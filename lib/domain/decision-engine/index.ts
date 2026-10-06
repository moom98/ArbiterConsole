import type {
  CompetitionType,
  Decision,
  Incident,
  PlayerColor,
  RuleCitation,
  SupervisionRegime,
} from "@/lib/domain/entities";
import { SUPPORTED_RULES_VERSIONS } from "@/lib/domain/entities";
import {
  IllegalMoveStandardTree,
  type PriorIllegalMove,
} from "@/lib/domain/decision-trees/dt-001-illegal-move-standard";
import {
  buildDecision,
  type DecisionFields,
} from "@/lib/domain/decision-trees/build-decision";
import { IllegalMoveFastCompetitionTree } from "@/lib/domain/decision-trees/dt-002-illegal-move-fast-competition";
import { IllegalMoveFastBasicTree } from "@/lib/domain/decision-trees/dt-003-illegal-move-fast-basic";
import { FlagFallTree } from "@/lib/domain/decision-trees/dt-004-flag-fall";
import {
  RepetitionTree,
  type RepetitionInput,
} from "@/lib/domain/decision-trees/dt-005-repetition";
import type { DecisionTreeResult } from "@/lib/domain/decision-trees/dt-001-illegal-move-standard";
import { QUESTIONS, type FollowUpQuestion } from "@/lib/domain/follow-up";
import { defaultProviders, type DomainProviders } from "@/lib/domain/providers";
import {
  analyzeRepetition,
  type ChessPositionPort,
} from "@/lib/domain/services/position-analysis";

export interface DecisionEngineDeps {
  /** 同一局面の自動判定に使う局面解析（未指定なら自動判定は利用不可） */
  positions?: ChessPositionPort;
}

/**
 * 判断に用いる規則セット。すべて明示的に与えること（既定値を仮定しない）。
 */
export interface RulesetContext {
  competitionType?: CompetitionType;
  /** Rapid / Blitz の場合は必須（SupervisionRegime のコメント参照） */
  supervisionRegime?: SupervisionRegime;
  /** 例: "FIDE-2023" */
  rulesVersion?: string;
}

export interface DecisionEngineContext {
  incident: Incident;
  ruleset?: RulesetContext;
  /**
   * この対局で各プレーヤーに既に適用された違法手ペナルティの明細（IncidentCounter が算出）。
   * 件数が回数になる。評価中の Incident 自身は含めないこと。
   */
  illegalMoveHistory?: Record<PlayerColor, PriorIllegalMove[]>;
}

export interface DecisionEngineResult {
  decision: Decision;
  requiresFollowUp: boolean;
  /** requiresFollowUp の場合に回答が必要な質問 */
  followUpQuestions: FollowUpQuestion[];
}

/**
 * Decision Engine - Orchestrator
 * Incident を規則セットと種別に応じて Decision Tree へルーティングする。
 * LLM は呼び出さない（ADR-002）。
 */
export class DecisionEngine {
  constructor(
    private readonly providers: DomainProviders = defaultProviders,
    private readonly deps: DecisionEngineDeps = {}
  ) {}

  processIncident(context: DecisionEngineContext): DecisionEngineResult {
    const { incident } = context;
    const ruleset = context.ruleset ?? {};

    // 1. 規則セットの明示を要求（domain.md rule 5）
    const contextQuestions: FollowUpQuestion[] = [];
    if (!ruleset.competitionType) {
      contextQuestions.push(QUESTIONS.competitionType);
    } else if (
      ruleset.competitionType !== "standard" &&
      !ruleset.supervisionRegime
    ) {
      contextQuestions.push(QUESTIONS.supervisionRegime);
    }
    if (contextQuestions.length > 0 || !ruleset.rulesVersion) {
      return this.contextRequired(
        incident,
        contextQuestions,
        !ruleset.rulesVersion
      );
    }
    if (
      !(SUPPORTED_RULES_VERSIONS as readonly string[]).includes(
        ruleset.rulesVersion
      )
    ) {
      return this.terminal(incident, {
        kind: "not-supported",
        conclusion: `規則バージョン「${ruleset.rulesVersion}」には対応していません。判断を確定できません。`,
        actions: ["CAへ確認してください。"],
        escalationReason: "未対応の規則バージョンです",
      });
    }

    // 2. カテゴリ別ルーティング
    const rulesVersion = ruleset.rulesVersion;
    const competitionType = ruleset.competitionType as CompetitionType;
    const regime = ruleset.supervisionRegime;

    if (incident.category === "illegal-move") {
      if (competitionType === "standard") {
        return this.processIllegalMoveStandard(context, rulesVersion);
      }
      return this.processIllegalMoveFast(
        context,
        competitionType,
        regime as SupervisionRegime,
        rulesVersion
      );
    }

    if (incident.category === "clock-time") {
      if (incident.subtype === undefined)
        return this.ask(incident, [QUESTIONS.clockTimeSubtype], rulesVersion);
      if (incident.subtype === "flag-fall") {
        const tree = new FlagFallTree(this.providers, rulesVersion);
        return this.finish(
          incident,
          tree.evaluate({
            ...incident.flagFallFacts,
            competitionType,
            supervisionRegime: regime,
          }),
          rulesVersion
        );
      }
    }

    if (incident.category === "draw") {
      if (incident.subtype === undefined)
        return this.ask(incident, [QUESTIONS.drawSubtype], rulesVersion);
      if (
        incident.subtype === "threefold-repetition-claim" ||
        incident.subtype === "fivefold-repetition" ||
        incident.subtype === "75-move-rule"
      ) {
        const facts = incident.drawClaimFacts ?? {};
        const input: Partial<RepetitionInput> = {
          ...facts,
          subtype: incident.subtype,
          competitionType,
          supervisionRegime: regime,
        };
        if (facts.conditionCheck === "auto" && facts.positionsText) {
          if (this.deps.positions) {
            const analysed = analyzeRepetition(
              this.deps.positions,
              facts.positionsText,
              incident.subtype === "threefold-repetition-claim" &&
                facts.claimMode === "about-to-appear"
                ? facts.intendedMove
                : undefined
            );
            input.analysis = analysed.ok
              ? { ok: true, result: analysed }
              : { ok: false, error: analysed.error };
          }
        }
        const tree = new RepetitionTree(this.providers, rulesVersion);
        return this.finish(incident, tree.evaluate(input), rulesVersion);
      }
    }

    return this.terminal(incident, {
      kind: "manual-review",
      conclusion: "この事象は手動での確認が必要です。",
      actions: [
        "ルール検索で関連規則を確認してください。",
        "Chief Arbiterへ相談してください。",
      ],
      escalationReason: "このカテゴリのDecision Treeは実装されていません",
    });
  }

  private processIllegalMoveStandard(
    context: DecisionEngineContext,
    rulesVersion: string
  ): DecisionEngineResult {
    const { incident, illegalMoveHistory } = context;
    const color = incident.playerColor;
    const tree = new IllegalMoveStandardTree(this.providers);
    const prior =
      color && illegalMoveHistory ? illegalMoveHistory[color] : undefined;
    const result = tree.evaluate({
      ...incident.illegalMoveFacts,
      playerColor: color,
      playerIncidentCount: Array.isArray(prior) ? prior.length : undefined,
      priorIllegalMoves: prior,
    });
    const decision = {
      ...result.decision,
      incidentId: incident.id,
      rulesVersion,
    };
    if (result.status === "needs-input") {
      return {
        decision,
        requiresFollowUp: true,
        followUpQuestions: result.questions,
      };
    }
    return { decision, requiresFollowUp: false, followUpQuestions: [] };
  }

  private processIllegalMoveFast(
    context: DecisionEngineContext,
    competitionType: Exclude<CompetitionType, "standard">,
    regime: SupervisionRegime,
    rulesVersion: string
  ): DecisionEngineResult {
    const { incident, illegalMoveHistory } = context;
    const color = incident.playerColor;
    const prior =
      color && illegalMoveHistory ? illegalMoveHistory[color] : undefined;
    const input = {
      ...incident.illegalMoveFacts,
      playerColor: color,
      playerIncidentCount: Array.isArray(prior) ? prior.length : undefined,
      priorIllegalMoves: prior,
    };
    const result =
      regime === "competition-rules"
        ? new IllegalMoveFastCompetitionTree(
            this.providers,
            competitionType,
            rulesVersion
          ).evaluate(input)
        : new IllegalMoveFastBasicTree(
            this.providers,
            competitionType,
            rulesVersion
          ).evaluate(input);
    return this.finish(incident, result, rulesVersion);
  }

  private finish(
    incident: Incident,
    result: DecisionTreeResult,
    rulesVersion: string
  ): DecisionEngineResult {
    const decision = {
      ...result.decision,
      incidentId: incident.id,
      rulesVersion,
    };
    if (result.status === "needs-input") {
      return {
        decision,
        requiresFollowUp: true,
        followUpQuestions: result.questions,
      };
    }
    return { decision, requiresFollowUp: false, followUpQuestions: [] };
  }

  /** subtype の選択など、Tree に入る前の質問 */
  private ask(
    incident: Incident,
    questions: FollowUpQuestion[],
    rulesVersion: string
  ): DecisionEngineResult {
    const labels = questions.map((q) => q.label);
    const decision = this.build(incident, {
      kind: "follow-up-required",
      conclusion:
        "判断に必要な情報が不足しています。以下の質問に回答してください。",
      actions: labels,
      intervention: "consult-ca",
      penalties: [],
      sources: [],
      confidence: "low",
      escalationRecommended: false,
      missingFields: labels,
      rulesVersion,
    });
    return { decision, requiresFollowUp: true, followUpQuestions: questions };
  }

  private contextRequired(
    incident: Incident,
    questions: FollowUpQuestion[],
    rulesVersionMissing: boolean
  ): DecisionEngineResult {
    const missing = questions.map((q) => q.label);
    if (rulesVersionMissing) missing.push("規則バージョン");
    const decision = this.build(incident, {
      kind: "context-required",
      conclusion:
        "対局の規則セット（競技区分・規則バージョン等）が指定されていないため、判断できません。",
      actions: ["対局コンテキストを設定してから再評価してください。"],
      intervention: "consult-ca",
      penalties: [],
      sources: [],
      confidence: "low",
      escalationRecommended: false,
      missingFields: missing,
    });
    return { decision, requiresFollowUp: true, followUpQuestions: questions };
  }

  private terminal(
    incident: Incident,
    fields: Pick<
      DecisionFields,
      "kind" | "conclusion" | "actions" | "escalationReason"
    > & {
      sources?: RuleCitation[];
    },
    rulesVersion?: string
  ): DecisionEngineResult {
    const decision = this.build(incident, {
      ...fields,
      rulesVersion,
      intervention: "consult-ca",
      penalties: [],
      sources: fields.sources ?? [],
      confidence: "low",
      escalationRecommended: true,
    });
    return { decision, requiresFollowUp: false, followUpQuestions: [] };
  }

  private build(
    incident: Incident,
    fields: Omit<DecisionFields, "incidentId">
  ): Decision {
    return buildDecision(this.providers, {
      ...fields,
      incidentId: incident.id,
    });
  }
}

export * from "@/lib/domain/decision-trees/dt-001-illegal-move-standard";
export { DT_002_ID } from "@/lib/domain/decision-trees/dt-002-illegal-move-fast-competition";
export { DT_003_ID } from "@/lib/domain/decision-trees/dt-003-illegal-move-fast-basic";
export { DT_004_ID } from "@/lib/domain/decision-trees/dt-004-flag-fall";
export { DT_005_ID } from "@/lib/domain/decision-trees/dt-005-repetition";
