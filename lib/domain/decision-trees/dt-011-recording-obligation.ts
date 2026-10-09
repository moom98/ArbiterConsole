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
  /** 棋譜の問題（not-writing / behind だけを渡す） */
  issue: "not-writing" | "behind";
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
 * DT-011: 棋譜の記録義務（FIDE Laws 2023 8.1.1 / 8.1.3 / 8.4 / 8.5。ADR-014 §7）。
 * 「記入していない」「遅れている」の報告で、Standard の対局だけを扱う（呼び出し側が確かめる）。
 *
 * - 「遅れている」で、記録していないのが双方の最新の手だけなら違反ではない（8.1.3）
 * - 加算は大会の持ち時間から求める（単一ピリオド・全ピリオドで「30秒以上か」が同じなら質問しない）。
 *   複数ピリオドで異なる場合はピリオドを、設定がない・不完全な場合は加算を質問する
 * - 加算が30秒以上、またはこのピリオドで5分を下回っていないなら、もう一方は尋ねずに「免除なし」
 * - 判定は assessRecordingObligation（三値）。遅延は免除を確定しない（CAへ確認）
 * - ペナルティは自動で適用しない（アービターの裁量。12.9）
 */
export class RecordingObligationTree {
  private readonly out: TreeOutput;

  constructor(providers: DomainProviders, rulesVersion = "FIDE-2023") {
    this.out = new TreeOutput(providers, DT_011_ID, rulesVersion);
  }

  evaluate(input: RecordingObligationTreeInput): DecisionTreeResult {
    const { facts, timeControl: tc, issue } = input;

    // 1. 遅れている: 双方の最新の手だけなら 8.1.3 の範囲（違反ではない）
    if (issue === "behind" && facts.onlyLastMoves === true)
      return this.withinLastMoves();
    const askOnlyLastMoves =
      issue === "behind" && facts.onlyLastMoves === undefined;
    /** 双方の最新の手だけの質問と一緒に尋ねる場合、それ以外の回答のときだけ表示する */
    const afterLastMoves = (q: FollowUpQuestion): FollowUpQuestion =>
      askOnlyLastMoves && !q.showWhen
        ? {
            ...q,
            showWhen: {
              questionId: "recordingOnlyLastMoves",
              values: ["false", "unknown"],
            },
          }
        : q;

    // 2. 残り時間（このピリオドで5分を下回ったか）
    const lowNow = known(facts.belowFiveNow);
    const below = known(facts.belowFiveInPeriod);
    const lowInPeriod =
      lowNow === true || below === true
        ? true
        : below === false
          ? false
          : undefined;

    // 3. 加算
    const inc = recordingIncrement(tc, facts.period);
    const assessment: RecordingObligationInput = {
      competitionType: "standard",
      belowFiveNow: lowNow,
      belowFiveInPeriod: below,
      delaySeconds: tc?.delaySeconds,
    };
    /** 加算を回答（加算の質問）ではなく設定から求めた（ピリオドの回答を含む） */
    let fromSettings = true;
    const incrementQuestions: FollowUpQuestion[] = [];
    switch (inc.status) {
      case "known":
        assessment.incrementSeconds = inc.incrementSeconds;
        break;
      case "class-known":
        assessment.incrementAtLeast30 = inc.atLeast30;
        break;
      case "ask-period":
        incrementQuestions.push(recordingPeriodQuestion(tc as TimeControl));
        break;
      case "unknown":
        break;
      case "ask-increment":
        fromSettings = false;
        if (facts.increment === undefined)
          incrementQuestions.push(QUESTIONS.recordingIncrement);
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

    const questions: FollowUpQuestion[] = [];
    if (askOnlyLastMoves) questions.push(QUESTIONS.recordingOnlyLastMoves);
    // 加算が30秒以上なら、残り時間に関係なく免除はない（残り時間は尋ねない）
    if (atLeast30 !== true && facts.belowFiveNow === undefined) {
      // 残り時間を先に尋ねる。ピリオド・加算は「5分を下回った（可能性がある）」場合だけ
      // 必要なため、次のラウンドで尋ねる（同じラウンドでは表示条件を1つの質問にしか結べない）
      questions.push(
        afterLastMoves(QUESTIONS.recordingBelowFiveNow),
        QUESTIONS.recordingBelowFiveInPeriod
      );
    } else if (
      atLeast30 !== true &&
      lowNow !== true &&
      facts.belowFiveInPeriod === undefined
    ) {
      const belowQ = afterLastMoves(bare(QUESTIONS.recordingBelowFiveInPeriod));
      questions.push(belowQ);
      // 5分を下回っていない（いいえ）なら加算は結果を変えないため、それ以外の回答のときだけ表示
      for (const q of incrementQuestions)
        questions.push({
          ...q,
          showWhen: {
            questionId: "recordingBelowFiveInPeriod",
            values: ["true", "unknown"],
          },
        });
    } else if (lowInPeriod !== false) {
      // このピリオドで5分を下回っていないなら、加算に関係なく免除はない（加算は尋ねない）
      questions.push(...incrementQuestions.map(afterLastMoves));
    }
    if (questions.length > 0)
      return this.out.needsInput(
        questions,
        INITIAL_CONCLUSION,
        cite(
          ...(issue === "behind" ? (["FIDE_8_1_3"] as const) : []),
          "FIDE_8_4"
        )
      );

    const result = assessRecordingObligation(assessment);
    switch (result.status) {
      case "exempt":
        return this.out.decided({
          kind: "recommendation",
          conclusion: result.explanation,
          actions: [
            "このピリオドの残りは、手を記録しなくても 8.1.1 の違反ではない（8.4）",
            "フラッグが落ちたら、記録していない選手は駒を動かす前に棋譜を完全に記入する。手番なら相手の棋譜を使ってよいが、指す前に返す（8.5.2）",
            "両者とも記録していない場合は、アービター（または補助者）がそばで記録するよう努める。フラッグが落ちたら時計を止め、両者に棋譜を記入させる（8.5.1）",
            "次のピリオドに入ったら、加算と残り時間によって記録義務が戻るか確認する（8.4 は「そのピリオドの残り」）",
          ],
          intervention: "no-intervention",
          penalties: [],
          sources: [...result.sources, ...cite("FIDE_8_5_2", "FIDE_8_5_1")],
          // 加算を回答から求めた場合は、設定で確かめていない
          confidence: fromSettings ? "high" : "medium",
          escalationRecommended: false,
        });
      case "required":
        // 遅れている手が双方の最新の手だけかどうか分からない場合、違反かどうかを確定できない
        if (issue === "behind" && facts.onlyLastMoves !== false)
          return this.manual(
            `${result.explanation}ただし、記録していないのが双方の最新の手（1手分の遅れ）だけなら違反ではありません（8.1.3）。`,
            ["記録していないのが双方の最新の手だけか"],
            [...result.sources, ...cite("FIDE_8_1_3")]
          );
        return this.out.decided({
          kind: "recommendation",
          conclusion: result.explanation,
          actions: [
            issue === "behind"
              ? "記録していない手を記録するよう選手に伝える（8.1.1。双方の最新の手の1手分の遅れは 8.1.3 で認められる）"
              : "手を記録するよう選手に伝える（8.1.1）",
            "従わない場合の対応はアービターの裁量で決める（12.9）",
          ],
          intervention: "immediate",
          penalties: [],
          sources: [
            ...result.sources,
            ...cite(
              ...(issue === "behind" ? (["FIDE_8_1_3"] as const) : []),
              "FIDE_12_9"
            ),
          ],
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

  /** 「遅れている」が双方の最新の手だけ（8.1.3） */
  private withinLastMoves(): DecisionTreeResult {
    return this.out.decided({
      kind: "recommendation",
      conclusion:
        "記録していないのが双方の最新の手（1手分の遅れ）だけなら、8.1.3 の範囲で違反ではありません。相手の手を記録する前に指し返してよく、次の手を指す前に自分の前の手を記録すればよいためです。",
      actions: [
        "介入しない（8.1.3: 相手の手を記録する前に指し返してよい）",
        "次の手を指す前に自分の前の手を記録していない場合は、改めて確認する（8.1.3）",
      ],
      intervention: "no-intervention",
      penalties: [],
      sources: cite("FIDE_8_1_3", "FIDE_8_1_1"),
      confidence: "high",
      escalationRecommended: false,
    });
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
