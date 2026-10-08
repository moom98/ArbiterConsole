/**
 * 既知の語彙による判定（Sensitive Gate L3v。ADR-012 の改訂、ユーザー決定 2026-10-08）。
 *
 * 機微な語のリスト（L2・L3）だけでは見逃しを 0 にできない（言い換えのたびに漏れる）。
 * そのため、置き換え後の本文の**すべての内容語**が、チェス・事故の既知の語彙で説明できる
 * 場合だけ clear とし、それ以外は uncertain（端末内で処理）にする。
 *
 * - 本文を文字の種類（漢字・カタカナ・ひらがな・英字）の連続に分け、それぞれを語彙で
 *   残らず分割できるかを確かめる（動的計画法）
 * - ひらがなは助詞・活用語尾など文法の語だけ。1文字の語尾は漢字・カタカナの直後だけ許す
 *   （例: 「いたい」「たたかれた」「けいさつ」を語尾の組み合わせで説明させないため）
 * - プレースホルダー・数字・記号・SAN の指し手・L3 の安全な文脈に覆われた部分は既知
 *
 * 語彙に機微な語を入れてはならない。組み合わせで機微になる語にも注意する:
 * 「切」（手を切った）・「出」（手を出した）・「引」（置き引き）・「外」（外来）・「合」
 * （押し合った）・「揉」（揉み合った）・「目」（目を回した）・「起」（起きない）・「弱」（弱っていた）・
 * 「消」（白が消えた）は単漢字で入れない（J1a-1 の監査）。送り仮名の「え」「け」「い」は
 * 許さない（目が見えない・動けない・手いたい）。語彙を増やす変更はレビューと評価ケースを伴うこと。
 */
import type { Span } from "./normalize";

/** 漢字の語（単漢字は、組み合わせても機微にならないものだけ） */
const KANJI_WORDS = `
違法手 違法 反則 違反 着手 指し手 手番 手数 一手 次手 両手 片手 先手 後手 手 次 白 黒 白番 黒番 両者 両方 片方 双方 相手 対戦 対戦相手 選手 対局 対局者
当該 本人 自分 他 別 各 全 同 同一 両 時計 時間 時間切 持 残 秒 分 加算 増加 遅延 秒読 表示 設定 故障 電池 交換 予備 停止 作動 押 押下 再開 開始
終了 中断 局面 盤 盤上 駒 王 王手 配置 初期配置 位置 向 置 触 取 戻 動 指 並 直 整 落 拾 移 進 換 置換 昇格 成 交差 枡 升 列 段 筋 斜 投了 合意
提案 申 申告 主張 指摘 確認 記録 記入 記載 棋譜 署名 結果 用紙 結果用紙 記録用紙 書 記 読 見 聞 言 話 答 告 伝 呼 求 認 断 拒否 承認 同意 了承 勝
負 敗 勝者 敗者 分 引分 千日手 得点 点 順位 組 組合 試合 大会 規則 規定 規約 条 項 条文 適用 対象 該当 不明 何 誰 際 再 再度 理由 内容 方法 問題
注意 指示 説明 要求 要請 警告 罰 罰則 減点 減 加 追加 延長 短縮 裁定 判定 判断 審判 裁 決定 決 選 数 計 確 変 違 間違 勘違 誤 正 正式 有効 無効
成立 不成立 完了 未 完 済 不足 超 以上 以下 未満 以内 前 後 中 直前 直後 途中 時 場合 状況 状態 最終 最初 最後 初 回 度 番 号 局 戦 団体戦 個人戦
主将 監督 席 隣 遅刻 欠席 棄権 不戦 不戦勝 不戦敗 到着 退場 入場 会場 開始前 待 続 止 始 終 替 忘 時間切 切替 遅 早 長 短 多 少 強 大 小 新 古
気付 発見 発生 入 来 行 帰 渡 返 使 通 付 押し忘 鳴 音 声 大声 騒音 静 静粛 一 二 三 四 五 六 七 八 九 十 百 千 〇 半 毎 約 各自 全員 以外
最大 最小 同様 同時 先 今 現在 今回 前回 次回 再び 一度 二度 三度 規 定 逆 受 借 繰 集中 観戦 観戦者 順 登録 助言 提出 出場 連絡 左 右 雑音 末
可能性 可能 一致 不一致 間 用意 準備 交代 移動 記号 表記 範囲 回目 局目 手目 番目 度目 日目 目視
`;

/** カタカナの語 */
const KATAKANA_WORDS = `
キング クイーン ルーク ビショップ ナイト ポーン チェック チェックメイト メイト ステイルメイト ステールメイト ドロー クレーム フラッグ フラグ タッチ ムーブ タッチムーブ キャスリング キャッスリング アンパッサン アンパサン プロモーション イリーガル イリーガルムーブ スコアシート スコア シート ペアリング ラウンド ボード テーブル アービター チーフ チーフアービター ディスプレイス ペナルティ ペナルティー ルール クロック デジタル アナログ ボタン ディスプレイ リセット セット モード ゼロ アウト タイム タイムアウト ミス プレーヤー プレイヤー ゲーム マス ファイル ランク キャプテン チーム クイックプレイ フィニッシュ ガイドライン メンバー バイ スタンダード ラピッド ブリッツ ボーナス インクリメント ディレイ カウント オファー アジャスト ジャドゥーブ ピース
`;

/** 英字の語（小文字で照合。SAN の指し手は別に扱う） */
const LATIN_WORDS = `
fide jcf ca da ia fa pgn fen san rapid blitz standard claim claimed draw flag flagged illegal move moves touch check mate checkmate stalemate white black clock time increment delay sec min vs no ok castling castle promotion queen rook bishop knight pawn king arbiter
`;

/** ひらがなの文法の語（助詞・活用語尾・補助動詞など）。内容語は入れない */
const HIRAGANA_GRAMMAR = `
が を に で と の は も へ や か ね よ
から まで より ので のに ばかり けど けれど ため ほど だけ しか など って とか なら ても でも には では とは への での からの までの について により によって として に対して ずつ
した して する します しました しません しない しなかった しよう され された される させ させた せず せずに さず さずに ずに ず
ない なかった なく なくて ません ませんでした ます ました です でした だった である であった
ている ていた ています ていました ていない ていなかった てしまった てしまい てから てくれ てもらった ておく ておいた てきた てほしい
いる いた います いました いない いなかった いて
ある あった あり あります ありました
なる なった なり なって なりました
れる れた れて られる られた られて
った って っている っていた
かった くない くなった くて
そう よう こと もの とき あと まえ まま ところ
この その あの どの これ それ あれ どれ ここ そこ どこ
すぐ まだ もう また さらに すでに ちょうど ほぼ
いう いった いって
よい いい よく
かどうか どうか はい いいえ
さん くん
やめ やめた やめて できる できない できた できず できなかった うるさい おかしい おかしく ふたたび
しかけ しかけた しかけて
たい たかった
`;

/**
 * 漢字とかなが混じる語（送り仮名の1文字を一般に許すと機微な語ができるため、語として列挙する。
 * 例: 「負け」は語として許し、「けが」は許さない）
 */
const MIXED_WORDS = [
  "負け",
  "勝ち",
  "引き分け",
  "置き換え",
  "置き間違い",
  "書き間違い",
  "間違い",
  "勘違い",
  "食い違い",
  "食い違",
  "押さえ",
  "申し出",
  "申し立て",
  "時間切れ",
  "電池が切れ",
  "電源が切れ",
  "時間が切れ",
  "整え",
  "表示が消え",
  "画面が消え",
  "悪い",
  "悪く",
  "追いつ",
  "足り",
  "扱い",
  "聞こえ",
  "疑い",
  "受け",
  "同じ",
];
const MIXED = new RegExp(MIXED_WORDS.join("|"), "g");

/** 1文字の送り仮名の直後にだけ置ける語尾（止めた・落ちた） */
const AFTER_OKURIGANA = new Set(["た", "て", "だ", "で"]);

/** 漢字・カタカナの直後にだけ置ける1文字の送り仮名 */
const OKURIGANA_SINGLES = new Set(
  Array.from(
    "くするれうつぬむぶぐきしちにみびぎりせてねめべげかさたなまばがらわっんろこそともよお"
  )
);

function words(list: string): Set<string> {
  return new Set(list.split(/\s+/).filter((w) => w !== ""));
}

const KANJI = words(KANJI_WORDS);
const KATAKANA = words(KATAKANA_WORDS);
const LATIN = words(LATIN_WORDS);
const GRAMMAR = words(HIRAGANA_GRAMMAR);
const maxLen = (s: Set<string>) =>
  Array.from(s).reduce((m, w) => Math.max(m, w.length), 0);
const KANJI_MAX = maxLen(KANJI);
const KATAKANA_MAX = maxLen(KATAKANA);
const GRAMMAR_MAX = maxLen(GRAMMAR);

type Script = "kanji" | "katakana" | "hiragana" | "latin" | "other";

function scriptOf(ch: string): Script {
  if (/[㐀-䶿一-鿿豈-﫿々〆]/.test(ch)) return "kanji";
  if (/[ァ-ヺ]/.test(ch)) return "katakana";
  if (/[ぁ-ゖゝゞ]/.test(ch)) return "hiragana";
  if (/[A-Za-z]/.test(ch)) return "latin";
  return "other";
}

/** 語彙で残らず分割できるか */
function segmentable(
  run: string,
  vocab: Set<string>,
  max: number,
  allowSingleAtStart?: Set<string>
): boolean {
  const ok: boolean[] = new Array(run.length + 1).fill(false);
  ok[0] = true;
  for (let i = 0; i < run.length; i++) {
    if (!ok[i]) continue;
    if (i === 0 && allowSingleAtStart?.has(run[0])) ok[1] = true;
    if (
      i === 1 &&
      allowSingleAtStart?.has(run[0]) &&
      AFTER_OKURIGANA.has(run[1])
    )
      ok[2] = true;
    for (let len = 1; len <= max && i + len <= run.length; len++)
      if (vocab.has(run.slice(i, i + len))) ok[i + len] = true;
  }
  return ok[run.length];
}

/** SAN の指し手・キャスリング（英字の連続より先に既知にする） */
const SAN =
  /(?<![A-Za-z0-9])(?:O-O(?:-O)?|0-0(?:-0)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=?[QRBN])?|[a-h][1-8](?:=?[QRBN])?)[+#]?(?![A-Za-z0-9])/g;

export interface VocabularyResult {
  /** 既知の語彙で説明できない内容語の数 */
  unknownRuns: number;
}

/**
 * 本文（NFKC 済み）のうち、既知の語彙で説明できない文字の連続を数える。
 * known は、すでに既知とみなす範囲（L3 の安全な文脈など）。
 */
export function unknownVocabulary(
  text: string,
  known: readonly Span[] = []
): VocabularyResult {
  const covered: boolean[] = new Array(text.length).fill(false);
  const mark = (start: number, end: number) => {
    for (let i = start; i < end; i++) covered[i] = true;
  };
  for (const s of known) mark(s.start, s.end);
  // well-formed のプレースホルダー
  const ph =
    /〈(?:選手|人物|日時|ID|連絡先|大会|会場|団体|盤|ラウンド|数値|属性)[A-Z0-9]+〉/g;
  let m: RegExpExecArray | null;
  while ((m = ph.exec(text)) !== null) mark(m.index, m.index + m[0].length);
  SAN.lastIndex = 0;
  while ((m = SAN.exec(text)) !== null) mark(m.index, m.index + m[0].length);
  MIXED.lastIndex = 0;
  while ((m = MIXED.exec(text)) !== null) mark(m.index, m.index + m[0].length);

  let unknownRuns = 0;
  let i = 0;
  while (i < text.length) {
    if (covered[i]) {
      i++;
      continue;
    }
    let script = scriptOf(text[i]);
    if (text[i] === "ー") {
      // 長音はカタカナの語の一部（単独の長音・ひらがなの後は内容とみなす）
      script = "katakana";
    }
    if (script === "other") {
      i++;
      continue;
    }
    let j = i + 1;
    while (
      j < text.length &&
      !covered[j] &&
      (scriptOf(text[j]) === script ||
        (script === "katakana" && text[j] === "ー"))
    )
      j++;
    const run = text.slice(i, j);
    const prev = i > 0 ? text[i - 1] : "";
    // 語幹の直後: 漢字・カタカナ、または既知の範囲（安全な文脈・混じりの語）の直後
    const afterStem =
      prev !== "" &&
      (scriptOf(prev) === "kanji" ||
        scriptOf(prev) === "katakana" ||
        covered[i - 1]);
    let ok: boolean;
    switch (script) {
      case "kanji":
        ok = segmentable(run, KANJI, KANJI_MAX);
        break;
      case "katakana":
        ok = segmentable(run, KATAKANA, KATAKANA_MAX);
        break;
      case "hiragana":
        ok = segmentable(
          run,
          GRAMMAR,
          GRAMMAR_MAX,
          afterStem ? OKURIGANA_SINGLES : undefined
        );
        break;
      case "latin":
        ok = LATIN.has(run.toLowerCase());
        break;
    }
    if (!ok) unknownRuns++;
    i = j;
  }
  return { unknownRuns };
}
