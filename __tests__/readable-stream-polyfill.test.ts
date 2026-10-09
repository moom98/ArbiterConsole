import { describe, it, expect } from "vitest";
import { ensureReadableStreamAsyncIterator } from "@/lib/infrastructure/pdf/readable-stream-polyfill";

/**
 * Safari には ReadableStream.prototype[Symbol.asyncIterator] がない。pdfjs の getTextContent は
 * `for await` で読むため、取り込みが「undefined is not a function (near '...t of e...')」で失敗した
 */

/** asyncIterator を持たない ReadableStream（Safari 相当） */
function safariLikeReadableStream() {
  class SafariReadableStream {
    private readonly inner: ReadableStream<unknown>;
    cancelled: unknown = "not-cancelled";
    constructor(chunks: unknown[]) {
      this.inner = new ReadableStream({
        start(c) {
          for (const x of chunks) c.enqueue(x);
          c.close();
        },
        cancel: (reason) => {
          this.cancelled = reason;
        },
      });
    }
    getReader() {
      return this.inner.getReader();
    }
  }
  return SafariReadableStream;
}

describe("ensureReadableStreamAsyncIterator", () => {
  it("adds for-await support when missing, and reads every chunk", async () => {
    const RS = safariLikeReadableStream();
    const target = { ReadableStream: RS };
    expect(
      (RS.prototype as unknown as Record<symbol, unknown>)[Symbol.asyncIterator]
    ).toBeUndefined();
    expect(ensureReadableStreamAsyncIterator(target)).toBe(true);

    const got: unknown[] = [];
    for await (const v of new RS([
      "a",
      "b",
      "c",
    ]) as unknown as AsyncIterable<unknown>)
      got.push(v);
    expect(got).toEqual(["a", "b", "c"]);
  });

  it("breaking out of the loop cancels the stream and releases the reader", async () => {
    const RS = safariLikeReadableStream();
    ensureReadableStreamAsyncIterator({ ReadableStream: RS });
    const stream = new RS([1, 2, 3]);
    for await (const v of stream as unknown as AsyncIterable<unknown>) {
      expect(v).toBe(1);
      break;
    }
    expect(stream.cancelled).toBeUndefined();
    // ロックが外れているので、もう一度 reader を取れる
    expect(() => stream.getReader()).not.toThrow();
  });

  it("does nothing where the browser already supports it", () => {
    expect(ensureReadableStreamAsyncIterator()).toBe(false);
    expect(ensureReadableStreamAsyncIterator({})).toBe(false);
  });
});
