# Design Phase Summary - Arbiter Console

**Date:** 2026-10-06
**Phase:** Phase 1-2 Complete (Foundation + AI/RAG Design)
**Status:** Ready for implementation

---

## 完了した設計ドキュメント

### Phase 1: 基礎設計
1. ✅ **ADR-001: Technology Stack Selection** - 技術スタック選定
2. ✅ **architecture.md** - システム全体アーキテクチャ
3. ✅ **domain-model.md** - ドメインモデル定義

### Phase 2: AI/RAG設計
4. ✅ **ADR-002: Decision Tree and LLM Responsibility Boundary** - LLMと決定的ロジックの分離
5. ✅ **ai-rag-design.md** - RAG構成とAI統合
6. ✅ **offline-design.md** - オフライン戦略

---

## 重要な設計判断サマリー

### 1. 技術スタック (ADR-001)

| 領域 | 選定技術 | 理由 |
|------|---------|------|
| Frontend | Next.js 14.2.x + React 18 | デジタル庁デザインシステム要件、PWA対応 |
| UI | Digital Agency Design System | ユーザー指定、政府標準 |
| 状態管理 | Zustand | 軽量、TypeScript親和性、永続化middleware |
| データ永続化 | Dexie.js (IndexedDB) | 大容量、オフライン対応、クエリ機能 |
| AI/LLM | Claude Sonnet 4.5 / Haiku 4 | 長文脈、構造化出力、日本語対応 |
| Vector検索 | Transformers.js (local) | オフライン対応必須 |
| 音声入力 | Web Speech API | ネイティブAPI、コスト不要 |
| PWA | next-pwa | Service Worker、オフラインキャッシュ |

> **Note (ADR-006):** The LLM provider is now **Google Gemini**, called only through the server Route Handlers `app/api/llm/*`. The API key is never sent to the browser. Claude/Anthropic references in this document are historical. See [ADR-006](../decisions/ADR-006-gemini-llm-via-server-route.md).

**制約事項**:
- React 18に固定（デザインシステムがReact 19非対応）
- オフライン動作必須（会場の通信品質問題）

### 2. LLMと決定的ロジックの分離 (ADR-002)

**Decision Tree対象** (10種類):
- Illegal Move (Standard / Rapid A4 / Rapid A5)
- Flag Fall (持ち時間切れ)
- Draw Claim (Threefold / 50-move / Fivefold / 75-move / Stalemate / Dead Position)

**理由**:
- 決定的ルールが存在（条件→結果が明確）
- 高頻度・高影響（ゲーム結果に直結）
- オフライン対応必須
- 性能要件（<100ms）
- ハルシネーションリスク排除

**LLM+RAG対象** (15-20種類):
- 電子機器所持（大会規則依存）
- Clock故障（状況依存）
- Player行動（主観的判断）
- Fair Play（自動判定禁止、CA必須）
- その他文脈依存Incident

**理由**:
- 文脈依存（状況により判断が変わる）
- 大会固有規則の影響大
- 頻度低・リスク中程度
- 人間の裁量が中心（AIは補助）

**ハイブリッド**: LLMで分類→Decision Treeで裁定

### 3. AI安全性制約（§14厳守）

**LLM出力検証（必須）**:
```typescript
// すべてのLLM出力は検証を通過必須
1. Penaltyがある場合、sourcesも必須
2. 引用されたArticleがDB内に実在すること
3. 引用されたArticleが検索結果に含まれていたこと（ハルシネーション防止）
4. Low confidenceの場合、CA escalation推奨
5. 推測語（「たぶん」「おそらく」）の検出と拒否
```

**検証失敗時の挙動**:
```
→ 「裁定を確定できません。CAへ確認してください。」を表示
→ Penaltyなし、sourcesなし、escalationRecommended=true
```

**原則**:
> 「AIがもっともらしい裁定を生成すること」よりも
> **「根拠のない裁定をしないこと」を優先**

### 4. RAG構成 (ai-rag-design.md)

**Embedding Model**: `Xenova/all-MiniLM-L6-v2`
- 多言語対応（日本語・英語）
- 小型（23MB）、高速（50-100ms/query）
- オフライン動作（Transformers.js via WebAssembly）
- 384次元（IndexedDBに格納可能）

**検索戦略**: Hybrid Search
```
Vector Search (0.6) + Full-text Search (0.4)
```
- Vector: セマンティック検索（「違法手のペナルティは？」）
- Full-text: Article番号検索（「7.5.5」）、キーワード完全一致

**Rule優先順位** (§6):
```
大会固有規定 (priority=1000)
  ↓
JCF規則 (priority=100)
  ↓
FIDE Laws (priority=10)
  ↓
補足資料 (priority=1)
```

数値boostを検索スコアに加算して再ランキング。

**競合検出**:
- 同じトピックで複数のsource typeが存在
- 裁定内容が異なる
→ 「複数の規定が関係するためCAへの確認が必要です」

### 5. オフライン戦略 (offline-design.md)

**オフラインで動作**:
- ✅ Rule検索（Vector + Full-text）
- ✅ Decision Tree裁定
- ✅ Incident Log（作成・閲覧）
- ✅ Tournament Profile
- ✅ Round Checklist
- ✅ Clock Operation Guide

**オフラインで不可**:
- ❌ LLM reasoning（Claude API必須）
- ❌ 新規PDF資料の埋め込み生成（Transformers.jsで可能だが遅い）

**Graceful Degradation**:
```
オフライン時にLLM必須Incidentが発生
↓
「この事象は詳細な分析が必要です。」
「ルール検索タブで関連規則を確認してください。」
「インターネット接続を確認するか、CAへ相談してください。」
```

**データサイズ見積もり**:
- FIDE Laws (500 articles): ~1.75MB (text + embeddings)
- JCF資料 (120 articles): ~0.5MB
- 大会1件（100ゲーム、50 incidents）: ~0.3MB
- **合計（アクティブ大会1件）**: ~2-3MB

**PWA構成**:
- Service Worker: 静的アセットキャッシュ
- IndexedDB: ルール資料、Incident、大会データ
- Background Sync: オンライン復帰時に自動同期

---

## 実装前に解決すべき未決事項

### 優先度: 高（実装開始前に決定必須）

1. **Decision Treeのバージョン管理方法**
   - **問題**: FIDE rulesが改訂された場合、Decision Tree実装も変更が必要
   - **提案**: Decision TreeをRuleSourceのversionと紐付け、旧大会には旧Treeを使用
   - **決定期限**: 実装開始前
   - **仮定**: MVP期間中はルール改訂なしと仮定し、バージョン管理は後回し

2. **多言語ルール（FIDE英語 + JCF日本語）の扱い**
   - **問題**: 同じArticleが英語版と日本語版で存在する場合の検索方法
   - **提案A**: 両方を別Articleとして格納、別々に埋め込み
   - **提案B**: 日本語版を英語に翻訳し、単一埋め込み空間
   - **仮定**: 提案A採用（翻訳誤差を避ける）
   - **決定期限**: ルール資料処理実装時

3. **LLM Context Windowへの記事数**
   - **問題**: 何件の検索結果をLLMに渡すか（多い=精度↑、遅い↑、コスト↑）
   - **提案**: Top 10 articles（約5K tokens）
   - **仮定**: 10件で十分と仮定
   - **検証**: 初期テストでTuning

### 優先度: 中（MVP後に決定可）

4. **LLM応答のキャッシュ戦略**
   - **問題**: 同じIncidentに対して毎回API呼び出しするか
   - **提案**: (incident description + tournament + game context) をキーに1時間キャッシュ
   - **仮定**: MVPではキャッシュなし（実装簡素化）

5. **Transformers.jsパフォーマンスが不十分な場合の対策**
   - **問題**: 低スペック端末でEmbedding生成が遅い（>5秒）
   - **提案**: Full-text searchのみにフォールバック
   - **仮定**: 現代スマホでは十分な性能と仮定
   - **検証**: 実機テスト後判断

6. **Background Sync非対応ブラウザの扱い**
   - **問題**: Safari等では完全対応していない
   - **提案**: `window.online` eventで代替
   - **仮定**: 代替実装で十分

### 優先度: 低（将来検討）

7. **Peer-to-Peer Sync（複数アービター間）**
   - MVP対象外、将来機能

8. **Fine-tuned Embedding Model**
   - MVP対象外、精度改善時に検討

---

## リスクマトリクス

### 高リスク（発生時の影響大）

| リスク | 発生確率 | 影響 | 対策 | 状態 |
|--------|---------|------|------|------|
| LLMがArticleをハルシネーション | 低 | 極大 | 出力検証層で拒否、DB照合必須 | 設計済み |
| IndexedDB quota超過（iOS 1GB制限） | 中 | 大 | Quota監視、古いデータ削除UI、Lite mode | 設計済み |
| Decision Treeにバグ（誤裁定） | 中 | 大 | 単体テスト必須、ルールソース引用 | 要実装 |
| オフラインで重要Incidentが処理不可 | 低 | 大 | Decision Treeで主要Incidentカバー、CA推奨 | 設計済み |

### 中リスク

| リスク | 発生確率 | 影響 | 対策 | 状態 |
|--------|---------|------|------|------|
| Embedding model精度不足（日本語） | 中 | 中 | Full-text併用、大きいモデルへ変更可 | 要検証 |
| Transformers.js性能不足（低スペック端末） | 中 | 中 | Full-textのみフォールバック | 設計済み |
| Service Worker登録失敗 | 低 | 中 | 警告表示、静的HTMLフォールバック | 要実装 |
| Rule検索結果0件（関連Article未登録） | 中 | 中 | CA自動エスカレーション | 設計済み |

### 低リスク

| リスク | 発生確率 | 影響 | 対策 | 状態 |
|--------|---------|------|------|------|
| 音声入力認識精度低下（騒音環境） | 高 | 低 | テキスト入力を主とし、音声は補助 | 設計済み |
| Background Sync非対応ブラウザ | 中 | 低 | 手動同期ボタン提供 | 設計済み |
| デザインシステムReact 19非対応 | 低 | 低 | React 18継続、将来マイグレーション | 受容 |

---

## 設計上の重要な仮定

以下の仮定を置いて設計を進めています。実装時に仮定が誤りと判明した場合、再設計が必要です。

### 仮定1: オフライン動作の範囲

**仮定**:
- 大会の80-90%のIncidentはDecision Treeでカバー可能
- 残り10-20%はLLM必須だが、オフライン時はCA推奨で対処可能

**根拠**:
- §16（Illegal Move）、§18（時間切れ）、§19（Draw）が大半を占める想定
- これらは決定的ルールが存在

**検証方法**:
- 実際の大会でIncident分類を記録し、比率を測定

**誤りだった場合の影響**:
- LLM必須Incidentが多い→オフラインで使えない→致命的
- 対策: より多くのIncidentをDecision Tree化

### 仮定2: Vector Search精度

**仮定**:
- `all-MiniLM-L6-v2`で日本語チェスルール検索が実用レベル
- Recall@10で80%以上（Top 10に正解Articleが入る）

**根拠**:
- 多言語モデルとして一定の性能実績
- Full-text searchと併用でカバー

**検証方法**:
- JCF資料でベンチマーク（実装後）

**誤りだった場合の影響**:
- 検索精度低い→LLMが正しいArticleを取得できない→誤裁定
- 対策: より大きいモデル（multilingual-e5-base）へ変更、またはFull-text onlyへ切り替え

### 仮定3: LLM出力検証で十分な安全性

**仮定**:
- 出力検証（Article実在確認、検索結果照合、推測語検出）でハルシネーションを防げる

**根拠**:
- 引用されたArticleがDBに存在し、検索結果に含まれていればハルシネーションではない
- 推測語を禁止すれば、根拠のない断定を防げる

**検証方法**:
- テストケースで意図的に存在しないArticleを引用させる試み

**誤りだった場合の影響**:
- ハルシネーションを見逃す→誤裁定→大会結果に影響
- 対策: より厳格な検証（引用箇所のテキスト一致確認）、人間レビュー必須化

### 仮定4: IndexedDB容量

**仮定**:
- 現代のスマホブラウザで2-3MBのデータ保存は問題ない
- iOSの1GB制限でも十分

**根拠**:
- テキスト+Embeddingで合計2-3MB程度

**検証方法**:
- 実機でIndexedDB書き込みテスト

**誤りだった場合の影響**:
- 容量不足→ルール資料を全保存できない
- 対策: Embedding圧縮（float32→int8）、Lite mode（FIDE onlyモード）

### 仮定5: 大会中のネットワーク状況

**仮定**:
- 大会中は断続的にオフライン（常時オンラインではない）
- 大会前後はオンライン（資料アップロード、同期可能）

**根拠**:
- §31の要件記述、実際の大会環境想定

**検証方法**:
- 実際の大会でネットワーク状況調査

**誤りだった場合の影響**:
- 常時オンライン→オフライン対応過剰（問題なし）
- 常時オフライン→LLM使えない、資料アップロード不可→対策検討必要

---

## 次のステップ推奨

### Option A: 実装開始（推奨）

設計が十分に完了しているため、以下の順で実装開始可能：

1. **プロジェクト初期化**
   - Next.js 14.2.x セットアップ
   - TypeScript設定
   - ESLint + Prettier

2. **基盤実装**
   - Dexie.jsスキーマ定義
   - Domain models（TypeScript interfaces + Zod schemas）
   - Repository interfaces

3. **MVP Decision Tree実装**
   - Illegal Move Standard Tree（最重要）
   - 単体テスト作成

4. **UI基礎**
   - デジタル庁デザインシステムセットアップ
   - Incident報告画面（モックアップ）

5. **RAG実装**
   - ルール資料アップロード機能
   - Embedding生成（Transformers.js）
   - Vector + Full-text 検索

6. **LLM統合**
   - Claude API クライアント
   - 出力検証層
   - Incident分類

7. **PWA化**
   - Service Worker
   - Offline対応テスト

### Option B: UI/UX設計先行

実装前にUI設計を詳細化：

1. **screen-flow.md作成**
   - 主要画面遷移図
   - Incident報告フロー
   - Decision Support表示フロー

2. **Wireframe作成**（任意）
   - Figma等でモバイル画面設計

3. **その後実装開始**

### Option C: Decision Tree詳細設計先行

主要Decision Treeのフロー図を詳細化：

1. **各Decision Treeのフローチャート作成**
   - docs/design/decision-trees/illegal-move-standard.md
   - 分岐条件、質問、出力を明記

2. **その後実装開始**

### 推奨: **Option A（実装開始）**

**理由**:
- 設計ドキュメントが十分に詳細
- 未決事項は実装中または実装後に解決可能
- 早期に動くプロトタイプを作成し、フィードバックを得る方が有益
- UI設計とDecision Tree詳細はコード化しながら詰められる

**実装優先順位**:
1. Illegal Move Standard Tree（高頻度・重要度最高）
2. Rule検索（基盤機能）
3. Incident Log（記録必須）
4. その他Decision Trees（Flag Fall、Draw等）
5. LLM統合（複雑な事象対応）

---

## ドキュメント一覧

### Phase 1: 基礎設計
- `docs/decisions/ADR-001-technology-stack.md`
- `docs/design/architecture.md`
- `docs/design/domain-model.md`

### Phase 2: AI/RAG設計
- `docs/decisions/ADR-002-decision-tree-llm-boundary.md`
- `docs/design/ai-rag-design.md`
- `docs/design/offline-design.md`

### 要件・ルール
- `docs/requirements/product-requirements.md`
- `.claude/rules/domain.md`
- `.claude/rules/frontend.md`
- `.claude/rules/testing.md`

### プロジェクト概要
- `CLAUDE.md`
- `README.md`

---

## 重要な制約と原則（再確認）

### §14: AI制約（絶対遵守）
- ✅ 登録資料を根拠として回答
- ✅ Article番号を明示
- ✅ 不足情報があれば質問
- ✅ 不確実な場合は明示
- ❌ 根拠のない裁定を生成しない
- ❌ 推測で断定しない
- ❌ 大会固有規則を一般ルールで上書きしない

### §34: Fail Safe
- 規則確定できない場合 → 「裁定を確定できません」
- 根拠不十分な場合 → 「CAへ確認してください」
- AIは無理に答えを生成しない

### §35: AI位置付け
- Decision Support（支援）≠ Automated Arbiter（自動化）
- 頻出・重大裁定 → Decision Tree（決定的ロジック）
- LLMのみで決定しない

### 設計原則
> **「AIがもっともらしい裁定を生成すること」よりも、**
> **「根拠のない裁定をしないこと」を優先**

---

## 承認と次のアクション

**設計承認**: ユーザー確認待ち

**次のアクション候補**:
1. ✅ **実装開始**（推奨）
2. ⏸️ UI/UX設計詳細化
3. ⏸️ Decision Tree詳細設計

ユーザーの指示により次のフェーズへ進みます。
