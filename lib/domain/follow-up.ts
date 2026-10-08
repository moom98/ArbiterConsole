import type {
  BothFlagsOrder,
  ClockTimeSubtype,
  CompetitionType,
  ConditionCheck,
  DrawClaimFacts,
  DrawSubtype,
  FlagFallFacts,
  FlagFallen,
  HistoryConfirmation,
  Incident,
  IllegalMoveDetection,
  IllegalMoveFacts,
  IllegalMoveSubtype,
  PlayerColor,
  RepetitionClaimMode,
  SideMaterial,
  SupervisionRegime,
} from "@/lib/domain/entities";

/**
 * 追加確認質問（要件 §12）。
 * 質問の定義（ID・ラベル・選択肢・入力形式）はドメインが持ち、UIは表示と回答の収集のみを行う。
 */

/** 駒数の質問 ID（例: "whiteQueens", "blackLightBishops"） */
export type MaterialQuestionId =
  `${PlayerColor}${Capitalize<keyof SideMaterial>}`;

export type IncidentQuestionId =
  // 違法手（DT-001 / DT-002 / DT-003）
  | "playerColor"
  | "subtype"
  | "gameEnded"
  | "clockPressed"
  | "opponentCanCheckmate"
  | "opponentMadeNextMove"
  | "detectedBy"
  // 時計・時間（DT-004）
  | "clockTimeSubtype"
  | "flagFallen"
  | "bothFlagsOrder"
  | "quickplayGuidelinesApply"
  | "lastPeriod"
  | "gameEndedBeforeFlag"
  | "movesNotCompleted"
  | MaterialQuestionId
  | "materialConfirmed"
  | "positionFen"
  | "positionBlocked"
  // ドロー（DT-005）
  | "drawSubtype"
  | "claimant"
  | "claimantHasMove"
  | "claimMode"
  | "moveWritten"
  | "touchedPiece"
  | "repetitionCheck"
  | "fivefoldCheck"
  | "seventyFiveCheck"
  | "lastMoveCheckmate"
  | "positionsText"
  | "historyConfirmed"
  | "intendedMove"
  // 手動確認（決定木の対象外）
  | "situationNote";

export type GameContextQuestionId = "competitionType" | "supervisionRegime";

export type FollowUpQuestionId = IncidentQuestionId | GameContextQuestionId;

export interface FollowUpOption {
  value: string;
  label: string;
}

/**
 * 入力形式
 * - choice: 選択肢ボタン（既定）
 * - count:  0 以上の整数（大きな +/- ステッパー）
 * - text:   任意入力のテキスト（上級者向け: FEN / 棋譜）
 */
export type FollowUpInputKind = "choice" | "count" | "text";

export interface FollowUpQuestion {
  id: FollowUpQuestionId;
  /** incident: このIncidentへの回答 / game-context: 対局（大会）コンテキストの設定 */
  scope: "incident" | "game-context";
  label: string;
  help?: string;
  options: FollowUpOption[];
  /** 省略時は "choice" */
  input?: FollowUpInputKind;
  /** count の範囲 */
  min?: number;
  max?: number;
  /** UI の初期値（count では "0"） */
  defaultValue?: string;
  /** true の場合、未回答（空）でも送信できる */
  optional?: boolean;
  placeholder?: string;
  /** UI でまとめて表示するためのグループ名（例: "白の駒（キング以外）"） */
  group?: string;
  /**
   * 同じラウンドの別の質問への回答が values のいずれかの場合のみ表示・回答を求める。
   * 条件の定義はドメインが持ち、UI は一致判定のみ行う。
   */
  showWhen?: { questionId: FollowUpQuestionId; values: string[] };
  /**
   * 共通の「わからない・確認できない」選択肢（UNKNOWN_OPTION）を持つ質問での扱い
   * （fact-model §3.3）。
   * - enumerate:     unknown のとき、他の選択肢すべてで評価して比較する（resolveUnknown）
   * - manual-review: 列挙できない（例: 駒数の確認）。unknown なら手動確認
   * 未設定の質問は共通の unknown を持たない（独自の unknown 値を持つ質問を含む）。
   */
  onUnknown?: "enumerate" | "manual-review";
}

/** 共通の「わからない・確認できない」の回答値 */
export const UNKNOWN_VALUE = "unknown";

/** 共通の「わからない・確認できない」選択肢（他の選択肢と同じ大きさで表示する） */
export const UNKNOWN_OPTION: FollowUpOption = {
  value: UNKNOWN_VALUE,
  label: "わからない・確認できない",
};

/** unknown のときに列挙する値（共通の unknown 以外の選択肢） */
export function enumerableValues(q: FollowUpQuestion): string[] {
  return q.options.map((o) => o.value).filter((v) => v !== UNKNOWN_VALUE);
}

/** showWhen の条件を満たすか（UI 用の純粋関数） */
export function isQuestionVisible(
  q: FollowUpQuestion,
  answers: Record<string, string>
): boolean {
  if (!q.showWhen) return true;
  const a = answers[q.showWhen.questionId];
  return a !== undefined && q.showWhen.values.includes(a);
}

const YES_NO: FollowUpOption[] = [
  { value: "true", label: "はい" },
  { value: "false", label: "いいえ" },
];

const COLOR_OPTIONS: FollowUpOption[] = [
  { value: "white", label: "白" },
  { value: "black", label: "黒" },
];

export const SUBTYPE_LABELS: Record<IllegalMoveSubtype, string> = {
  "illegal-move": "通常の違法手",
  "promotion-not-replaced": "昇格の駒を置かずに時計を押した",
  "clock-without-move": "手を指さずに時計を押した",
  "two-hands": "両手で指した",
};

export const CLOCK_TIME_SUBTYPE_LABELS: Record<ClockTimeSubtype, string> = {
  "flag-fall": "フラッグが落ちた（時間切れ）",
  other: "その他の時計トラブル",
};

export const DRAW_SUBTYPE_LABELS: Record<DrawSubtype, string> = {
  "threefold-repetition-claim": "三回同一局面のクレーム（9.2）",
  "fivefold-repetition": "五回同一局面（9.6.1）",
  "75-move-rule": "75手ルール（9.6.2）",
  other: "その他（合意・50手ルール等）",
};

const PIECE_LABELS: Record<keyof SideMaterial, string> = {
  queens: "クイーン",
  rooks: "ルーク",
  lightBishops: "白マスのビショップ",
  darkBishops: "黒マスのビショップ",
  knights: "ナイト",
  pawns: "ポーン",
};

/** 駒数入力の上限（昇格を含めて理論上ありうる最大値） */
const PIECE_MAX: Record<keyof SideMaterial, number> = {
  queens: 9,
  rooks: 10,
  lightBishops: 9,
  darkBishops: 9,
  knights: 10,
  pawns: 8,
};

export const MATERIAL_KEYS: readonly (keyof SideMaterial)[] = [
  "queens",
  "rooks",
  "lightBishops",
  "darkBishops",
  "knights",
  "pawns",
];

export function materialQuestionId(
  color: PlayerColor,
  piece: keyof SideMaterial
): MaterialQuestionId {
  return `${color}${piece.charAt(0).toUpperCase()}${piece.slice(1)}` as MaterialQuestionId;
}

function materialQuestions(): Record<MaterialQuestionId, FollowUpQuestion> {
  const out = {} as Record<MaterialQuestionId, FollowUpQuestion>;
  for (const color of ["white", "black"] as const) {
    for (const piece of MATERIAL_KEYS) {
      const id = materialQuestionId(color, piece);
      out[id] = {
        id,
        scope: "incident",
        label: PIECE_LABELS[piece],
        input: "count",
        min: 0,
        max: PIECE_MAX[piece],
        defaultValue: "0",
        options: [],
        group:
          color === "white" ? "白の駒（キング以外）" : "黒の駒（キング以外）",
      };
    }
  }
  return out;
}

/** 共通の unknown を加える（fact-model §3.3: すべての DT 質問に unknown） */
function withUnknown(
  q: FollowUpQuestion,
  onUnknown: "enumerate" | "manual-review" = "enumerate"
): FollowUpQuestion {
  return { ...q, options: [...q.options, UNKNOWN_OPTION], onUnknown };
}

const CONDITION_AUTO: FollowUpOption = {
  value: "auto",
  label: "下の棋譜から判定する",
};

const BASE_QUESTIONS: Record<FollowUpQuestionId, FollowUpQuestion> = {
  playerColor: {
    id: "playerColor",
    scope: "incident",
    label: "違反したのはどちらのプレーヤーですか？",
    options: COLOR_OPTIONS,
  },
  subtype: {
    id: "subtype",
    scope: "incident",
    label: "どの違反ですか？",
    help: "1つの手の中で複数該当する場合（例: 両手による違法キャスリング）は主なものを1つ選んでください。1回として数えます。",
    options: (Object.keys(SUBTYPE_LABELS) as IllegalMoveSubtype[]).map(
      (value) => ({ value, label: SUBTYPE_LABELS[value] })
    ),
  },
  gameEnded: {
    id: "gameEnded",
    scope: "incident",
    label: "対局はすでに終了していますか？",
    help: "棋譜に署名済み、またはその他の方法で対局終了が明らかな場合は「はい」",
    options: YES_NO,
  },
  clockPressed: {
    id: "clockPressed",
    scope: "incident",
    label: "違反したプレーヤーは時計を押しましたか？",
    help: "「手を指さずに時計を押した」の場合は「はい」",
    options: YES_NO,
  },
  opponentCanCheckmate: {
    id: "opponentCanCheckmate",
    scope: "incident",
    label:
      "相手は、あらゆる合法手の連続によって違反者のキングをチェックメイトできる局面ですか？",
    help: "メイト不可能な場合はドロー（7.5.5 ただし書き）。判断できない場合は「わからない」を選ぶと、CA確認の判断支援になります。",
    options: [
      { value: "true", label: "メイト可能" },
      { value: "false", label: "メイト不可能" },
      { value: "unknown", label: "わからない（CAへ確認）" },
    ],
  },
  opponentMadeNextMove: {
    id: "opponentMadeNextMove",
    scope: "incident",
    label: "違反者の相手は、すでに次の手を指しましたか？",
    help: "A.5.2: 相手が次の手を指した後は、違法手を訂正できません。",
    options: YES_NO,
  },
  detectedBy: {
    id: "detectedBy",
    scope: "incident",
    label: "違法手を指摘したのは誰ですか？",
    options: [
      { value: "arbiter", label: "アービターが目撃した" },
      { value: "opponent-claim", label: "相手がクレームした" },
      { value: "other", label: "その他（観戦者の報告など）" },
    ],
  },

  // ---- 時計・時間 ----
  clockTimeSubtype: {
    id: "clockTimeSubtype",
    scope: "incident",
    label: "どの事象ですか？",
    options: (Object.keys(CLOCK_TIME_SUBTYPE_LABELS) as ClockTimeSubtype[]).map(
      (value) => ({ value, label: CLOCK_TIME_SUBTYPE_LABELS[value] })
    ),
  },
  flagFallen: {
    id: "flagFallen",
    scope: "incident",
    label: "フラッグが落ちたのはどちらですか？",
    options: [
      ...COLOR_OPTIONS,
      { value: "both", label: "両方（両方の時計が 0.00）" },
    ],
  },
  bothFlagsOrder: {
    id: "bothFlagsOrder",
    scope: "incident",
    label: "どちらのフラッグが先に落ちましたか？",
    help: "電子時計では、先に落ちた側に表示（フラッグ表示）が出ることが多いです。",
    options: [
      { value: "white-first", label: "白が先（白の時計に表示）" },
      { value: "black-first", label: "黒が先（黒の時計に表示）" },
      { value: "unknown", label: "判別できない" },
    ],
  },
  quickplayGuidelinesApply: {
    id: "quickplayGuidelinesApply",
    scope: "incident",
    label:
      "増加時間なしの対局で、Guidelines III（Quickplay Finish）の使用が事前に告知されていますか？",
    options: YES_NO,
  },
  lastPeriod: {
    id: "lastPeriod",
    scope: "incident",
    label: "残りの全ての手を指し切る最終ピリオドですか？",
    options: YES_NO,
  },
  gameEndedBeforeFlag: {
    id: "gameEndedBeforeFlag",
    scope: "incident",
    label:
      "フラッグに気付く（主張される）前に、対局はすでに終了していましたか？",
    help: "チェックメイト・ステイルメイト・投了・合意によるドロー・デッドポジション・五回同一局面・75手ルールなど",
    options: YES_NO,
  },
  movesNotCompleted: {
    id: "movesNotCompleted",
    scope: "incident",
    label:
      "時間切れのプレーヤーは、そのピリオドの規定手数を完了していませんでしたか？",
    help: "全手数を指し切る持ち時間（単一ピリオド）の場合は「完了していない」",
    options: [
      { value: "true", label: "完了していない" },
      { value: "false", label: "規定手数は完了していた" },
      { value: "unknown", label: "わからない（CAへ確認）" },
    ],
  },
  ...materialQuestions(),
  materialConfirmed: {
    id: "materialConfirmed",
    scope: "incident",
    label: "盤上の駒数を上のとおり確認しましたか？",
    help: "キング以外の駒を数えてください。FEN を入力した場合は FEN の駒が使われます。",
    options: [{ value: "true", label: "確認した" }],
  },
  positionFen: {
    id: "positionFen",
    scope: "incident",
    label: "（任意）局面の FEN",
    input: "text",
    optional: true,
    placeholder: "例: 8/8/8/4k3/8/8/4K3/7R w - - 0 1",
    options: [],
  },
  positionBlocked: {
    id: "positionBlocked",
    scope: "incident",
    label:
      "ポーンが固定され、駒が相手キングに到達できない「閉塞局面」の可能性はありますか？",
    help: "盤上にポーンがあるため、駒数だけでは判定できません。",
    options: [
      { value: "false", label: "ない（通常の局面）" },
      { value: "unknown", label: "ある／判断できない（CAへ確認）" },
    ],
  },

  // ---- ドロー ----
  drawSubtype: {
    id: "drawSubtype",
    scope: "incident",
    label: "どの事象ですか？",
    options: (Object.keys(DRAW_SUBTYPE_LABELS) as DrawSubtype[]).map(
      (value) => ({ value, label: DRAW_SUBTYPE_LABELS[value] })
    ),
  },
  claimant: {
    id: "claimant",
    scope: "incident",
    label: "クレームしたのはどちらのプレーヤーですか？",
    options: COLOR_OPTIONS,
  },
  claimantHasMove: {
    id: "claimantHasMove",
    scope: "incident",
    label: "クレームしたプレーヤーの手番（自分の時計が動いている）ですか？",
    options: YES_NO,
  },
  claimMode: {
    id: "claimMode",
    scope: "incident",
    label: "どのクレームですか？",
    options: [
      {
        value: "just-appeared",
        label: "相手の直前の手で3回目の局面が出現した（9.2.2）",
      },
      {
        value: "about-to-appear",
        label: "自分の次の手で3回目の局面が出現する（9.2.1）",
      },
    ],
  },
  moveWritten: {
    id: "moveWritten",
    scope: "incident",
    label:
      "クレームしたプレーヤーは、指す手を棋譜に記入し、その手を指す意思をアービターに宣言しましたか？",
    options: YES_NO,
  },
  touchedPiece: {
    id: "touchedPiece",
    scope: "incident",
    label:
      "クレームの前に、クレームしたプレーヤーは動かす（取る）意図で駒に触れましたか？",
    options: YES_NO,
  },
  repetitionCheck: {
    id: "repetitionCheck",
    scope: "incident",
    label:
      "対局を再現して確認した結果、クレームの局面は3回以上（今回を含む）出現していますか？",
    help: "同じ手番・同じ駒配置・同じキャスリング権・同じアンパッサンの可否（9.2.3）",
    options: [
      { value: "met", label: "3回以上を確認した" },
      { value: "not-met", label: "3回未満だった" },
      { value: "unknown", label: "確認できない（CAへ）" },
      CONDITION_AUTO,
    ],
  },
  fivefoldCheck: {
    id: "fivefoldCheck",
    scope: "incident",
    label:
      "同じ局面が5回以上出現していることを確認しましたか？（連続でなくてよい）",
    options: [
      { value: "met", label: "5回以上を確認した" },
      { value: "not-met", label: "5回未満だった" },
      { value: "unknown", label: "確認できない（CAへ）" },
      CONDITION_AUTO,
    ],
  },
  seventyFiveCheck: {
    id: "seventyFiveCheck",
    scope: "incident",
    label:
      "両プレーヤーとも、ポーンの移動も駒取りもなく75手以上を指したことを確認しましたか？",
    options: [
      { value: "met", label: "75手以上を確認した" },
      { value: "not-met", label: "75手未満だった" },
      { value: "unknown", label: "確認できない（CAへ）" },
      CONDITION_AUTO,
    ],
  },
  lastMoveCheckmate: {
    id: "lastMoveCheckmate",
    scope: "incident",
    label: "最後の手はチェックメイトでしたか？",
    options: YES_NO,
  },
  positionsText: {
    id: "positionsText",
    scope: "incident",
    label: "（任意）棋譜・PGN（初期配置からの指し手）",
    help: '「判定する」を選んだ場合に使用します。標準の表記（SAN）で入力してください。例: 1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6。途中の局面から始める場合は [FEN "…"] を先頭に書きます（その場合「不成立」は自動では確定しません）。FEN の列は使えません。入力した棋譜は端末の外へ送りません。',
    input: "text",
    optional: true,
    placeholder: "1. e4 e5 2. Nf3 Nc6 ...",
    options: [],
  },
  historyConfirmed: {
    id: "historyConfirmed",
    scope: "incident",
    label:
      "棋譜を再生した最終局面と手数は、盤上の局面・スコアシートと一致しますか？",
    help: "上に表示した最終局面（手番・最後の手・FEN）を盤上と照合してください。一致しない場合は自動判定を使いません。",
    options: [
      { value: "match", label: "局面も手数も一致した" },
      { value: "position-only", label: "局面は一致・手数は確認できない" },
      { value: "mismatch", label: "一致しない" },
      { value: "unknown", label: "照合できない（盤上で再現する）" },
    ],
  },
  intendedMove: {
    id: "intendedMove",
    scope: "incident",
    label: "（任意）記入した次の手（例: Nf3）",
    input: "text",
    optional: true,
    placeholder: "Nf3",
    options: [],
  },

  // ---- 手動確認 ----
  situationNote: {
    id: "situationNote",
    scope: "incident",
    label: "状況のメモ（必須）",
    help: "決定木の対象外のため、CA・記録用に状況を簡潔に記入してください。",
    input: "text",
    placeholder: "例: 時計の表示が消えた",
    options: [],
  },

  // ---- 対局コンテキスト ----
  competitionType: {
    id: "competitionType",
    scope: "game-context",
    label: "競技区分を選択してください",
    options: [
      { value: "standard", label: "Standard" },
      { value: "rapid", label: "Rapid" },
      { value: "blitz", label: "Blitz" },
    ],
  },
  supervisionRegime: {
    id: "supervisionRegime",
    scope: "game-context",
    label: "大会規定で適用される規則（Rapid A.4/A.5・Blitz B.2/B.3）",
    options: [
      { value: "competition-rules", label: "Competition Rules（A.4 / B.2）" },
      { value: "basic-rules", label: "それ以外（A.5 / B.3）" },
    ],
  },
};

/**
 * 共通の unknown を持つ質問（fact-model §3.3）。
 * 独自の unknown 値を持つ質問（opponentCanCheckmate・bothFlagsOrder・movesNotCompleted・
 * positionBlocked・同一局面の確認・対局履歴の照合）は各 DT が独自の手動確認で扱うため含めない。
 * 駒数（count）・テキストは列挙できず、テキストは任意（空欄 = 不明）のため含めない。
 * game-context（競技区分・規則）は大会プロファイルから与えるため含めない。
 */
const ENUMERATED_UNKNOWN: readonly IncidentQuestionId[] = [
  "playerColor",
  "subtype",
  "gameEnded",
  "clockPressed",
  "opponentMadeNextMove",
  "detectedBy",
  "clockTimeSubtype",
  "flagFallen",
  "quickplayGuidelinesApply",
  "lastPeriod",
  "gameEndedBeforeFlag",
  "drawSubtype",
  "claimant",
  "claimantHasMove",
  "claimMode",
  "moveWritten",
  "touchedPiece",
  "lastMoveCheckmate",
];
const MANUAL_REVIEW_UNKNOWN: readonly IncidentQuestionId[] = [
  // 「確認した」の1択。確認できなければ駒数が使えないため手動確認
  "materialConfirmed",
];

export const QUESTIONS: Record<FollowUpQuestionId, FollowUpQuestion> = {
  ...BASE_QUESTIONS,
};
for (const id of ENUMERATED_UNKNOWN)
  QUESTIONS[id] = withUnknown(BASE_QUESTIONS[id], "enumerate");
for (const id of MANUAL_REVIEW_UNKNOWN)
  QUESTIONS[id] = withUnknown(BASE_QUESTIONS[id], "manual-review");

/** この質問への回答 raw が共通の unknown か */
export function isGenericUnknownAnswer(
  id: string,
  raw: string | undefined
): boolean {
  return (
    raw === UNKNOWN_VALUE &&
    (QUESTIONS as Record<string, FollowUpQuestion | undefined>)[id]
      ?.onUnknown !== undefined
  );
}

function parseBoolean(value: string): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parseTriState(value: string): boolean | "unknown" | undefined {
  if (value === "unknown") return "unknown";
  return parseBoolean(value);
}

function isOneOf<T extends string>(
  value: string,
  allowed: readonly T[]
): value is T {
  return (allowed as readonly string[]).includes(value);
}

/** 駒数の回答を解釈する（範囲外・非整数は無視） */
function parseCount(raw: string, max: number): number | undefined {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const n = Number(trimmed);
  return n <= max ? n : undefined;
}

const MATERIAL_ID_MAP: Record<
  string,
  { color: PlayerColor; piece: keyof SideMaterial }
> = Object.fromEntries(
  (["white", "black"] as const).flatMap((color) =>
    MATERIAL_KEYS.map((piece) => [
      materialQuestionId(color, piece),
      { color, piece },
    ])
  )
);

const CONDITION_CHECKS = ["met", "not-met", "unknown", "auto"] as const;

/**
 * Incident スコープの回答を Incident に反映した新しい Incident を返す（純粋関数）。
 * 不正な値は無視する。
 */
export function applyIncidentAnswers(
  incident: Incident,
  answers: Partial<Record<IncidentQuestionId, string>>
): Incident {
  const facts: Partial<IllegalMoveFacts> = { ...incident.illegalMoveFacts };
  const flag: Partial<FlagFallFacts> = {
    ...incident.flagFallFacts,
    material: incident.flagFallFacts?.material
      ? {
          white: { ...incident.flagFallFacts.material.white },
          black: { ...incident.flagFallFacts.material.black },
        }
      : undefined,
  };
  const draw: Partial<DrawClaimFacts> = { ...incident.drawClaimFacts };
  let playerColor: PlayerColor | undefined = incident.playerColor;
  let subtype: string | undefined = incident.subtype;
  let touchedIllegal = false;
  let touchedFlag = false;
  let touchedDraw = false;
  let next_description = incident.description;
  const unknown = new Set(incident.unknownAnswers ?? []);

  /** 共通の unknown が選ばれた質問の、以前の回答を取り消す */
  const clearAnswer = (id: IncidentQuestionId): void => {
    switch (id) {
      case "playerColor":
        playerColor = undefined;
        break;
      case "subtype":
      case "gameEnded":
      case "clockPressed":
      case "opponentMadeNextMove":
      case "detectedBy":
        delete facts[id];
        touchedIllegal = true;
        break;
      case "clockTimeSubtype":
        if (incident.category === "clock-time") subtype = undefined;
        break;
      case "flagFallen":
        delete flag.flagFallen;
        if (incident.category === "clock-time") playerColor = undefined;
        touchedFlag = true;
        break;
      case "quickplayGuidelinesApply":
      case "lastPeriod":
      case "gameEndedBeforeFlag":
      case "materialConfirmed":
        delete flag[id];
        touchedFlag = true;
        break;
      case "drawSubtype":
        if (incident.category === "draw") subtype = undefined;
        delete draw.subtype;
        touchedDraw = true;
        break;
      case "claimant":
        delete draw.claimant;
        if (incident.category === "draw") playerColor = undefined;
        touchedDraw = true;
        break;
      case "claimantHasMove":
      case "claimMode":
      case "moveWritten":
      case "touchedPiece":
      case "lastMoveCheckmate":
        delete draw[id];
        touchedDraw = true;
        break;
    }
  };

  for (const [id, raw] of Object.entries(answers) as [
    IncidentQuestionId,
    string | undefined,
  ][]) {
    if (raw === undefined) continue;

    // 共通の unknown は値として保持せず unknownAnswers に記録する（fact-model §3.3 e）。
    // 未回答（undefined）とは区別され、DT は needs-input で止まらずに resolveUnknown で扱う
    if (isGenericUnknownAnswer(id, raw)) {
      unknown.add(id);
      clearAnswer(id);
      continue;
    }
    unknown.delete(id);

    const material = MATERIAL_ID_MAP[id];
    if (material) {
      const n = parseCount(raw, PIECE_MAX[material.piece]);
      if (n !== undefined) {
        flag.material = flag.material ?? { white: {}, black: {} };
        flag.material[material.color][material.piece] = n;
        touchedFlag = true;
      }
      continue;
    }

    switch (id) {
      // ---- 違法手 ----
      case "playerColor":
        if (isOneOf(raw, ["white", "black"] as const)) playerColor = raw;
        break;
      case "subtype":
        if (isOneOf(raw, Object.keys(SUBTYPE_LABELS) as IllegalMoveSubtype[])) {
          facts.subtype = raw;
          touchedIllegal = true;
        }
        break;
      case "gameEnded":
      case "clockPressed":
      case "opponentMadeNextMove": {
        const b = parseBoolean(raw);
        if (b !== undefined) {
          facts[id] = b;
          touchedIllegal = true;
        }
        break;
      }
      case "opponentCanCheckmate": {
        const b = parseBoolean(raw);
        facts.opponentCanCheckmate = b ?? "unknown";
        touchedIllegal = true;
        break;
      }
      case "detectedBy":
        if (
          isOneOf(raw, [
            "arbiter",
            "opponent-claim",
            "other",
          ] as readonly IllegalMoveDetection[])
        ) {
          facts.detectedBy = raw;
          touchedIllegal = true;
        }
        break;

      // ---- 時計・時間 ----
      case "clockTimeSubtype":
        if (
          isOneOf(
            raw,
            Object.keys(CLOCK_TIME_SUBTYPE_LABELS) as ClockTimeSubtype[]
          )
        )
          subtype = raw;
        break;
      case "flagFallen":
        if (isOneOf(raw, ["white", "black", "both"] as readonly FlagFallen[])) {
          flag.flagFallen = raw;
          // 時間切れの対象プレーヤー（両方の場合は未設定のまま）
          if (raw !== "both") playerColor = raw;
          touchedFlag = true;
        }
        break;
      case "bothFlagsOrder":
        if (
          isOneOf(raw, [
            "white-first",
            "black-first",
            "unknown",
          ] as readonly BothFlagsOrder[])
        ) {
          flag.bothFlagsOrder = raw;
          touchedFlag = true;
        }
        break;
      case "quickplayGuidelinesApply":
      case "lastPeriod":
      case "gameEndedBeforeFlag":
      case "materialConfirmed": {
        const b = parseBoolean(raw);
        if (b !== undefined) {
          flag[id] = b;
          touchedFlag = true;
        }
        break;
      }
      case "movesNotCompleted":
      case "positionBlocked": {
        const t = parseTriState(raw);
        if (t !== undefined) {
          flag[id] = t;
          touchedFlag = true;
        }
        break;
      }
      case "positionFen": {
        const fen = raw.trim();
        flag.fen = fen === "" ? undefined : fen;
        touchedFlag = true;
        break;
      }

      // ---- ドロー ----
      case "drawSubtype":
        if (isOneOf(raw, Object.keys(DRAW_SUBTYPE_LABELS) as DrawSubtype[])) {
          subtype = raw;
          draw.subtype = raw;
          touchedDraw = true;
        }
        break;
      case "claimant":
        if (isOneOf(raw, ["white", "black"] as const)) {
          draw.claimant = raw;
          // 誤ったクレームの時間加算は請求者の履歴に帰属させる（Penalty 履歴）
          playerColor = raw;
          touchedDraw = true;
        }
        break;
      case "claimantHasMove":
      case "moveWritten":
      case "touchedPiece":
      case "lastMoveCheckmate": {
        const b = parseBoolean(raw);
        if (b !== undefined) {
          draw[id] = b;
          touchedDraw = true;
        }
        break;
      }
      case "claimMode":
        if (
          isOneOf(raw, [
            "about-to-appear",
            "just-appeared",
          ] as readonly RepetitionClaimMode[])
        ) {
          draw.claimMode = raw;
          touchedDraw = true;
        }
        break;
      case "repetitionCheck":
      case "fivefoldCheck":
      case "seventyFiveCheck":
        if (isOneOf(raw, CONDITION_CHECKS as readonly ConditionCheck[])) {
          draw.conditionCheck = raw;
          touchedDraw = true;
        }
        break;
      case "situationNote": {
        const note = raw.trim();
        if (note !== "") {
          next_description = next_description.trim()
            ? `${next_description}\n${note}`
            : note;
        }
        break;
      }
      case "positionsText":
      case "intendedMove": {
        const text = raw.trim();
        draw[id] = text === "" ? undefined : text;
        touchedDraw = true;
        break;
      }
      case "historyConfirmed":
        if (
          isOneOf(raw, [
            "match",
            "position-only",
            "mismatch",
            "unknown",
          ] as readonly HistoryConfirmation[])
        ) {
          draw.historyConfirmed = raw;
          touchedDraw = true;
        }
        break;
    }
  }

  // 別の対局履歴に対する照合結果は引き継がない（ADR-014 §4）。同じ送信で新しい棋譜と
  // 照合結果が届いた場合も、照合は表示していた旧い棋譜に対するものなので消す
  if (draw.positionsText !== incident.drawClaimFacts?.positionsText)
    delete draw.historyConfirmed;
  // 「判定する」を選び直した場合は、照合からやり直す（「一致しない」の誤タップを取り消せる）
  const reselectedAuto = (
    ["repetitionCheck", "fivefoldCheck", "seventyFiveCheck"] as const
  ).some((id) => answers[id] === "auto");
  if (reselectedAuto && answers.historyConfirmed === undefined)
    delete draw.historyConfirmed;

  const next: Incident = {
    ...incident,
    playerColor,
    subtype,
    description: next_description,
  };
  if (unknown.size > 0) next.unknownAnswers = Array.from(unknown);
  else delete next.unknownAnswers;
  if (
    incident.category === "illegal-move" ||
    touchedIllegal ||
    incident.illegalMoveFacts
  ) {
    next.illegalMoveFacts = facts;
    // 違法手の subtype は Incident.subtype にも反映（従来どおり）
    // 「わからない」と回答された場合は、以前の subtype を残さない（ログ・CSV・回数の明細に出さない）
    if (incident.category === "illegal-move")
      next.subtype =
        facts.subtype ??
        (unknown.has("subtype") ? undefined : incident.subtype);
  }
  if (touchedFlag || incident.flagFallFacts) next.flagFallFacts = flag;
  if (touchedDraw || incident.drawClaimFacts) next.drawClaimFacts = draw;
  return next;
}

/**
 * 構造化された追加質問で判断するカテゴリ（自由記述は任意のメモ）。
 * それ以外のカテゴリは手動確認になるため、状況の説明を必須とする。
 */
export function usesStructuredQuestions(
  category: Incident["category"]
): boolean {
  return (
    category === "illegal-move" ||
    category === "clock-time" ||
    category === "draw"
  );
}

/**
 * カテゴリ選択画面のショートカット（M3: 頻出の決定木へ subtype 込みで直接入る）。
 * subtype をカテゴリ選択時に確定し、追加質問のラウンドを減らす。
 */
export interface QuickReport {
  id: string;
  category: Incident["category"];
  subtype: string;
  label: string;
}

export const QUICK_REPORTS: readonly QuickReport[] = [
  {
    id: "flag-fall",
    category: "clock-time",
    subtype: "flag-fall",
    label: "フラッグ（時間切れ）",
  },
  {
    id: "threefold",
    category: "draw",
    subtype: "threefold-repetition-claim",
    label: "三回同一局面のクレーム",
  },
  {
    id: "fivefold",
    category: "draw",
    subtype: "fivefold-repetition",
    label: "五回同一局面",
  },
  {
    id: "75-move",
    category: "draw",
    subtype: "75-move-rule",
    label: "75手ルール",
  },
];

/** カテゴリに対して有効な subtype か（報告時の検証用） */
export function isKnownSubtype(
  category: Incident["category"],
  subtype: string
): boolean {
  if (category === "clock-time")
    return Object.keys(CLOCK_TIME_SUBTYPE_LABELS).includes(subtype);
  if (category === "draw")
    return Object.keys(DRAW_SUBTYPE_LABELS).includes(subtype);
  return false;
}

/** game-context スコープの回答を解釈する（純粋関数） */
export function parseGameContextAnswers(
  answers: Partial<Record<GameContextQuestionId, string>>
): {
  competitionType?: CompetitionType;
  supervisionRegime?: SupervisionRegime;
} {
  const out: {
    competitionType?: CompetitionType;
    supervisionRegime?: SupervisionRegime;
  } = {};
  const ct = answers.competitionType;
  if (ct && isOneOf(ct, ["standard", "rapid", "blitz"] as const))
    out.competitionType = ct;
  const sr = answers.supervisionRegime;
  if (sr && isOneOf(sr, ["competition-rules", "basic-rules"] as const))
    out.supervisionRegime = sr;
  return out;
}
