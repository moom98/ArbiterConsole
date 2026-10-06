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
import { QUESTIONS, type FollowUpQuestion } from "@/lib/domain/follow-up";
import { cite } from "@/lib/domain/rules/citations";
import { defaultProviders, type DomainProviders } from "@/lib/domain/providers";

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

const COMPETITION_JA: Record<CompetitionType, string> = {
  standard: "Standard",
  rapid: "Rapid",
  blitz: "Blitz",
};

/**
 * Decision Engine - Orchestrator
 * Incident を規則セットと種別に応じて Decision Tree へルーティングする。
 * LLM は呼び出さない（ADR-002）。
 */
export class DecisionEngine {
  constructor(private readonly providers: DomainProviders = defaultProviders) {}

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
    if (incident.category === "illegal-move") {
      if (ruleset.competitionType === "standard") {
        return this.processIllegalMoveStandard(context, ruleset.rulesVersion);
      }
      return this.illegalMoveFastNotSupported(
        incident,
        ruleset.competitionType as Exclude<CompetitionType, "standard">,
        ruleset.supervisionRegime as SupervisionRegime,
        ruleset.rulesVersion
      );
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

  private illegalMoveFastNotSupported(
    incident: Incident,
    competitionType: Exclude<CompetitionType, "standard">,
    regime: SupervisionRegime,
    rulesVersion: string
  ): DecisionEngineResult {
    let sources: RuleCitation[];
    if (competitionType === "rapid") {
      sources =
        regime === "competition-rules"
          ? cite("FIDE_A_4", "FIDE_A_3", "FIDE_A_6")
          : cite("FIDE_A_5_2", "FIDE_A_3", "FIDE_A_6");
    } else {
      sources =
        regime === "competition-rules"
          ? cite("FIDE_B_2", "FIDE_B_4")
          : cite("FIDE_B_3", "FIDE_A_5_2", "FIDE_A_3", "FIDE_B_4");
    }
    return this.terminal(
      incident,
      {
        kind: "not-supported",
        conclusion: `${COMPETITION_JA[competitionType]}の違法手の判断支援は未対応です。Standard の判断は適用できません。CAへ確認してください。`,
        actions: [
          "時計を止める（必要な場合）",
          "下記の条文を確認する",
          "CAへ確認する",
        ],
        escalationReason: `${COMPETITION_JA[competitionType]}用のDecision Treeは未実装です`,
        sources,
      },
      rulesVersion
    );
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
