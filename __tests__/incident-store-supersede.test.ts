// @vitest-environment node
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ArbiterDatabase } from "@/lib/infrastructure/db/schema";
import { SUPERSEDED, createIncidentStore } from "@/lib/stores/incident-store";
import type {
  LlmAssistOptions,
  LlmAssistOutcome,
  LlmAssistPort,
} from "@/lib/domain/llm/ports";
import type { ReportContext } from "@/lib/domain/services/game-context";
import { fixedProviders } from "./helpers";

const CTX: ReportContext = {
  competitionType: "standard",
  rulesVersion: "FIDE-2023",
  round: 1,
  boardNumber: 1,
};

function needsConfirmation(key: string): LlmAssistOutcome {
  return {
    status: "needs-confirmation",
    preview: {
      destination: "AI参考情報（Gemini）",
      fields: [{ label: "事象", text: key }],
      notes: [],
    },
    approvalKey: key,
  };
}

let n = 0;

/** 古い操作が後から完了しても、reset・後の操作の表示を上書きしない */
describe("incident store: late results of superseded runs are dropped", () => {
  let db: ArbiterDatabase;
  let release: Array<() => void>;
  let assist: ReturnType<typeof vi.fn>;
  /** 送信（approvalKey 付き）を保留にするか */
  let holdSends: boolean;

  function makeStore() {
    const llm: LlmAssistPort = { assist: assist as LlmAssistPort["assist"] };
    return createIncidentStore({
      db,
      providers: fixedProviders(`sup${n}`),
      llm,
    });
  }

  beforeEach(() => {
    db = new ArbiterDatabase(`supersede-${++n}`);
    release = [];
    holdSends = false;
    assist = vi.fn(
      async (
        req: { incident: { description?: string } },
        options?: LlmAssistOptions
      ): Promise<LlmAssistOutcome> => {
        const key = `key:${req.incident.description}`;
        if (options?.approvalKey !== key) return needsConfirmation(key);
        if (holdSends) await new Promise<void>((r) => release.push(r));
        return { status: "error", code: "upstream-timeout", message: "t" };
      }
    );
  });

  afterEach(async () => {
    await db.delete();
  });

  async function report(store: ReturnType<typeof makeStore>, text: string) {
    await store.getState().submitIncident({
      context: CTX,
      category: "player-behavior",
      description: text,
      arbiterObserved: true,
    });
    return store.getState().currentIncident!.id;
  }

  it("a send that completes after reset does not bring back its incident or busy state", async () => {
    const store = makeStore();
    await report(store, "X");
    holdSends = true;
    const pending = store.getState().confirmExternalAiSend();
    await vi.waitFor(() => expect(release).toHaveLength(1));
    expect(store.getState().isProcessing).toBe(true);

    store.getState().reset();
    expect(store.getState().isProcessing).toBe(false);
    release[0]();
    const res = await pending;

    expect(res).toEqual({ ok: false, error: SUPERSEDED });
    expect(store.getState().currentIncident).toBeNull();
    expect(store.getState().currentDecision).toBeNull();
    expect(store.getState().error).toBeNull();
    // 送信の結果は保存されている（履歴を読み込み直せば見える）
    const stored = await db.incidents.toArray();
    const decision = await db.decisions.get(stored[0].decisionId!);
    expect(decision?.llm?.status).toBe("unavailable");
  });

  it("a late result for incident X does not replace incident Y's pending confirmation", async () => {
    const store = makeStore();
    const x = await report(store, "X");
    const y = await report(store, "Y");
    await store.getState().retryIncident(x);
    holdSends = true;
    const sendX = store.getState().confirmExternalAiSend();
    await vi.waitFor(() => expect(release).toHaveLength(1));

    await store.getState().retryIncident(y);
    expect(store.getState().externalAiConfirmation?.approvalKey).toBe("key:Y");
    release[0]();
    expect((await sendX).ok).toBe(false);

    expect(store.getState().currentIncident?.id).toBe(y);
    expect(store.getState().externalAiConfirmation?.approvalKey).toBe("key:Y");
    expect(store.getState().isProcessing).toBe(false);
  });

  it("reset right after confirming clears the approval: a later retry asks again", async () => {
    const store = makeStore();
    const x = await report(store, "X");
    const pending = store.getState().confirmExternalAiSend();
    store.getState().reset();
    await pending;
    assist.mockClear();

    await store.getState().retryIncident(x);
    expect(assist).toHaveBeenCalledTimes(1);
    expect(assist.mock.calls[0][1]?.approvalKey).toBeUndefined();
    expect(store.getState().externalAiConfirmation).not.toBeNull();
  });
});
