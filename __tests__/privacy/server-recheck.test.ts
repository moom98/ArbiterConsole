import { answeringProviders } from "../helpers";
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import benign from "../fixtures/privacy/benign.ja.json";
import benignReview from "../fixtures/privacy/benign-review.ja.json";
import pii from "../fixtures/privacy/pii.ja.json";
import {
  prepareClassification,
  prepareEmbeddingQuery,
  prepareReasoning,
  type CandidateArticle,
} from "@/lib/application/external-ai-guard";
import {
  MINIMIZATION_LIMITS,
  NO_IDENTIFIERS,
  PlaceholderMap,
  protectIncidentText,
  recheckIncidentText,
  recheckRegulationText,
  type KnownIdentifiers,
  type ProtectedTextRoute,
} from "@/lib/domain/privacy";
import {
  LLM_LIMITS,
  type LlmApiResponse,
} from "@/lib/infrastructure/llm/contract";
import {
  validateClassificationRequest,
  validateEmbedRequest,
  validateReasoningRequest,
} from "@/lib/infrastructure/llm/server/request-validation";

/**
 * 送信内容の再確認（L5。external-ai-data-protection.md §7）。合成データのみ。
 * - サーバーは対応表を持たずに、ゲート・パターンの規則・残存チェックをもう一度行う
 * - クライアントも送る直前に同じ関数を通すため、正しいクライアントの送信は 400 にならない
 */

const PII_IDS = pii.identifiers as unknown as KnownIdentifiers;
const ROUTES: ProtectedTextRoute[] = [
  "classify",
  "facts",
  "reason-description",
  "embed-query",
];

describe("recheckIncidentText (L5, incident-derived text)", () => {
  it("accepts de-identified text with indexed placeholders and clock readings", () => {
    for (const text of [
      "〈選手A〉が違法手を指したので〈選手B〉がクレームした",
      "白の時計のフラッグが落ちたと黒が申し立てた",
      "黒の残り0:45でフラッグが落ちた",
      "〈日時1〉に〈盤1〉で白が違法手を指した",
    ])
      expect(recheckIncidentText(text, "classify"), text).toEqual({
        ok: true,
      });
  });

  it.each([
    ["date", "6月8日に白が違法手を指した"],
    ["time", "白が13時に違法手を指した"],
    ["contact", "白の連絡先は090-1234-5678です"],
    ["board", "第3ボードで白が違法手を指した"],
    ["round", "第2ラウンドで白が違法手を指した"],
    ["labelled id", "会員番号: 123456 の白が違法手を指した"],
    ["rating", "レーティング1850の白が違法手を指した"],
    ["honorific name", "山本さんが違法手を指したので黒がクレームした"],
    ["latin name", "IM Smith played an illegal move"],
  ])("rejects text that the pattern rules would still change (%s)", (_n, t) => {
    const r = recheckIncidentText(t, "reason-description");
    expect(r.ok).toBe(false);
  });

  it("names 'pattern' when only the redaction would change the text", () => {
    const r = recheckIncidentText(
      "山本さんが違法手を指したので黒がクレームした",
      "reason-description"
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.findings).toContain("pattern");
  });

  it("rejects sensitive text (the gate is not clear), even with placeholders", () => {
    for (const t of [
      "〈選手A〉が対局中に気分が悪くなり倒れた",
      "〈選手A〉の持病の発作で対局が止まった",
      "相手がカンニングしている疑い",
    ]) {
      const r = recheckIncidentText(t, "reason-description");
      expect(r.ok, t).toBe(false);
    }
  });

  it("rejects a placeholder-shaped bracket that is not an indexed placeholder", () => {
    // 〈田中太郎〉は placeholder の形ではない。規則の対象になり、本文が変わる
    const r = recheckIncidentText(
      "〈田中太郎〉が違法手を指したので黒がクレームした",
      "classify"
    );
    expect(r.ok).toBe(false);
  });

  it("applies the minimum narrative length only to classify and facts", () => {
    const t = "〈選手A〉が違法手";
    expect(recheckIncidentText(t, "classify").ok).toBe(false);
    expect(recheckIncidentText(t, "facts").ok).toBe(false);
    expect(recheckIncidentText(t, "reason-description").ok).toBe(true);
  });

  it("rejects text that is not NFKC-normalised (the server never rewrites)", () => {
    // 全角の数字は NFKC で半角になる。クライアントの出力は必ず正規化済み
    expect(
      recheckIncidentText(
        "白が違法手を指したので黒がクレームした１",
        "reason-description"
      ).ok
    ).toBe(false);
  });
});

describe("recheckRegulationText (L5, tournament regulation text: rules 1, 5, 12 only)", () => {
  it("keeps rating limits, ages, round numbers, times and dates", () => {
    for (const t of [
      "レーティング1600以下の選手に限る",
      "12歳以下の部",
      "第3ラウンドは13時に開始する",
      "2026年6月8日に開催する",
      "〈選手A〉は前年度の優勝者とする",
    ])
      expect(recheckRegulationText(t), t).toEqual({ ok: true });
  });

  it.each([
    ["mail", "問い合わせは info@example.com まで"],
    ["phone", "連絡先 03-1234-5678"],
    ["labelled id", "会員番号: 123456 の選手"],
    ["honorific name", "主催者の山本さんに連絡する"],
  ])(
    "rejects contact details, labelled ids and names with an honorific (%s)",
    (_n, t) => {
      expect(recheckRegulationText(t).ok).toBe(false);
    }
  );
});

describe("client and server agree: whatever the guard sends passes the server (no 400 for a correct client)", () => {
  const sets: [string, { text: string }[], KnownIdentifiers][] = [
    ["benign", benign.cases, NO_IDENTIFIERS],
    ["benign-review", benignReview.cases, NO_IDENTIFIERS],
    ["pii", pii.cases, PII_IDS],
  ];

  it("protectIncidentText output always passes recheckIncidentText (E2 = L5)", () => {
    for (const [name, cases, ids] of sets)
      for (const route of ROUTES)
        for (const c of cases) {
          const r = protectIncidentText({
            route,
            text: c.text,
            identifiers: ids,
            map: new PlaceholderMap(),
          });
          if (r.ok)
            expect(
              recheckIncidentText(r.text, route),
              `${name} ${route} ${c.text}`
            ).toEqual({ ok: true });
        }
  });

  it("E2 does not hold back any fixture text that the earlier steps let through", () => {
    const stopped: string[] = [];
    for (const [name, cases, ids] of sets)
      for (const route of ROUTES)
        for (const c of cases) {
          const r = protectIncidentText({
            route,
            text: c.text,
            identifiers: ids,
            map: new PlaceholderMap(),
          });
          if (!r.ok && r.stage === "recheck")
            stopped.push(`${name} ${route}: ${c.text}`);
        }
    expect(stopped).toEqual([]);
  });

  it("a newline join that would create a new pattern is held back on the device (stage recheck), not sent", () => {
    // 文を改行でつなぐと「12」「34」が「1234」（4桁の数字）になる。サーバーでは本文が変わる
    const r = protectIncidentText({
      route: "classify",
      text: "白が違法手を指したので黒がクレームした。白の残り12\n34手目に黒がクレームした",
      identifiers: NO_IDENTIFIERS,
      map: new PlaceholderMap(),
    });
    expect(r).toMatchObject({
      ok: false,
      stage: "recheck",
      recheck: ["pattern"],
    });
  });

  function capture() {
    return vi.fn(
      async (_kind: string, _body: unknown): Promise<LlmApiResponse> => ({
        ok: true,
        result: { vectors: [Array.from({ length: 768 }, () => 0.1)] },
        model: "gemini-embedding-001@768+deid1",
      })
    );
  }

  it("classification bodies from the guard pass validateClassificationRequest", async () => {
    let checked = 0;
    for (const [, cases, ids] of sets)
      for (const c of cases) {
        const call = capture();
        const r = await prepareClassification(
          c.text,
          {},
          { identifiers: async () => ids, call: answeringProviders(call) }
        );
        if (r.status !== "needs-confirmation") continue;
        await r.send();
        const body = JSON.parse(JSON.stringify(call.mock.calls[0][1]));
        expect(validateClassificationRequest(body), c.text).toMatchObject({
          ok: true,
        });
        checked++;
      }
    expect(checked).toBeGreaterThan(20);
  });

  it("query bodies from the guard pass validateEmbedRequest", async () => {
    let checked = 0;
    for (const [, cases, ids] of sets)
      for (const c of cases.slice(0, 40)) {
        const call = capture();
        const r = await prepareEmbeddingQuery(
          c.text,
          {},
          { identifiers: async () => ids, call }
        );
        if (r.status !== "needs-confirmation") continue;
        await r.send();
        const body = JSON.parse(JSON.stringify(call.mock.calls[0][1]));
        expect(validateEmbedRequest(body), c.text).toMatchObject({ ok: true });
        checked++;
      }
    expect(checked).toBeGreaterThan(20);
  });

  const TOURNAMENT_ARTICLE: CandidateArticle = {
    id: "r-t",
    article: "第5条",
    title: "電子機器（田中 太郎 選手の申し出による）",
    content:
      "レーティング1600以下の部は13時に開始する。問い合わせは info@example.com または主催者の山本さんまで。会員番号: 123456 の選手は受付で申し出ること。田中 太郎さんは前年度の優勝者。",
    source: "tournament",
    sourceName: "秋季オープン 大会規定",
    sourceVersion: "2026",
    priority: 1000,
  };
  const FIDE_ARTICLE: CandidateArticle = {
    id: "r-f",
    article: "11.3.2.1",
    title: "Electronic devices",
    content:
      "During play, a player is forbidden to have any electronic device not specifically approved by the arbiter in the playing venue. 2023-01-01",
    source: "FIDE",
    sourceName: "FIDE Laws of Chess",
    sourceVersion: "2023",
    page: 44,
    priority: 10,
  };

  it("reasoning bodies from the guard pass validateReasoningRequest (incident text and tournament articles)", async () => {
    let checked = 0;
    for (const [, cases, ids] of sets)
      for (const c of cases) {
        const call = capture();
        const r = await prepareReasoning(
          {
            incident: {
              category: "illegal-move",
              subtype: "two-hands",
              playerColor: "white",
              description: c.text,
              arbiterObserved: true,
            },
            context: { competitionType: "standard", rulesVersion: "FIDE-2023" },
          },
          { identifiers: async () => ids, call }
        );
        if (r.status !== "needs-confirmation") continue;
        await r.send(r.toSentArticles([TOURNAMENT_ARTICLE, FIDE_ARTICLE]));
        const body = JSON.parse(JSON.stringify(call.mock.calls[0][1]));
        expect(validateReasoningRequest(body), c.text).toMatchObject({
          ok: true,
        });
        checked++;
      }
    expect(checked).toBeGreaterThan(20);
  });

  it("an unknown stored subtype (old data) is not sent, so the server does not reject the request", async () => {
    const call = capture();
    const r = await prepareReasoning(
      {
        incident: {
          category: "player-behavior",
          subtype: "legacy-free-text",
          description: "白が違法手を指したので黒がクレームした",
          arbiterObserved: false,
        },
        context: { competitionType: "standard", rulesVersion: "FIDE-2023" },
      },
      { identifiers: async () => NO_IDENTIFIERS, call }
    );
    if (r.status !== "needs-confirmation") throw new Error("expected clear");
    await r.send(r.toSentArticles([FIDE_ARTICLE]));
    const body = JSON.parse(JSON.stringify(call.mock.calls[0][1]));
    expect(body.incident).not.toHaveProperty("subtype");
    expect(validateReasoningRequest(body)).toMatchObject({ ok: true });
  });

  it("tournament articles as sent pass the server's regulation re-check field by field", async () => {
    const r = await prepareReasoning(
      {
        incident: {
          category: "illegal-move",
          description: "白が違法手を指したので黒がクレームした",
          arbiterObserved: true,
        },
        context: { competitionType: "standard", rulesVersion: "FIDE-2023" },
      },
      { identifiers: async () => NO_IDENTIFIERS, call: capture() }
    );
    if (r.status !== "needs-confirmation") throw new Error("expected clear");
    // 再確認を通らない大会規定は toSentArticles が落とす（null）。通常の規定は置き換え後に通る
    const sent = r.toSentArticles([TOURNAMENT_ARTICLE, FIDE_ARTICLE]);
    expect(sent.map((a) => a.id)).toEqual(["r-t", "r-f"]);
    for (const a of sent.filter((x) => x.source === "tournament"))
      for (const t of [a.article, a.title, a.content])
        expect(recheckRegulationText(t)).toEqual({ ok: true });
  });

  // 切った位置が空白でも、送る本文はプレビューと同じで、サーバーを通る（J1a-3 レビュー M1）
  const LONG = (n: number, tail: string) =>
    "白が違法手を指したので黒がクレームした。"
      .repeat(Math.ceil(n / 20))
      .slice(0, n) + tail;

  it("long text cut at whitespace: the query sent equals the preview and passes the server (embed-query)", async () => {
    const call = capture();
    const r = await prepareEmbeddingQuery(
      // 200 文字目が空白（9文の後に19文字、空白、続き）
      LONG(180, "白が違法手を指したので黒がクレームした 黒がクレームした"),
      {},
      { identifiers: async () => NO_IDENTIFIERS, call }
    );
    if (r.status !== "needs-confirmation") throw new Error("expected clear");
    expect(r.query).toHaveLength(199);
    expect(r.query).toBe(r.query.trim());
    await r.send();
    const body = JSON.parse(JSON.stringify(call.mock.calls[0][1]));
    expect(body.texts[0]).toBe(r.query);
    expect(r.preview.fields[0].text).toBe(r.query);
    expect(validateEmbedRequest(body)).toMatchObject({ ok: true });
  });

  it("a cut that would leave 「三時」 at the end is held back on the device, not rejected by the server", async () => {
    const call = capture();
    const r = await prepareEmbeddingQuery(
      LONG(197, "三時 白がクレームした"),
      {},
      { identifiers: async () => NO_IDENTIFIERS, call }
    );
    expect(r.status).toBe("local");
    expect(call).not.toHaveBeenCalled();
  });

  it.each([
    ["classify", 495],
    ["reason-description", 995],
    ["embed-query", 195],
  ] as const)(
    "long inputs for %s (forced truncation) stay consistent with the server",
    async (route, n) => {
      for (const tail of [
        "三時 白がクレームした",
        " 〈選手A〉が",
        "白がクレーム  黒",
      ]) {
        const call = capture();
        const text = LONG(n, tail);
        if (route === "classify") {
          const r = await prepareClassification(
            text,
            {},
            { identifiers: async () => NO_IDENTIFIERS, call }
          );
          if (r.status !== "needs-confirmation") continue;
          await r.send();
          const body = JSON.parse(JSON.stringify(call.mock.calls[0][1]));
          expect(body.narrative).toBe(r.preview.fields[0].text);
          expect(validateClassificationRequest(body), tail).toMatchObject({
            ok: true,
          });
        } else if (route === "embed-query") {
          const r = await prepareEmbeddingQuery(
            text,
            {},
            { identifiers: async () => NO_IDENTIFIERS, call }
          );
          if (r.status !== "needs-confirmation") continue;
          await r.send();
          const body = JSON.parse(JSON.stringify(call.mock.calls[0][1]));
          expect(validateEmbedRequest(body), tail).toMatchObject({ ok: true });
        } else {
          const r = await prepareReasoning(
            {
              incident: {
                category: "illegal-move",
                description: text,
                arbiterObserved: true,
              },
              context: {
                competitionType: "standard",
                rulesVersion: "FIDE-2023",
              },
            },
            { identifiers: async () => NO_IDENTIFIERS, call }
          );
          if (r.status !== "needs-confirmation") continue;
          await r.send(r.toSentArticles([FIDE_ARTICLE]));
          const body = JSON.parse(JSON.stringify(call.mock.calls[0][1]));
          expect(body.incident.description).toBe(r.preview.fields[0].text);
          expect(validateReasoningRequest(body), tail).toMatchObject({
            ok: true,
          });
        }
      }
    }
  );

  it("a tournament article whose truncation creates a new match is not sent (toSentArticles drops it)", async () => {
    const r = await prepareReasoning(
      {
        incident: {
          category: "illegal-move",
          description: "白が違法手を指したので黒がクレームした",
          arbiterObserved: true,
        },
        context: { competitionType: "standard", rulesVersion: "FIDE-2023" },
      },
      { identifiers: async () => NO_IDENTIFIERS, call: capture() }
    );
    if (r.status !== "needs-confirmation") throw new Error("expected clear");
    // 13桁の数字は連絡先の規則に当たらないが、4,000 文字で切ると「0312345678」（電話番号の形）になる
    const content =
      "あ".repeat(LLM_LIMITS.maxArticleContentChars - 10) + "0312345678901";
    expect(
      recheckRegulationText(content.slice(0, LLM_LIMITS.maxArticleContentChars))
        .ok
    ).toBe(false);
    const sent = r.toSentArticles([
      { ...TOURNAMENT_ARTICLE, content },
      FIDE_ARTICLE,
    ]);
    expect(sent.map((a) => a.id)).toEqual(["r-f"]);
  });

  it("FIDE/JCF source labels that fail the narrow check are left out; ids that are not identifiers drop the article", async () => {
    const call = capture();
    const r = await prepareReasoning(
      {
        incident: {
          category: "illegal-move",
          description: "白が違法手を指したので黒がクレームした",
          arbiterObserved: true,
        },
        context: { competitionType: "standard", rulesVersion: "FIDE-2023" },
      },
      { identifiers: async () => NO_IDENTIFIERS, call }
    );
    if (r.status !== "needs-confirmation") throw new Error("expected clear");
    const sent = r.toSentArticles([
      {
        ...FIDE_ARTICLE,
        sourceName: "山本さん提供の規則集",
        sourceVersion: "090-1234-5678",
      },
      { ...FIDE_ARTICLE, id: "山本さん" },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toHaveProperty("sourceVersion");
    expect(sent[0].sourceName).toBeUndefined();
    await r.send(sent);
    const body = JSON.parse(JSON.stringify(call.mock.calls[0][1]));
    expect(validateReasoningRequest(body)).toMatchObject({ ok: true });
  });

  it("the server's length limits are the client's minimization limits (§5.3)", () => {
    expect(LLM_LIMITS.maxClassifyNarrativeChars).toBe(
      MINIMIZATION_LIMITS.narrative
    );
    expect(LLM_LIMITS.maxReasonDescriptionChars).toBe(
      MINIMIZATION_LIMITS.reasonDescription
    );
    expect(LLM_LIMITS.maxEmbedQueryChars).toBe(MINIMIZATION_LIMITS.embedQuery);
  });
});
