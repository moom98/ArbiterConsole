/**
 * ReadableStream の非同期反復（`for await (const x of stream)`）の補完。
 *
 * pdfjs-dist（v5 以降）の `page.getTextContent()` は ReadableStream を `for await` で読む。
 * Safari（iOS を含む）は ReadableStream.prototype[Symbol.asyncIterator] を実装していないため、
 * 「undefined is not a function (near '...t of e...')」で PDF の取り込みが失敗する。
 * 未実装の場合だけ、reader.read() による同等の反復を追加する（実装済みのブラウザでは何もしない）。
 *
 * worker 側の `for await`（DecompressionStream）は pdfjs が失敗時に別の展開方法へ切り替えるため対象外。
 */

interface ReadableStreamLike {
  getReader(): {
    read(): Promise<{ done: boolean; value?: unknown }>;
    cancel(reason?: unknown): Promise<void>;
    releaseLock(): void;
  };
}

export function ensureReadableStreamAsyncIterator(
  target: { ReadableStream?: unknown } = globalThis as {
    ReadableStream?: unknown;
  }
): boolean {
  const RS = target.ReadableStream as
    { prototype: Record<symbol, unknown> } | undefined;
  if (!RS || typeof Symbol === "undefined" || !Symbol.asyncIterator)
    return false;
  const proto = RS.prototype;
  if (typeof proto[Symbol.asyncIterator] === "function") return false;

  Object.defineProperty(proto, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value: function (this: ReadableStreamLike) {
      const reader = this.getReader();
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        reader.releaseLock();
      };
      const iterator = {
        next(): Promise<IteratorResult<unknown>> {
          return reader.read().then(
            (r) => {
              if (r.done) {
                finish();
                return { done: true, value: undefined };
              }
              return { done: false, value: r.value };
            },
            (error: unknown) => {
              finish();
              throw error;
            }
          );
        },
        // break・例外で反復を途中で終えた場合（仕様どおりストリームを取り消す）
        return(value?: unknown): Promise<IteratorResult<unknown>> {
          if (finished) return Promise.resolve({ done: true, value });
          return reader.cancel(value).then(
            () => {
              finish();
              return { done: true, value };
            },
            () => {
              finish();
              return { done: true, value };
            }
          );
        },
        [Symbol.asyncIterator]() {
          return iterator;
        },
      };
      return iterator;
    },
  });
  return true;
}
