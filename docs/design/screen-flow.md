# Screen Flow and Navigation Design

**Version:** 1.0
**Last Updated:** 2026-10-06
**Status:** Draft

---

## 1. Overview

This document defines the **screen structure and navigation flows** for Arbiter Console. The design prioritizes:

1. **Mobile-first**: Optimized for smartphone usage during tournaments (§4, §32)
2. **Quick access**: Critical functions accessible in 2-3 taps
3. **One-handed operation**: Large buttons, minimal scrolling (§32)
4. **Context awareness**: Show relevant actions based on current state
5. **Offline-ready**: All screens work without internet (except LLM features)

---

## 2. Screen Inventory

### 2.1 Primary Screens (Always Accessible)

| Screen                             | Purpose                      | Key Features                                    | Offline |
| ---------------------------------- | ---------------------------- | ----------------------------------------------- | ------- |
| **ホーム** (Home)                  | Tournament dashboard         | Active tournament, quick actions, round status  | ✅      |
| **トラブル報告** (Incident Report) | Report and resolve incidents | Category selection, NL input, decision support  | ⚠️*     |
| **ルール検索** (Rule Search)       | Search chess rules           | Vector + full-text search, article view         | ✅      |
| **履歴** (Incident Log)            | View past incidents          | Filter by game/player, review decisions         | ✅      |
| **設定** (Settings)                | App configuration            | Tournament profile, clock model, offline status | ✅      |

*Decision Trees work offline, LLM reasoning requires internet

### 2.2 Secondary Screens

| Screen                                       | Purpose                      | Access From                    | Offline |
| -------------------------------------------- | ---------------------------- | ------------------------------ | ------- |
| **大会作成** (Create Tournament)             | Setup new tournament         | Home                           | ✅      |
| **大会詳細** (Tournament Detail)             | View/edit tournament         | Home                           | ✅      |
| **ラウンドチェックリスト** (Round Checklist) | Pre/post-round tasks         | Home, Tournament Detail        | ✅      |
| **対局詳細** (Game Detail)                   | View game info + incidents   | Incident Log, Round Checklist  | ✅      |
| **裁定詳細** (Decision Detail)               | View decision with sources   | Incident Log, Decision Support | ✅      |
| **Article詳細** (Article View)               | Read full rule text          | Rule Search, Decision Detail   | ✅      |
| **Clock操作ガイド** (Clock Guide)            | Clock operation instructions | Decision Detail, Settings      | ✅      |
| **Player質問モード** (Player Q&A)            | Explain rules to players     | Incident Report                | ⚠️      |
| **ルール資料管理** (Rule Management)         | Upload/manage rule sources   | Settings                       | ⚠️      |

### 2.3 Auxiliary Screens

| Screen                            | Purpose                    | Access From             | Offline |
| --------------------------------- | -------------------------- | ----------------------- | ------- |
| **オンボーディング** (Onboarding) | First-time setup wizard    | App launch (first time) | ⚠️      |
| **同期状態** (Sync Status)        | View sync queue, conflicts | Settings                | ✅      |
| **About**                         | App info, version, credits | Settings                | ✅      |

---

## 3. Information Architecture

```
Arbiter Console
│
├── ホーム (Home)
│   ├── 大会作成 (Create Tournament)
│   ├── 大会詳細 (Tournament Detail)
│   │   ├── ラウンド一覧
│   │   ├── ラウンドチェックリスト (Round Checklist)
│   │   └── 対局詳細 (Game Detail)
│   │       └── Incident履歴
│   └── 簡易Incident報告 (Quick Report)
│
├── トラブル報告 (Incident Report) ★ Primary
│   ├── カテゴリ選択
│   ├── 自然言語入力 (Text/Voice)
│   ├── 追加質問 (Follow-up Questions)
│   ├── 裁定表示 (Decision Support)
│   │   ├── 根拠詳細 (Article View)
│   │   └── Clock操作ガイド
│   ├── Player質問モード (Player Q&A)
│   └── Incident保存確認
│
├── ルール検索 (Rule Search) ★ Primary
│   ├── 検索入力
│   ├── 検索結果一覧
│   └── Article詳細 (Article View)
│
├── 履歴 (Incident Log) ★ Primary
│   ├── フィルタ (By Game/Player/Category)
│   ├── Incident一覧
│   └── 裁定詳細 (Decision Detail)
│       └── Article詳細
│
└── 設定 (Settings) ★ Primary
    ├── 大会プロファイル編集
    ├── Clock機種選定
    ├── ルール資料管理 (Rule Management)
    ├── 同期状態 (Sync Status)
    ├── オフライン準備状況
    └── About
```

---

## 4. Navigation Pattern

### 4.1 Bottom Tab Navigation (Primary)

**Fixed bottom navigation bar** with 5 primary screens:

```
┌─────────────────────────────────────────────────────────┐
│                     Screen Content                       │
│                                                           │
│                                                           │
│                                                           │
└─────────────────────────────────────────────────────────┘
┌─────┬─────┬─────┬─────┬─────┐
│ ホーム │ 報告 │ 検索 │ 履歴 │ 設定 │  ← Bottom Tab Bar
│ Home │Report│Search│ Log │Settings│
└─────┴─────┴─────┴─────┴─────┘
```

**Tab Icons + Labels**:

- ホーム: 🏠 Home
- 報告: ⚠️ Incident Report (primary action, highlighted)
- 検索: 🔍 Rule Search
- 履歴: 📋 Incident Log
- 設定: ⚙️ Settings

**Active Tab Indicator**: Bold label + underline

### 4.2 Hierarchical Navigation

**For secondary screens** (Tournament Detail, Game Detail, etc.):

- **Back button** (top-left): Return to previous screen
- **Breadcrumb** (optional, on larger screens): Show navigation path
- **Close button** (modals): Dismiss overlay

---

## 5. Screen Flows

### 5.1 Flow 1: Incident Reporting (Core Flow)

**Scenario**: Arbiter witnesses illegal move

```
[Home] or [Incident Report Tab]
    │
    ├─ Tap "トラブル報告" button
    │
    ▼
[Category Selection]
    │
    ├─ Select "違法手・着手"
    │
    ▼
[Natural Language Input]
    │
    ├─ Option A: Type "黒が両手でキャスリングした"
    ├─ Option B: Voice input → transcription shown
    │
    ├─ Tap "送信"
    │
    ▼
[AI Classification] (Loading...)
    │
    ├─ Classified as: illegal-move / two-hands
    ├─ Missing info detected
    │
    ▼
[Follow-up Questions]
    │
    ├─ Q1: "時計を押しましたか？" → Yes
    ├─ Q2: "相手は次の手を指しましたか？" → No
    ├─ Q3: "この選手の今回の対局での違法手は何回目ですか？" → 1回目
    │
    ▼
[Decision Support Display]
    │
    ├─ 結論: "Blackの1回目のIllegal Move"
    ├─ 今すぐ行うこと:
    │   - 時計を止める
    │   - 局面を戻す
    │   - Whiteに2分追加
    │   - Blackに正しい手を指させる
    ├─ 介入: "今すぐ介入"
    ├─ Penalty: "Whiteに2分追加"
    ├─ 根拠:
    │   - [FIDE 7.5.4] (tap to expand)
    │   - [JCF NA p.48] (tap to expand)
    │
    ├─ Actions:
    │   [Clock操作ガイドを見る]
    │   [この裁定を保存]
    │
    ▼
[Incident Saved Confirmation]
    │
    ├─ "Incidentを記録しました"
    ├─ Options:
    │   [履歴で確認]
    │   [新しいIncidentを報告]
    │   [ホームへ戻る]
```

**Key UX Points**:

- **Progressive disclosure**: Only show questions when needed
- **Large buttons**: Easy to tap with one hand
- **Auto-scroll**: Scroll to new content automatically
- **Confirmation**: Always confirm before saving
- **Quick exit**: Can cancel at any step

> **Implementation (Milestone 6, ADR-006):** when a tournament is active, the report flow's first
> step shows the tournament's ruleset (read-only), its rounds (current round preselected) and a
> board grid: tap a board (1 tap; 2 when changing round) → category. "その他のボード" creates a
> missing board. An incomplete tournament ruleset blocks this step (no defaults). Without a
> tournament, or via "大会を使わずに報告", the ad-hoc context form (ADR-004) is used. Rule search
> passes the active tournament id (tournament regulations first; none when no tournament).

### 5.2 Flow 2: Rule Search

**Scenario**: Arbiter needs to verify threefold repetition rule

```
[Rule Search Tab]
    │
    ▼
[Search Input Screen]
    │
    ├─ Input: "三回同一局面"
    │
    ▼
[Search Results]
    │
    ├─ Results (sorted by priority):
    │   1. [FIDE 9.2.2] Threefold repetition (score: 0.95)
    │   2. [JCF NA p.72] 同一局面の判定 (score: 0.89)
    │   3. [FIDE 9.2.1] ...
    │
    ├─ Tap result #1
    │
    ▼
[Article Detail View]
    │
    ├─ Article: FIDE 9.2.2
    ├─ Source: FIDE Laws of Chess 2023
    ├─ Full text: "The game is drawn, upon a correct claim by a player..."
    ├─ Related articles: [9.2.1] [9.2.3]
    │
    ├─ Actions:
    │   [関連Articleを見る]
    │   [この検索を保存] (bookmark)
```

**Key UX Points**:

- **Instant search**: Results appear as you type
- **Relevance scores**: Show confidence
- **Source badges**: Visual indicators (FIDE/JCF/Tournament)
- **Expandable text**: Collapsible sections for long articles

### 5.3 Flow 3: Round Checklist

**Scenario**: Arbiter prepares for round start

```
[Home]
    │
    ├─ Active tournament shown
    ├─ Current round: Round 3
    │
    ├─ Tap "ラウンドチェックリスト"
    │
    ▼
[Round Checklist - Pre-Round]
    │
    ├─ Phase: 開始前
    ├─ Checklist:
    │   ☑ Board配置確認
    │   ☑ Clock配置確認
    │   ☑ Clock設定確認
    │   ☑ Score sheet配布
    │   ☐ Board番号確認
    │   ☐ Player名確認
    │   ☐ FBO確認
    │
    ├─ Tap checkbox to mark complete
    │
    ▼
[All Pre-Round Items Checked]
    │
    ├─ "開始前チェック完了"
    ├─ [ラウンド開始] button enabled
    │
    ├─ Tap [ラウンド開始]
    │
    ▼
[Round Active]
    │
    ├─ Status: 対局中
    ├─ Checklist switches to: 対局中チェック
    │   ☐ Time trouble Board確認
    │   ☐ Clock状態確認
    │   ☐ 未解決Incident確認
```

> **Implementation (Milestone 7, ADR-008):** `/tournament/[id]/rounds/[n]`, reached from the home
> current-round card ("ラウンドチェックリスト") and from each round in `/tournament/[id]`. Stage tabs
> 開始前 / 対局中 / 終了時 (the current one follows the round status; 対局中 shows 開始直後 + 対局中
> sections), progress "done / total" with a bar, rows ≥56px with a 28px checkbox, a メモ button per
> item (saved on blur), 根拠 on demand (verbatim citations), pending-incident count while active.
> [ラウンド開始] is always enabled: with incomplete pre-round items it shows an in-page warning and
> "確認して開始する". [ラウンド終了] with pending incidents in the round shows a warning, a link to
> the log and "確認して終了する". "項目を編集（この大会）" adds / removes / reorders items for the
> tournament.

**Key UX Points**:

- **Phase-aware**: Checklist changes based on round status
- **Progress indicator**: X/Y items completed
- **Large checkboxes**: Easy to tap
- **Notes field**: Add remarks per item

### 5.4 Flow 4: Player Question Mode (§15)

**Scenario**: Player asks "この局面でキャスリングできますか？"

```
[Incident Report Tab]
    │
    ├─ Tap "Player質問モード"
    │
    ▼
[Player Q&A Mode]
    │
    ├─ Input: "この局面でキャスリングできますか？"
    │
    ▼
[AI Processing] (LLM mode)
    │
    ├─ Extract topic: Castling
    ├─ Retrieve rules: FIDE 3.8
    │
    ▼
[Explanation Display]
    │
    ├─ "Playerへの説明:"
    │
    ├─ "キャスリングは以下の条件をすべて満たす場合に可能です：
    │   1. Kingとそのルークがまだ動いていないこと
    │   2. Kingとルークの間に駒がないこと
    │   3. Kingがチェックを受けていないこと
    │   4. Kingが通過するマスがチェックされていないこと
    │   5. Kingの最終位置がチェックされていないこと
    │
    │   詳細はFIDE Laws 3.8をご確認ください。"
    │
    ├─ [Playerへ見せる] (Large text mode)
    ├─ [元の規則を見る] → Article 3.8
```

**Key UX Points**:

- **Player-friendly language**: No technical jargon
- **General rule only**: No position-specific advice (per §15)
- **Large text mode**: Show to player on arbiter's device
- **Source reference**: Always cite article

### 5.5 Flow 5: Offline Incident (Graceful Degradation)

**Scenario**: Arbiter reports complex incident while offline

```
[Incident Report]
    │
    ├─ Offline status shown: "オフライン"
    │
    ├─ Input: "スマートウォッチを着けている"
    │
    ▼
[Classification Attempt]
    │
    ├─ Keyword match: "player-behavior / electronic-device"
    ├─ Requires LLM analysis (not available offline)
    │
    ▼
[Offline Fallback]
    │
    ├─ "この事象は詳細な分析が必要です。"
    │
    ├─ Suggestions:
    │   - 「ルール検索」で以下を確認:
    │     • "電子機器"
    │     • "スマートウォッチ"
    │   - CAへ相談
    │
    ├─ [ルール検索を開く] button
    ├─ [Incidentを記録]  (saves description only)
    │
    ▼
[Rule Search Opened]
    │
    ├─ Pre-filled query: "電子機器"
    ├─ Results: FIDE 11.3, Tournament regulations
```

**Key UX Points**:

- **Clear offline indicator**: Always visible
- **Helpful suggestions**: Provide next steps
- **Partial save**: Can save incident description
- **Smooth handoff**: Open Rule Search with pre-filled query

---

## 6. Screen Layouts (Mobile)

### 6.1 Home Screen

```
┌─────────────────────────────────────────┐
│  Arbiter Console           [🔔] [⚙️]    │ ← Header
├─────────────────────────────────────────┤
│                                          │
│  ■ 現在の大会                            │
│  全日本選手権 2026                        │
│  Round 3 / 9   |   Board: 1-50          │
│  Status: 対局中                          │
│                                          │
│  [ラウンドチェックリスト]                 │ ← Primary action
│                                          │
├─────────────────────────────────────────┤
│  Quick Actions                           │
│  ┌──────────┐  ┌──────────┐             │
│  │ トラブル │  │ ルール   │             │
│  │ 報告     │  │ 検索     │             │
│  └──────────┘  └──────────┘             │
├─────────────────────────────────────────┤
│  ■ 最近のIncident                        │
│  ┌─────────────────────────────────┐    │
│  │ Board 12 | 10:23                │    │
│  │ Illegal Move (Black)            │    │
│  │ → 2分追加                        │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │ Board 7 | 10:15                 │    │
│  │ Clock malfunction               │    │
│  │ → CAへ確認                       │    │
│  └─────────────────────────────────┘    │
│                                          │
│  [履歴をすべて見る]                      │
│                                          │
└─────────────────────────────────────────┘
│ ホーム  報告  検索  履歴  設定 │ ← Bottom Nav
└─────────────────────────────────────────┘
```

> **Implementation (Milestone 6):** `/home` shows a full-width "トラブルを報告" button first, then the
> active tournament card (ruleset, "Round N / total · status · boards", CA-escalation count, link to
> round management), a tournament switcher (when >1), quick actions 報告 / 検索 / ログ, recent
> incidents of the active tournament (max 5) and the decision-support notice. Milestone 7 adds the
> "ラウンドチェックリスト" button to the current round card. Tournament screens: `/tournament` (list/select),
> `/tournament/new`, `/tournament/[id]` (bulk "Round N, boards a–b", start/end round, per-board
> white/black, players, profile edit, delete). Settings links to them and enables the tournament
> regulations upload for the active tournament.

### 6.2 Incident Report Screen (Category Selection)

```
┌─────────────────────────────────────────┐
│ [←] トラブル報告                         │
├─────────────────────────────────────────┤
│                                          │
│  カテゴリを選択してください               │
│                                          │
│  ┌─────────────────────────────────┐    │
│  │  ⚠️ 違法手・着手                │    │ ← Large buttons
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │  ♟️ 駒・盤面の異常              │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │  ⏱️ 時計・時間                  │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │  🏁 終局・勝敗                  │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │  🤝 Draw                        │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │  📝 棋譜                        │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │  🚫 プレーヤーの行動            │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │  👥 チーム戦                    │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │  🔍 Fair Play / Anti-Cheating  │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │  📋 その他・大会運営            │    │
│  └─────────────────────────────────┘    │
│                                          │
└─────────────────────────────────────────┘
```

### 6.3 Decision Support Display

```
┌─────────────────────────────────────────┐
│ [←] 裁定                 [💾 保存]       │
├─────────────────────────────────────────┤
│                                          │
│  ■ 結論                                  │
│  Blackの1回目のIllegal Move              │
│  （両手によるキャスリング）               │
│                                          │
├─────────────────────────────────────────┤
│  ■ 今すぐ行うこと                        │
│  1. ⏸️ 時計を止める                     │
│  2. ↩️ 局面をIllegal Move直前へ戻す     │
│  3. ⏱️ Whiteに2分追加                   │
│  4. ♟️ Blackに正しい手を指させる         │
│     （片手で）                           │
│                                          │
│  [Clock操作ガイドを見る]                 │
│                                          │
├─────────────────────────────────────────┤
│  ■ 介入                                  │
│  🚨 今すぐ介入                           │
│                                          │
├─────────────────────────────────────────┤
│  ■ Penalty                               │
│  ⏱️ Whiteに2分追加                      │
│                                          │
├─────────────────────────────────────────┤
│  ■ 根拠                                  │
│  ┌─────────────────────────────────┐    │
│  │ [FIDE Laws 7.5.4] ▼              │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │ [JCF NA Seminar p.48] ▼          │    │
│  └─────────────────────────────────┘    │
│                                          │
│  (Tap to expand full text)               │
│                                          │
└─────────────────────────────────────────┘
```

### 6.4 Rule Search Results

```
┌─────────────────────────────────────────┐
│ [←] ルール検索                           │
├─────────────────────────────────────────┤
│  🔍 [三回同一局面_______________] [×]    │ ← Search input
├─────────────────────────────────────────┤
│                                          │
│  検索結果: 3件                           │
│                                          │
│  ┌─────────────────────────────────┐    │
│  │ [FIDE] 9.2.2                    │    │ ← High priority
│  │ Threefold repetition            │    │
│  │ The game is drawn, upon a...    │    │
│  │ Score: 0.95                     │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │ [JCF] NAセミナー p.72           │    │
│  │ 同一局面の判定                   │    │
│  │ 同一局面と判定するには...        │    │
│  │ Score: 0.89                     │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │ [FIDE] 9.2.1                    │    │
│  │ ...                             │    │
│  │ Score: 0.72                     │    │
│  └─────────────────────────────────┘    │
│                                          │
└─────────────────────────────────────────┘
```

---

## 7. Interaction Patterns

### 7.1 Button Sizes (Mobile-First, §32)

**Primary Actions**:

- Height: 56px minimum
- Width: Full-width or 48% (for side-by-side)
- Font size: 16px
- Touch target: 48x48px minimum

**Secondary Actions**:

- Height: 44px
- Font size: 14px

**Icon Buttons**:

- Size: 48x48px minimum
- Icon: 24x24px

### 7.2 Input Methods

**Text Input**:

- Keyboard type: Default (allows Japanese + English)
- Autocomplete: Off (prevent leaking player names)
- Max length: 500 characters

**Voice Input**:

```tsx
<VoiceInputButton>
  Tap → Recording starts → Transcription shown → Edit/Confirm
</VoiceInputButton>
```

**Selection**:

- Radio buttons: Large (24px), labels 44px height
- Checkboxes: Large (24px), labels 44px height
- Dropdowns: Avoided (use button lists instead)

### 7.3 Loading States

**Short operations (<2s)**:

- Spinner overlay with translucent background

**Long operations (2-10s)**:

- Progress indicator with message
- Example: "AI分析中... (3/10s)"

**Very long operations (>10s)**:

- Progress bar with steps
- Example: "Embedding生成中... 150/500 articles"

### 7.4 Error Handling

**Network errors**:

```
┌─────────────────────────────────────────┐
│  ⚠️ インターネット接続がありません       │
│                                          │
│  オフラインモードで利用できる機能:       │
│  • ルール検索                            │
│  • Decision Tree裁定                     │
│  • Incident記録                          │
│                                          │
│  [再試行] [オフラインで続行]             │
└─────────────────────────────────────────┘
```

**Validation errors**:

```
┌─────────────────────────────────────────┐
│  ❌ 入力エラー                           │
│                                          │
│  Board番号が不正です。                   │
│  1〜50の数値を入力してください。         │
│                                          │
│  [OK]                                    │
└─────────────────────────────────────────┘
```

**LLM errors**:

```
┌─────────────────────────────────────────┐
│  ⚠️ AI分析に失敗しました                │
│                                          │
│  以下をお試しください:                   │
│  • ルール検索で関連規則を確認            │
│  • CAへ相談                              │
│                                          │
│  [ルール検索] [Incidentを記録] [閉じる]  │
└─────────────────────────────────────────┘
```

---

## 8. Responsive Design

### 8.1 Breakpoints

| Device             | Width           | Layout                         |
| ------------------ | --------------- | ------------------------------ |
| Mobile (Portrait)  | < 768px         | Single column, bottom nav      |
| Tablet (Portrait)  | 768px - 1024px  | Single column, side nav option |
| Tablet (Landscape) | 1024px - 1280px | Two columns, side nav          |
| Desktop            | > 1280px        | Multi-column, side nav         |

**Note**: Mobile portrait is **primary target** (per §4).

### 8.2 Mobile-Specific Optimizations

**Font Sizes**:

- Body: 16px (prevents zoom on iOS)
- Headings: 20px (H3), 24px (H2), 28px (H1)
- Small text: 14px minimum

**Spacing**:

- Section padding: 16px
- Between elements: 12px
- Between sections: 24px

**Scrolling**:

- Avoid horizontal scroll
- Sticky headers for long lists
- Pull-to-refresh for updates

**Gestures**:

- Swipe left/right: Navigate between tabs (optional)
- Long press: Show context menu (optional)
- Pinch-to-zoom: Disabled (except article view)

---

## 9. Accessibility

### 9.1 WCAG Compliance

**Target**: WCAG 2.1 AA

**Color Contrast**:

- Text: 4.5:1 minimum
- Large text (18px+): 3:1 minimum
- UI components: 3:1 minimum

**Touch Targets**:

- 48x48px minimum (per §32)
- 8px spacing between targets

**Focus Indicators**:

- Visible outline on keyboard focus
- 2px solid, high-contrast color

### 9.2 Screen Reader Support

**Semantic HTML**:

```tsx
<main>
  <h1>トラブル報告</h1>
  <section aria-label="カテゴリ選択">
    <button aria-label="違法手・着手を報告">違法手・着手</button>
  </section>
</main>
```

**ARIA Labels**:

- All buttons have descriptive labels
- Icons have aria-label
- Forms have proper labels + fieldsets

**Keyboard Navigation**:

- Tab order follows visual order
- Enter/Space activates buttons
- Escape closes modals

---

## 10. Offline UI Indicators

### 10.1 Network Status Bar

```
┌─────────────────────────────────────────┐
│ 📶 オンライン                            │  ← Green background
└─────────────────────────────────────────┘

or

┌─────────────────────────────────────────┐
│ ⚠️ オフライン  一部機能が制限されています │  ← Yellow background
└─────────────────────────────────────────┘
```

**Position**: Top of screen, collapsible after 3 seconds

### 10.2 Feature Availability Hints

**On Incident Report screen**:

```
[Online]
  - Category selection shown
  - All features available

[Offline]
  - Category selection shown
  - Warning: "AI分析は利用できません。Decision Treeで対応可能な事象のみ処理できます。"
```

**On Rule Search screen**:

```
[Online/Offline]
  - Full functionality (local search)
```

### 10.3 Sync Indicators

**Incident saved offline**:

```
┌─────────────────────────────────────────┐
│  ✅ Incidentを記録しました               │
│  📤 オンライン復帰時に同期されます       │
└─────────────────────────────────────────┘
```

**After sync**:

```
┌─────────────────────────────────────────┐
│  ✅ 同期完了                             │
└─────────────────────────────────────────┘
```

---

## 11. Dark Mode (Future Enhancement)

**Not in MVP**, but designed for future addition:

**Color Scheme**:

- Light mode: Default (white background)
- Dark mode: Dark gray background (#1a1a1a), white text
- System preference detection: `prefers-color-scheme`

**Implementation**:

- CSS variables for colors
- Toggle in Settings

---

## 12. Open Questions & Decisions

### Decisions Made

1. **Navigation Pattern**: Bottom tab bar (mobile-first)
   - **Reason**: Most common mobile pattern, thumb-friendly

2. **Primary Actions**: 5 tabs max
   - **Reason**: Fits on screen without scrolling, clear priority

3. **Incident Report**: Multi-step wizard
   - **Reason**: Progressive disclosure reduces cognitive load

4. **No hamburger menu**: All primary functions in tabs
   - **Reason**: Faster access, less taps (per §32)

5. **Large buttons**: 56px height minimum
   - **Reason**: One-handed operation, tournament stress (§32)

### Open Questions

1. **Q**: Should we support landscape mode?
   - **Proposal**: Yes, but optimize for portrait first
   - **Decision**: To be tested with real users

2. **Q**: Swipe gestures for navigation?
   - **Proposal**: Optional enhancement, not required for MVP
   - **Decision**: Post-MVP

3. **Q**: Voice output (TTS) for decisions?
   - **Proposal**: Useful for accessibility, but not MVP
   - **Decision**: Post-MVP

---

## 13. References

- [Product Requirements](../requirements/product-requirements.md) - §4, §32 (UI requirements)
- [Architecture](./architecture.md) - System structure
- [Domain Model](./domain-model.md) - Entities and flows
- [Offline Design](./offline-design.md) - Offline UI indicators

---

## Revision History

- 2026-10-06: Initial version
