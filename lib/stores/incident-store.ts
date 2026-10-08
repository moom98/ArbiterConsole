import { create } from "zustand";
import type {
  Decision,
  Game,
  Incident,
  IncidentCategory,
  RulesetSnapshot,
  Tournament,
} from "@/lib/domain/entities";
import {
  DecisionEngine,
  type DecisionEngineResult,
  type EvaluateOptions,
} from "@/lib/domain/decision-engine";
import {
  applyIncidentAnswers,
  isKnownSubtype,
  type FollowUpQuestion,
  type IncidentQuestionId,
} from "@/lib/domain/follow-up";
import { IncidentCounter } from "@/lib/domain/services/incident-counter";
import {
  deriveRulesetFromTournament,
  validateReportContext,
  type ReportContext,
} from "@/lib/domain/services/game-context";
import { defaultProviders, type DomainProviders } from "@/lib/domain/providers";
import { incidentStatusAfterDecision } from "@/lib/domain/services/incident-status";
import { db as defaultDb, type ArbiterDatabase } from "@/lib/infrastructure/db";
import { chessJsPositionPort } from "@/lib/infrastructure/chess/chess-js-position-port";
import type { LlmAssistPort } from "@/lib/domain/llm/ports";
import type { ExternalAiPreview } from "@/lib/domain/llm/types";
import { createLlmAssistPort } from "@/lib/application/llm-assist";
import {
  mateSearchNeeded,
  type HelpmateSearchPort,
} from "@/lib/domain/services/mate-possibility";
import { createHelpmateSearchPort } from "@/lib/infrastructure/chess/helpmate/port";
import {
  ensureGameForContext,
  loadGameRecords,
  loadLastReportContext,
  saveLastReportContext,
} from "@/lib/infrastructure/db/incident-repository";

export type SubmitResult =
  { ok: true; result: DecisionEngineResult } | { ok: false; error: string };

export interface SubmitIncidentParams {
  /**
   * 大会の対局（大会管理で作成した Game.id）。指定した場合は大会から規則セットを導出する（ADR-006）。
   * 未指定の場合は context（暫定大会。ADR-004）を使う。
   */
  gameId?: string;
  /** 暫定大会のコンテキスト（gameId 未指定時は必須） */
  context?: ReportContext;
  category: IncidentCategory;
  /** 任意: カテゴリ選択時に確定した subtype（QUICK_REPORTS） */
  subtype?: string;
  description: string;
  arbiterObserved: boolean;
  /** 「外部AIに送らない」（external-ai-data-protection.md §4.4）。既定 false */
  externalAiOptOut?: boolean;
}

/** 外部AIへ送る前の確認待ち（D13）。まだ何も送っていない */
export interface ExternalAiConfirmation {
  preview: ExternalAiPreview;
  approvalKey: string;
}

export interface IncidentStore {
  currentIncident: Incident | null;
  currentDecision: Decision | null;
  followUpQuestions: FollowUpQuestion[];
  isProcessing: boolean;
  /** AI 参考情報（LLM）を取得中（決定木の対象外の事象のみ） */
  llmPending: boolean;
  /** 局面からメイトの手順を探している（端末内。ADR-015） */
  mateSearchPending: boolean;
  error: string | null;
  lastContext: ReportContext | null;
  /** 外部AIへ送る内容の確認待ち（現在の Incident の AI 参考情報） */
  externalAiConfirmation: ExternalAiConfirmation | null;

  loadLastContext: () => Promise<void>;
  /** 新しい Incident を登録し、判断支援を評価する */
  submitIncident: (params: SubmitIncidentParams) => Promise<SubmitResult>;
  /** 現在の Incident に追加質問の回答を反映し、同じ Incident を再評価する */
  answerFollowUp: (
    answers: Partial<Record<IncidentQuestionId, string>>
  ) => Promise<SubmitResult>;
  /**
   * 現在の Incident を再評価する（例: オフラインだった AI 参考情報をオンラインで再取得）。
   * この Incident でアービターが確認済みの送信内容と同じなら、もう一度確認を求めずに送る
   */
  retryEvaluation: () => Promise<SubmitResult>;
  /**
   * 保存済みの Incident（例: インシデント履歴で選んだもの）を現在の Incident にして再評価する。
   * 確認・再送の扱いは retryEvaluation と同じ（確認していない内容は送らず、確認を求める）
   */
  retryIncident: (incidentId: string) => Promise<SubmitResult>;
  /** アービターが確認した内容（externalAiConfirmation）で AI 参考情報を取得する（D13） */
  confirmExternalAiSend: () => Promise<SubmitResult>;
  reset: () => void;
}

export interface IncidentStoreDeps {
  db: ArbiterDatabase;
  providers: DomainProviders;
  /** 決定木の対象外の事象の AI 参考情報（未指定なら手動確認のみ）。ADR-007 */
  llm?: LlmAssistPort;
  /**
   * メイト可能性の局面のヘルプメイト探索（端末内の Web Worker。ADR-015）。
   * 未指定なら探索しない（局面からメイト可能を確定できず、CAへ確認になる）
   */
  mateSearch?: HelpmateSearchPort;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Store は薄く保つ: コンテキスト収集 → Engine 呼び出し → 永続化。
 * 違法手回数の算出は IncidentCounter（ドメイン）が行う。
 */
export function createIncidentStore(deps: IncidentStoreDeps) {
  const { db, providers } = deps;
  // 同時に複数の AI 参考情報の取得が走っても正しく表示できるよう件数で管理する
  let setLlmPending: (pending: boolean) => void = () => {};
  let setMateSearchPending: (pending: boolean) => void = () => {};
  let inFlight = 0;
  const llm: LlmAssistPort | undefined = deps.llm
    ? {
        assist: async (request, options) => {
          inFlight++;
          setLlmPending(true);
          try {
            return await deps.llm!.assist(request, options);
          } finally {
            inFlight--;
            setLlmPending(inFlight > 0);
          }
        },
      }
    : undefined;
  const engine = new DecisionEngine(providers, {
    positions: chessJsPositionPort,
    llm,
  });

  /**
   * 判断に用いる規則セット: 報告時のスナップショット（ADR-006）。
   * スナップショットのない旧 Incident は大会から導出する（不足があれば undefined → context-required）。
   */
  async function rulesetFor(
    incident: Incident,
    game: Game | undefined
  ): Promise<RulesetSnapshot | undefined> {
    if (incident.rulesetSnapshot) return incident.rulesetSnapshot;
    const tournament: Tournament | undefined = game
      ? await db.tournaments.get(game.tournamentId)
      : undefined;
    if (!tournament) return undefined;
    const derived = deriveRulesetFromTournament(tournament);
    return derived.ok ? derived.ruleset : undefined;
  }

  /**
   * 判定にヘルプメイトの手順が必要で、この局面の探索結果がなければ探索して Incident に付ける。
   * 探索の失敗は記録しない（次の評価で再試行。今回は「探索を利用できない」として CA 確認）。
   */
  async function withMateSearch(incident: Incident): Promise<Incident> {
    if (!deps.mateSearch) return incident;
    const request = mateSearchNeeded(chessJsPositionPort, incident);
    if (!request) return incident;
    setMateSearchPending(true);
    try {
      return { ...incident, mateSearch: await deps.mateSearch.search(request) };
    } catch (error) {
      console.error("Helpmate search failed:", error);
      return incident;
    } finally {
      setMateSearchPending(false);
    }
  }

  async function evaluate(
    input: Incident,
    options: EvaluateOptions = {}
  ): Promise<DecisionEngineResult> {
    const incident = await withMateSearch(input);
    const game = await db.games.get(incident.gameId);
    const ruleset = await rulesetFor(incident, game);
    const records = await loadGameRecords(db, incident.gameId);
    const illegalMoveHistory = IncidentCounter.illegalMoveHistory(
      records,
      incident.gameId,
      { excludeIncidentId: incident.id }
    );
    const touchMoveViolations = IncidentCounter.touchMoveViolationsByColor(
      records,
      incident.gameId,
      { excludeIncidentId: incident.id }
    );

    // 決定木を優先し、対象外の事象のみ AI 参考情報を取得する（DecisionEngine.evaluate）
    const result = await engine.evaluate(
      {
        incident,
        ruleset,
        illegalMoveHistory,
        touchMoveViolations,
        tournamentId: game?.tournamentId,
      },
      options
    );

    const now = providers.now();
    if (result.requiresFollowUp) {
      // 追加質問待ち: Incident は保留のまま（エスカレーション扱いにしない）
      await db.incidents.put({
        ...incident,
        status: "pending",
        updatedAt: now,
      });
    } else {
      await db.transaction("rw", db.incidents, db.decisions, async () => {
        await db.decisions.add(result.decision);
        // 再評価（例: AI 参考情報の再取得）で置き換えた前回の判断を記録する
        if (incident.decisionId && incident.decisionId !== result.decision.id)
          await db.decisions.update(incident.decisionId, {
            supersededBy: result.decision.id,
          });
        await db.incidents.put({
          ...incident,
          status: incidentStatusAfterDecision(result.decision),
          decisionId: result.decision.id,
          escalatedToCA: result.decision.escalationRecommended,
          escalationReason: result.decision.escalationReason,
          updatedAt: now,
        });
      });
    }
    return result;
  }

  /** 報告対象の対局を解決する（大会の対局 or 暫定大会の対局） */
  async function resolveGame(
    params: SubmitIncidentParams,
    now: Date
  ): Promise<{
    game: Game;
    ruleset: RulesetSnapshot;
    adHocContext?: ReportContext;
  }> {
    if (params.gameId !== undefined) {
      const game = await db.games.get(params.gameId);
      if (!game) throw new Error("対局が見つかりません");
      const tournament = await db.tournaments.get(game.tournamentId);
      if (!tournament) throw new Error("対局の大会が見つかりません");
      const derived = deriveRulesetFromTournament(tournament);
      if (!derived.ok) throw new Error(derived.errors.join(" / "));
      return { game, ruleset: derived.ruleset };
    }
    if (!params.context) throw new Error("対局を指定してください");
    const contextErrors = validateReportContext(params.context);
    if (contextErrors.length > 0) throw new Error(contextErrors.join(" / "));
    const { game, tournament } = await ensureGameForContext(
      db,
      params.context,
      now
    );
    const derived = deriveRulesetFromTournament(tournament);
    if (!derived.ok) throw new Error(derived.errors.join(" / "));
    await saveLastReportContext(db, params.context, now);
    return { game, ruleset: derived.ruleset, adHocContext: params.context };
  }

  return create<IncidentStore>((set, get) => {
    setLlmPending = (pending) => set({ llmPending: pending });
    /** アービターが確認した送信内容（Incident ごと。メモリ内だけ） */
    let approved: { incidentId: string; approvalKey: string } | null = null;
    setMateSearchPending = (pending) => set({ mateSearchPending: pending });
    /** 確認済みの送信内容（同じ Incident のみ）を付けて再評価する */
    async function reevaluate(
      stored: Incident
    ): Promise<{ incident: Incident; result: DecisionEngineResult }> {
      const result = await evaluate(stored, {
        approvalKey:
          approved?.incidentId === stored.id ? approved.approvalKey : undefined,
      });
      return {
        incident: (await db.incidents.get(stored.id)) ?? stored,
        result,
      };
    }
    async function run(
      fn: () => Promise<{ incident: Incident; result: DecisionEngineResult }>,
      options: { clearPrevious: boolean }
    ): Promise<SubmitResult> {
      set({ isProcessing: true, error: null });
      // 新規報告では前回の判断を必ず消す（失敗時に古い判断が表示されないように）
      if (options.clearPrevious) {
        set({
          currentIncident: null,
          currentDecision: null,
          followUpQuestions: [],
          externalAiConfirmation: null,
        });
      }
      try {
        const { incident, result } = await fn();
        set({
          currentIncident: incident,
          currentDecision: result.decision,
          followUpQuestions: result.followUpQuestions,
          externalAiConfirmation: result.externalAiConfirmation ?? null,
        });
        return { ok: true, result };
      } catch (error) {
        console.error("Failed to process incident:", error);
        const message = errorMessage(error);
        set({ error: message });
        return { ok: false, error: message };
      } finally {
        set({ isProcessing: false });
      }
    }

    return {
      currentIncident: null,
      currentDecision: null,
      followUpQuestions: [],
      isProcessing: false,
      llmPending: false,
      mateSearchPending: false,
      error: null,
      lastContext: null,
      externalAiConfirmation: null,

      loadLastContext: async () => {
        try {
          set({ lastContext: await loadLastReportContext(db) });
        } catch (error) {
          console.error("Failed to load last context:", error);
        }
      },

      submitIncident: (params) =>
        run(
          async () => {
            if (
              params.subtype !== undefined &&
              !isKnownSubtype(params.category, params.subtype)
            )
              throw new Error(`不正な subtype です: ${params.subtype}`);

            const now = providers.now();
            const { game, ruleset, adHocContext } = await resolveGame(
              params,
              now
            );
            if (adHocContext) set({ lastContext: adHocContext });

            const incident: Incident = {
              id: providers.generateId(),
              gameId: game.id,
              category: params.category,
              subtype: params.subtype,
              rulesetSnapshot: ruleset,
              description: params.description,
              ...(params.externalAiOptOut ? { externalAiOptOut: true } : {}),
              arbiterObserved: params.arbiterObserved,
              reportedBy: "arbiter",
              reportedAt: now,
              status: "pending",
              escalatedToCA: false,
              createdAt: now,
              updatedAt: now,
            };
            await db.incidents.add(incident);
            const result = await evaluate(incident);
            return {
              incident: (await db.incidents.get(incident.id)) ?? incident,
              result,
            };
          },
          { clearPrevious: true }
        ),

      answerFollowUp: (answers) =>
        run(
          async () => {
            const current = get().currentIncident;
            if (!current) throw new Error("回答対象のIncidentがありません");
            const stored = (await db.incidents.get(current.id)) ?? current;
            const updated = applyIncidentAnswers(stored, answers);
            const result = await evaluate(updated);
            return {
              incident: (await db.incidents.get(updated.id)) ?? updated,
              result,
            };
          },
          { clearPrevious: false }
        ),

      retryEvaluation: () =>
        run(
          async () => {
            const current = get().currentIncident;
            if (!current) throw new Error("再評価するIncidentがありません");
            return reevaluate((await db.incidents.get(current.id)) ?? current);
          },
          { clearPrevious: false }
        ),

      retryIncident: (incidentId) =>
        run(
          async () => {
            const stored = await db.incidents.get(incidentId);
            if (!stored) throw new Error("Incidentが見つかりません");
            return reevaluate(stored);
          },
          // 別の Incident の判断・確認待ちの内容を残さない
          { clearPrevious: get().currentIncident?.id !== incidentId }
        ),

      confirmExternalAiSend: () =>
        run(
          async () => {
            const current = get().currentIncident;
            const confirmation = get().externalAiConfirmation;
            if (!current || !confirmation)
              throw new Error("確認する送信内容がありません");
            const stored = (await db.incidents.get(current.id)) ?? current;
            approved = {
              incidentId: stored.id,
              approvalKey: confirmation.approvalKey,
            };
            // 送る直前の内容が確認した内容と違えば、ポートは送らずにもう一度確認を求める
            const result = await evaluate(stored, {
              approvalKey: confirmation.approvalKey,
            });
            return {
              incident: (await db.incidents.get(stored.id)) ?? stored,
              result,
            };
          },
          { clearPrevious: false }
        ),

      reset: () => {
        approved = null;
        set({
          currentIncident: null,
          currentDecision: null,
          followUpQuestions: [],
          externalAiConfirmation: null,
          error: null,
        });
      },
    };
  });
}

export const useIncidentStore = createIncidentStore({
  db: defaultDb,
  providers: defaultProviders,
  llm: createLlmAssistPort(),
  mateSearch: createHelpmateSearchPort(),
});
