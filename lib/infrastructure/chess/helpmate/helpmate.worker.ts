/// <reference lib="webworker" />
/**
 * ヘルプメイト探索の Web Worker（ADR-015）。画面を止めずに、時間の上限つきで探索する。
 */
import type { HelpmateWorkerRequest, HelpmateWorkerResponse } from "./port";
import { runHelpmateSearch } from "./run";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<HelpmateWorkerRequest>) => {
  const { id, request } = e.data;
  let response: HelpmateWorkerResponse;
  try {
    response = { id, record: runHelpmateSearch(request) };
  } catch (error) {
    response = {
      id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  ctx.postMessage(response);
};
