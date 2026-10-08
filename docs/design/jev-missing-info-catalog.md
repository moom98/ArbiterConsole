# Fact カタログ（レビュー用）

**Status:** 改訂版ドラフト。2026-10-08 のユーザーレビュー（R1〜R8）を反映済みで、再レビュー待ちです。
**Date:** 2026-10-08
**設計:**
- [fact-model.md](./fact-model.md)（仕組み）
- [external-ai-data-protection.md](./external-ai-data-protection.md)（送信の保護）
- [jev-classifier-design.md](./jev-classifier-design.md)

この文書がカタログの正本です。実装（J1）では内容をそのまま `lib/domain/facts/catalog.ts` へ写します。

> 送信禁止語（旧 §B）は [external-ai-data-protection.md](./external-ai-data-protection.md) の付録 A へ移しました。Sensitive Gate と PII 除去を分けたこと（指摘 11）に伴う移動です。

---

## 前回からの主な変更

| 指摘 | 変更 |
| --- | --- |
| 1 | 「カテゴリ内の不足項目を確率順に最大5件」は廃止しました。必要な fact は **Decision Tree（DT のないカテゴリでは fact plan）が今の分岐に応じて決めます。** Jev は、その fact が報告に書かれているかだけを判定します。 |
| 2 | Jev への質問を「書かれていないか」から「**明示されているか**」に変えました。推測できるだけの場合は「書かれていない」とします。 |
| 3 | 0.5 の固定しきい値は廃止しました。しきい値は**評価データで決め、fact ごとに持ちます。** 判断のつかない範囲と、しきい値が未設定の場合は missing（アービターに確認）とします。 |
| 4 | すべての fact に **区分（blocking / conditional / optional）と適用条件**を付けました。 |
| 5 | 回答は原則 **はい / いいえ / わからない**です。選択式や数値の質問にも「わからない」を必ず付けます。DT は「わからない」でも止まりません（fact-model §3.3）。 |
| 6 | 質問を**観測事実**の形に直しました（例：resignation-clear → 投了に関して観察された発言・動作）。 |
| 7 | `dr.claim-timing` を追加しました。`dr.next-move-written` は「次の手で成立」の場合だけ尋ねます。 |
| 8 | `ss.low-time` を `ss.remaining-time`（残り時間 m:ss）に変えました。5分未満かどうかはコードで比べます。 |

## 表の見方

- **区分**：
  - **B** = blocking（必須）
  - **C** = conditional（条件を満たし、かつ DT がその分岐に来たときだけ必須）
  - **O** = optional（任意。必須にはしない）
- **回答**：
  - YN = はい / いいえ / わからない
  - 選択 = 選択肢 + わからない（「複数」は複数選択可）
  - 時間 = m:ss または わからない
  - 数 = 数値 または わからない
  - 設定 = アプリの設定や記録から取得し、質問しない
- **Jev**：報告に明示されているかを Jev で判定する対象か（○）。
  - 設定から分かる値と fair-play は対象外です。
- **根拠**：
  - `§nn` = 要件の節
  - `DT:xxx` = 決定木の質問 ID
  - `IC§n` = `docs/design/incident-classification.md` の節
  - **要確認**：要件に直接の記載がない項目です。

---

## 1. illegal-move（違法手）— DT-001 / 002 / 003 が必要な fact を決める

| ID | 質問（観測事実） | 回答 | 区分 | 適用条件 | Jev | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| `im.action` | 何が起きましたか（違法な位置へ駒を動かした・両手で指した・昇格の駒を置かずに時計を押した・手を指さずに時計を押した） | 選択 | B | — | ○ | §16, DT:subtype |
| `im.player` | 違法な動作をしたのはどちらですか（白・黒） | 選択 | B | — | ○ | DT:playerColor |
| `im.clock-pressed` | その後、その選手は時計を押しましたか | YN | B | — | ○ | §12, DT:clockPressed |
| `im.after-result` | 違法手に気づいたのは、結果の記入・署名・握手の後でしたか | YN | B | — | ○ | §12, DT:gameEnded（観測の形に変更） |
| `im.opponent-moved` | 相手はその後、次の手を指しましたか | YN | C | 対局種別が Rapid/Blitz で、DT が要求したとき | ○ | §17（A.5）, DT:opponentMadeNextMove |
| `im.noticed-by` | 違法手を最初に指摘したのは誰ですか（アービター・相手・その他） | 選択 | C | DT が要求したとき（Rapid/Blitz の監督体制による） | ○ | §12, DT:detectedBy |
| `im.opponent-material` | 相手側の盤上の駒の数（Q・R・B・N・P） | 数 | C | 処置が対局の終了につながりうる分岐で、DT が要求したとき。メイトできるかの判定はコード（ADR-005） | — | §16, DT:material（`opponentCanCheckmate` の直接質問は廃止） |
| `im.count` | 同じ選手のこの対局での違法手の回数 | 設定 | — | Incident Log から取得し、質問しない | — | §16 |

## 2. clock-time（時計・時間）— DT-004（フラッグ）が必要な fact を決める

| ID | 質問（観測事実） | 回答 | 区分 | 適用条件 | Jev | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| `ct.event` | 何が起きましたか（時計の表示が0になった・その他の時計トラブル） | 選択 | B | — | ○ | §18, DT:clockTimeSubtype |
| `ct.zero-side` | 表示が0になったのはどちらですか（白・黒・両方） | 選択 | C | `ct.event` = 0になった | ○ | DT:flagFallen |
| `ct.zero-order` | 両方の場合、先に0になったのはどちらか分かりますか（白・黒） | 選択 | C | `ct.zero-side` = 両方 | ○ | DT:bothFlagsOrder |
| `ct.before-zero` | 表示が0になる前に何がありましたか（チェックメイト・投了の発言や動作・ドロー合意の発言・なし） | 選択 | C | `ct.event` = 0になった | ○ | DT:gameEndedBeforeFlag（観測の形に変更） |
| `ct.opponent-material` | 相手側の盤上の駒の数 | 数 | C | DT が要求したとき（`movesNotCompleted` の分岐） | — | §18, DT:material |
| `ct.period` | 最終ピリオドか・加算の有無 | 設定 | — | 大会の持ち時間設定から取得。未設定の場合のみ質問 | — | DT:lastPeriod, DT:quickplayGuidelinesApply |
| `ct.clock-observed` | 時計で何が見えましたか（表示が消えた・時間が増えた/減った・押しても切り替わらない・設定と違う時間・その他） | 選択・複数 | C | `ct.event` = その他 | ○ | §18（旧 `ct.malfunction-or-setting` の判断を観測に変更） |
| `ct.stopped-by` | 時計を止めたのは誰ですか（白・黒・アービター・止まっていない） | 選択 | O | `ct.event` = その他 | ○ | §18 |

## 3. draw（ドロー）

DT-005 が扱うのは次の3つです：三回同一局面のクレーム、五回同一局面、75手。「その他」（合意・50手のクレーム・ステイルメイト等）には DT がないので、fact plan で扱います。

| ID | 質問（観測事実） | 回答 | 区分 | 適用条件 | Jev | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| `dr.kind` | 何の申し出・クレームですか（三回同一局面のクレーム・五回同一局面・75手・その他） | 選択 | B | — | ○ | §19, DT:drawSubtype（選択肢は DT と同じ） |
| `dr.other-kind` | その他の場合、何ですか（ドローの合意・50手のクレーム・ステイルメイト・これ以上メイトできない局面・その他） | 選択 | C | `dr.kind` = その他（fact plan） | ○ | §19 |
| `dr.claimant` | クレームしたのはどちらですか（白・黒） | 選択 | C | `dr.kind` = 三回同一局面のクレーム（DT）、または `dr.other-kind` = 50手のクレーム（fact plan） | ○ | §19, DT:claimant |
| **`dr.claim-timing`（新規）** | 主張している局面はどれですか（**相手の直前の手で既に出現・成立した** ／ **自分がこれから指す予定の手で出現・成立する**） | 選択 | C | `dr.claimant` と同じ | ○ | §19（成立済みか、次の手で成立するのか）, FIDE 9.2.1 / 9.2.2 / 9.3, DT:claimMode |
| `dr.clock-running` | クレームしたとき、どちらの時計が動いていましたか（白・黒・止まっていた） | 選択 | C | `dr.claimant` と同じ | ○ | §19, DT:claimantHasMove（観測の形に変更。止まっていた は unknown として扱う） |
| `dr.next-move-written` | 予定の手を棋譜に書きましたか（盤上ではまだ指していない） | YN | C | **`dr.claim-timing` = 予定の手で出現・成立する場合のみ** | ○ | §19, DT:moveWritten |
| `dr.piece-touched` | 予定の手の駒に手を触れましたか | YN | C | `dr.kind` = 三回同一局面のクレーム（どちらのタイミングでも。DT-005 の基本の質問） | ○ | §19, DT:touchedPiece |
| `dr.positions` | 同一局面の記録（棋譜の該当部分、または局面の記述） | テキスト | C | DT が同一局面の確認を求めたとき。成立したかの判定はコード（`auto`）。**外部へは送らない** | — | §19, DT:positionsText |
| `dr.clock-stopped` | クレームの際に時計を止めましたか | YN | O | `dr.claimant` と同じ | ○ | §19 |

## 4. game-result（対局結果）— fact plan

| ID | 質問（観測事実） | 回答 | 区分 | 適用条件 | Jev | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| `gr.issue` | 何が起きましたか（記入された結果が食い違う・署名がない・投了をめぐる争い・その他） | 選択 | B | — | ○ | IC§7, §20 |
| `gr.claimed-white` | 白が主張している結果（白勝ち・黒勝ち・ドロー） | 選択 | C | `gr.issue` が食い違い・争い | ○ | IC§7（result-dispute） |
| `gr.claimed-black` | 黒が主張している結果（白勝ち・黒勝ち・ドロー） | 選択 | C | `gr.issue` が食い違い・争い | ○ | IC§7（result-dispute） |
| `gr.resign-observed` | 投了に関して観察された発言・動作（「投了します」等の発言・キングを倒した・握手した・時計を止めた・結果用紙に署名した・どれもない） | 選択・複数 | C | `gr.issue` = 投了をめぐる争い | ○ | IC§7（resignation）。**旧 `gr.resignation-clear`「明確だったか」の判断は廃止** |
| `gr.signatures` | 結果用紙・棋譜の署名（白あり・黒あり・どちらもなし） | 選択・複数 | C | `gr.issue` = 署名がない | ○ | §20（Sign漏れ） |

## 5. scoresheet（棋譜）— fact plan

| ID | 質問（観測事実） | 回答 | 区分 | 適用条件 | Jev | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| `ss.issue` | 何が起きましたか（記入していない・遅れている・指す前に書いた・読めない・誤記） | 選択 | B | — | ○ | §20 |
| `ss.moves-behind` | 何手遅れていますか | 数 | C | `ss.issue` = 遅れている | ○ | §20 |
| **`ss.remaining-time`**（旧 low-time） | 記入していない側の時計の残り時間（m:ss） | 時間 | C | `ss.issue` が記入していない・遅れている | ○ | **要確認**（FIDE Laws 8.4。要件本文に直接の記載なし）。**5分未満かどうかの比較はコードで行う。** 比べる値と加算の条件は規則の版のパラメーターとして持つ |
| `ss.increment` | 1手ごとの加算（秒） | 設定 | — | 大会の持ち時間設定から取得。未設定の場合のみ質問 | — | FIDE Laws 8.4（要確認） |

## 6. player-behavior（選手の行動・電子機器）— fact plan

| ID | 質問（観測事実） | 回答 | 区分 | 適用条件 | Jev | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| `pb.behavior` | 何が観察されましたか（電子機器・会話・離席・対局エリアからの退出・騒音・相手への妨害・喫煙・観客の干渉・その他） | 選択・複数 | B | — | ○ | §21 |
| `pb.actor` | 当事者は誰ですか（白・黒・観客・その他） | 選択 | B | — | ○ | §21（観客による干渉） |
| `pb.device-type` | 機器の種類（スマートフォン・スマートウォッチ・その他） | 選択 | C | `pb.behavior` に電子機器を含む | ○ | §21 |
| `pb.device-where` | 機器はどこにありましたか（身につけていた・バッグの中・指定の保管場所・その他） | 選択 | C | `pb.behavior` に電子機器を含む | ○ | §21（バッグ収納の条件） |
| `pb.device-observed` | 機器について何が観察されましたか（音が鳴った・画面が点いた・操作していた・電源が切れていた） | 選択・複数 | C | `pb.behavior` に電子機器を含む | ○ | §21（電源OFFの条件） |
| `pb.went-where` | どこへ行きましたか（席を離れた・対局エリアの外に出た） | 選択 | C | `pb.behavior` に離席・退出を含む | ○ | §21 |
| `pb.observed-by` | 誰が観察しましたか（アービター自身・選手からの申告・その他） | 選択 | O | — | ○ | **要確認**（AI推論の入力 `arbiterObserved` と同じ趣旨） |
| `pb.tournament-device-rule` | 電子機器に関する大会規定 | 設定 | — | 大会規定（Tournament Profile）。質問しない | — | §21（大会規定を優先） |

## 7. team（団体戦）— fact plan

| ID | 質問（観測事実） | 回答 | 区分 | 適用条件 | Jev | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| `tm.issue` | 何が起きましたか（ボード順の違い・キャプテンとの会話・助言・結果の確認・その他） | 選択 | B | — | ○ | §22 |
| `tm.who` | 話した・助言した相手は誰ですか（キャプテン・チームメンバー・その他） | 選択 | C | `tm.issue` が会話または助言 | ○ | §22 |
| `tm.timing` | いつのことですか（対局中・対局前・対局後） | 選択 | C | `tm.issue` が会話または助言 | ○ | **要確認**（会話や助言の扱いに関係しうる） |
| `tm.content` | 何について話していましたか（局面・ドローの申し出・結果・その他・聞こえなかった） | 選択 | C | `tm.issue` が会話または助言 | ○ | §22（Captainからの助言） |

> 盤番号・ボード順の具体的な番号は、アービターが端末上で確認するだけです。外部へは送りません（external-ai-data-protection §5.2.2）。

## 8. board-piece（盤・駒）— fact plan

| ID | 質問（観測事実） | 回答 | 区分 | 適用条件 | Jev | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| `bp.issue` | 何が起きましたか（駒がずれた・落ちた・初期配置が違う・駒が足りない・盤の向きが違う・昇格の駒がない） | 選択 | B | — | ○ | IC§5 |
| `bp.when` | いつ気づきましたか（開始前・対局中・終了後） | 選択 | B | — | ○ | IC§5（When noticed / discovered?） |
| `bp.how` | 駒が動いたとき何が見えましたか（手・袖が当たった・指している途中だった・見ていない） | 選択 | C | `bp.issue` がずれた・落ちた | ○ | IC§5。**旧 `bp.intentional`「故意か偶然か」の判断は廃止** |
| `bp.record` | 正しい局面を確かめられる棋譜はありますか（両者の棋譜あり・片方のみ・なし） | 選択 | C | `bp.issue` がずれた・落ちた・初期配置 | ○ | IC§5（Position reconstructable?） |

## 9. tournament-admin（大会運営）— fact plan

| ID | 質問（観測事実） | 回答 | 区分 | 適用条件 | Jev | 根拠 |
| --- | --- | --- | --- | --- | --- | --- |
| `ta.issue` | 何が起きましたか（遅刻・ペアリングの誤り・会場・用具の不足・その他） | 選択 | B | — | ○ | §9（10. その他・大会運営）, IC§13 |
| `ta.late-elapsed` | 対局開始から到着までの経過時間（分） | 時間 | C | `ta.issue` = 遅刻 | ○ | IC§13（How late?）。**default time と比べるのはコード**（値は大会規定） |
| `ta.discovered` | いつ発覚しましたか（対局前・対局中・終了後） | 選択 | C | `ta.issue` = ペアリングの誤り | ○ | IC§13（When discovered?） |

## 10. fair-play — 対象外

- カテゴリとして fair-play を選んだ入力は、**理由を問わず外部へ送りません**（external-ai-data-protection §4.2 L0）。
- fact の確認は端末内だけで行います。Jev による判定はしません。
- 項目は従来どおり §23 の記録項目を使います。

---

## 再レビューで判断していただきたい点

1. **「要確認」の項目**：採用するか、文言をどうするか。
   - `ss.remaining-time` / `ss.increment`（FIDE 8.4）
   - `pb.observed-by`
   - `tm.timing`
2. **既存 DT の質問の言い換え**（fact-model §3.4）：
   - `opponentCanCheckmate`、`positionBlocked`、`lastMoveCheckmate` の直接質問を廃止して、駒の数・局面の入力からコードで判定する
   - `gameEnded` / `gameEndedBeforeFlag` / `claimantHasMove` / `touchedPiece` を観測の形にする
3. **50手のクレーム**：DT がないので、fact plan で扱う（§3）。
4. **区分と適用条件の妥当性**（B/C/O の付け方）。
