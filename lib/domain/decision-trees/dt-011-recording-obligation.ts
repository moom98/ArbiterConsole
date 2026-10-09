import type {
  RuleCitation,
  ScoresheetFacts,
  TimeControl,
} from "@/lib/domain/entities";
import type { DomainProviders } from "@/lib/domain/providers";
import { cite } from "@/lib/domain/rules/citations";
import {
  QUESTIONS,
  recordingPeriodQuestion,
  type FollowUpQuestion,
} from "@/lib/domain/follow-up";
import {
  assessRecordingObligation,
  recordingIncrement,
  type RecordingObligationInput,
  type RecordingObligationMissing,
} from "@/lib/domain/services/time-control";
import type { DecisionTreeResult } from "./dt-001-illegal-move-standard";
import { TreeOutput } from "./tree-support";

export const DT_011_ID = "DT-011-recording-obligation" as const;

export interface RecordingObligationTreeInput {
  /** 回答（「わからない」は "unknown"） */
  facts: ScoresheetFacts;
  /** 報告時点の大会の持ち時間（ない・不完全なら加算を質問する） */
  timeControl?: TimeControl;
}

const INITIAL_CONCLUSION =
  "記録義務（8.1.1）の免除（8.4）に当たるかを判断します。以下の質問に回答してください。";

const MISSING_LABELS: Record<RecordingObligationMissing, string> = {
  remainingTime: "記録していない側の時計の今の残り時間（5分未満か）",
  belowFiveInPeriod: "このピリオド中に5分を下回ったか",
  increment: "現在のピリオドの1手ごとの加算（30秒以上か）",
  delayTreatment: "遅延（ディレイ）方式での 8.4 の扱い",
};

/** 一緒に質問する親の質問がない場合は showWhen を外す（単独でも表示されるように） */
function bare(q: FollowUpQuestion): FollowUpQuestion {
  const { showWhen: _ignored, ...rest } = q;
  return rest;
}

const known = (v: boolean | "unknown" | undefined): boolean | undefined =>
  v === "unknown" ? undefined : v;

/**
 * DT-011: 棋譜の記録義務（FIDE Laws 2023 8.1.1 / 8.4。ADR-014 §7）。
 * 「記入していない」「遅れている」の報告で、Standard の対局だけを扱う（呼び出し側が確かめる）。
 *
 * - 加算は大会の持ち時間から求める（単一ピリオド・全ピリオドで「30秒以上か」が同じなら質問しない）。
 *   複数ピリオドで異なる場合はピリオドを、設定がない・不完全な場合は加算を質問する
 * - 加算が30秒以上なら、残り時間を尋ねずに「免除なし」
 * - 判定は assessRecordingObligation（三値）。遅延は免除を確定しない（CAへ確認）
 * - ペナルティは自動で適用しない（アービターの裁量。12.9）
 */
export class RecordingObligationTree {
  private readonly out: TreeOutput;

  constructor(providers: DomainProviders, rulesVersion = "FIDE-2023") {
    this.out = new TreeOutput(providers, DT_011_ID, rulesVersion);
  }

  evaluate(input: RecordingObligationTreeInput): DecisionTreeResult {
    const { facts, timeControl: tc } = input;
    const inc = recordingIncrement(tc, facts.period);

    const assessment: RecordingObligationInput = {
      competitionType: "standard",
      belowFiveNow: known(facts.belowFiveNow),
      belowFiveInPeriod: known(facts.belowFiveInPeriod),
      delaySeconds: tc?.delaySeconds,
    };
    /** 加算を設定から求めた（回答ではない） */
    let fromSettings = true;
    const questions: FollowUpQuestion[] = [];
    switch (inc.status) {
      case "known":
        assessment.incrementSeconds = inc.incrementSeconds;
        break;
      case "class-known":
        assessment.incrementAtLeast30 = inc.atLeast30;
        break;
      case "ask-period":
        questions.push(recordingPeriodQuestion(tc as TimeControl));
        break;
      case "unknown":
        fromSettings = false;
        break;
      case "ask-increment":
        fromSettings = false;
        if (facts.increment === undefined)
          questions.push(QUESTIONS.recordingIncrement);
        else if (facts.increment !== "unknown") {
          assessment.incrementAtLeast30 = facts.increment === "at-least-30";
          // 遅延方式の回答は、遅延の秒数が分からなくても遅延ありとして扱う（免除を確定しない）
          if (facts.increment === "delay")
            assessment.delaySeconds = Math.max(1, tc?.delaySeconds ?? 0);
        }
        break;
    }

    const atLeast30 =
      assessment.incrementSeconds !== undefined
        ? assessment.incrementSeconds >= 30
        : assessment.incrementAtLeast30;
    // 加算が30秒以上なら、残り時間に関係なく免除はない（残り時間は尋ねない）
    if (atLeast30 !== true) {
      if (facts.belowFiveNow === undefined)
        questions.unshift(
          QUESTIONS.recordingBelowFiveNow,
          QUESTIONS.recordingBelowFiveInPeriod
        );
      else if (
        facts.belowFiveNow !== true &&
        facts.belowFiveInPeriod === undefined
      )
        questions.unshift(bare(QUESTIONS.recordingBelowFiveInPeriod));
    }
    if (questions.length > 0)
      return this.out.needsInput(
        questions,
        INITIAL_CONCLUSION,
        cite("FIDE_8_4")
      );

    const result = assessRecordingObligation(assessment);
    switch (result.status) {
      case "exempt":
        return this.out.decided({
          kind: "recommendation",
          conclusion: result.explanation,
          actions: [
            "このピリオドの残りは、手を記録しなくても 8.1.1 の違反ではない（8.4）",
            "次のピリオドに入ったら、加算と残り時間によって記録義務が戻るか確認する（8.4 は「そのピリオドの残り」）",
          ],
          intervention: "no-intervention",
          penalties: [],
          sources: result.sources,
          // 加算を回答から求めた場合は、設定で確かめていない
          confidence: fromSettings ? "high" : "medium",
          escalationRecommended: false,
        });
      case "required":
        return this.out.decided({
          kind: "recommendation",
          conclusion: result.explanation,
          actions: [
            "手を記録するよう選手に伝える（8.1.1）",
            "従わない場合の対応はアービターの裁量で決める（12.9）",
          ],
          intervention: "immediate",
          penalties: [],
          sources: [...result.sources, ...cite("FIDE_12_9")],
          confidence: fromSettings ? "high" : "medium",
          escalationRecommended: false,
        });
      case "unknown":
        return this.manual(
          result.explanation,
          result.missing.map((m) => MISSING_LABELS[m]),
          result.sources
        );
      case "not-assessed":
        // 呼び出し側が Standard だけを渡すため起きない。判断しない
        return this.manual(result.explanation, [], result.sources);
    }
  }

  private manual(
    explanation: string,
    missing: string[],
    sources: RuleCitation[]
  ): DecisionTreeResult {
    return this.out.decided({
      kind: "manual-review",
      conclusion: explanation,
      actions: [
        ...missing.map((m) => `確認できなかった事実: ${m}`),
        "記録義務の免除に当たるか判断できないため、CAへ確認してください",
      ],
      intervention: "consult-ca",
      penalties: [],
      sources,
      confidence: "low",
      escalationRecommended: true,
      missingFields: missing.length > 0 ? missing : undefined,
    });
  }
}
