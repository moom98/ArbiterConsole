# Arbiter Console Product Requirements v0.1

**Do not modify or remove requirements from this file solely for design or implementation convenience.**

---

## 1. プロジェクト概要

### 1.1 プロダクト名

**Arbiter Console**

チェス大会でアービターが競技進行・裁定・記録を行う際に使用する、モバイル利用を主眼としたアービター業務支援アプリケーション。

### 1.2 背景

チェス大会では、Illegal Move、Touch Move、時間切れ、時計の不具合、ドロー申請、電子機器の所持、棋譜上の問題など、多数の事象についてアービターがその場で迅速に判断する必要がある。

一方で、すべてのルール・例外・大会固有規定を記憶しておくことは難しい。また、同じ事象でもStandard / Rapidなど競技形式や大会固有規定によって処置が変わる。

本システムは、アービターの代わりに裁定することを目的とするものではなく、

**「発生した事象について、必要な情報を短時間で整理し、適用すべき規則・処置・根拠をアービターへ提示する」**

ことを目的とする。

日本チェス連盟のNAセミナー資料でも、アービターの職務としてルール遵守・競技進行・プレー環境維持・不正防止が挙げられ、大会全体の進行もアービターの仕事とされている。

*参照: NAセミナー資料_第4回_修正版*

---

## 2. プロダクトの目的

Arbiter Consoleは次の業務を支援する。

1. 大会中に発生したトラブルについて、適用ルールを短時間で確認する。
2. テキストまたは音声で自然言語による質問を行えるようにする。
3. 裁定に必要な情報が不足している場合、必要な追加質問を行う。
4. 適用ルールだけでなく、**「アービターが今何をする必要があるか」**を提示する。
5. 裁定根拠となる規則・条文・資料を確認できるようにする。
6. 大会固有規則を考慮した回答を行う。
7. 発生したIncidentと裁定内容を記録する。
8. 同一対局・同一選手について過去に発生したIncidentを参照できるようにする。
9. ラウンド開始前・進行中・終了時のアービター業務を支援する。
10. チェスクロック操作など、裁定後に必要となる実務作業を支援する。

---

## 3. 想定ユーザー

主な利用者は以下とする。

- National Arbiter
- FIDE Arbiter
- International Arbiter
- 大会でアービター業務を行うスタッフ

特に、ルールを理解しているものの、細かい条件や例外についてその場で確認したいアービターを主要ユーザーとする。

初心者向けのチェスルール学習アプリを主目的とはしない。

---

## 4. 利用環境

大会会場でスマートフォンを使用することを主要な利用環境とする。

以下の条件を考慮する。

- 立った状態で利用する。
- 長時間画面を操作できない。
- 対局から目を離す時間を極力短くする必要がある。
- 騒音のある会場で利用する可能性がある。
- 通信状況が悪い可能性がある。
- 片手で操作する可能性がある。
- 裁定まで数十秒以内で情報を確認したいケースがある。

アービターはゲームの進行を定期的に確認し、PC作業などで対局から目を離しすぎないことが求められているため、操作時間を短くすることを重要な要件とする。

*参照: NAセミナー資料_第4回_修正版*

---

## 5. ルール情報源

### 5.1 参照資料

本システムは最低限以下を参照できること。

#### A. 日本チェス連盟アービター資料

ユーザーから提供された

**「NAセミナー資料 第4回 修正版（2025/11/8）」**

を日本国内大会における主要参照資料として扱う。

資料には以下が含まれる。

- アービターの役割
- Laws of Chess
- チェスクロック
- Irregularity
- 棋譜
- Draw規定
- プレーヤーの行動
- Arbiterの権限
- Rapid rules
- Anti-cheating
- Pairing
- Rating
- Tie-break

*参照: NAセミナー資料_第4回_修正版*

#### B. FIDE Laws of Chess

現行のFIDE Laws of Chessを基礎規則として参照する。

**旧版のLaws of Chessを回答根拠に使用してはならない。**

#### C. 大会固有規定

各大会の

- 大会要項
- 競技規則
- 細則
- Captain規則
- Default time
- Time Control
- 電子機器規則
- Draw offer規則
- チーム編成規則

等を登録可能とする。

---

## 6. ルールの優先順位

複数資料の規定が存在する場合、システムは資料の優先関係を管理すること。

基本的な考え方を以下とする。

```
大会固有規定
→ 日本国内で適用されるJCF規則・運用
→ FIDE Laws of Chess
→ 補足資料・解説
```

ただし、自動的に競合を解決できない場合には推測せず、

**「複数の規定が関係するためCAへの確認が必要」**

と表示する。

**AIが一般的なチェス知識によって登録資料の内容を上書きしてはならない。**

---

## 7. Tournament Profile

大会ごとにTournament Profileを登録できること。

最低限以下の情報を保持する。

- 大会名
- 開催日
- Standard / Rapid / Blitz等の競技区分
- Time Control
- Increment / Delay
- Default time
- Rapid Competition Rules適用有無
- 電子機器規定
- 棋譜記録義務
- Draw offerに関する大会規則
- チーム戦 / 個人戦
- Board数
- Round数
- Fixed Board Orderの有無
- Captain規則
- Bye規則
- その他大会固有規則
- 参照する大会要項

**Time Controlから競技区分を判定する場合、単純な初期持ち時間のみでは判断しない。**

例えばNA資料では 30min + 30sec/move は60手時点で60分相当となるためStandardとして扱われる。

*参照: NAセミナー資料_第4回_修正版*

---

## 8. 大会中の基本状態

アプリは大会中、少なくとも以下を現在状態として保持できること。

- Tournament
- Round
- Board
- White player
- Black player
- Time Control
- 現在のIncident
- 各選手の過去のIncident
- 各選手のPenalty履歴

BoardやPlayer情報との連携方法は設計フェーズで決定する。

---

## 9. トラブル報告機能

ユーザーは「トラブルを報告」からIncidentを登録できること。

以下を主要カテゴリとする。

1. 違法手・着手
2. 駒・盤面の異常
3. 時計・時間
4. 終局・勝敗
5. Draw
6. 棋譜
7. プレーヤーの行動
8. チーム戦
9. Fair Play / Anti-Cheating
10. その他・大会運営

カテゴリは将来的に追加可能であること。

---

## 10. 自然言語質問

ユーザーは自由入力によって質問できること。

入力方法は、

- テキスト
- 音声

を必須とする。

例：

- 「黒が両手でキャスリングした」
- 「時計を押さずに席を離れた」
- 「三回同一局面を主張された」
- 「スマートウォッチを着けている」
- 「キャプテンが選手に話しかけた」
- 「黒の時間が落ちたけど白にはナイトしかない」

など。

音声入力結果は送信前または処理中にテキストとして確認できることが望ましい。

---

## 11. AIによるIncident分類

自由入力された質問について、AIは以下を判定する。

- Incident category
- Incident subtype
- 関係する規則
- 裁定に不足している情報
- 大会固有規則を参照する必要があるか
- Standard / Rapid等による分岐が必要か

**AIは情報が不足している状態で裁定を確定してはならない。**

---

## 12. 追加確認質問

裁定に必要な情報が不足している場合、ユーザーへ追加質問を行う。

質問は原則として、

**裁定結果を変える可能性のある情報のみ**

に限定する。

例えばIllegal Moveでは以下が重要となる。

- 時計を押したか
- 同じ選手による何回目のIllegal Moveか
- 相手が次の手を指したか
- アービター自身が目撃したか
- 対局がすでに終了していないか
- Standard / Rapidのどちらか

NA資料でもIllegal Moveは時計を押した時点で成立するとされており、同じ選手の1回目と2回目で処置が変わる。

*参照: NAセミナー資料_第4回_修正版*

質問数は可能な限り少なくする。

---

## 13. Decision Support

裁定候補を提示する場合、最低限以下を表示する。

### 結論

例：
```
Blackの1回目のIllegal Move。
```

### 今すぐ行うこと

例：
```
- 時計を止める
- 局面をIllegal Move直前へ戻す
- Whiteに2分追加
- Blackに正しい手を指させる
```

### 介入

以下のいずれかを明示する。

- 今すぐ介入
- PlayerのClaimを待つ
- CAへ確認
- 判断不能

### Penalty

- Warning
- 相手への時間加算
- 当該Playerの時間減算
- Game Loss
- その他

### 根拠

- 資料名
- Article番号
- Page
- 原文または該当記述

**アービターには介入すべき場面と、Playerの申立てを待つべき場面が存在するため、介入可否を明示することを重要要件とする。**

*参照: NAセミナー資料_第4回_修正版*

---

## 14. AIの回答制約

AIは以下を守ること。

### 必須

- 登録資料を根拠として回答する。
- 適用したArticleを示す。
- Tournament Profileを考慮する。
- 不足情報があれば質問する。
- 不確実な場合は不確実であると明示する。
- 複数解釈が成立する場合はCAへの上申を促す。

### 禁止

- 根拠のない裁定を生成する。
- 条文が見つからない内容を推測して断定する。
- 大会固有規則を一般ルールで上書きする。
- Playerにチェス上の助言を与える。
- 特定局面の最善手を提示する。
- 「たぶん」「一般的には」だけを根拠にPenaltyを確定する。

---

## 15. Playerからの質問対応

アービターがPlayerからルールについて質問された場合に利用できるモードを設ける。

例：
```
「この局面でキャスリングできますか？」
```

この場合、システムは局面に対してYes / Noを回答するのではなく、

**キャスリングに適用される一般規則**

を提示する。

NA資料でも、PlayerにはLaws of Chessの説明を求める権利がある一方、特定局面について「はい」「いいえ」と回答するのではなく適切なルールを説明するとされている。

*参照: NAセミナー資料_第4回_修正版*

このモードでは回答を、

**「Playerへそのまま説明できる文章」**

として生成できること。

---

## 16. Illegal Move対応

Illegal Moveは高頻度・高リスクIncidentとして専用処理を持つこと。

少なくとも以下を区別する。

- 通常のIllegal Move
- KingをCheck状態にした
- Checkを解除しなかった
- 手を指さず時計を押した
- 両手による着手
- Promotionの不備
- Castling関連
- その他

同じPlayerのIllegal Move回数を対局単位で管理する。

StandardではNA資料に従い、

- 1回目：相手+2分
- 2回目：原則Game Loss

を基本とする。

*参照: NAセミナー資料_第4回_修正版*

RapidについてはRapid規則による分岐を行う。

---

## 17. Rapid対応

Rapidの場合にはStandardと異なる処理を明確に分離する。

Tournament Profileには、

- A.4 Competition Rules適用
- A.5 Competition Rules非適用

のどちらかを登録可能とする。

NA資料では、A.5の場合、相手が次の手を指したかどうか等によってIllegal Moveの扱いが変わる。

*参照: NAセミナー資料_第4回_修正版*

したがって、

**Standard用Decision TreeとRapid用Decision Treeを混在させないこと。**

---

## 18. 時計・時間トラブル

最低限以下を扱う。

- Clock押し忘れ
- 手を指す前にClockを押した
- Clockを押す手が異なる
- Clockに手を置き続ける
- Clockを乱暴に扱う
- Clock故障
- 設定間違い
- Time Control間違い
- Flag fall
- PlayerによるClock停止
- ArbiterによるClock停止
- 中断後の再開
- Penaltyによる時間加減算

時間切れについては、

**時間切れ＝必ず負け**

とはせず、相手に合法的なMate可能性があるかを確認する必要がある。

*参照: NAセミナー資料_第4回_修正版*

---

## 19. Draw対応

最低限以下に対応する。

- Draw offer
- Agreement
- Threefold repetition
- Fivefold repetition
- 50-move rule
- 75-move rule
- Stalemate
- Dead position

Threefold / 50-move claimについては専用手順を提示できること。

確認項目として、

- ClaimしたPlayer
- そのPlayerの手番か
- 条件成立済みか
- 次の手によって成立するのか
- 次の手を棋譜に記入したか
- Clockを停止したか

等を扱う。

同一局面判定では少なくとも、

- 同じPlayerの手番
- 駒の位置
- Castling rights
- En passant rights

を考慮する。

*参照: NAセミナー資料_第4回_修正版*

---

## 20. 棋譜対応

最低限以下を扱う。

- 棋譜の書き忘れ
- 数手遅れている
- 事前記入
- 読めない
- 誤記
- Draw offer記録
- 結果記録
- Player名誤り
- White / Black誤り
- Board番号誤り
- Sign漏れ

Standardでは原則として棋譜記入義務を前提とする。

棋譜への手の事前記入は原則禁止であり、Draw claim等の例外がある。

*参照: NAセミナー資料_第4回_修正版*

---

## 21. Player行動・電子機器

最低限以下を扱う。

- Smartphone
- Smartwatch
- その他電子機器
- バッグへのアクセス
- メモ
- 助言
- 他Boardの分析
- 会話
- 離席
- 対局エリアからの退出
- 騒音
- 過度なDraw offer
- 相手への妨害
- 喫煙
- 観客による干渉

電子機器については大会規則による例外があり得るため、Tournament Profileを優先する。

NA資料では電子機器をバッグに収納する場合にも、電源OFF・指定された場所への保管・Arbiterの許可なしにバッグへアクセスしない等の条件が示されている。

*参照: NAセミナー資料_第4回_修正版*

---

## 22. チーム戦

チーム戦では追加で以下を扱う。

- Fixed Board Order
- RoundごとのPlayer order
- PlayerのBoard間違い
- Captainとの会話
- Captainからの助言
- Team memberとの会話
- Captainによる結果確認
- Team result
- Default
- Bye

大会固有規則を強く参照するカテゴリとする。

---

## 23. Fair Play / Anti-Cheating

最低限以下を記録・確認できる。

- 不自然な離席
- 頻繁なトイレ利用
- 外部情報利用の疑い
- 電子機器利用
- 第三者からの助言
- 検査拒否
- バッグ検査
- Playerからの不正申告

**AIは不正を自動認定してはならない。**

このカテゴリでは、

**事実記録・規則確認・CAへのエスカレーション支援**

を主目的とする。

---

## 24. Incident Log

Incidentごとに記録を保存できること。

最低限以下を保持する。

- 日時
- Tournament
- Round
- Board
- White / Black
- 対象Player
- Incident category
- Incident subtype
- 発生内容
- Arbiterが直接観察したか
- PlayerからのClaimか
- 裁定
- Penalty
- 時間調整
- 適用したArticle
- 参照資料
- CAへEscalationしたか
- メモ

大会終了後には、ゲーム中に発生した事件や申立てと結論を報告することがNA資料でも求められている。

*参照: NAセミナー資料_第4回_修正版*

---

## 25. Penalty履歴

同一対局内のPenalty履歴をPlayerごとに確認できること。

特に、

**Illegal Move回数**

は即座に確認できること。

Penalty種別として最低限、

- Warning
- 相手への時間追加
- 違反Playerの時間減少
- Point変更
- Game Loss
- Round exclusion
- Tournament exclusion

を表現可能とする。

FIDE Article 12.9に相当するPenalty体系を扱えること。

*参照: NAセミナー資料_第4回_修正版*

---

## 26. Round Checklist

アプリは裁定だけでなく、大会進行業務も支援する。

以下のフェーズを想定する。

### ラウンド開始前

- Board / Piece配置
- Clock配置
- Clock設定
- Battery
- Score sheet
- Board番号
- Player name
- FBO
- その他大会固有項目

### 開始直後

- 全Clockが開始されているか
- 欠席Player
- Default対象
- Board / Color間違い

### 対局中

- Time trouble Board
- Clock状態
- Playerの不自然な離席
- 未解決Incident

### 終了時

- Clock停止
- 最終局面
- Result
- White / Black
- Player名
- Board番号
- Sign
- Score sheet回収
- Result報告

NA資料でもこれらがArbiterの職務として挙げられている。

*参照: NAセミナー資料_第4回_修正版*

---

## 27. Clock Operation Guide

PenaltyやClock correctionが必要となった際に、チェスクロックの操作方法を参照できること。

例：

- +1分
- +2分
- 時間減算
- Move counter修正
- Clock交換
- Time Control再設定

大会で使用するClock機種をTournament Profileで指定可能とすることが望ましい。

---

## 28. ルール検索

全文検索または自然言語検索によってルールを参照できること。

例：

- 7.5.5
- illegal move
- 両手
- 時計押し忘れ
- 三回同一局面

検索結果には、

- 条文番号
- 内容
- 出典
- Page
- 関連条文

を表示する。

---

## 29. 回答の情報源表示

AI回答には必ず根拠資料を紐付ける。

例：
```
FIDE Laws of Chess 7.5.4
FIDE Laws of Chess 7.5.5
JCF NA Seminar 2025 p.48
Tournament Regulations §4.2
```

ユーザーが根拠を開いて原文を確認できること。

---

## 30. Source Version管理

Rulesは改訂されるため、

- 資料名
- Version
- 公開日
- 有効開始日

を管理できること。

**旧ルールと現行ルールを同一の検索対象として無条件に混在させてはならない。**

---

## 31. オフライン要件

大会会場の通信品質を考慮し、最低限以下はオフライン利用可能であることが望ましい。

- Tournament Profile
- Lawsの本文検索
- Tournament Regulations
- Incident Log閲覧
- Incident Log登録
- Round Checklist
- Clock Operation Guide

AIによる自然言語解析が通信を必要とする場合でも、

**基本的なルール検索と定型Decision Treeは通信不能でも利用できること**

を目標とする。

---

## 32. 操作性要件

大会中の使用を前提として、

- 片手操作可能
- Buttonを大きくする
- 重要な裁定を数タップで確認可能
- 長文入力を要求しない
- 音声入力可能
- 回答の最上部に「今すること」を表示
- 根拠説明は必要時に展開する

ことを求める。

**通常のChat UIだけで完結させない。**

---

## 33. パフォーマンス要件

大会中の裁定利用では、

- 定型Incident選択後の表示：可能な限り即時
- Rule検索：数秒以内
- AI質問回答：可能な限り短時間

を目標とする。

**AIから長文の解説を返すことより、短時間で正しい次の行動を確認できること**

を優先する。

---

## 34. Fail Safe

裁定を安全側に倒すため、以下を満たす。

適用規則が確定できない場合、

```
「裁定を確定できません」
```

と表示する。

重大な判断について根拠が不十分な場合、

```
「CAへ確認してください」
```

と表示する。

**AIは無理に答えを生成しない。**

---

## 35. プロダクト上のAIの位置付け

本システムにおけるAIは、

**Arbiter Decision Support**

であり、

**Automated Arbiter**

ではない。

最終的な裁定権限はアービターにある。

AIの主な役割は、

- 自然言語理解
- Incident分類
- 不足情報抽出
- 関連Rule検索
- Rule要約
- Tournament Ruleとの照合
- Playerへの説明文生成

とする。

一方、

**頻出かつ重大な裁定は、可能な限りLLMのみで決定せず、明示的なルール・Decision Treeによって処理する。**

---

## 36. MVP範囲

最初のリリースでは以下をMVPとする。

### 必須

- Tournament Profile
- Tournament Regulations登録
- JCF / FIDEルール検索
- テキスト質問
- 音声質問
- Incident 10分類
- AIによる分類
- 不足情報の追加質問
- Decision Support
- Article / Source表示
- Illegal Move対応
- 時計・時間対応
- Draw対応
- 電子機器対応
- Incident Log
- Penalty履歴
- Round Checklist
- Clock Operation Guide

### MVP対象外

- Swiss Pairing Engineの独自実装
- FIDE Rating計算
- Tie-break計算
- Chess Engineによる局面評価
- 最善手解析
- Anti-cheatingの自動判定
- Player向け一般Chessアプリ

---

## 37. 設計時に必ず解決すべき事項

この要件をもとに設計するAIエージェントは、少なくとも以下を設計対象とすること。

1. 画面構成・Navigation
2. Tournament Profileデータモデル
3. Round / Board / Playerモデル
4. Incidentモデル
5. Penaltyモデル
6. Rule / Source / Articleモデル
7. Incident分類体系
8. 各IncidentのDecision Tree
9. AIとDecision Treeの責任分界
10. RAG構成
11. Source priorityの実装方法
12. Rule version管理
13. 音声入力フロー
14. Incident Log
15. Offline strategy
16. Clock Guide管理方法
17. AIが追加質問を生成する方式
18. CA Escalationの条件
19. 誤回答を抑制する仕組み
20. MVPと将来拡張を分離したArchitecture
