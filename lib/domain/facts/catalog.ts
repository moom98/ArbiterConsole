import type {
  FactCondition,
  FactDefinition,
  FactOption,
  FactUsage,
  SourceRef,
} from "./types";

/**
 * Fact カタログ（データ）。正本は docs/design/jev-missing-info-catalog.md。
 * 変更する場合は正本を先に直し、ここへ写すこと。
 *
 * fact ID の接頭辞:
 * game.* 共通 / im.* 違法手（7.5）/ tch.* 触れた駒（Article 4）/ ct.* 時計 / dr.* ドロー /
 * gr.* 対局結果 / ss.* 棋譜 / pb.* 選手の行動 / tm.* 団体戦 / bp.* 盤・駒 / ta.* 大会運営
 */

// ---------------------------------------------------------------------------
// 補助
// ---------------------------------------------------------------------------

const req = (ref: string, note?: string): SourceRef => ({
  kind: "requirement",
  ref,
  note,
});
const fide = (ref: string, note?: string): SourceRef => ({
  kind: "fide",
  ref,
  note,
});
const dt = (ref: string): SourceRef => ({ kind: "dt", ref });
const design = (ref: string, note?: string): SourceRef => ({
  kind: "design",
  ref,
  note,
});

const opts = (...pairs: [string, string][]): FactOption[] =>
  pairs.map(([value, label]) => ({ value, label }));

const COLORS = opts(["white", "白"], ["black", "黒"]);

/** 報告文で確認できる観測事実（Jev の明示判定の対象） */
function observed(
  id: string,
  question: string,
  answer: FactDefinition["answer"],
  sources: SourceRef[]
): FactDefinition {
  return {
    id,
    question,
    answer,
    localOnly: false,
    presenceCheckable: true,
    sources,
  };
}

/** 端末内だけで使う構造化データ（外部へ送らない・Jev の対象外） */
function localOnly(
  id: string,
  question: string,
  format: "game-history" | "fen" | "square-list" | "san",
  sources: SourceRef[]
): FactDefinition {
  return {
    id,
    question,
    answer: { kind: "structured", format },
    localOnly: true,
    presenceCheckable: false,
    sources,
  };
}

/** 設定・記録から求める fact（求められない場合のみ質問する） */
function derived(
  id: string,
  question: string,
  answer: FactDefinition["answer"],
  derivedFrom: NonNullable<FactDefinition["derivedFrom"]>,
  sources: SourceRef[]
): FactDefinition {
  return {
    id,
    question,
    answer,
    localOnly: false,
    presenceCheckable: false,
    derivedFrom,
    sources,
  };
}

const YN = { kind: "yes-no" } as const;
const choice = (options: FactOption[]) =>
  ({ kind: "choice", options }) as const;
const multi = (options: FactOption[]) =>
  ({ kind: "choice", options, multiple: true }) as const;
const DURATION = { kind: "duration" } as const;
const count = (max: number) => ({ kind: "count", min: 0, max }) as const;

const is = (fact: string, ...values: string[]): FactCondition => ({
  fact,
  in: values,
});
const any = (...conditions: FactCondition[]): FactCondition => ({
  any: conditions,
});
const all = (...conditions: FactCondition[]): FactCondition => ({
  all: conditions,
});

/** 7.5 の完了した違法手のサブタイプ（touch-move は含まない。ADR-014 §6） */
export const ILLEGAL_MOVE_75_SUBTYPES = [
  "illegal-move",
  "promotion-not-replaced",
  "clock-without-move",
  "two-hands",
] as const;

export const TOUCH_MOVE_SUBTYPE = "touch-move";

// ---------------------------------------------------------------------------
// 定義
// ---------------------------------------------------------------------------

export const FACT_DEFINITIONS: readonly FactDefinition[] = [
  // ---- 共通（§0）
  observed(
    "game.end-event",
    "対局を終わらせた出来事として、何が観察されましたか（握手だけでは終了として扱いません）",
    choice(
      opts(
        ["in-progress", "まだ対局中"],
        ["checkmate", "チェックメイト"],
        ["resignation", "投了の発言や動作"],
        ["stalemate", "ステイルメイト"],
        ["draw-agreement", "ドローの合意"],
        ["time-out", "時間切れの確定（アービターが確認、または有効な主張）"],
        ["other", "その他"]
      )
    ),
    [req("§12"), fide("5"), fide("6.8")]
  ),
  observed(
    "game.record-state",
    "結果の記入・署名の状態",
    choice(
      opts(
        ["none", "未記入"],
        ["written", "記入のみ"],
        ["one-signed", "片方が署名"],
        ["both-signed", "両者が署名"]
      )
    ),
    [req("§20", "結果記録・Sign漏れ")]
  ),
  localOnly(
    "game.history",
    "対局の手順（PGN／棋譜。途中から始まる場合は開始 FEN を含む。端末内で厳密に再生・検証し、最終局面を盤上と照合します。外部へは送りません）",
    "game-history",
    [req("§19"), design("ADR-014 §4")]
  ),
  localOnly(
    "game.position",
    "判定に使う局面（FEN。手番・キャスリング権・アンパッサンを含む）",
    "fen",
    [design("ADR-014 §5")]
  ),

  // ---- 違法手（7.5）（§1）
  observed(
    "im.action",
    "何が起きましたか",
    choice(
      opts(
        ["illegal-move", "違法な位置へ駒を動かした"],
        ["two-hands", "両手で指した"],
        ["promotion-not-replaced", "昇格の駒を置かずに時計を押した"],
        ["clock-without-move", "手を指さずに時計を押した"],
        ["touch-move", "触れた駒を動かさなかった等（触れた駒の規則）"]
      )
    ),
    [req("§16"), dt("subtype"), fide("7.5"), fide("4")]
  ),
  observed("im.player", "違法な動作をしたのはどちらですか", choice(COLORS), [
    dt("playerColor"),
  ]),
  observed("im.clock-pressed", "その後、その選手は時計を押しましたか", YN, [
    req("§12"),
    dt("clockPressed"),
  ]),
  observed("im.opponent-moved", "相手はその後、次の手を指しましたか", YN, [
    req("§17", "A.5"),
    dt("opponentMadeNextMove"),
  ]),
  observed(
    "im.noticed-by",
    "違法手を最初に指摘したのは誰ですか",
    choice(
      opts(
        ["arbiter", "アービター"],
        ["opponent-claim", "相手"],
        ["other", "その他"]
      )
    ),
    [req("§12"), dt("detectedBy")]
  ),
  derived(
    "im.count",
    "同じ選手のこの対局での、7.5 の違法手の回数",
    count(10),
    "incidentLog",
    [req("§16"), design("ADR-014 §6", "touch-move は数えない")]
  ),

  // ---- 触れた駒（Article 4）（§2）
  observed("tch.player", "駒に触れたのはどちらですか", choice(COLORS), [
    fide("4"),
  ]),
  observed(
    "tch.how",
    "どのように触れましたか",
    choice(
      opts(
        ["grasped", "指でつかんだ"],
        ["lifted", "持ち上げた"],
        ["pushed", "指で押した"],
        ["brushed", "袖や手が当たった"]
      )
    ),
    [fide("4.2"), fide("4.3")]
  ),
  observed(
    "tch.adjust-declared",
    "触れる前に「整えます（j'adoube）」等と言いましたか",
    YN,
    [fide("4.2.1")]
  ),
  observed("tch.on-move", "触れたのは、その選手の手番のときでしたか", YN, [
    fide("4.3"),
  ]),
  localOnly(
    "tch.touched",
    "触れた駒とマス（触れた順に。例：e2 の白ポーン → d1 の白クイーン）",
    "square-list",
    [fide("4.3.1"), fide("4.3.2"), fide("4.3.3"), fide("4.5")]
  ),
  observed(
    "tch.special",
    "特別な手の途中でしたか",
    choice(
      opts(
        ["castling-king-first", "キャスリング：キングを先に触れた"],
        ["castling-rook-first", "キャスリング：ルークを先に触れた"],
        ["promotion-placed", "昇格：駒を置いた"],
        ["promotion-not-placed", "昇格：まだ置いていない"],
        ["none", "該当なし"]
      )
    ),
    [fide("4.4")]
  ),
  observed(
    "tch.what-next",
    "触れた後に何をしましたか",
    choice(
      opts(
        ["moved-touched", "その駒を動かした"],
        ["moved-other", "別の駒を動かした"],
        ["not-moved", "まだ動かしていない"]
      )
    ),
    [fide("4.3"), fide("4.7")]
  ),
  observed("tch.released", "動かした駒を、マスの上で手から離しましたか", YN, [
    fide("4.7"),
  ]),
  observed(
    "tch.claimed-by-opponent",
    "相手からの申し立てで始まりましたか",
    YN,
    [fide("4.8")]
  ),
  observed(
    "tch.claim-timing",
    "相手が申し立てたのは、自分が動かす・取る意思で駒に触れる前でしたか",
    YN,
    [fide("4.8")]
  ),

  // ---- 時計・時間（§3）
  observed(
    "ct.event",
    "何が起きましたか",
    choice(
      opts(
        ["flag-fall", "時計の表示が0になった"],
        ["other", "その他の時計トラブル"]
      )
    ),
    [req("§18"), dt("clockTimeSubtype")]
  ),
  observed(
    "ct.zero-side",
    "表示が0になったのはどちらですか",
    choice([...COLORS, { value: "both", label: "両方" }]),
    [dt("flagFallen")]
  ),
  observed(
    "ct.zero-order",
    "両方の場合、先に0になったのはどちらか分かりますか",
    choice(opts(["white-first", "白が先"], ["black-first", "黒が先"])),
    [dt("bothFlagsOrder")]
  ),
  observed(
    "ct.ended-before-flag",
    "フラッグが確定する前に（アービターが気付く、または有効な主張がされる前に）、対局を終わらせる出来事がありましたか",
    choice(
      opts(
        ["none", "なし"],
        ["checkmate", "チェックメイト"],
        ["resignation", "投了"],
        ["draw-agreement", "ドローの合意"],
        ["stalemate", "ステイルメイト"],
        ["other", "その他"]
      )
    ),
    [fide("6.8"), fide("5.1.1"), dt("gameEndedBeforeFlag")]
  ),
  derived(
    "ct.last-period",
    "残りの全ての手を指し切る最終ピリオドですか",
    YN,
    "tournament.timeControl",
    // ピリオドが1つの持ち時間、または対局履歴（手数）がある場合だけ設定から求める。
    // それ以外は手数が分からないため質問する
    [
      dt("lastPeriod"),
      fide("6.9"),
      design("ADR-014 §7", "単一ピリオドまたは手数が分かる場合のみ導出"),
    ]
  ),
  derived(
    "ct.quickplay-guidelines",
    "大会規定でクイックプレイ・フィニッシュの指針（Guidelines III）が適用されますか",
    YN,
    "tournament.profile",
    [dt("quickplayGuidelinesApply")]
  ),
  observed(
    "ct.clock-observed",
    "時計で何が見えましたか",
    multi(
      opts(
        ["display-off", "表示が消えた"],
        ["time-changed", "時間が増えた／減った"],
        ["not-switching", "押しても切り替わらない"],
        ["wrong-setting", "設定と違う時間"],
        ["other", "その他"]
      )
    ),
    [req("§18")]
  ),
  observed(
    "ct.stopped-by",
    "時計を止めたのは誰ですか",
    choice([
      ...COLORS,
      { value: "arbiter", label: "アービター" },
      { value: "not-stopped", label: "止まっていない" },
    ]),
    [req("§18")]
  ),

  // ---- ドロー（§4）
  observed(
    "dr.kind",
    "何が起きましたか",
    choice(
      opts(
        ["threefold-repetition-claim", "3回同一局面のクレーム"],
        ["fifty-move-claim", "50手のクレーム"],
        ["fivefold-repetition", "5回同一局面"],
        ["75-move-rule", "75手"],
        ["agreement", "ドローの合意"],
        ["stalemate", "ステイルメイト"],
        ["dead-position", "これ以上メイトできない局面"],
        ["other", "その他"]
      )
    ),
    [req("§19"), dt("drawSubtype"), design("ADR-014 §1")]
  ),
  observed("dr.claimant", "クレームしたのはどちらですか", choice(COLORS), [
    req("§19"),
    dt("claimant"),
  ]),
  observed(
    "dr.claim-timing",
    "主張している局面はどれですか",
    choice(
      opts(
        ["just-appeared", "相手の直前の手で既に出現・成立した"],
        ["about-to-appear", "自分がこれから指す予定の手で出現・成立する"]
      )
    ),
    [
      req("§19"),
      fide("9.2.1"),
      fide("9.2.2"),
      fide("9.3.1"),
      fide("9.3.2"),
      dt("claimMode"),
    ]
  ),
  observed(
    "dr.last-mover",
    "クレームの直前に、盤上で最後に手を指したのはどちらですか",
    choice(COLORS),
    [
      req("§19", "そのPlayerの手番か"),
      design("ADR-014 §2", "手番は時計から求めない"),
    ]
  ),
  observed(
    "dr.clock-state",
    "クレームしたとき、時計はどうなっていましたか",
    choice(
      opts(
        ["white-running", "白の時計が動いていた"],
        ["black-running", "黒の時計が動いていた"],
        ["stopped", "止まっていた"]
      )
    ),
    [req("§19", "Clockを停止したか"), design("ADR-014 §2", "記録のみ")]
  ),
  observed(
    "dr.next-move-written",
    "予定の手を棋譜に書きましたか（盤上ではまだ指していない）",
    YN,
    [req("§19"), dt("moveWritten")]
  ),
  localOnly("dr.intended-move", "予定の手（棋譜の表記）", "san", [
    dt("intendedMove"),
  ]),
  observed(
    "dr.piece-touched",
    "クレームの前に、その手番で、動かす・取る意思で盤上の駒に触れましたか（駒を整える目的・偶然を除く）",
    YN,
    [fide("9.4"), dt("touchedPiece")]
  ),
  observed(
    "dr.manual-reconstruction",
    "盤上で手順を再現した結果",
    choice(
      opts(
        ["met", "条件を満たした"],
        ["not-met", "条件を満たさなかった"],
        ["not-reconstructable", "再現できなかった"]
      )
    ),
    [req("§19"), design("ADR-014 §4")]
  ),
  observed(
    "dr.agreement-observed",
    "合意について観察された発言・動作",
    multi(
      opts(
        ["offer", "ドローの申し出"],
        ["acceptance", "承諾の発言"],
        ["handshake", "握手"],
        ["result-written", "結果の記入"]
      )
    ),
    [req("§19", "Draw offer / Agreement")]
  ),

  // ---- 対局結果（§5）
  observed(
    "gr.issue",
    "何が起きましたか",
    choice(
      opts(
        ["mismatch", "記入された結果が食い違う"],
        ["unsigned", "署名がない"],
        ["resignation-dispute", "投了をめぐる争い"],
        ["other", "その他"]
      )
    ),
    [design("IC§7"), req("§20")]
  ),
  observed(
    "gr.recorded-result",
    "結果用紙・棋譜に実際に記録されている結果",
    multi(
      opts(
        ["white-win", "白勝ち"],
        ["black-win", "黒勝ち"],
        ["draw", "ドロー"],
        ["blank", "未記入"]
      )
    ),
    [req("§20", "結果記録")]
  ),
  observed(
    "gr.claimed-white",
    "白が主張している結果",
    choice(
      opts(["white-win", "白勝ち"], ["black-win", "黒勝ち"], ["draw", "ドロー"])
    ),
    [design("IC§7", "result-dispute")]
  ),
  observed(
    "gr.claimed-black",
    "黒が主張している結果",
    choice(
      opts(["white-win", "白勝ち"], ["black-win", "黒勝ち"], ["draw", "ドロー"])
    ),
    [design("IC§7", "result-dispute")]
  ),
  observed(
    "gr.signatures",
    "結果用紙・棋譜の署名",
    multi(
      opts(["white", "白あり"], ["black", "黒あり"], ["none", "どちらもなし"])
    ),
    [req("§20", "Sign漏れ")]
  ),
  observed(
    "gr.resign-observed",
    "投了に関して観察された発言・動作",
    multi(
      opts(
        ["said-resign", "「投了します」等の発言"],
        ["king-tipped", "キングを倒した"],
        ["clock-stopped", "時計を止めた"],
        ["signed", "結果用紙に署名した"],
        ["none", "どれもない"]
      )
    ),
    [design("IC§7", "resignation")]
  ),

  // ---- 棋譜（§6）
  observed(
    "ss.issue",
    "何が起きましたか",
    choice(
      opts(
        ["not-writing", "記入していない"],
        ["behind", "遅れている"],
        ["pre-written", "指す前に書いた"],
        ["illegible", "読めない"],
        ["wrong", "誤記"]
      )
    ),
    [req("§20")]
  ),
  observed("ss.moves-behind", "何手遅れていますか", count(200), [req("§20")]),
  observed(
    "ss.remaining-time",
    "記入していない側の時計の、今の残り時間",
    DURATION,
    [fide("8.4")]
  ),
  observed(
    "ss.below-five-in-period",
    "このピリオドの中で、残り時間が一度でも5分を下回ったことがありましたか",
    YN,
    [fide("8.4", "ピリオドの残りは免除が続く")]
  ),
  derived(
    "ss.increment",
    "現在のピリオドの1手ごとの加算（秒）",
    count(600),
    "tournament.timeControl",
    [fide("8.4")]
  ),
  derived(
    "ss.current-period",
    "現在のピリオド",
    count(10),
    "tournament.timeControl",
    [fide("8.4")]
  ),
  observed("ss.move-number", "現在の手数（何手目か）", count(500), [
    fide("8.4"),
  ]),

  // ---- 選手の行動・電子機器（§7）
  observed(
    "pb.behavior",
    "何が観察されましたか",
    multi(
      opts(
        ["device", "電子機器"],
        ["bag", "バッグに触れた・開けた"],
        ["talking", "会話"],
        ["left-seat", "離席"],
        ["left-area", "対局エリアからの退出"],
        ["noise", "騒音"],
        ["disturbing", "相手への妨害"],
        ["smoking", "喫煙"],
        ["spectator", "観客の干渉"],
        ["other", "その他"]
      )
    ),
    [req("§21"), fide("11.3.2.2")]
  ),
  observed(
    "pb.actor",
    "当事者は誰ですか",
    choice([
      ...COLORS,
      { value: "spectator", label: "観客" },
      { value: "other", label: "その他" },
    ]),
    [req("§21")]
  ),
  observed(
    "pb.disputed",
    "当事者のあいだで事実関係に食い違いがありますか",
    YN,
    [req("§14", "複数解釈・CAへの上申")]
  ),
  observed(
    "pb.observed-by",
    "誰が観察しましたか",
    choice(
      opts(
        ["arbiter", "アービター自身"],
        ["player-report", "選手からの申告"],
        ["other-report", "観客等からの申告"]
      )
    ),
    [req("§21"), req("§14")]
  ),
  observed(
    "pb.device-type",
    "機器の種類",
    choice(
      opts(
        ["smartphone", "スマートフォン"],
        ["smartwatch", "スマートウォッチ"],
        ["earphones", "イヤホン"],
        ["other", "その他"]
      )
    ),
    [req("§21")]
  ),
  observed(
    "pb.device-where",
    "機器はどこにありましたか",
    choice(
      opts(
        ["on-person", "身につけていた"],
        ["in-bag", "バッグの中"],
        ["designated-place", "指定の保管場所"],
        ["other", "その他"]
      )
    ),
    [req("§21")]
  ),
  observed(
    "pb.device-observed",
    "機器について何が観察されましたか",
    multi(
      opts(
        ["rang", "音が鳴った"],
        ["screen-on", "画面が点いた"],
        ["operated", "操作していた"],
        ["powered-off", "電源が切れていた"]
      )
    ),
    [req("§21")]
  ),
  observed(
    "pb.bag-access",
    "対局中に、その選手がバッグに触れた・開けた・中の物を取り出したことがありましたか",
    YN,
    [req("§21"), fide("11.3.2.2")]
  ),
  observed(
    "pb.bag-access-permission",
    "そのとき、アービターの許可を得ていましたか",
    YN,
    [req("§21"), fide("11.3.2.2")]
  ),
  observed(
    "pb.went-where",
    "どこへ行きましたか",
    choice(
      opts(["seat", "席を離れた"], ["out-of-area", "対局エリアの外に出た"])
    ),
    [req("§21")]
  ),
  derived(
    "pb.tournament-device-rule",
    "電子機器に関する大会規定",
    YN,
    "tournament.profile",
    [req("§21", "大会規定を優先")]
  ),

  // ---- 団体戦（§8）
  observed(
    "tm.issue",
    "何が起きましたか",
    choice(
      opts(
        ["board-order", "ボード順の違い"],
        ["captain-talk", "キャプテンとの会話"],
        ["advice", "助言"],
        ["result-check", "結果の確認"],
        ["other", "その他"]
      )
    ),
    [req("§22")]
  ),
  observed(
    "tm.who",
    "話した・助言した相手は誰ですか",
    choice(
      opts(
        ["captain", "キャプテン"],
        ["member", "チームメンバー"],
        ["other", "その他"]
      )
    ),
    [req("§22")]
  ),
  observed(
    "tm.timing",
    "いつのことですか",
    choice(
      opts(["during", "対局中"], ["before", "対局前"], ["after", "対局後"])
    ),
    [req("§22")]
  ),
  observed(
    "tm.content",
    "何について話していましたか",
    choice(
      opts(
        ["position", "局面"],
        ["draw-offer", "ドローの申し出"],
        ["result", "結果"],
        ["other", "その他"],
        ["not-heard", "聞こえなかった"]
      )
    ),
    [req("§22", "Captainからの助言")]
  ),

  // ---- 盤・駒（§9）
  observed(
    "bp.issue",
    "何が起きましたか",
    choice(
      opts(
        ["displaced", "駒がずれた"],
        ["fell", "駒が落ちた"],
        ["wrong-initial", "初期配置が違う"],
        ["colours-reversed", "白黒を逆にして対局している"],
        ["missing-piece", "駒が足りない"],
        ["board-orientation", "盤の向きが違う"],
        ["no-promotion-piece", "昇格の駒がない"]
      )
    ),
    [design("IC§5"), fide("7.2"), fide("7.3")]
  ),
  observed(
    "bp.when",
    "いつ気づきましたか",
    choice(
      opts(["before", "開始前"], ["during", "対局中"], ["after", "終了後"])
    ),
    [design("IC§5")]
  ),
  observed(
    "bp.moves-played",
    "気づいた時点で、両者が指し終えた手数（黒の手数）",
    count(500),
    [fide("7.3", "10手の基準はコードで比べる")]
  ),
  observed(
    "bp.how",
    "駒が動いたとき何が見えましたか",
    choice(
      opts(
        ["hand-or-sleeve", "手・袖が当たった"],
        ["while-moving", "指している途中だった"],
        ["not-seen", "見ていない"]
      )
    ),
    [design("IC§5")]
  ),
  observed(
    "bp.record",
    "正しい局面を確かめられる棋譜はありますか",
    choice(
      opts(["both", "両者の棋譜あり"], ["one", "片方のみ"], ["none", "なし"])
    ),
    [design("IC§5"), fide("7.2.1", "初期配置の誤りは対象外")]
  ),

  // ---- 大会運営（§10）
  observed(
    "ta.issue",
    "何が起きましたか",
    choice(
      opts(
        ["late", "遅刻"],
        ["pairing", "ペアリングの誤り"],
        ["venue", "会場"],
        ["equipment", "用具の不足"],
        ["other", "その他"]
      )
    ),
    [req("§9"), design("IC§13")]
  ),
  observed("ta.late-elapsed", "対局開始から到着までの経過時間", DURATION, [
    design("IC§13", "default time と比べるのはコード"),
  ]),
  observed(
    "ta.discovered",
    "いつ発覚しましたか",
    choice(
      opts(["before", "対局前"], ["during", "対局中"], ["after", "終了後"])
    ),
    [design("IC§13")]
  ),
];

// ---------------------------------------------------------------------------
// 使い方（カテゴリ・サブタイプごとの区分と適用条件）
// ---------------------------------------------------------------------------

const IM = {
  category: "illegal-move",
  subtypes: ILLEGAL_MOVE_75_SUBTYPES,
} as const;
const TCH = {
  category: "illegal-move",
  subtypes: [TOUCH_MOVE_SUBTYPE],
} as const;

const DRAW_CLAIM = is(
  "dr.kind",
  "threefold-repetition-claim",
  "fifty-move-claim"
);
const DRAW_POSITIONS = is(
  "dr.kind",
  "threefold-repetition-claim",
  "fifty-move-claim",
  "fivefold-repetition",
  "75-move-rule"
);

/** はい/いいえの DT 質問へ変換（指定した値が false、他は true） */
const toBoolean = (
  falseValue: string,
  trueValues: readonly string[]
): Readonly<Record<string, string>> =>
  Object.fromEntries([
    [falseValue, "false"],
    ...trueValues.map((v) => [v, "true"]),
  ]);

export const FACT_USAGES: readonly FactUsage[] = [
  // ---- 違法手（7.5）: DT-001/002/003
  {
    factId: "im.action",
    category: "illegal-move",
    level: "blocking",
    dtQuestionIds: ["subtype"],
    // touch-move は DT-001〜003 ではなく DT-007 へ振り分ける（ADR-014 §6）
    dtUnhandled: [TOUCH_MOVE_SUBTYPE],
  },
  {
    factId: "im.player",
    ...IM,
    level: "blocking",
    dtQuestionIds: ["playerColor"],
  },
  {
    factId: "im.clock-pressed",
    ...IM,
    level: "blocking",
    dtQuestionIds: ["clockPressed"],
  },
  {
    factId: "game.end-event",
    ...IM,
    level: "blocking",
    dtQuestionIds: ["gameEnded"],
    // 「まだ対局中」以外は終了（握手は選択肢にない）
    dtValues: toBoolean("in-progress", [
      "checkmate",
      "resignation",
      "stalemate",
      "draw-agreement",
      "time-out",
      "other",
    ]),
  },
  // DT は使わないが記録に残す fact（DT の判断には影響しない。fact-model §3.1）
  {
    factId: "game.record-state",
    ...IM,
    level: "conditional",
    appliesWhen: is(
      "game.end-event",
      "checkmate",
      "resignation",
      "stalemate",
      "draw-agreement",
      "time-out",
      "other"
    ),
  },
  {
    factId: "im.opponent-moved",
    ...IM,
    level: "conditional",
    appliesWhen: { context: "competitionType", in: ["rapid", "blitz"] },
    dtQuestionIds: ["opponentMadeNextMove"],
  },
  {
    factId: "im.noticed-by",
    ...IM,
    level: "conditional",
    dtQuestionIds: ["detectedBy"],
  },
  // 7.5.5: 違法手の直前に戻した局面でメイト可能性を判定する（ADR-014 §5、J1b-4）。
  // 局面は FEN で入力する（入力方法 matePosition と FEN reinstatedFen）。メイト可能性はコードが判定する。
  // 対局履歴から局面を求めるのは後続（対局履歴の入力 UI ができてから）
  { factId: "game.history", ...IM, level: "conditional" },
  {
    factId: "game.position",
    ...IM,
    level: "conditional",
    dtQuestionIds: ["matePosition", "reinstatedFen"],
    dtValues: "computed",
  },
  // 記録から求めるだけで質問しない
  { factId: "im.count", ...IM, level: "optional" },

  // ---- 触れた駒: DT-007
  { factId: "tch.player", ...TCH, level: "blocking" },
  { factId: "tch.how", ...TCH, level: "blocking" },
  { factId: "tch.adjust-declared", ...TCH, level: "blocking" },
  { factId: "tch.on-move", ...TCH, level: "blocking" },
  { factId: "tch.touched", ...TCH, level: "blocking" },
  { factId: "tch.what-next", ...TCH, level: "blocking" },
  // 条件が構造化データ（tch.touched）にあるため、DT-007 が requestedFactIds で要求する
  { factId: "tch.special", ...TCH, level: "conditional" },
  {
    factId: "tch.released",
    ...TCH,
    level: "conditional",
    appliesWhen: is("tch.what-next", "moved-touched"),
  },
  { factId: "tch.claimed-by-opponent", ...TCH, level: "optional" },
  {
    factId: "tch.claim-timing",
    ...TCH,
    level: "conditional",
    appliesWhen: is("tch.claimed-by-opponent", "true"),
  },
  {
    factId: "game.position",
    ...TCH,
    level: "conditional",
    appliesWhen: is("tch.what-next", "moved-other", "not-moved"),
  },

  // ---- 時計: DT-004
  {
    factId: "ct.event",
    category: "clock-time",
    level: "blocking",
    dtQuestionIds: ["clockTimeSubtype"],
  },
  {
    factId: "ct.zero-side",
    category: "clock-time",
    level: "conditional",
    appliesWhen: is("ct.event", "flag-fall"),
    dtQuestionIds: ["flagFallen"],
  },
  {
    factId: "ct.zero-order",
    category: "clock-time",
    level: "conditional",
    appliesWhen: is("ct.zero-side", "both"),
    dtQuestionIds: ["bothFlagsOrder"],
  },
  {
    factId: "ct.ended-before-flag",
    category: "clock-time",
    level: "conditional",
    appliesWhen: is("ct.event", "flag-fall"),
    dtQuestionIds: ["gameEndedBeforeFlag"],
    dtValues: toBoolean("none", [
      "checkmate",
      "resignation",
      "draw-agreement",
      "stalemate",
      "other",
    ]),
  },
  // フラッグ確定時の局面でメイト可能性を判定する（ADR-014 §5、J1b-4）。
  // 局面は FEN で入力する（駒数の入力は廃止）。メイト可能性はコードが判定する
  { factId: "game.history", category: "clock-time", level: "conditional" },
  {
    factId: "game.position",
    category: "clock-time",
    level: "conditional",
    dtQuestionIds: ["matePosition", "positionFen"],
    dtValues: "computed",
  },
  // 設定から求められない場合のみ質問する
  {
    factId: "ct.last-period",
    category: "clock-time",
    level: "conditional",
    dtQuestionIds: ["lastPeriod"],
  },
  {
    factId: "ct.quickplay-guidelines",
    category: "clock-time",
    level: "conditional",
    dtQuestionIds: ["quickplayGuidelinesApply"],
  },
  {
    factId: "ct.clock-observed",
    category: "clock-time",
    level: "conditional",
    appliesWhen: is("ct.event", "other"),
  },
  {
    factId: "ct.stopped-by",
    category: "clock-time",
    level: "optional",
    appliesWhen: is("ct.event", "other"),
  },

  // ---- ドロー: DT-005（クレーム）/ DT-006（自動）/ fact plan
  {
    factId: "dr.kind",
    category: "draw",
    level: "blocking",
    dtQuestionIds: ["drawSubtype"],
    // DT-005/006 の再構成（J1b-5）までは、新しい種類を既存の "other" に変換する
    dtValues: {
      "threefold-repetition-claim": "threefold-repetition-claim",
      "fifty-move-claim": "other",
      "fivefold-repetition": "fivefold-repetition",
      "75-move-rule": "75-move-rule",
      agreement: "other",
      stalemate: "other",
      "dead-position": "other",
      other: "other",
    },
  },
  {
    factId: "dr.claimant",
    category: "draw",
    level: "conditional",
    appliesWhen: DRAW_CLAIM,
    dtQuestionIds: ["claimant"],
  },
  {
    factId: "dr.claim-timing",
    category: "draw",
    level: "conditional",
    appliesWhen: DRAW_CLAIM,
    dtQuestionIds: ["claimMode"],
  },
  {
    factId: "dr.last-mover",
    category: "draw",
    level: "conditional",
    appliesWhen: DRAW_CLAIM,
    dtQuestionIds: ["claimantHasMove"],
    // 申立人と最後に指した側から手番を求める（時計からは求めない。ADR-014 §2）
    dtValues: "computed",
  },
  {
    factId: "dr.clock-state",
    category: "draw",
    level: "optional",
    appliesWhen: DRAW_CLAIM,
  },
  {
    factId: "dr.next-move-written",
    category: "draw",
    level: "conditional",
    appliesWhen: all(DRAW_CLAIM, is("dr.claim-timing", "about-to-appear")),
    dtQuestionIds: ["moveWritten"],
  },
  {
    factId: "dr.intended-move",
    category: "draw",
    level: "conditional",
    appliesWhen: is("dr.next-move-written", "true"),
    dtQuestionIds: ["intendedMove"],
  },
  {
    factId: "dr.piece-touched",
    category: "draw",
    level: "conditional",
    appliesWhen: DRAW_CLAIM,
    dtQuestionIds: ["touchedPiece"],
  },
  {
    factId: "game.history",
    category: "draw",
    level: "conditional",
    appliesWhen: DRAW_POSITIONS,
    // 棋譜の入力と、再生した最終局面の盤上との照合（ADR-014 §4）
    dtQuestionIds: ["positionsText", "historyConfirmed"],
    dtValues: "computed",
  },
  {
    factId: "dr.manual-reconstruction",
    category: "draw",
    level: "conditional",
    appliesWhen: DRAW_POSITIONS,
    dtQuestionIds: ["repetitionCheck", "fivefoldCheck", "seventyFiveCheck"],
    dtValues: {
      met: "met",
      "not-met": "not-met",
      "not-reconstructable": "unknown",
    },
  },
  {
    factId: "dr.agreement-observed",
    category: "draw",
    level: "conditional",
    appliesWhen: is("dr.kind", "agreement"),
  },

  // ---- 対局結果: fact plan
  { factId: "gr.issue", category: "game-result", level: "blocking" },
  {
    factId: "gr.recorded-result",
    category: "game-result",
    level: "conditional",
    appliesWhen: is("gr.issue", "mismatch", "unsigned", "resignation-dispute"),
  },
  {
    factId: "gr.claimed-white",
    category: "game-result",
    level: "conditional",
    appliesWhen: is("gr.issue", "mismatch", "resignation-dispute"),
  },
  {
    factId: "gr.claimed-black",
    category: "game-result",
    level: "conditional",
    appliesWhen: is("gr.issue", "mismatch", "resignation-dispute"),
  },
  {
    factId: "gr.signatures",
    category: "game-result",
    level: "conditional",
    appliesWhen: is("gr.issue", "mismatch", "unsigned", "resignation-dispute"),
  },
  {
    factId: "gr.resign-observed",
    category: "game-result",
    level: "conditional",
    appliesWhen: is("gr.issue", "resignation-dispute"),
  },
  {
    factId: "game.end-event",
    category: "game-result",
    level: "conditional",
    appliesWhen: is("gr.issue", "mismatch", "resignation-dispute"),
  },

  // ---- 棋譜: fact plan
  { factId: "ss.issue", category: "scoresheet", level: "blocking" },
  {
    factId: "ss.moves-behind",
    category: "scoresheet",
    level: "conditional",
    appliesWhen: is("ss.issue", "behind"),
  },
  {
    factId: "ss.remaining-time",
    category: "scoresheet",
    level: "conditional",
    // 8.1.1 の記録義務がある対局（Standard）のみ
    appliesWhen: all(is("ss.issue", "not-writing", "behind"), {
      context: "competitionType",
      in: ["standard"],
    }),
  },
  {
    // 今の残り時間が5分以上で、加算が30秒未満のとき（FIDE 8.4: ピリオド中に一度でも5分未満なら免除が続く）
    factId: "ss.below-five-in-period",
    category: "scoresheet",
    level: "conditional",
    appliesWhen: all(
      is("ss.issue", "not-writing", "behind"),
      { context: "competitionType", in: ["standard"] },
      { fact: "ss.remaining-time", range: { gte: 300 } },
      { fact: "ss.increment", range: { lt: 30 } }
    ),
  },
  {
    // 設定から求められない場合のみ質問する
    factId: "ss.increment",
    category: "scoresheet",
    level: "conditional",
    appliesWhen: all(is("ss.issue", "not-writing", "behind"), {
      context: "competitionType",
      in: ["standard"],
    }),
  },
  // 設定と手数から求めるだけで質問しない（求められない場合は ss.move-number を尋ねる）
  { factId: "ss.current-period", category: "scoresheet", level: "optional" },
  {
    factId: "ss.move-number",
    category: "scoresheet",
    level: "conditional",
    appliesWhen: all(
      is("ss.issue", "not-writing", "behind"),
      { context: "competitionType", in: ["standard"] },
      { notDerived: "ss.current-period" }
    ),
  },

  // ---- 選手の行動: fact plan
  { factId: "pb.behavior", category: "player-behavior", level: "blocking" },
  { factId: "pb.actor", category: "player-behavior", level: "blocking" },
  { factId: "pb.disputed", category: "player-behavior", level: "blocking" },
  {
    factId: "pb.observed-by",
    category: "player-behavior",
    level: "conditional",
    appliesWhen: any(
      { incident: "arbiterObserved", is: false },
      is("pb.disputed", "true")
    ),
  },
  {
    factId: "pb.device-type",
    category: "player-behavior",
    level: "conditional",
    appliesWhen: is("pb.behavior", "device"),
  },
  {
    factId: "pb.device-where",
    category: "player-behavior",
    level: "conditional",
    appliesWhen: is("pb.behavior", "device"),
  },
  {
    factId: "pb.device-observed",
    category: "player-behavior",
    level: "conditional",
    appliesWhen: is("pb.behavior", "device"),
  },
  {
    // 機器の場所に関係なく尋ねる（FIDE 11.3.2.2）
    factId: "pb.bag-access",
    category: "player-behavior",
    level: "conditional",
    appliesWhen: is("pb.behavior", "device", "bag"),
  },
  {
    factId: "pb.bag-access-permission",
    category: "player-behavior",
    level: "conditional",
    appliesWhen: is("pb.bag-access", "true"),
  },
  {
    factId: "pb.went-where",
    category: "player-behavior",
    level: "conditional",
    appliesWhen: is("pb.behavior", "left-seat", "left-area"),
  },
  // 大会規定から求めるだけで質問しない
  {
    factId: "pb.tournament-device-rule",
    category: "player-behavior",
    level: "optional",
  },

  // ---- 団体戦: fact plan
  { factId: "tm.issue", category: "team", level: "blocking" },
  {
    factId: "tm.who",
    category: "team",
    level: "conditional",
    appliesWhen: is("tm.issue", "captain-talk", "advice"),
  },
  {
    factId: "tm.timing",
    category: "team",
    level: "conditional",
    appliesWhen: is("tm.issue", "captain-talk", "advice"),
  },
  {
    factId: "tm.content",
    category: "team",
    level: "conditional",
    appliesWhen: is("tm.issue", "captain-talk", "advice"),
  },

  // ---- 盤・駒: fact plan
  { factId: "bp.issue", category: "board-piece", level: "blocking" },
  { factId: "bp.when", category: "board-piece", level: "blocking" },
  {
    factId: "bp.moves-played",
    category: "board-piece",
    level: "conditional",
    appliesWhen: is("bp.issue", "colours-reversed"),
  },
  {
    factId: "bp.how",
    category: "board-piece",
    level: "conditional",
    appliesWhen: is("bp.issue", "displaced", "fell"),
  },
  {
    // 初期配置の誤り（7.2.1）は対象外
    factId: "bp.record",
    category: "board-piece",
    level: "conditional",
    appliesWhen: is("bp.issue", "displaced", "fell"),
  },

  // ---- 大会運営: fact plan
  { factId: "ta.issue", category: "tournament-admin", level: "blocking" },
  {
    factId: "ta.late-elapsed",
    category: "tournament-admin",
    level: "conditional",
    appliesWhen: is("ta.issue", "late"),
  },
  {
    factId: "ta.discovered",
    category: "tournament-admin",
    level: "conditional",
    appliesWhen: is("ta.issue", "pairing"),
  },
];

const DEFINITION_BY_ID = new Map(FACT_DEFINITIONS.map((d) => [d.id, d]));

export function getFactDefinition(id: string): FactDefinition | undefined {
  return DEFINITION_BY_ID.get(id);
}
