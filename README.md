# Arbiter Console

**Decision Support Application for Chess Tournament Arbiters**

[![License](https://img.shields.io/badge/license-Private-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-14.2.x-black)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-18.3.1-blue)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)

## Overview

**Arbiter Console** は、チェストーナメント審判向けのDecision Supportアプリケーションです。

このシステムは人間の審判が大会中に情報に基づいた判断を下すのを支援します。これは**自動裁定システムではありません**—最終的な判断は常に人間の審判に委ねられます。

## Project Status

**現在の状態**: Milestone 3完了（基本機能実装済み）

- ✅ Milestone 0: Project Foundation
- ✅ Milestone 1: Rule Search MVP
- ✅ Milestone 2: Illegal Move Decision Tree
- ✅ Milestone 3: Incident Log
- 🔄 Milestone 4-10: 開発予定

詳細な実装状況は [IMPLEMENTATION_STATUS.md](./docs/IMPLEMENTATION_STATUS.md) を参照してください。

## Features

### 実装済み機能

#### 📚 Rule Search

- FIDE Laws of Chess、JCF規則のPDFインポート
- AI embeddings生成（Transformers.js、オフライン対応）
- Hybrid search（Vector検索 + Full-text検索）
- ルール優先度システム（大会規則 > JCF > FIDE）

#### ⚖️ Decision Support

- DT-001: Illegal Move (Standard) の完全実装
  - 1回目: 相手に2分追加
  - 2回目以降: Game Loss
  - FIDE 7.5.4, 7.5.5準拠
- 自然言語によるインシデント報告
- リアルタイム裁定生成
- 根拠規則の自動引用

#### 📊 Incident Management

- インシデント履歴の表示・管理
- カテゴリフィルタリング（10カテゴリ）
- ペナルティ統計ダッシュボード
- CSV export機能

#### 📱 Mobile-First Design

- PWA対応（オフライン動作可能）
- Bottom tab navigation
- レスポンシブデザイン
- 48px最小タッチターゲット

### 開発予定機能

- 🔄 追加Decision Trees (Rapid A4/A5, Flag Fall, Threefold Repetition)
- 🔄 Tournament管理
- 🔄 音声入力
- 🔄 多言語対応

## Tech Stack

### Frontend

- **Framework**: Next.js 14.2.x (App Router)
- **UI Library**: React 18.3.1
- **Styling**: Tailwind CSS 3.4.1
- **Language**: TypeScript 5.x
- **State Management**: Zustand 5.x

### Data & Storage

- **Database**: Dexie.js (IndexedDB wrapper)
- **Vector Search**: Transformers.js (paraphrase-multilingual-MiniLM-L12-v2)
- **Full-text Search**: Lunr.js（日本語は文字bi-gram）

### AI & ML

- **LLM**: Google Gemini API（`@google/genai`、サーバーの Route Handler 経由のみ。[ADR-007](./docs/decisions/ADR-007-gemini-llm-via-server-route.md)）
- **Embeddings**: Xenova/paraphrase-multilingual-MiniLM-L12-v2 (384-dim, 多言語, 約120MB, 自己ホスト — [ADR-003](./docs/decisions/ADR-003-offline-rule-search.md))
- **Runtime**: WebAssembly (browser-based)

### Tools

- **Linting**: ESLint 8.x + Prettier
- **Testing**: Vitest
- **PWA**: next-pwa

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- Git

### Installation

```bash
# Clone repository
git clone git@github.com:moom98/ArbiterConsole.git
cd ArbiterConsole

# Install dependencies
npm install

# Download the embedding model into public/models/ (one-time, ~120MB, needs network)
npm run fetch-models
```

オフライン動作のため、実行時アセットはすべて同一オリジンから配信します（[ADR-003](./docs/decisions/ADR-003-offline-rule-search.md)）。

- `public/pdfjs/`, `public/ort/`: `npm run dev` / `npm run build` の前に `scripts/copy-runtime-assets.mjs` が node_modules から自動コピー
- `public/models/`: `npm run fetch-models` で Hugging Face からダウンロード（デプロイ前に実行）。リビジョンはコミットSHAに固定され、ダウンロード後にファイルのハッシュを検証します

いずれも生成物のためリポジトリには含めません（.gitignore 対象）。モデル未配置の場合、ルール検索はキーワード検索のみで動作します。

`npm run build` はモデル未配置だとエラーで停止します（意味検索なしでのデプロイ防止）。開発・CIでモデル無しのままビルドする場合は明示的に `ALLOW_MISSING_MODEL=1` を指定してください。

### LLM（AI参考情報）の設定

決定木の対象外の事象（例: スマートウォッチ・携帯電話などの選手の行動）では、Google Gemini による「AI参考」情報を表示します。Gemini はサーバー（`app/api/llm/*` の Route Handler）からのみ呼び出し、API キーをブラウザに送ることはありません（[ADR-007](./docs/decisions/ADR-007-gemini-llm-via-server-route.md)）。

`.env.example` を `.env.local` にコピーし、サーバーの環境変数を設定してください（`.env.local` はコミットしない）。

| 変数                      | 既定値                     | 説明                                                           |
| ------------------------- | -------------------------- | -------------------------------------------------------------- |
| `GEMINI_API_KEY`          | （なし・必須）             | Gemini API キー（サーバー専用。`NEXT_PUBLIC_` を付けないこと） |
| `GEMINI_MODEL_REASONING`  | `gemini-flash-latest`      | 決定木の対象外の事象の推論（構造化出力）                       |
| `GEMINI_MODEL_CLASSIFIER` | `gemini-flash-lite-latest` | 自由記述のインシデント分類（低コスト）                         |

- キー未設定の場合、`/api/llm/*` は 503（`not-configured`）を返し、アプリは手動確認（CAへ確認）とキーワード分類で動作します。
- レート制限はサーバープロセス内のメモリで 10 req/分/IP（分類・推論の合計）です。サーバーレス・複数インスタンスではインスタンスごとの制限になります。
- `*-latest` は別名のため挙動が変わることがあります。大会中の再現性が必要な場合はバージョン固定のモデル ID を指定してください。
- AI の出力は端末内の決定的な検証器（引用条文の存在・原文との一致・根拠のないペナルティ・推測表現など）を通過した場合のみ「AI参考」として表示され、それ以外は「CAへ確認」になります。決定木の対象となる事象では AI は判断に使われません。

#### モデル・プロバイダーの変更方法

- **モデルの変更（判定=分類 / 推論）:** サーバーの環境変数 `GEMINI_MODEL_CLASSIFIER`（分類）と `GEMINI_MODEL_REASONING`（推論）を変更し、サーバーを再起動するだけです。コード変更は不要です。既定値は `lib/infrastructure/llm/server/config.ts` の `DEFAULT_CLASSIFIER_MODEL` / `DEFAULT_REASONING_MODEL` の1か所だけで定義しています（他のファイルにモデル ID を書かないこと）。
- **既定値の変更:** `config.ts` の2つの定数のみを変更し、`.env.example` と本 README の表を合わせて更新します。
- **プロバイダーの変更:** `GenerateJsonFn`（`lib/infrastructure/llm/server/generate.ts`）を実装したアダプターを追加します。次に `lib/infrastructure/llm/server/provider.ts` の `llmProvider` を差し替え、必要なら `config.ts` の環境変数名を変更します。ドメイン（検証器・DecisionEngine）、クライアント、UI は変更不要です。

### Development

```bash
# Start development server
npm run dev

# Open browser
# http://localhost:3000
```

### Build

```bash
# Production build (requires `npm run fetch-models` first)
npm run build

# Build without the embedding model (development / CI only; keyword search only)
ALLOW_MISSING_MODEL=1 npm run build

# Start production server
npm start
```

### Testing

```bash
# Run tests (currently has dependency issues)
npm test
```

## Usage

### 1. Rule Search

1. 設定画面で資料種別（FIDE / JCF）を選び、資料名・版・PDFを指定してインポート。同じ種別の有効な資料が既にある場合は、「置き換える（既存資料は旧版として保存し検索対象外）」か「両方を有効にする」かを画面上で選択します。登録済み資料は設定画面から削除できます
2. システムが条文とページ番号を抽出し、embeddingsを生成（初回のみ、数分かかる場合があります）
3. 検索画面でキーワード・条文番号を入力（例: "違法手", "7.5.4", "illegal move"）
4. 結果には資料名・版・ページが表示され、タップで条文全文と出典を確認できます

### 2. Incident Reporting

1. 報告画面でインシデントのカテゴリを選択（違法手、時計/時間、など）
2. 状況を自然言語で説明
   - 例: "白がナイトを違法な位置に移動し、時計を押しました。黒はまだ次の手を指していません。"
3. 「裁定を確認」ボタンをクリック
4. システムが自動的に裁定を生成し、根拠規則とともに表示

### 3. Incident Log

1. 履歴画面でこれまでのインシデントを確認
2. カテゴリでフィルタリング
3. インシデントをクリックして詳細を表示
4. CSV exportボタンで全データをエクスポート

## Architecture

```
┌─────────────────────────────────────────────────┐
│         Presentation Layer                      │
│  (Next.js + React + Tailwind CSS)              │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│         Application Layer                       │
│  (Zustand Stores + UI State Management)        │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│         Domain Layer                            │
│  (Decision Trees + Decision Engine)            │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│         Infrastructure Layer                    │
│  (IndexedDB + Transformers.js + /api/llm→Gemini)│
└─────────────────────────────────────────────────┘
```

詳細は [architecture.md](./docs/design/architecture.md) を参照してください。

## Core Principles

### 🚫 No Unfounded Rulings

AIは根拠のない裁定を生成しません。すべての裁定には明確な規則の引用が含まれます。

### 🎯 Decision Support, Not Automation

このシステムは審判の判断を**支援**するものであり、**自動化**するものではありません。

### 🛡️ Offline-First

Decision Treesはオフラインで動作します。インターネット接続は検索やLLM機能でのみ必要です。

### 📖 Source Citation Required

すべての裁定は、FIDE Laws of Chess、JCF規則、または大会特別規定に基づきます。

### ⚠️ Fair Play: No Auto-Detection

フェアプレー違反の自動検出は行いません。AIは事実の記録と規則の提示のみを行います。

## Documentation

- [Product Requirements](./docs/requirements/product-requirements.md)
- [Implementation Status](./docs/IMPLEMENTATION_STATUS.md)
- [Implementation Plan](./docs/design/implementation-plan.md)
- [Architecture](./docs/design/architecture.md)
- [Domain Model](./docs/design/domain-model.md)
- [AI/RAG Design](./docs/design/ai-rag-design.md)
- [Decision Trees](./docs/design/incident-classification.md)
- [CHANGELOG](./CHANGELOG.md)

## Development

### Directory Structure

```
arbiter-console/
├── app/                    # Next.js App Router pages
│   ├── (tabs)/            # Tab navigation pages
│   │   ├── home/
│   │   ├── report/
│   │   ├── search/
│   │   ├── log/
│   │   └── settings/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/            # React components
│   ├── ui/               # UI primitives
│   └── features/         # Feature components
├── lib/                   # Business logic
│   ├── domain/           # Domain layer
│   │   ├── entities/
│   │   ├── decision-trees/
│   │   ├── decision-engine/
│   │   └── services/
│   ├── infrastructure/   # Infrastructure layer
│   │   ├── db/
│   │   ├── ai/
│   │   ├── embeddings/
│   │   └── pdf/
│   └── stores/           # Zustand stores
├── __tests__/            # Test files
├── docs/                 # Documentation
├── public/               # Static assets
└── package.json
```

### Adding a New Decision Tree

1. `lib/domain/decision-trees/` に新しいファイルを作成
2. Decision Treeクラスを実装（input → Decision）
3. `lib/domain/decision-engine/index.ts` にルーティングを追加
4. `__tests__/` にテストを追加
5. ドキュメント更新

詳細は既存のDT-001を参照: `lib/domain/decision-trees/dt-001-illegal-move-standard.ts`

## Contributing

このプロジェクトは現在プライベート開発中です。

## License

Private - All Rights Reserved

## Support

Issues: https://github.com/moom98/ArbiterConsole/issues

## Acknowledgments

- **FIDE** - Laws of Chess
- **JCF** (Japan Chess Federation) - Japanese chess regulations
- **Digital Agency Design System** - UI components
- **Google** - Gemini API for AI-assisted reference information
