import type {
  CompetitionType,
  Decision,
  DrawSubtype,
  Incident,
  PlayerColor,
  RuleCitation,
  SupervisionRegime,
  TimeControl,
  TournamentOverrides,
} from "@/lib/domain/entities";
import {
  SUPPORTED_RULES_VERSIONS,
  TOUCH_MOVE_SUBTYPE,
  drawClaimBasisOf,
} from "@/lib/domain/entities";
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
import { DrawClaimTree } from "@/lib/domain/decision-trees/dt-005-draw-claim";
import { AutomaticDrawTree } from "@/lib/domain/decision-trees/dt-006-automatic-draw";
import { TouchMoveTree } from "@/lib/domain/decision-trees/dt-007-touch-move";
import type { DrawTreeInput } from "@/lib/domain/decision-trees/draw-shared";
import type { DecisionTreeResult } from "@/lib/domain/decision-trees/dt-001-illegal-move-standard";
import {
  QUESTIONS,
  applyIncidentAnswers,
  type FollowUpQuestion,
  type IncidentQuestionId,
} from "@/lib/domain/follow-up";
import {
  DEFAULT_NEEDS_INPUT_CONCLUSION,
  resolveUnknown,
  unknownResolutionFields,
  type BranchResult,
} from "@/lib/domain/decision-trees/tree-support";
import { defaultProviders, type DomainProviders } from "@/lib/domain/providers";
import {
  analyzeRepetition,
  type ChessPositionPort,
} from "@/lib/domain/services/position-analysis";
import {
  parseGameHistoryText,
  validateGameHistory,
} from "@/lib/domain/services/game-history";
import {
  assessMatePossibility,
  matePositionRequest,
  type MatePossibility,
} from "@/lib/domain/services/mate-possibility";
import { touchObligation } from "@/lib/domain/services/touch-move";
import { lastPeriodFromTimeControl } from "@/lib/domain/services/time-control";
import type { LlmAssistOutcome, LlmAssistPort } from "@/lib/domain/llm/ports";
import { buildLlmDecision } from "@/lib/domain/llm/llm-decision";
import { mentionsFairPlay } from "@/lib/domain/llm/keyword-classifier";
import {
  FAIR_PLAY_ACTIONS,
  FAIR_PLAY_CONCLUSION,
  FAIR_PLAY_ESCALATION_REASON,
} from "@/lib/domain/services/fair-play";

export interface DecisionEngineDeps {
  /**
   * 局面解析。同一局面の自動判定と、メイト可能性の手順の検証（ADR-014 §5）に使う
   * （未指定ならどちらも利用不可）
   */
  positions?: ChessPositionPort;
  /**
   * 決定木の対象外の事象について AI 参考情報を取得するポート（ADR-007）。
   * evaluate() でのみ使用する。未指定なら従来どおり手動確認（CAへ確認）とする。
   */
  llm?: LlmAssistPort;
}

/** 決定木の対象外（LLM 参考情報の対象）であることを示す内部結果 */
interface UncoveredIncident {
  uncovered: true;
  rulesVersion: string;
  ruleset: Required<Pick<RulesetContext, "competitionType" | "rulesVersion">> &
    Pick<RulesetContext, "supervisionRegime">;
}

function isUncovered(
  r: DecisionEngineResult | UncoveredIncident
): r is UncoveredIncident {
  return (r as UncoveredIncident).uncovered === true;
}

const OFFLINE_AI_NOTE = "オンライン時にAI参考情報を取得できます。";

/**
 * 判断に用いる規則セット。すべて明示的に与えること（既定値を仮定しない）。
 */
export interface RulesetContext {
  competitionType?: CompetitionType;
  /** Rapid / Blitz の場合は必須（SupervisionRegime のコメント参照） */
  supervisionRegime?: SupervisionRegime;
  /** 例: "FIDE-2023" */
  rulesVersion?: string;
  /**
   * 大会規定による明示的な上書き（出典付き）。未指定なら上書きなし。
   * 現在は Blitz B.2 の加算時間のみ参照する（ADR-005 / ADR-006）。
   */
  tournamentOverrides?: TournamentOverrides;
  /**
   * 報告時の持ち時間（ADR-014 §7）。最終ピリオドかどうか（DT-004 lastPeriod）を設定から
   * 求めるために使う。未指定なら質問する。
   */
  timeControl?: TimeControl;
}

export interface DecisionEngineContext {
  incident: Incident;
  ruleset?: RulesetContext;
  /**
   * この対局で各プレーヤーに既に適用された違法手ペナルティの明細（IncidentCounter が算出）。
   * 件数が回数になる。評価中の Incident 自身は含めないこと。
   */
  illegalMoveHistory?: Record<PlayerColor, PriorIllegalMove[]>;
  /**
   * この対局で各プレーヤーに記録済みのタッチムーブ違反の回数（IncidentCounter が算出。
   * 7.5 の違法手とは別に数える。ADR-014 §6）。評価中の Incident 自身は含めないこと。
   */
  touchMoveViolations?: Record<PlayerColor, number>;
  /** 大会 ID（AI 参考情報の規則検索で大会固有規定を対象にするため） */
  tournamentId?: string;
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
 *
 * - processIncident（同期）: 決定木のみ。対象外は手動確認（CAへ確認）。
 * - evaluate（非同期）: 決定木を優先し、対象外の事象に限り LlmAssistPort から
 *   AI 参考情報を取得して、ドメインの決定的な検証器で検証する（ADR-002 / ADR-007）。
 * エンジン自身は LLM・HTTP を直接呼び出さない（ポート経由）。
 */
export class DecisionEngine {
  constructor(
    private readonly providers: DomainProviders = defaultProviders,
    private readonly deps: DecisionEngineDeps = {}
  ) {}

  processIncident(context: DecisionEngineContext): DecisionEngineResult {
    const routed = this.routeResolvingUnknown(context);
    if (!isUncovered(routed)) return routed;
    return this.manualReview(context.incident, routed.rulesVersion);
  }

  /**
   * 決定木で判断できる事象は決定木の結果を返す（LLM は呼ばない）。
   * 決定木の対象外の事象のみ、LLM ポートが注入されていれば AI 参考情報を取得する。
   */
  async evaluate(
    context: DecisionEngineContext
  ): Promise<DecisionEngineResult> {
    const routed = this.routeResolvingUnknown(context);
    if (!isUncovered(routed)) return routed;
    const { incident } = context;
    if (!this.deps.llm) {
      return this.manualReview(incident, routed.rulesVersion);
    }

    let outcome: LlmAssistOutcome;
    try {
      outcome = await this.deps.llm.assist({
        incident: {
          category: incident.category,
          subtype: incident.subtype,
          playerColor: incident.playerColor,
          description: incident.description,
          arbiterObserved: incident.arbiterObserved,
        },
        context: {
          competitionType: routed.ruleset.competitionType,
          supervisionRegime: routed.ruleset.supervisionRegime,
          rulesVersion: routed.rulesVersion,
          tournamentId: context.tournamentId,
        },
      });
    } catch (error) {
      outcome = {
        status: "error",
        code: "port-error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    return this.fromLlmOutcome(incident, routed.rulesVersion, outcome);
  }

  private fromLlmOutcome(
    incident: Incident,
    rulesVersion: string,
    outcome: LlmAssistOutcome
  ): DecisionEngineResult {
    switch (outcome.status) {
      case "ok": {
        const decision = buildLlmDecision(this.providers, {
          incidentId: incident.id,
          category: incident.category,
          rulesVersion,
          raw: outcome.raw,
          model: outcome.model,
          articles: outcome.articles,
          storedArticleIds: outcome.storedArticleIds,
        });
        return { decision, requiresFollowUp: false, followUpQuestions: [] };
      }
      case "offline":
        return this.manualReview(incident, rulesVersion, {
          extraAction: OFFLINE_AI_NOTE,
          escalationReason:
            "オフラインのためAI参考情報を取得できません（オンライン必須）。CAへ確認してください。",
          llm: {
            status: "offline",
            message: "オンライン必須",
          },
        });
      case "no-articles":
        return this.terminal(
          incident,
          {
            kind: "manual-review",
            conclusion: "該当する規則が見つかりませんでした。",
            actions: [
              "CAへ確認してください。",
              "ルール検索で関連規則を確認してください（大会規定が登録されているか確認）。",
            ],
            escalationReason:
              "登録済みの規則から関連する条文が見つからないため、AI参考情報を生成できません。",
            llm: { status: "no-articles" },
          },
          rulesVersion
        );
      case "error":
        return this.manualReview(incident, rulesVersion, {
          extraAction: OFFLINE_AI_NOTE,
          escalationReason: `AI参考情報を取得できませんでした（${outcome.message}）。CAへ確認してください。`,
          llm: {
            status: "unavailable",
            message: outcome.message,
            errorCode: outcome.code,
          },
        });
    }
  }

  /** 決定木の対象外: 手動確認（CAへ確認） */
  private manualReview(
    incident: Incident,
    rulesVersion: string,
    options: {
      extraAction?: string;
      escalationReason?: string;
      llm?: Decision["llm"];
    } = {}
  ): DecisionEngineResult {
    return this.terminal(
      incident,
      {
        kind: "manual-review",
        conclusion: "この事象は手動での確認が必要です。",
        actions: [
          "ルール検索で関連規則を確認してください。",
          "Chief Arbiterへ相談してください。",
          ...(options.extraAction ? [options.extraAction] : []),
        ],
        escalationReason:
          options.escalationReason ??
          "このカテゴリのDecision Treeは実装されていません",
        llm: options.llm,
      },
      rulesVersion
    );
  }

  /**
   * 「わからない」と回答された事実（incident.unknownAnswers）を resolveUnknown で扱う
   * （fact-model §3.3）。各分岐は、その事実に値を仮定した Incident で通常どおりルーティングする。
   * DT 本体は unknown を知らない（未設定の事実として扱う）。
   */
  private routeResolvingUnknown(
    context: DecisionEngineContext
  ): DecisionEngineResult | UncoveredIncident {
    const { incident } = context;
    const unknownIds = incident.unknownAnswers ?? [];
    const base = this.route(context);
    if (unknownIds.length === 0) return base;

    const toBranch = (
      r: DecisionEngineResult | UncoveredIncident
    ): BranchResult =>
      isUncovered(r)
        ? { status: "other" }
        : r.requiresFollowUp
          ? {
              status: "needs-input",
              decision: r.decision,
              questions: r.followUpQuestions,
            }
          : { status: "decided", decision: r.decision };

    const resolution = resolveUnknown({
      unknownIds,
      base: toBranch(base),
      evaluate: (assignment) =>
        toBranch(
          this.route({
            ...context,
            incident: applyIncidentAnswers(
              incident,
              assignment as Partial<Record<IncidentQuestionId, string>>
            ),
          })
        ),
    });

    switch (resolution.kind) {
      case "not-needed":
        return base;
      case "ask-others": {
        if (isUncovered(base)) return base;
        const labels = resolution.questions
          .filter((q) => !q.optional)
          .map((q) => q.label);
        // 元の評価にない質問（全分岐で共通に必要な質問）の場合、元の結論文は合わない。
        // 全分岐の結論文が同じなら、それを使う（例: 照合する最終局面の表示）
        const baseIds = new Set(base.followUpQuestions.map((q) => q.id));
        const sameRound = resolution.questions.every((q) => baseIds.has(q.id));
        return {
          decision: {
            ...base.decision,
            conclusion: sameRound
              ? base.decision.conclusion
              : (resolution.conclusion ?? DEFAULT_NEEDS_INPUT_CONCLUSION),
            actions: labels,
            missingFields: labels,
          },
          requiresFollowUp: true,
          followUpQuestions: resolution.questions,
        };
      }
      default: {
        const decision = this.build(incident, {
          ...unknownResolutionFields(resolution),
          rulesVersion: context.ruleset?.rulesVersion,
        });
        return { decision, requiresFollowUp: false, followUpQuestions: [] };
      }
    }
  }

  private route(
    context: DecisionEngineContext
  ): DecisionEngineResult | UncoveredIncident {
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
      // 触れた駒の規則は DT-001〜003 より先に DT-007 へ（ADR-014 §6）
      if (incident.subtype === TOUCH_MOVE_SUBTYPE)
        return this.processTouchMove(context, rulesVersion);
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
            // 最終ピリオドは設定から求められれば設定を優先する（ピリオドが1つなら常に最終。
            // 複数ピリオドでは手数が分からないため質問する。ADR-014 §7）
            lastPeriod:
              lastPeriodFromTimeControl(ruleset.timeControl) ??
              incident.flagFallFacts?.lastPeriod,
            competitionType,
            supervisionRegime: regime,
            mate: this.mateFor(incident),
          }),
          rulesVersion
        );
      }
    }

    if (incident.category === "draw") {
      if (incident.subtype === undefined)
        return this.ask(incident, [QUESTIONS.drawSubtype], rulesVersion);
      // DT-005 Draw Claim（9.2 / 9.3）/ DT-006 Automatic Draw（9.6）。合意・ステイルメイト・
      // デッドポジション・その他は Decision Tree を持たない（ADR-014 §1）
      const claimBasis = drawClaimBasisOf(incident.subtype);
      if (
        claimBasis !== undefined ||
        incident.subtype === "fivefold-repetition" ||
        incident.subtype === "75-move-rule"
      ) {
        const facts = incident.drawClaimFacts ?? {};
        const input: Partial<DrawTreeInput> = {
          ...facts,
          // 上の条件で DT-005 / DT-006 の subtype に絞り込み済み
          subtype: incident.subtype as DrawSubtype,
          competitionType,
          supervisionRegime: regime,
          tournamentOverrides: ruleset.tournamentOverrides,
        };
        if (facts.conditionCheck === "auto" && facts.positionsText) {
          if (this.deps.positions) {
            // 対局履歴（game.history）は端末内で解析・検証したものだけを使う（ADR-014 §4）
            const port = this.deps.positions;
            const parsed = parseGameHistoryText(facts.positionsText);
            const validated = parsed.ok
              ? validateGameHistory(port, parsed.history)
              : parsed;
            const analysed = validated.ok
              ? analyzeRepetition(
                  port,
                  validated,
                  // 9.2.1 / 9.3.1: 記入した手を指した後の局面で判定する
                  claimBasis !== undefined &&
                    facts.claimMode === "about-to-appear"
                    ? facts.intendedMove
                    : undefined
                )
              : validated;
            input.analysis = analysed.ok
              ? { ok: true, result: analysed }
              : { ok: false, error: analysed.error };
          }
        }
        const result =
          claimBasis !== undefined
            ? new DrawClaimTree(this.providers, rulesVersion).evaluate(input)
            : new AutomaticDrawTree(this.providers, rulesVersion).evaluate(
                input
              );
        return this.finish(incident, result, rulesVersion);
      }
    }

    // 決定木の対象外（例: "other" を選んだ場合）。状況の記録がなければメモを求める
    if (!incident.description.trim())
      return this.ask(incident, [QUESTIONS.situationNote], rulesVersion);

    // フェアプレー（他カテゴリでも不正の疑いに触れる記述を含む）は LLM に送らず、
    // 事実記録と CA への報告のみ（§23, ADR-007）
    if (
      incident.category === "fair-play" ||
      mentionsFairPlay(incident.description)
    )
      return this.terminal(
        incident,
        {
          kind: "manual-review",
          conclusion: FAIR_PLAY_CONCLUSION,
          actions: [...FAIR_PLAY_ACTIONS],
          escalationReason: FAIR_PLAY_ESCALATION_REASON,
        },
        rulesVersion
      );

    return {
      uncovered: true,
      rulesVersion,
      ruleset: {
        competitionType,
        supervisionRegime: regime,
        rulesVersion,
      },
    };
  }

  private processTouchMove(
    context: DecisionEngineContext,
    rulesVersion: string
  ): DecisionEngineResult {
    const { incident } = context;
    const facts = incident.touchMoveFacts ?? {};
    const player = incident.playerColor;
    // 触れた駒と局面は端末内だけで解析する（ADR-012）
    const obligation =
      player &&
      (facts.whatNext === "moved-other" || facts.whatNext === "not-moved") &&
      facts.touchedText !== undefined
        ? touchObligation(
            this.deps.positions,
            player,
            facts.touchedText,
            facts.fen
          )
        : undefined;
    const result = new TouchMoveTree(this.providers, rulesVersion).evaluate({
      ...facts,
      player,
      arbiterObserved: incident.arbiterObserved,
      obligation,
      priorViolations: player
        ? context.touchMoveViolations?.[player]
        : undefined,
    });
    return this.finish(incident, result, rulesVersion);
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
      mate: this.mateFor(incident),
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
      tournamentOverrides: context.ruleset?.tournamentOverrides,
      mate: this.mateFor(incident),
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

  /**
   * メイト可能性（6.9 / 7.5.5 / A.5.3）を局面から判定する（ADR-014 §5）。
   * ヘルプメイトの手順は Incident.mateSearch の候補を、毎回ポートで再生して検証する。
   */
  private mateFor(incident: Incident): MatePossibility {
    const request = matePositionRequest(incident);
    if (!request)
      return {
        verdict: "unknown",
        cause: "no-position",
        reason: "局面が入力されていません",
      };
    if (!this.deps.positions)
      return {
        verdict: "unknown",
        cause: "not-searched",
        reason: "局面解析を利用できません",
      };
    return assessMatePossibility(
      this.deps.positions,
      request,
      incident.mateSearch
    );
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
      "kind" | "conclusion" | "actions" | "escalationReason" | "llm"
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
export { DT_005_ID } from "@/lib/domain/decision-trees/dt-005-draw-claim";
export { DT_006_ID } from "@/lib/domain/decision-trees/dt-006-automatic-draw";
export { DT_007_ID } from "@/lib/domain/decision-trees/dt-007-touch-move";
