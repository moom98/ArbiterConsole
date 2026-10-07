import type {
  ChecklistItemDefinition,
  ChecklistPhase,
  ChecklistTemplateEntry,
  Round,
  RoundChecklist,
  RoundStatus,
  Tournament,
} from "@/lib/domain/entities";
import type { DomainProviders } from "@/lib/domain/providers";
import type {
  ChecklistRepository,
  RoundRepository,
  TournamentRepository,
} from "@/lib/domain/repositories";
import {
  addCustomItem,
  assessRoundTransition,
  buildChecklistView,
  defaultTemplateEntries,
  emptyRoundChecklist,
  moveItem,
  removeItem,
  resolveChecklistItems,
  setItemDone,
  setItemNote,
  type ChecklistView,
  type RoundTransitionAssessment,
} from "@/lib/domain/services/round-checklist";
import type { TournamentService } from "./tournament-management";

export interface RoundChecklistData {
  tournament: Tournament;
  round: Round;
  items: ChecklistItemDefinition[];
  checklist: RoundChecklist | null;
  view: ChecklistView;
  /** このラウンドで保留中の Incident 数 */
  pendingIncidentCount: number;
  /** 大会ごとに構成を変更しているか */
  customized: boolean;
}

export type RoundTransitionResult =
  | {
      status: "confirmation-required";
      assessment: RoundTransitionAssessment;
    }
  | { status: "changed"; round: Round };

export interface RoundChecklistRepos {
  checklists: ChecklistRepository;
  tournaments: TournamentRepository;
  rounds: RoundRepository;
}

/**
 * Round Checklist のユースケース（Milestone 7）。
 * 判定・変換はドメイン（round-checklist.ts）、ラウンドの状態遷移は TournamentService に委ねる。
 */
export class RoundChecklistService {
  /** 完了状態の read-modify-write を直列化する（連続タップで更新が失われないように） */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly repos: RoundChecklistRepos,
    private readonly tournaments: TournamentService,
    private readonly providers: DomainProviders
  ) {}

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async templateEntries(
    tournamentId: string
  ): Promise<{ entries: ChecklistTemplateEntry[]; customized: boolean }> {
    const t = await this.repos.checklists.findTemplate(tournamentId);
    return t
      ? { entries: t.entries, customized: true }
      : { entries: defaultTemplateEntries(), customized: false };
  }

  private async requireRound(roundId: string): Promise<Round> {
    const round = await this.repos.rounds.findById(roundId);
    if (!round) throw new Error("ラウンドが見つかりません");
    return round;
  }

  /** 大会のチェックリスト項目（表示順） */
  async listItems(tournamentId: string): Promise<{
    items: ChecklistItemDefinition[];
    customized: boolean;
  }> {
    const tournament = await this.repos.tournaments.findById(tournamentId);
    const { entries, customized } = await this.templateEntries(tournamentId);
    return { items: resolveChecklistItems(entries, tournament), customized };
  }

  /** ラウンドのチェックリスト。大会・ラウンドがなければ null */
  async load(
    tournamentId: string,
    roundNumber: number
  ): Promise<RoundChecklistData | null> {
    const [tournament, round] = await Promise.all([
      this.repos.tournaments.findById(tournamentId),
      this.repos.rounds.findByNumber(tournamentId, roundNumber),
    ]);
    if (!tournament || !round) return null;
    const [{ entries, customized }, checklist, pendingIncidentCount] =
      await Promise.all([
        this.templateEntries(tournamentId),
        this.repos.checklists.findRoundChecklist(round.id),
        this.repos.checklists.countPendingIncidents(tournamentId, roundNumber),
      ]);
    const items = resolveChecklistItems(entries, tournament);
    return {
      tournament,
      round,
      items,
      checklist,
      view: buildChecklistView(items, checklist, round.status),
      pendingIncidentCount,
      customized,
    };
  }

  private updateChecklist(
    roundId: string,
    itemId: string,
    update: (c: RoundChecklist, now: Date) => RoundChecklist
  ): Promise<RoundChecklist> {
    return this.serialize(async () => {
      const round = await this.requireRound(roundId);
      const { entries } = await this.templateEntries(round.tournamentId);
      if (!resolveChecklistItems(entries).some((i) => i.id === itemId))
        throw new Error("チェック項目が見つかりません");
      const now = this.providers.now();
      const current =
        (await this.repos.checklists.findRoundChecklist(roundId)) ??
        emptyRoundChecklist(round, now);
      const next = update(current, now);
      await this.repos.checklists.saveRoundChecklist(next);
      return next;
    });
  }

  setDone(
    roundId: string,
    itemId: string,
    done: boolean
  ): Promise<RoundChecklist> {
    return this.updateChecklist(roundId, itemId, (c, now) =>
      setItemDone(c, itemId, done, now)
    );
  }

  setNote(
    roundId: string,
    itemId: string,
    note: string
  ): Promise<RoundChecklist> {
    return this.updateChecklist(roundId, itemId, (c, now) =>
      setItemNote(c, itemId, note, now)
    );
  }

  // ---- 大会ごとのカスタマイズ ----

  private updateTemplate(
    tournamentId: string,
    update: (entries: ChecklistTemplateEntry[]) => ChecklistTemplateEntry[]
  ): Promise<void> {
    return this.serialize(async () => {
      if (!(await this.repos.tournaments.findById(tournamentId)))
        throw new Error("大会が見つかりません");
      const { entries } = await this.templateEntries(tournamentId);
      await this.repos.checklists.saveTemplate({
        tournamentId,
        entries: update(entries),
        updatedAt: this.providers.now(),
      });
    });
  }

  addItem(
    tournamentId: string,
    phase: ChecklistPhase,
    label: string
  ): Promise<void> {
    return this.updateTemplate(tournamentId, (entries) =>
      addCustomItem(entries, {
        id: `custom-${this.providers.generateId()}`,
        phase,
        label,
      })
    );
  }

  removeItem(tournamentId: string, itemId: string): Promise<void> {
    return this.updateTemplate(tournamentId, (entries) =>
      removeItem(entries, itemId)
    );
  }

  moveItem(
    tournamentId: string,
    itemId: string,
    direction: -1 | 1
  ): Promise<void> {
    return this.updateTemplate(tournamentId, (entries) =>
      moveItem(entries, itemId, direction)
    );
  }

  /** 既定テンプレートに戻す（追加した項目は消える。完了状態は保持） */
  resetTemplate(tournamentId: string): Promise<void> {
    return this.serialize(() =>
      this.repos.checklists.deleteTemplate(tournamentId)
    );
  }

  // ---- ラウンドの開始・終了 ----

  async assessTransition(
    roundId: string,
    to: RoundStatus
  ): Promise<RoundTransitionAssessment> {
    const round = await this.requireRound(roundId);
    const [{ entries }, checklist, pendingIncidentCount] = await Promise.all([
      this.templateEntries(round.tournamentId),
      this.repos.checklists.findRoundChecklist(round.id),
      this.repos.checklists.countPendingIncidents(
        round.tournamentId,
        round.roundNumber
      ),
    ]);
    return assessRoundTransition({
      status: round.status,
      to,
      items: resolveChecklistItems(entries),
      checklist,
      pendingIncidentCount,
    });
  }

  /**
   * ラウンドを開始・終了する。警告がある場合は、confirmed: true（アービターが警告を確認した）
   * でなければ変更せずに確認を求める。確認後の判断はアービターに委ねる。
   */
  async changeRoundStatus(
    roundId: string,
    to: RoundStatus,
    options: { confirmed?: boolean } = {}
  ): Promise<RoundTransitionResult> {
    const assessment = await this.assessTransition(roundId, to);
    if (assessment.warnings.length > 0 && !options.confirmed)
      return { status: "confirmation-required", assessment };
    const round = await this.tournaments.changeRoundStatus(roundId, to);
    return { status: "changed", round };
  }
}
