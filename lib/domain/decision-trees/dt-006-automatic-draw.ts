import type { DomainProviders } from "@/lib/domain/providers";
import { cite } from "@/lib/domain/rules/citations";
import { QUESTIONS } from "@/lib/domain/follow-up";
import { SEVENTY_FIVE_MOVES_PLIES } from "@/lib/domain/services/position-analysis";
import type { DecisionTreeResult } from "./dt-001-illegal-move-standard";
import {
  autoLine,
  confirmText,
  resolveCheck,
  unknownCheck,
  type DrawTreeInput,
} from "./draw-shared";
import { TreeOutput } from "./tree-support";

export const DT_006_ID = "DT-006-automatic-draw" as const;

/** 75手 = 両プレーヤー各75手 = 150 半手 */
export { SEVENTY_FIVE_MOVES_PLIES } from "@/lib/domain/services/position-analysis";

export type AutomaticDrawInput = DrawTreeInput;

/**
 * DT-006: Automatic Draw（FIDE Laws 2023 Art. 9.6。ADR-014 §1）
 *
 * - fivefold-repetition: 9.6.1（同じ局面が5回。連続でなくてよい）
 * - 75-move-rule:        9.6.2（ポーンの移動も駒取りもなく各75手。最後の手がメイトならメイトが優先）
 *
 * クレームする人がいないため、申立人・手番・駒への接触は扱わない。アービターが介入して
 * ドローを宣言する。条件は対局履歴（game.history）の自動判定、または盤上での手動再現で確認する。
 */
export class AutomaticDrawTree {
  private readonly out: TreeOutput;

  constructor(providers: DomainProviders, rulesVersion = "FIDE-2023") {
    this.out = new TreeOutput(providers, DT_006_ID, rulesVersion);
  }

  evaluate(input: Partial<AutomaticDrawInput>): DecisionTreeResult {
    switch (input.subtype) {
      case "fivefold-repetition":
        // "met-checkmate" は 75手の確認だけの値。五回同一局面では未回答として扱う
        return this.fivefold(
          input.conditionCheck === "met-checkmate"
            ? { ...input, conditionCheck: undefined }
            : input
        );
      case "75-move-rule":
        return this.seventyFive(input);
      default:
        return this.out.needsInput([QUESTIONS.drawSubtype]);
    }
  }

  // ---------------------------------------------------------------------------

  private fivefold(input: Partial<AutomaticDrawInput>): DecisionTreeResult {
    const resolved = resolveCheck(input, {
      autoOutcome: (r, complete) =>
        r.maxOccurrences >= 5 ? "met" : complete ? "not-met" : "inconclusive",
    });
    const sources = cite("FIDE_9_6", "MANUAL_9_6_INTERVENE");
    if (resolved !== null && "result" in resolved) return resolved.result;
    if (resolved !== null && "confirm" in resolved)
      return this.out.needsInput(
        [QUESTIONS.historyConfirmed],
        `五回同一局面（9.6.1）の確認です。直ちに時計を止めて確認してください。\n${confirmText(resolved.confirm)}`,
        sources
      );
    if (resolved === null || "error" in resolved)
      return this.out.needsInput(
        [QUESTIONS.fivefoldCheck, QUESTIONS.positionsText],
        `五回同一局面（9.6.1）の確認が必要です。${resolved ? `\n${resolved.error}` : ""}`,
        sources
      );
    if (resolved.outcome === "met" || resolved.outcome === "met-checkmate") {
      return this.out.decided({
        kind: "recommendation",
        conclusion:
          "同じ局面が5回以上出現しています。プレーヤーのクレームは不要で、対局はドローです（9.6.1）。直ちに介入してください。",
        actions: [
          "直ちに時計を止めて介入する",
          ...autoLine(resolved.auto, input.historyConfirmed),
          "ドローを宣言する（9.6.1）",
          "結果を記録する",
        ],
        intervention: "immediate",
        penalties: [{ type: "draw", description: "ドロー（五回同一局面）" }],
        sources: cite(
          "FIDE_9_6",
          "FIDE_9_2_3",
          "MANUAL_9_6_INTERVENE",
          "JCF_NA_P70_FIVEFOLD_75"
        ),
        confidence: resolved.auto ? "medium" : "high",
        escalationRecommended: false,
      });
    }
    if (resolved.outcome === "not-met") {
      return this.out.decided({
        kind: "recommendation",
        conclusion:
          "同じ局面は5回未満のため、9.6.1 による介入は行いません。対局を続行します。",
        actions: [
          ...autoLine(resolved.auto, input.historyConfirmed),
          "介入しない（プレーヤーは手番で 9.2 のクレームができる）",
          "引き続き、同一局面の回数を記録しておく",
        ],
        intervention: "no-intervention",
        penalties: [],
        sources: cite("FIDE_9_6", "FIDE_9_2"),
        confidence: resolved.auto ? "medium" : "high",
        escalationRecommended: false,
      });
    }
    return unknownCheck(this.out, "五回同一局面", [
      "FIDE_9_6",
      "MANUAL_9_6_INTERVENE",
    ]);
  }

  private seventyFive(input: Partial<AutomaticDrawInput>): DecisionTreeResult {
    const resolved = resolveCheck(input, {
      // 9.6.2: 途中で一度でも 150 半手に達していれば成立。途中からの履歴では
      // 開始 FEN の halfmove clock を信用せず、履歴内で数えた値（下限）で比べる。
      // 150 半手に初めて達した手がチェックメイトなら、メイトが優先
      autoOutcome: (r, complete) =>
        r.maxHalfmoveClock >= SEVENTY_FIVE_MOVES_PLIES
          ? r.seventyFiveReachedWithCheckmate
            ? "met-checkmate"
            : "met"
          : complete
            ? "not-met"
            : "inconclusive",
      validate: (r) =>
        r.seventyFiveCheckmateUncertain
          ? "途中の局面から始まる棋譜では、75手に達したのが最後のチェックメイトの手か、それより前かを確定できません（開始局面の手数は使いません）。盤上・スコアシートで手順を確認してください。"
          : undefined,
    });
    const sources = cite("FIDE_9_6", "MANUAL_9_6_INTERVENE");
    if (resolved !== null && "result" in resolved) return resolved.result;
    if (resolved !== null && "confirm" in resolved)
      return this.out.needsInput(
        [QUESTIONS.historyConfirmed],
        `75手ルール（9.6.2）の確認です。直ちに時計を止めて確認してください。\n${confirmText(resolved.confirm)}`,
        sources
      );
    if (resolved === null || "error" in resolved)
      return this.out.needsInput(
        [QUESTIONS.seventyFiveCheck, QUESTIONS.positionsText],
        `75手ルール（9.6.2）の確認が必要です。${resolved ? `\n${resolved.error}` : ""}`,
        sources
      );

    // 手動確認の "met" は、チェックメイトでないことを記録した回答（lastMoveCheckmate = false）
    // だけをドローにする。旧（J1b-5 より前）の「75手以上」は、チェックメイトの有無を
    // 確認していない（未回答・わからない）ため確認をやり直す。旧の「チェックメイト」はメイト優先
    let outcome = resolved.outcome;
    if (outcome === "met" && !resolved.auto) {
      if (input.lastMoveCheckmate === true) outcome = "met-checkmate";
      else if (input.lastMoveCheckmate !== false)
        return this.out.needsInput(
          [QUESTIONS.seventyFiveCheck, QUESTIONS.positionsText],
          "75手ルール（9.6.2）の確認が必要です。\n以前の回答では、75手に達した手がチェックメイトだったかが確認されていません。もう一度選んでください。",
          sources
        );
    }

    if (outcome === "met-checkmate") {
      return this.out.decided({
        kind: "recommendation",
        conclusion:
          "75手に達した最後の手がチェックメイトのため、チェックメイトが優先されます（9.6.2）。",
        actions: [
          ...autoLine(resolved.auto, input.historyConfirmed),
          "チェックメイトによる結果を記録する",
        ],
        intervention: "no-intervention",
        penalties: [],
        sources: cite("FIDE_9_6"),
        confidence: resolved.auto ? "medium" : "high",
        escalationRecommended: false,
      });
    }
    if (outcome === "met") {
      return this.out.decided({
        kind: "recommendation",
        conclusion:
          "両プレーヤーとも、ポーンの移動も駒取りもなく75手以上を指しています。対局はドローです（9.6.2）。直ちに介入してください。",
        actions: [
          "直ちに時計を止めて介入する",
          ...autoLine(resolved.auto, input.historyConfirmed),
          "ドローを宣言する（9.6.2）",
          "結果を記録する",
        ],
        intervention: "immediate",
        penalties: [{ type: "draw", description: "ドロー（75手ルール）" }],
        sources: cite(
          "FIDE_9_6",
          "MANUAL_9_6_INTERVENE",
          "JCF_NA_P70_FIVEFOLD_75"
        ),
        confidence: resolved.auto ? "medium" : "high",
        escalationRecommended: false,
      });
    }
    if (outcome === "not-met") {
      return this.out.decided({
        kind: "recommendation",
        conclusion: "75手に達していないため、9.6.2 による介入は行いません。",
        actions: [
          ...autoLine(resolved.auto, input.historyConfirmed),
          "介入しない（50手ルール 9.3 のクレームは手番のプレーヤーが行える）",
          "引き続き手数を記録しておく",
        ],
        intervention: "no-intervention",
        penalties: [],
        sources: cite("FIDE_9_6", "FIDE_9_3"),
        confidence: resolved.auto ? "medium" : "high",
        escalationRecommended: false,
      });
    }
    return unknownCheck(this.out, "75手ルール", [
      "FIDE_9_6",
      "MANUAL_9_6_INTERVENE",
    ]);
  }
}
