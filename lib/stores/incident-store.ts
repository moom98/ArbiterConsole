import { create } from "zustand";
import type {
  Decision,
  Incident,
  IncidentCategory,
  Tournament,
} from "@/lib/domain/entities";
import {
  DecisionEngine,
  type DecisionEngineResult,
} from "@/lib/domain/decision-engine";
import {
  applyIncidentAnswers,
  isKnownSubtype,
  type FollowUpQuestion,
  type IncidentQuestionId,
} from "@/lib/domain/follow-up";
import { IncidentCounter } from "@/lib/domain/services/incident-counter";
import {
  validateReportContext,
  type ReportContext,
} from "@/lib/domain/services/game-context";
import { defaultProviders, type DomainProviders } from "@/lib/domain/providers";
import { incidentStatusAfterDecision } from "@/lib/domain/services/incident-status";
import { db as defaultDb, type ArbiterDatabase } from "@/lib/infrastructure/db";
import { chessJsPositionPort } from "@/lib/infrastructure/chess/chess-js-position-port";
import type { LlmAssistPort } from "@/lib/domain/llm/ports";
import { createLlmAssistPort } from "@/lib/infrastructure/llm/llm-assist-port";
import {
  ensureGameForContext,
  loadGameRecords,
  loadLastReportContext,
  saveLastReportContext,
} from "@/lib/infrastructure/db/incident-repository";

export type SubmitResult =
  { ok: true; result: DecisionEngineResult } | { ok: false; error: string };

export interface SubmitIncidentParams {
  context: ReportContext;
  category: IncidentCategory;
  /** 任意: カテゴリ選択時に確定した subtype（QUICK_REPORTS） */
  subtype?: string;
  description: string;
  arbiterObserved: boolean;
}

export interface IncidentStore {
  currentIncident: Incident | null;
  currentDecision: Decision | null;
  followUpQuestions: FollowUpQuestion[];
  isProcessing: boolean;
  /** AI 参考情報（LLM）を取得中（決定木の対象外の事象のみ） */
  llmPending: boolean;
  error: string | null;
  lastContext: ReportContext | null;

  loadLastContext: () => Promise<void>;
  /** 新しい Incident を登録し、判断支援を評価する */
  submitIncident: (params: SubmitIncidentParams) => Promise<SubmitResult>;
  /** 現在の Incident に追加質問の回答を反映し、同じ Incident を再評価する */
  answerFollowUp: (
    answers: Partial<Record<IncidentQuestionId, string>>
  ) => Promise<SubmitResult>;
  /** 現在の Incident を再評価する（例: オフラインだった AI 参考情報をオンラインで再取得） */
  retryEvaluation: () => Promise<SubmitResult>;
  reset: () => void;
}

export interface IncidentStoreDeps {
  db: ArbiterDatabase;
  providers: DomainProviders;
  /** 決定木の対象外の事象の AI 参考情報（未指定なら手動確認のみ）。ADR-007 */
  llm?: LlmAssistPort;
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
  let setLlmPending: (pending: boolean) => void = () => {};
  const llm: LlmAssistPort | undefined = deps.llm
    ? {
        assist: async (request) => {
          setLlmPending(true);
          try {
            return await deps.llm!.assist(request);
          } finally {
            setLlmPending(false);
          }
        },
      }
    : undefined;
  const engine = new DecisionEngine(providers, {
    positions: chessJsPositionPort,
    llm,
  });

  async function evaluate(incident: Incident): Promise<DecisionEngineResult> {
    const game = await db.games.get(incident.gameId);
    const tournament: Tournament | undefined = game
      ? await db.tournaments.get(game.tournamentId)
      : undefined;
    const records = await loadGameRecords(db, incident.gameId);
    const illegalMoveHistory = IncidentCounter.illegalMoveHistory(
      records,
      incident.gameId,
      { excludeIncidentId: incident.id }
    );

    // 決定木を優先し、対象外の事象のみ AI 参考情報を取得する（DecisionEngine.evaluate）
    const result = await engine.evaluate({
      incident,
      ruleset: tournament
        ? {
            competitionType: tournament.competitionType,
            supervisionRegime: tournament.supervisionRegime,
            rulesVersion: tournament.rulesVersion,
          }
        : undefined,
      illegalMoveHistory,
      tournamentId: tournament?.id,
    });

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

  return create<IncidentStore>((set, get) => {
    setLlmPending = (pending) => set({ llmPending: pending });
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
        });
      }
      try {
        const { incident, result } = await fn();
        set({
          currentIncident: incident,
          currentDecision: result.decision,
          followUpQuestions: result.followUpQuestions,
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
      error: null,
      lastContext: null,

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
            const contextErrors = validateReportContext(params.context);
            if (contextErrors.length > 0)
              throw new Error(contextErrors.join(" / "));
            if (
              params.subtype !== undefined &&
              !isKnownSubtype(params.category, params.subtype)
            )
              throw new Error(`不正な subtype です: ${params.subtype}`);

            const now = providers.now();
            const { game } = await ensureGameForContext(
              db,
              params.context,
              now
            );
            await saveLastReportContext(db, params.context, now);
            set({ lastContext: params.context });

            const incident: Incident = {
              id: providers.generateId(),
              gameId: game.id,
              category: params.category,
              subtype: params.subtype,
              description: params.description,
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
            const stored = (await db.incidents.get(current.id)) ?? current;
            const result = await evaluate(stored);
            return {
              incident: (await db.incidents.get(stored.id)) ?? stored,
              result,
            };
          },
          { clearPrevious: false }
        ),

      reset: () =>
        set({
          currentIncident: null,
          currentDecision: null,
          followUpQuestions: [],
          error: null,
        }),
    };
  });
}

export const useIncidentStore = createIncidentStore({
  db: defaultDb,
  providers: defaultProviders,
  llm: createLlmAssistPort(),
});
