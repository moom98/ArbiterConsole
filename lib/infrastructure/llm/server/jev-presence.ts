import { getFactDefinition } from "@/lib/domain/facts/catalog";
import type { FactId } from "@/lib/domain/facts/types";
import type { JevQuestion } from "./jev-client";
import { JEV_DATA_NOTE, noulAnswer } from "./jev-questions";

/**
 * /api/llm/facts の質問の組み立てと回答の変換（純粋関数。fact-model.md §4.2）。
 *
 * - 質問は**カタログからだけ**作る。クライアントが送るのは fact id だけで、質問文は送れない
 * - 「報告文に明示されているか」だけを尋ねる。推論・可能性・含意は false
 * - サーバーはしきい値を適用しない。確率をそのまま返す（クライアントの parseFactPresence が判断する）
 */

const PRESENCE_INSTRUCTIONS =
  "Answer true only if the incident text explicitly states the observed fact that answers the question below. Inference, likelihood or implication is false.";

/** 判定してよい fact か（カタログにあり、presenceCheckable、端末内専用でない） */
export function isPresenceCheckableFact(id: string): boolean {
  const d = getFactDefinition(id);
  return d !== undefined && d.presenceCheckable && !d.localOnly;
}

/**
 * fact ごとに noul の質問を1つ作る（質問 ID は fact id。ドット・ハイフンは J0 で確認済み）。
 * 判定できない fact が含まれる場合は例外（入力検証で先に拒否していること）
 */
export function buildJevPresenceQuestions(
  factIds: readonly FactId[]
): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {};
  for (const id of factIds) {
    const definition = getFactDefinition(id);
    if (!definition || !isPresenceCheckableFact(id))
      throw new Error("fact is not presence-checkable");
    questions[id] = {
      type: "noul",
      instructions: `${PRESENCE_INSTRUCTIONS} Question: 「${definition.question}」 ${JEV_DATA_NOTE}`,
      criteria: {
        true: `The text explicitly states the observation that answers: 「${definition.question}」`,
        false:
          "The text does not state it, states it only indirectly, or it would have to be inferred.",
      },
    };
  }
  return questions;
}

export interface RawFactPresence {
  /** 要求した fact のうち、回答の形が正しいものだけ（欠けた fact はクライアントで missing） */
  presence: Record<FactId, number>;
  provider: "jev";
}

/** Jev の回答を確率の形に変換する。要求していない質問の回答は捨てる */
export function jevAnswersToRawPresence(
  answers: Record<string, unknown>,
  factIds: readonly FactId[]
): RawFactPresence {
  const presence: Record<FactId, number> = {};
  for (const id of factIds) {
    if (!Object.hasOwn(answers, id)) continue;
    const p = noulAnswer(answers[id]);
    if (p !== null) presence[id] = p;
  }
  return { presence, provider: "jev" };
}
