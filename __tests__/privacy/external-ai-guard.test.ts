import { answeringProviders } from "../helpers";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  embedRuleDocuments,
  prepareClassification,
  prepareEmbeddingQuery,
  prepareReasoning,
  type CandidateArticle,
  type ReasoningInput,
} from "@/lib/application/external-ai-guard";
import { NO_IDENTIFIERS, type KnownIdentifiers } from "@/lib/domain/privacy";
import {
  EMBEDDING_MODEL,
  type LlmApiResponse,
} from "@/lib/infrastructure/llm/contract";
import { ArbiterDatabase } from "@/lib/infrastructure/db/schema";
import { loadKnownIdentifiers } from "@/lib/infrastructure/privacy/known-identifiers";
import { tournament } from "../tournament/fixtures";

/**
 * 外部AIガード（ADR-012, external-ai-data-protection.md §3, §8.3 Guard）。
 * 合成データのみ。
 */

const IDS: KnownIdentifiers = {
  ...NO_IDENTIFIERS,
  players: [{ name: "田中 太郎", fideId: "12345678" }],
  tournaments: ["秋季オープン"],
};
const withIds = { identifiers: async () => IDS };

function okEmbedCall() {
  return vi.fn(
    async (_kind: string, body: unknown): Promise<LlmApiResponse> => {
      const texts = (body as { texts: string[] }).texts;
      return {
        ok: true,
        result: {
          vectors: texts.map(() =>
            Array.from({ length: EMBEDDING_MODEL.dimensions }, () => 0.1)
          ),
        },
        model: EMBEDDING_MODEL.key,
      };
    }
  );
}

describe("only the guard reaches /api/llm/* (callLlmApi)", () => {
  const ROOT = join(__dirname, "..", "..");
  /** コメントを除いたソース（説明の中の名前は数えない） */
  const code = (p: string) =>
    readFileSync(join(ROOT, p), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }

  it("no module other than the guard (and the client itself) imports callLlmApi", () => {
    const offenders = ["lib", "app", "components"]
      .flatMap((d) => sources(join(ROOT, d)))
      .map((p) => relative(ROOT, p))
      .filter(
        (p) =>
          p !== "lib/application/external-ai-guard.ts" &&
          p !== "lib/infrastructure/llm/llm-api-client.ts"
      )
      .filter((p) => /\bcallLlmApi\b/.test(code(p)));
    expect(offenders).toEqual([]);
  });

  it("no module fetches /api/llm/ directly", () => {
    const offenders = ["lib", "app", "components"]
      .flatMap((d) => sources(join(ROOT, d)))
      .map((p) => relative(ROOT, p))
      .filter(
        (p) =>
          !p.startsWith("app/api/") && !p.startsWith("lib/infrastructure/llm/") // contract.ts の LLM_API_PATHS とサーバー
      )
      .filter((p) => /["'`]\/api\/llm/.test(code(p)));
    expect(offenders).toEqual([]);
  });
});

describe("classification", () => {
  it("sends only the de-identified narrative, after send(), and never the mapping", async () => {
    const call = vi.fn(async (): Promise<LlmApiResponse> => ({
      ok: true,
      result: {},
      model: "m",
    }));
    const r = await prepareClassification(
      "田中太郎のスマホが鳴った",
      {},
      { ...withIds, call: answeringProviders(call) }
    );
    if (r.status !== "needs-confirmation") throw new Error("expected clear");
    expect(r.preview.fields[0].text).toBe("〈選手A〉のスマホが鳴った");
    expect(r.preview.destination).toBe("カテゴリの提案（Gemini（Google））");
    expect(call).not.toHaveBeenCalled();
    await r.send();
    expect(call).toHaveBeenCalledTimes(1);
    const [kind, body] = call.mock.calls[0] as unknown as [string, unknown];
    expect(kind).toBe("classify");
    expect(body).toEqual({
      narrative: "〈選手A〉のスマホが鳴った",
      provider: "gemini",
    });
    expect(JSON.stringify(body)).not.toContain("田中");
  });

  it.each([
    [
      "fair-play category (L0)",
      "黒のスマホが鳴った",
      { category: "fair-play" as const },
    ],
    ["opt-out switch (L1)", "黒のスマホが鳴った", { doNotSend: true }],
    ["health (L2)", "白が対局中に体調が悪いと言った", {}],
    ["ambiguous (L3)", "白が離席した", {}],
    ["unknown vocabulary (L3v)", "白が会場の外でぐずぐずしていた", {}],
  ])("%s → local, with reason codes only", async (_label, text, options) => {
    const call = vi.fn();
    const r = await prepareClassification(text, options, { ...withIds, call });
    expect(r.status).toBe("local");
    if (r.status !== "local") return;
    expect(r.reasons.length).toBeGreaterThan(0);
    // 理由はコードだけ（本文を含めない）
    expect(JSON.stringify(r)).not.toContain(text);
    expect(call).not.toHaveBeenCalled();
  });

  it("fails closed when the known identifiers cannot be loaded", async () => {
    const call = vi.fn();
    const r = await prepareClassification(
      "黒のスマホが鳴った",
      {},
      {
        call,
        identifiers: async () => {
          throw new Error("db closed");
        },
      }
    );
    expect(r).toEqual({ status: "local", reasons: ["residual"] });
    expect(call).not.toHaveBeenCalled();
  });
});

describe("embedding queries", () => {
  it("sends the de-identified query only through send()", async () => {
    const call = okEmbedCall();
    const r = await prepareEmbeddingQuery(
      "田中太郎のスマホが鳴った",
      {},
      { ...withIds, call }
    );
    if (r.status !== "needs-confirmation") throw new Error("expected clear");
    expect(r.query).toBe("〈選手A〉のスマホが鳴った");
    expect(call).not.toHaveBeenCalled();
    await r.send();
    expect(call.mock.calls[0][1]).toEqual({
      taskType: "query",
      texts: ["〈選手A〉のスマホが鳴った"],
    });
  });

  it("a sensitive query is not sent (keyword search only)", async () => {
    const r = await prepareEmbeddingQuery("救急車を呼んだ場合", {}, withIds);
    expect(r.status).toBe("local");
  });
});

describe("document embeddings", () => {
  it("de-identifies tournament regulations with the narrow rules; FIDE text is unchanged", async () => {
    const call = okEmbedCall();
    await embedRuleDocuments(
      [
        {
          text: "第3条 問い合わせは田中太郎（090-1234-5678）まで。1600以下のクラスは第2ラウンドから。",
          sourceType: "tournament",
        },
        {
          text: "11.3 During play a player is forbidden to have any electronic device. Arbiter 2023",
          sourceType: "FIDE",
        },
      ],
      { deps: { ...withIds, call } }
    );
    const texts = (call.mock.calls[0][1] as { texts: string[] }).texts;
    expect(texts[0]).not.toContain("田中");
    expect(texts[0]).not.toContain("090-1234-5678");
    // 大会規定の中身（レーティング・ラウンド）は残す（§5.5）
    expect(texts[0]).toContain("1600以下");
    expect(texts[0]).toContain("第2ラウンド");
    expect(texts[1]).toBe(
      "11.3 During play a player is forbidden to have any electronic device. Arbiter 2023"
    );
  });

  it("does not load identifiers when there is no tournament regulation", async () => {
    const identifiers = vi.fn(async () => IDS);
    await embedRuleDocuments([{ text: "FIDE 1.1", sourceType: "FIDE" }], {
      deps: { identifiers, call: okEmbedCall() },
    });
    expect(identifiers).not.toHaveBeenCalled();
  });
});

describe("reasoning", () => {
  const INPUT: ReasoningInput = {
    incident: {
      category: "player-behavior",
      subtype: undefined,
      playerColor: "black",
      description: "田中太郎のスマホが鳴った",
      arbiterObserved: true,
    },
    context: { competitionType: "standard", rulesVersion: "FIDE-2023" },
  };
  const TOURNAMENT_ARTICLE: CandidateArticle = {
    id: "r-t",
    article: "第5条",
    title: "電子機器",
    content:
      "田中太郎選手を含む全選手は、対局中に電子機器を身に着けてはならない。連絡先 info@example.com",
    source: "tournament",
    sourceName: "秋季オープン 大会規定",
    sourceVersion: "2026",
    page: 1,
    priority: 1000,
  };
  const FIDE_ARTICLE: CandidateArticle = {
    id: "r-f",
    article: "11.3.2.1",
    title: "Electronic devices",
    content:
      "During play, a player is forbidden to have any electronic device.",
    source: "FIDE",
    sourceName: "FIDE Laws of Chess",
    sourceVersion: "2023",
    priority: 1,
  };

  it("de-identifies the description and tournament articles with one shared map; no tournament id or regulation name", async () => {
    const call = vi.fn(async (): Promise<LlmApiResponse> => ({
      ok: true,
      result: {},
      model: "m",
    }));
    const r = await prepareReasoning(INPUT, { ...withIds, call });
    if (r.status !== "needs-confirmation") throw new Error("expected clear");
    expect(r.preview.fields[0].text).toBe("〈選手A〉のスマホが鳴った");
    expect(JSON.stringify(r.preview)).not.toContain("田中");

    const sent = r.toSentArticles([TOURNAMENT_ARTICLE, FIDE_ARTICLE]);
    expect(sent[0].content).toContain("〈選手A〉");
    expect(sent[0].content).not.toContain("田中");
    expect(sent[0].content).not.toContain("info@example.com");
    expect(sent[0].sourceName).toBe("大会規定");
    expect(sent[0]).not.toHaveProperty("sourceVersion");
    expect(sent[1]).toEqual({
      id: "r-f",
      article: "11.3.2.1",
      title: "Electronic devices",
      content: FIDE_ARTICLE.content,
      source: "FIDE",
      sourceName: "FIDE Laws of Chess",
      sourceVersion: "2023",
      page: undefined,
      priority: 1,
    });

    expect(call).not.toHaveBeenCalled();
    await r.send(sent);
    const body = JSON.stringify((call.mock.calls[0] as unknown[])[1]);
    expect(body).not.toContain("田中");
    expect(body).not.toContain("秋季オープン");
    expect(body).not.toContain("tournamentId");
    expect(r.reidentify("〈選手A〉に確認する").text).toBe(
      "田中 太郎に確認する"
    );
  });

  it("the approval key changes when the payload changes (a new name is registered)", async () => {
    const before = await prepareReasoning(
      {
        ...INPUT,
        incident: {
          ...INPUT.incident,
          description: "佐藤花子のスマホが鳴った",
        },
      },
      { identifiers: async () => ({ ...IDS, players: [] }) }
    );
    const after = await prepareReasoning(
      {
        ...INPUT,
        incident: {
          ...INPUT.incident,
          description: "佐藤花子のスマホが鳴った",
        },
      },
      {
        identifiers: async () => ({
          ...IDS,
          players: [{ name: "佐藤 花子" }],
        }),
      }
    );
    // 名前が未登録の場合は語彙の判定で止まる（敬称なしの名前は送らない）
    expect(before.status).toBe("local");
    expect(after.status).toBe("needs-confirmation");
  });

  it("a sensitive description is not sent, and nothing is prepared", async () => {
    const r = await prepareReasoning(
      {
        ...INPUT,
        incident: {
          ...INPUT.incident,
          description: "白が倒れて救急車を呼んだ",
        },
      },
      withIds
    );
    expect(r.status).toBe("local");
  });
});

describe("loadKnownIdentifiers (IndexedDB)", () => {
  let db: ArbiterDatabase;
  beforeEach(async () => {
    db = new ArbiterDatabase(`known-ids-${Math.random()}`);
    await db.open();
  });
  afterEach(async () => {
    await db.delete();
  });

  it("reads player profiles, every saved game's players and tournament fields, without duplicates", async () => {
    const now = new Date(0);
    await db.tournaments.put(
      tournament({
        id: "T1",
        name: "秋季オープン",
        venue: "市民会館",
        chiefArbiter: "山田 一郎",
      })
    );
    await db.players.bulkAdd([
      {
        id: "p1",
        tournamentId: "T1",
        name: "田中 太郎",
        fideId: "12345678",
        title: "FM",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "p2",
        tournamentId: "T1",
        name: "  ",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.games.add({
      id: "g1",
      tournamentId: "T1",
      round: 1,
      white: { name: "鈴木 次郎" },
      black: { name: "田中 太郎", fideId: "12345678" },
      startTime: now,
      createdAt: now,
      updatedAt: now,
    } as never);

    const ids = await loadKnownIdentifiers(db, {
      players: [{ name: "未保存 選手" }],
    });
    expect(ids.players.map((p) => p.name).sort()).toEqual(
      ["未保存 選手", "田中 太郎", "田中 太郎", "鈴木 次郎"].sort()
    );
    expect(ids.players).toContainEqual({
      name: "田中 太郎",
      fideId: "12345678",
      title: "FM",
    });
    expect(ids.tournaments).toEqual(["秋季オープン"]);
    expect(ids.venues).toEqual(["市民会館"]);
    expect(ids.officials).toEqual(["山田 一郎"]);
  });
});
