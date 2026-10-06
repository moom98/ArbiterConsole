import type {
  CompetitionType,
  Incident,
  IllegalMoveFacts,
  IllegalMoveSubtype,
  PlayerColor,
  SupervisionRegime,
} from "@/lib/domain/entities";

/**
 * 追加確認質問（要件 §12）。
 * 質問の定義（ID・ラベル・選択肢）はドメインが持ち、UIは表示と回答の収集のみを行う。
 */
export type IncidentQuestionId =
  | "playerColor"
  | "subtype"
  | "gameEnded"
  | "clockPressed"
  | "opponentCanCheckmate";

export type GameContextQuestionId = "competitionType" | "supervisionRegime";

export type FollowUpQuestionId = IncidentQuestionId | GameContextQuestionId;

export interface FollowUpOption {
  value: string;
  label: string;
}

export interface FollowUpQuestion {
  id: FollowUpQuestionId;
  /** incident: このIncidentへの回答 / game-context: 対局（大会）コンテキストの設定 */
  scope: "incident" | "game-context";
  label: string;
  help?: string;
  options: FollowUpOption[];
}

const YES_NO: FollowUpOption[] = [
  { value: "true", label: "はい" },
  { value: "false", label: "いいえ" },
];

export const SUBTYPE_LABELS: Record<IllegalMoveSubtype, string> = {
  "illegal-move": "通常の違法手",
  "promotion-not-replaced": "昇格の駒を置かずに時計を押した",
  "clock-without-move": "手を指さずに時計を押した",
  "two-hands": "両手で指した",
};

export const QUESTIONS: Record<FollowUpQuestionId, FollowUpQuestion> = {
  playerColor: {
    id: "playerColor",
    scope: "incident",
    label: "違反したのはどちらのプレーヤーですか？",
    options: [
      { value: "white", label: "白" },
      { value: "black", label: "黒" },
    ],
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

function parseBoolean(value: string): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function isOneOf<T extends string>(
  value: string,
  allowed: readonly T[]
): value is T {
  return (allowed as readonly string[]).includes(value);
}

/**
 * Incident スコープの回答を Incident に反映した新しい Incident を返す（純粋関数）。
 * 不正な値は無視する。
 */
export function applyIncidentAnswers(
  incident: Incident,
  answers: Partial<Record<IncidentQuestionId, string>>
): Incident {
  const facts: Partial<IllegalMoveFacts> = { ...incident.illegalMoveFacts };
  let playerColor: PlayerColor | undefined = incident.playerColor;

  for (const [id, raw] of Object.entries(answers) as [
    IncidentQuestionId,
    string | undefined,
  ][]) {
    if (raw === undefined) continue;
    switch (id) {
      case "playerColor":
        if (isOneOf(raw, ["white", "black"] as const)) playerColor = raw;
        break;
      case "subtype":
        if (isOneOf(raw, Object.keys(SUBTYPE_LABELS) as IllegalMoveSubtype[]))
          facts.subtype = raw;
        break;
      case "gameEnded":
      case "clockPressed": {
        const b = parseBoolean(raw);
        if (b !== undefined) facts[id] = b;
        break;
      }
      case "opponentCanCheckmate": {
        const b = parseBoolean(raw);
        facts.opponentCanCheckmate = b ?? "unknown";
        break;
      }
    }
  }

  return {
    ...incident,
    playerColor,
    subtype: facts.subtype ?? incident.subtype,
    illegalMoveFacts: facts,
  };
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
