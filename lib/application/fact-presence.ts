/**
 * 報告文での記載の有無の確認（fact-model.md §4, jev-classifier-design §14.3, J2-2）。
 *
 * - DT が求めた質問のうち、カタログの fact に対応し、判定してよいものだけを Jev に尋ねる
 * - 送る前に送信内容を示し、アービターが確認してから送る（D13）。任意の操作で、送らなくても
 *   質問にはそのまま回答できる
 * - 結果は**質問の並べ方にだけ**使う（記載なし → 先、記載あり → 後）。質問を省略せず、値も埋めない
 *   （ADR-002, ADR-013）。失敗・未較正・不正な応答はすべて「記載なし」（全部を尋ねる）
 */
import type { IncidentCategory } from "@/lib/domain/entities";
import { presenceTargets } from "@/lib/domain/facts";
import type {
  FollowUpQuestion,
  IncidentQuestionId,
} from "@/lib/domain/follow-up";
import { notSentNotice } from "@/lib/domain/llm/external-ai";
import {
  parseFactPresence,
  type FactPresence,
} from "@/lib/domain/llm/presence";
import type { JevCalibration } from "@/lib/domain/llm/calibration";
import type { ExternalAiPreview } from "@/lib/domain/llm/types";
import { browserIsOnline } from "@/lib/infrastructure/llm/llm-api-client";
import {
  prepareFactPresence,
  type ExternalAiGuardDeps,
} from "./external-ai-guard";

export interface FactPresenceOutcome {
  /** 質問 id → 記載の有無（判定した質問だけ） */
  byQuestion: Partial<Record<IncidentQuestionId, FactPresence>>;
  /** 表示する注意（失敗・未較正など） */
  notice?: string;
}

export type FactPresenceStep =
  /** 送らない（対象がない・オフライン・使えない・送れない内容）。notice は理由 */
  | { status: "none"; notice?: string }
  | {
      status: "needs-confirmation";
      preview: ExternalAiPreview;
      send(): Promise<FactPresenceOutcome>;
    };

export interface FactPresenceInput {
  category: IncidentCategory;
  subtype?: string;
  /** 報告文（Incident.description） */
  description: string;
  /** このラウンドの質問 */
  questions: readonly FollowUpQuestion[];
  /** 「外部AIに送らない」 */
  doNotSend?: boolean;
}

export interface FactPresenceDeps extends ExternalAiGuardDeps {
  /** 既定は登録済みの較正（テストで差し替える） */
  calibrations?: readonly JevCalibration[];
}

export const UNCALIBRATED_NOTICE =
  "AIの判定はまだ較正されていないため、すべて「記載なし」として並べています";

function targetsOf(input: FactPresenceInput) {
  // フェアプレーは送らない（L0 もガードで止めるが、確認自体を提案しない）
  if (input.category === "fair-play") return [];
  if (!input.description.trim()) return [];
  return presenceTargets(
    input.category,
    input.subtype,
    input.questions
      .filter((q) => q.scope === "incident")
      .map((q) => q.id as IncidentQuestionId)
  );
}

/**
 * 記載の確認を提案するか（端末内だけで決める。通信しない）。
 * 画面はこれが true のときだけ「AIで報告文の記載を確認（任意）」を出し、タップされてから準備する
 */
export function canOfferFactPresenceCheck(input: FactPresenceInput): boolean {
  return targetsOf(input).length > 0;
}

export async function prepareFactPresenceCheck(
  input: FactPresenceInput,
  deps: FactPresenceDeps = {}
): Promise<FactPresenceStep> {
  const text = input.description.trim();
  const targets = targetsOf(input);
  if (targets.length === 0) return { status: "none" };
  if (!(deps.isOnline ?? browserIsOnline)())
    return {
      status: "none",
      notice:
        "オフラインのため記載の確認はできません。すべての質問に回答してください",
    };

  const factIds = Array.from(new Set(targets.map((t) => t.factId)));
  const guarded = await prepareFactPresence(
    text,
    factIds,
    { category: input.category, doNotSend: input.doNotSend },
    deps
  );
  if (guarded.status === "local")
    return { status: "none", notice: notSentNotice(guarded.reasons) };
  if (guarded.status === "unavailable")
    return {
      status: "none",
      notice: "記載の確認は現在利用できません。すべての質問に回答してください",
    };
  if (guarded.status === "provider-unknown")
    return {
      status: "none",
      notice: `AIの送り先を確認できないため送信していません（${guarded.error.message}）`,
    };

  return {
    status: "needs-confirmation",
    preview: guarded.preview,
    async send() {
      const res = await guarded.send();
      if (!res.ok)
        return {
          byQuestion: {},
          notice: `記載の確認に失敗しました（${res.error.message}）。すべての質問に回答してください`,
        };
      const parsed = parseFactPresence(res.result, {
        model: res.model,
        requestedFactIds: factIds,
        calibrations: deps.calibrations,
      });
      const byQuestion: Partial<Record<IncidentQuestionId, FactPresence>> = {};
      for (const t of targets)
        byQuestion[t.questionId] = parsed.byFact[t.factId];
      return {
        byQuestion,
        notice: !parsed.valid
          ? "AIの応答を解釈できないため、すべて「記載なし」として並べています"
          : !parsed.calibrated
            ? UNCALIBRATED_NOTICE
            : undefined,
      };
    },
  };
}
