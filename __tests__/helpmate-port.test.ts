import { describe, it, expect, vi, afterEach } from "vitest";
import type { MateSearchRecord } from "@/lib/domain/entities";
import { HELPMATE_ENGINE_VERSION } from "@/lib/domain/services/mate-possibility";
import { createHelpmateSearchPort } from "@/lib/infrastructure/chess/helpmate/port";

const REQUEST = {
  fen: "7k/Q7/6K1/8/8/8/8/8 w - - 0 1",
  attacker: "white" as const,
};
const RECORD: MateSearchRecord = {
  ...REQUEST,
  status: "found",
  moves: ["Qg7#"],
  engine: HELPMATE_ENGINE_VERSION,
};

/** テスト用の Worker（postMessage を受けて、指定した応答を返す） */
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  posted: { id: number }[] = [];
  constructor(
    private readonly reply: (
      w: FakeWorker,
      msg: { id: number }
    ) => void = () => {}
  ) {}
  postMessage(msg: { id: number }) {
    this.posted.push(msg);
    this.reply(this, msg);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

afterEach(() => vi.useRealTimers());

describe("createHelpmateSearchPort (ADR-015)", () => {
  it("returns the worker's record", async () => {
    const w = new FakeWorker((w, m) =>
      queueMicrotask(() => w.emit({ id: m.id, record: RECORD }))
    );
    const port = createHelpmateSearchPort({
      createWorker: () => w as unknown as Worker,
    });
    await expect(port.search(REQUEST)).resolves.toEqual(RECORD);
  });

  it("rejects on an error response", async () => {
    const w = new FakeWorker((w, m) =>
      queueMicrotask(() => w.emit({ id: m.id, error: "boom" }))
    );
    const port = createHelpmateSearchPort({
      createWorker: () => w as unknown as Worker,
    });
    await expect(port.search(REQUEST)).rejects.toThrow("boom");
  });

  it("after a worker error, pending searches fail and later searches run in place", async () => {
    const w = new FakeWorker();
    const create = vi.fn(() => w as unknown as Worker);
    const port = createHelpmateSearchPort({ createWorker: create });
    const first = port.search(REQUEST);
    w.onerror?.({ message: "crashed" } as ErrorEvent);
    await expect(first).rejects.toThrow("crashed");
    expect(w.terminated).toBe(true);
    const second = await port.search(REQUEST);
    expect(second.status).toBe("found"); // その場で探索した結果
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("times out when the worker never answers, then recreates the worker", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const port = createHelpmateSearchPort({
      createWorker: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w as unknown as Worker;
      },
      timeoutMs: 1000,
    });
    const first = port.search(REQUEST);
    const assertion = expect(first).rejects.toThrow("応答がありません");
    vi.advanceTimersByTime(1000);
    await assertion;
    expect(workers[0].terminated).toBe(true);
    void port.search(REQUEST).catch(() => {});
    expect(workers).toHaveLength(2);
  });
});
