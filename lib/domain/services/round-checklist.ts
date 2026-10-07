import type {
  ChecklistItemDefinition,
  ChecklistItemState,
  ChecklistPhase,
  ChecklistStage,
  ChecklistTemplateEntry,
  RoundChecklist,
  RoundStatus,
  Tournament,
} from "@/lib/domain/entities";
import { cite } from "@/lib/domain/rules/citations";
import { formatTimeControl } from "./tournament-profile";

/**
 * Round Checklist のドメインロジック（Milestone 7）。React・DB に依存しない純粋関数のみ。
 *
 * 既定テンプレートは要件 §26 の項目に、FIDE Arbiters' Manual 2025「Summary of the General
 * Duties of an Arbiter」と JCF NAセミナー資料「アービターの職務」を対応付けたもの。
 * 根拠は原典で逐語確認できたものだけを付け、確認できない項目は根拠なしとする。
 * チェックリストは業務支援であり、裁定には使用しない。
 */

export const CHECKLIST_PHASES: readonly ChecklistPhase[] = [
  "pre",
  "start",
  "during",
  "post",
];

export const CHECKLIST_PHASE_LABEL: Record<ChecklistPhase, string> = {
  pre: "ラウンド開始前",
  start: "開始直後",
  during: "対局中",
  post: "終了時",
};

export const CHECKLIST_STAGES: readonly ChecklistStage[] = [
  "pre",
  "during",
  "post",
];

export const CHECKLIST_STAGE_LABEL: Record<ChecklistStage, string> = {
  pre: "開始前",
  during: "対局中",
  post: "終了時",
};

/** 段階に含まれるフェーズ（表示順） */
export const STAGE_PHASES: Record<ChecklistStage, readonly ChecklistPhase[]> = {
  pre: ["pre"],
  during: ["start", "during"],
  post: ["post"],
};

export function stageOfPhase(phase: ChecklistPhase): ChecklistStage {
  return phase === "pre" ? "pre" : phase === "post" ? "post" : "during";
}

/** ラウンドの状態に対応する段階（ラウンド開始で pre → during、終了で during → post） */
export function stageForRoundStatus(status: RoundStatus): ChecklistStage {
  switch (status) {
    case "pending":
      return "pre";
    case "active":
      return "during";
    case "completed":
      return "post";
  }
}

// ---------------------------------------------------------------------------
// 既定テンプレート
// ---------------------------------------------------------------------------

/** 既定テンプレート（表示順）。ID は保存データから参照されるため変更しないこと */
export const DEFAULT_CHECKLIST_ITEMS: readonly ChecklistItemDefinition[] = [
  // ---- ラウンド開始前 ----
  {
    id: "pre-venue",
    phase: "pre",
    label: "会場環境（照明・換気・対局エリア）",
    citations: cite("JCF_NA_P11_B_VENUE", "MANUAL_DUTIES_A_B"),
  },
  {
    id: "pre-board-pieces",
    phase: "pre",
    label: "盤・駒の配置",
    citations: cite("JCF_NA_P11_C_EQUIPMENT", "MANUAL_DUTIES_A_C"),
  },
  {
    id: "pre-clock-placement",
    phase: "pre",
    label: "時計の配置（位置・向き）",
    citations: cite("FIDE_6_5", "JCF_NA_P11_E_CLOCKS", "MANUAL_DUTIES_A_E"),
  },
  {
    id: "pre-clock-setting",
    phase: "pre",
    label: "時計を大会の持ち時間に設定",
    citations: cite("JCF_NA_P11_E_CLOCKS", "MANUAL_DUTIES_A_E"),
  },
  {
    id: "pre-battery",
    phase: "pre",
    label: "時計のバッテリー",
    citations: cite("JCF_NA_P11_E_CLOCKS", "MANUAL_DUTIES_A_E"),
  },
  {
    id: "pre-scoresheets",
    phase: "pre",
    label: "棋譜用紙・筆記具",
    citations: cite("JCF_NA_P11_C_EQUIPMENT", "MANUAL_DUTIES_A_C"),
  },
  {
    id: "pre-board-numbers",
    phase: "pre",
    label: "ボード番号・名札",
    citations: cite("JCF_NA_P11_D_TABLES", "MANUAL_DUTIES_A_D"),
  },
  {
    id: "pre-pairings",
    phase: "pre",
    label: "ペアリング掲示・プレーヤー名",
  },
  {
    id: "pre-fbo",
    phase: "pre",
    label: "FBO・ボード順（チーム戦）",
    detail: "チーム戦でない大会では、この項目を削除できます",
    citations: cite("JCF_NA_P11_F_FBO", "MANUAL_DUTIES_A_F"),
  },
  {
    id: "pre-devices",
    phase: "pre",
    label: "電子機器の持ち込み禁止の周知",
    citations: cite("FIDE_11_3_2"),
  },
  // ---- 開始直後 ----
  {
    id: "start-clocks",
    phase: "start",
    label: "全ボードで白の時計が開始されている",
    citations: cite("FIDE_6_6", "MANUAL_6_6_CHECK_CLOCKS_STARTED"),
  },
  {
    id: "start-absent",
    phase: "start",
    label: "欠席プレーヤーの記録・CAへ報告",
    citations: cite("JCF_NA_P11_G_UNPLAYED", "MANUAL_DUTIES_B_A"),
  },
  {
    id: "start-default",
    phase: "start",
    label: "Default（不戦敗）対象の確認",
    detail: "Default time は大会規定で確認",
    citations: cite("FIDE_6_7_1"),
  },
  {
    id: "start-board-color",
    phase: "start",
    label: "ボード・色の間違いがないか",
  },
  // ---- 対局中 ----
  {
    id: "during-time-trouble",
    phase: "during",
    label: "時間切迫のボードを観察",
    citations: cite("JCF_NA_P12_J_TIME_TROUBLE", "MANUAL_DUTIES_B_D"),
  },
  {
    id: "during-clocks",
    phase: "during",
    label: "時計と手数を定期的に確認",
    citations: cite("JCF_NA_P11_H_CLOCK_CHECK", "MANUAL_DUTIES_B_B"),
  },
  {
    id: "during-player-absence",
    phase: "during",
    label: "プレーヤーの不自然な離席・接触",
    citations: cite("JCF_NA_P12_I_LEAVING", "MANUAL_DUTIES_B_C"),
  },
  {
    id: "during-incidents",
    phase: "during",
    label: "未解決Incidentの確認",
  },
  // ---- 終了時 ----
  {
    id: "post-clock-stopped",
    phase: "post",
    label: "時計の停止・最終局面の確認",
  },
  {
    id: "post-result-signed",
    phase: "post",
    label: "結果（White / Black・プレーヤー名・ボード番号）と両者のサイン",
    citations: cite("FIDE_8_7", "JCF_NA_P12_L_SIGNATURES", "MANUAL_DUTIES_B_F"),
  },
  {
    id: "post-scoresheets-collected",
    phase: "post",
    label: "棋譜用紙の回収",
  },
  {
    id: "post-results-recorded",
    phase: "post",
    label: "結果の記録・更新",
    citations: cite("JCF_NA_P12_M_RESULTS", "MANUAL_DUTIES_B_G"),
  },
  {
    id: "post-results-crosschecked",
    phase: "post",
    label: "棋譜用紙と結果の突合・CAへ報告",
    citations: cite("JCF_NA_P12_N_CROSSCHECK", "MANUAL_DUTIES_C_A"),
  },
  {
    id: "post-incidents-reviewed",
    phase: "post",
    label: "このラウンドのIncidentを確認",
  },
  {
    id: "post-equipment-next-round",
    phase: "post",
    label: "次ラウンドの機材の準備",
    citations: cite("JCF_NA_P12_O_EQUIPMENT", "MANUAL_DUTIES_C_B"),
  },
];

const BUILTIN_BY_ID = new Map(DEFAULT_CHECKLIST_ITEMS.map((i) => [i.id, i]));

export function defaultTemplateEntries(): ChecklistTemplateEntry[] {
  return DEFAULT_CHECKLIST_ITEMS.map((i) => ({ kind: "builtin", id: i.id }));
}

/** 大会の情報に依存する補足（例: 持ち時間）を付ける */
function withTournamentDetail(
  item: ChecklistItemDefinition,
  tournament: Pick<Tournament, "timeControl"> | null | undefined
): ChecklistItemDefinition {
  if (item.id === "pre-clock-setting" && tournament?.timeControl)
    return {
      ...item,
      detail: `大会設定: ${formatTimeControl(tournament.timeControl)}`,
    };
  return item;
}

/**
 * 大会のチェックリスト項目（表示順）。構成が保存されていなければ既定テンプレート。
 * 既定項目の文言・根拠は常にコード上のテンプレートから引く（未知の既定 ID は無視する）。
 */
export function resolveChecklistItems(
  entries: readonly ChecklistTemplateEntry[] | null | undefined,
  tournament?: Pick<Tournament, "timeControl"> | null
): ChecklistItemDefinition[] {
  const source = entries ?? defaultTemplateEntries();
  const items: ChecklistItemDefinition[] = [];
  for (const e of source) {
    if (e.kind === "builtin") {
      const def = BUILTIN_BY_ID.get(e.id);
      if (def) items.push(withTournamentDetail(def, tournament));
    } else {
      items.push({ id: e.id, phase: e.phase, label: e.label, custom: true });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// 大会ごとのカスタマイズ（追加・削除・並べ替え）
// ---------------------------------------------------------------------------

export const MAX_CUSTOM_LABEL_LENGTH = 80;

export function addCustomItem(
  entries: readonly ChecklistTemplateEntry[],
  input: { id: string; phase: ChecklistPhase; label: string }
): ChecklistTemplateEntry[] {
  const label = input.label.trim();
  if (!label) throw new Error("項目名を入力してください");
  if (label.length > MAX_CUSTOM_LABEL_LENGTH)
    throw new Error(`項目名は${MAX_CUSTOM_LABEL_LENGTH}文字以内にしてください`);
  if (!CHECKLIST_PHASES.includes(input.phase))
    throw new Error("フェーズが不正です");
  if (entries.some((e) => e.id === input.id))
    throw new Error("項目IDが重複しています");
  // 同じフェーズの最後に追加する
  const result = [...entries];
  const phaseOf = (e: ChecklistTemplateEntry) =>
    e.kind === "custom" ? e.phase : BUILTIN_BY_ID.get(e.id)?.phase;
  let insertAt = result.length;
  const order = CHECKLIST_PHASES.indexOf(input.phase);
  for (let i = result.length - 1; i >= 0; i--) {
    const p = phaseOf(result[i]);
    if (p && CHECKLIST_PHASES.indexOf(p) <= order) {
      insertAt = i + 1;
      break;
    }
    insertAt = i;
  }
  result.splice(insertAt, 0, {
    kind: "custom",
    id: input.id,
    phase: input.phase,
    label,
  });
  return result;
}

export function removeItem(
  entries: readonly ChecklistTemplateEntry[],
  itemId: string
): ChecklistTemplateEntry[] {
  return entries.filter((e) => e.id !== itemId);
}

/** 同じフェーズ内で1つ上（-1）/下（+1）へ移動する。端では変化しない */
export function moveItem(
  entries: readonly ChecklistTemplateEntry[],
  itemId: string,
  direction: -1 | 1
): ChecklistTemplateEntry[] {
  const items = resolveChecklistItems(entries);
  const target = items.find((i) => i.id === itemId);
  if (!target) return [...entries];
  const samePhase = items.filter((i) => i.phase === target.phase);
  const pos = samePhase.findIndex((i) => i.id === itemId);
  const neighbour = samePhase[pos + direction];
  if (!neighbour) return [...entries];
  const result = [...entries];
  const a = result.findIndex((e) => e.id === itemId);
  const b = result.findIndex((e) => e.id === neighbour.id);
  [result[a], result[b]] = [result[b], result[a]];
  return result;
}

// ---------------------------------------------------------------------------
// ラウンドごとの完了状態
// ---------------------------------------------------------------------------

export function emptyRoundChecklist(
  round: { id: string; tournamentId: string },
  now: Date
): RoundChecklist {
  return {
    id: round.id,
    roundId: round.id,
    tournamentId: round.tournamentId,
    items: [],
    updatedAt: now,
  };
}

function updateItemState(
  checklist: RoundChecklist,
  itemId: string,
  update: (prev: ChecklistItemState) => ChecklistItemState,
  now: Date
): RoundChecklist {
  const prev = checklist.items.find((s) => s.itemId === itemId) ?? {
    itemId,
    done: false,
  };
  const next = update(prev);
  return {
    ...checklist,
    items: [...checklist.items.filter((s) => s.itemId !== itemId), next],
    updatedAt: now,
  };
}

export function setItemDone(
  checklist: RoundChecklist,
  itemId: string,
  done: boolean,
  now: Date
): RoundChecklist {
  return updateItemState(
    checklist,
    itemId,
    (prev) => ({ ...prev, done, doneAt: done ? now : undefined }),
    now
  );
}

export const MAX_NOTE_LENGTH = 500;

export function setItemNote(
  checklist: RoundChecklist,
  itemId: string,
  note: string,
  now: Date
): RoundChecklist {
  const trimmed = note.trim();
  if (trimmed.length > MAX_NOTE_LENGTH)
    throw new Error(`メモは${MAX_NOTE_LENGTH}文字以内にしてください`);
  return updateItemState(
    checklist,
    itemId,
    (prev) => ({ ...prev, note: trimmed || undefined }),
    now
  );
}

// ---------------------------------------------------------------------------
// 表示用の構成・進捗
// ---------------------------------------------------------------------------

export interface ChecklistViewItem extends ChecklistItemDefinition {
  done: boolean;
  doneAt?: Date;
  note?: string;
}

export interface ChecklistProgress {
  done: number;
  total: number;
}

export interface ChecklistSection {
  phase: ChecklistPhase;
  label: string;
  items: ChecklistViewItem[];
}

export interface ChecklistStageView {
  stage: ChecklistStage;
  label: string;
  sections: ChecklistSection[];
  progress: ChecklistProgress;
}

export interface ChecklistView {
  /** ラウンドの状態に対応する段階 */
  currentStage: ChecklistStage;
  stages: Record<ChecklistStage, ChecklistStageView>;
}

export function checklistProgress(
  items: readonly { done: boolean }[]
): ChecklistProgress {
  return { done: items.filter((i) => i.done).length, total: items.length };
}

export function buildChecklistView(
  items: readonly ChecklistItemDefinition[],
  checklist: RoundChecklist | null,
  roundStatus: RoundStatus
): ChecklistView {
  const stateById = new Map(
    (checklist?.items ?? []).map((s) => [s.itemId, s] as const)
  );
  const viewItems: ChecklistViewItem[] = items.map((def) => {
    const s = stateById.get(def.id);
    return { ...def, done: s?.done ?? false, doneAt: s?.doneAt, note: s?.note };
  });
  const stages = {} as Record<ChecklistStage, ChecklistStageView>;
  for (const stage of CHECKLIST_STAGES) {
    const sections = STAGE_PHASES[stage].map((phase) => ({
      phase,
      label: CHECKLIST_PHASE_LABEL[phase],
      items: viewItems.filter((i) => i.phase === phase),
    }));
    stages[stage] = {
      stage,
      label: CHECKLIST_STAGE_LABEL[stage],
      sections,
      progress: checklistProgress(sections.flatMap((s) => s.items)),
    };
  }
  return { currentStage: stageForRoundStatus(roundStatus), stages };
}

// ---------------------------------------------------------------------------
// ラウンドの開始・終了時の警告（判断はアービターが行う）
// ---------------------------------------------------------------------------

export type RoundTransitionWarning =
  | {
      kind: "incomplete-pre-round";
      /** 未完了の開始前項目の名前 */
      items: string[];
    }
  | {
      kind: "pending-incidents";
      /** このラウンドで保留中（追加質問待ち・AI判断の確認待ちを含む）の Incident 数 */
      count: number;
    };

export interface RoundTransitionAssessment {
  to: "active" | "completed";
  warnings: RoundTransitionWarning[];
}

/**
 * ラウンドの開始・終了前の確認事項。
 * - 開始（pending → active）: 開始前の項目が未完了なら警告（開始は可能。アービターが判断する）
 * - 終了（active → completed）: このラウンドに保留中の Incident があれば警告（明示的な確認が必要）
 * 不正な遷移はエラー（遷移の規則は round-planning.transitionRound と同じ）。
 */
export function assessRoundTransition(input: {
  status: RoundStatus;
  to: RoundStatus;
  items: readonly ChecklistItemDefinition[];
  checklist: RoundChecklist | null;
  pendingIncidentCount: number;
}): RoundTransitionAssessment {
  const { status, to } = input;
  if (status === "pending" && to === "active") {
    const view = buildChecklistView(input.items, input.checklist, status);
    const incomplete = view.stages.pre.sections
      .flatMap((s) => s.items)
      .filter((i) => !i.done)
      .map((i) => i.label);
    return {
      to,
      warnings:
        incomplete.length > 0
          ? [{ kind: "incomplete-pre-round", items: incomplete }]
          : [],
    };
  }
  if (status === "active" && to === "completed") {
    return {
      to,
      warnings:
        input.pendingIncidentCount > 0
          ? [{ kind: "pending-incidents", count: input.pendingIncidentCount }]
          : [],
    };
  }
  throw new Error(`ラウンドの状態を ${status} から ${to} に変更できません`);
}

/**
 * 確認済みの警告で、現在の警告がすべて説明されているか。
 * 確認後に増えた未完了項目・保留中の Incident・新しい種類の警告があれば false（再確認が必要）。
 */
export function warningsAcknowledged(
  current: readonly RoundTransitionWarning[],
  acknowledged: readonly RoundTransitionWarning[]
): boolean {
  return current.every((w) => {
    switch (w.kind) {
      case "incomplete-pre-round": {
        const seen = acknowledged.find((a) => a.kind === w.kind);
        return (
          seen?.kind === "incomplete-pre-round" &&
          w.items.every((label) => seen.items.includes(label))
        );
      }
      case "pending-incidents": {
        const seen = acknowledged.find((a) => a.kind === w.kind);
        return seen?.kind === "pending-incidents" && w.count <= seen.count;
      }
    }
  });
}

export function describeTransitionWarning(w: RoundTransitionWarning): string {
  switch (w.kind) {
    case "incomplete-pre-round":
      return `開始前チェックが${w.items.length}件未完了です`;
    case "pending-incidents":
      return `このラウンドに保留中（追加質問待ち・AI判断の確認待ちを含む）のIncidentが${w.count}件あります`;
  }
}
