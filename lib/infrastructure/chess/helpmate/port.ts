import type { MateSearchRecord } from "@/lib/domain/entities";
import type {
  HelpmateSearchPort,
  MatePositionRequest,
} from "@/lib/domain/services/mate-possibility";
import { HELPMATE_TIME_BUDGET_MS, runHelpmateSearch } from "./run";

/** Worker との間のメッセージ */
export interface HelpmateWorkerRequest {
  id: number;
  request: MatePositionRequest;
}
export interface HelpmateWorkerResponse {
  id: number;
  record?: MateSearchRecord;
  error?: string;
}

/** Worker から応答がないときに諦めるまでの時間（探索の期限 + 余裕） */
export const HELPMATE_WORKER_TIMEOUT_MS = HELPMATE_TIME_BUDGET_MS + 3500;

export interface HelpmateSearchPortOptions {
  /** Worker を作る（テスト用に差し替え可能）。null なら探索をその場で実行する */
  createWorker?: () => Worker | null;
  timeoutMs?: number;
}

function defaultCreateWorker(): Worker | null {
  if (typeof window === "undefined" || typeof Worker === "undefined")
    return null;
  try {
    return new Worker(new URL("./helpmate.worker.ts", import.meta.url));
  } catch {
    return null;
  }
}

/**
 * ヘルプメイト探索のポート（ADR-015）。
 * ブラウザでは Web Worker で探索し、画面を止めない。Worker を使えない環境（テスト・SSR）
 * では同じ探索をその場で実行する。Worker は最初の探索のときに作る。
 * - Worker のエラー: 待っている探索を失敗させ、以降はその場で探索する
 * - 応答がない（モバイルで Worker が止められた等）: その探索を失敗させ、次回は Worker を作り直す
 */
export function createHelpmateSearchPort(
  options: HelpmateSearchPortOptions = {}
): HelpmateSearchPort {
  const createWorker = options.createWorker ?? defaultCreateWorker;
  const timeoutMs = options.timeoutMs ?? HELPMATE_WORKER_TIMEOUT_MS;
  let worker: Worker | null | undefined;
  let nextId = 0;
  const pending = new Map<
    number,
    {
      resolve: (r: MateSearchRecord) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  const failAll = (message: string, next: Worker | null | undefined) => {
    pending.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    });
    pending.clear();
    worker?.terminate();
    worker = next;
  };

  const getWorker = (): Worker | null => {
    if (worker !== undefined) return worker;
    const w = createWorker();
    worker = w;
    if (!w) return null;
    w.onmessage = (e: MessageEvent<HelpmateWorkerResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      clearTimeout(p.timer);
      if (e.data.record) p.resolve(e.data.record);
      else p.reject(new Error(e.data.error ?? "探索に失敗しました"));
    };
    w.onerror = (e) => failAll(e.message || "Worker error", null);
    w.onmessageerror = () => failAll("Worker message error", null);
    return w;
  };

  return {
    search(request) {
      const w = getWorker();
      if (!w) return Promise.resolve(runHelpmateSearch(request));
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => failAll("探索の応答がありません", undefined),
          timeoutMs
        );
        pending.set(id, { resolve, reject, timer });
        w.postMessage({ id, request } satisfies HelpmateWorkerRequest);
      });
    },
  };
}
