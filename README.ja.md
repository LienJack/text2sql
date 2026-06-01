# Text2SQL

[English](README.md) | [简体中文](README.zh-CN.md) | 日本語

Text2SQL は、企業のデータ分析 QA シナリオに向けたフルスタックの学習・デモプロジェクトです。自然言語の質問を、ガバナンス可能で、実行可能で、再生可能な SQL に変換し、データソース接続、セマンティック知識、権限ガバナンス、実行証跡、フロントエンド体験を 1 本のワークフローとしてつなぎます。

![Text2SQL プラットフォーム概要](assets/readme-platform-overview.png)

## プロジェクト背景

業務チームは「何を聞きたいか」は分かっていても、そのデータがどのテーブルにあるのか、指標定義が何か、SQL をどう書くべきかまでは把握していないことがよくあります。質問をそのまま LLM に渡すだけでも十分ではありません。モデルはスキーマを誤って推測し、業務用語の文脈を欠き、テーブル権限を自然に守れず、なぜその SQL が生成されたのかを説明しにくいからです。

このプロジェクトは、SQL を生成するだけの Prompt demo ではありません。実運用に近い制約を前提にした Text2SQL プラットフォームのプロトタイプです。

- ユーザーはデータソースを起点に質問し、システムはセッション、ワークスペース、データ権限を紐付けます。
- Agent は SQL 生成前に schema、用語、過去サンプル、セマンティック資産を検索します。
- 生成された SQL は read-only、安全性、権限、方言、実行チェックを通過する必要があります。
- 各実行には `runId` があり、trace、RAG evidence、delivery artifact、replay を追跡できます。
- フロントエンドとバックエンドは共有型と SSE プロトコルによって、同期レスポンス、ストリーミング、実行詳細の契約を揃えます。

## 解決する課題

1. **自然言語と SQL のコンテキスト差分**
   ユーザーは「売上」「アクティブ顧客」「直近 30 日のトレンド」と話しますが、データベースにはテーブル、カラム、外部キー、指標、業務用語があります。このプロジェクトは RAG、semantic spine、glossary、modeling workspace によって、SQL 生成前の証跡として文脈を整えます。

2. **制御しづらい LLM 生成**
   Text2SQL v2 runtime は明示的な LangGraph オーケストレーションを使います。intake、retrieve、assemble-context、semantic-plan、generate-sql、validate、correct、execute、answer を観測可能な段階として分け、すべてを 1 つの Prompt に押し込めません。

3. **データ権限と安全な実行**
   クエリは「動く」だけでは不十分です。システムは workspace datasource binding、table-permissions、policyVersion をガバナンスの主軸とし、不確実、未承認、安全に解析できない場合は fail-closed に倒します。

4. **障害診断の難しさ**
   すべての分析実行は `runId` を中心に証跡を保存します。同期レスポンス、stream finish、run view、RAG replay は同じ delivery contract を参照し、RAG ヒット、SQL 生成、修正、実行、フロントエンド表示を振り返りやすくします。

5. **複数データソースのデモ閉ループ**
   SQLite、MySQL、PostgreSQL、CSV、Excel に対応し、`/data-sources`、`/chat`、`/settings`、`/modeling` などのフロントエンドワークベンチでデモと拡張を続けられます。

## 機能プレビュー

### セマンティックモデリングワークベンチ

![セマンティックモデリングワークベンチ](assets/screenshots/01-modeling-erd-workbench.png)

データ関係図は、物理テーブル構造を運用可能なセマンティック資産へ引き上げます。左側は Models / Views の資産ツリー、中央は ERD キャンバス、右側では選択モデルのフィールド、リレーション、プレビュー文脈を確認できます。ユーザーはデータベース同期、自動レイアウト、リレーション管理、Modeling Draft 保存を行い、チェック通過後に active 版として公開できます。

### データソース接続ウィザード

![データソース接続ウィザード](assets/screenshots/02-datasource-create-wizard.png)

データソースページは、データベースやファイルをワークスペースに接続します。ウィザードは CSV、Excel、SQLite、MySQL、PostgreSQL に対応します。作成または編集時には現在のワークスペースに自動で紐付き、idempotency key により重複送信を防ぎます。作成後はそのまま分析会話を開始することも、テーブル選択やモデリング初期化に進むこともできます。

### ChatBI ワークベンチ

![ChatBI ワークベンチ](assets/screenshots/03-chat-answer-result.png)

Chat ページは自然言語分析のメイン入口です。各セッションはデータソースとモデル設定に紐付き、サイドバーはデータソースごとに履歴セッションを分離します。メイン領域にはユーザー質問、Agent の実行段階、最終回答、テーブル証跡、Save as View の入口が表示されます。回答は単なるテキストではなく、`validation`、実行サマリ、artifact を含む構造化された delivery result です。

### SQL 証跡リプレイ

![SQL 証跡リプレイ](assets/screenshots/04-chat-sql-evidence.png)

同じ ChatBI 結果から SQL 証跡タブに切り替え、回答生成に使われた SQL を確認できます。このビューは人による検証、デバッグリプレイ、ガバナンス監査に役立ちます。ユーザーは生成されたクエリ、ソート、集約、フィールド選択が業務期待と合っているかを確認できます。

### チャート結果

![チャート結果](assets/screenshots/05-chat-chart-result.png)

結果 artifact はチャートとしても投影できます。この例では支払い方法の比率をグラフ表示しています。Answer、View SQL、Chart は同じ実行証跡を共有するため、テキスト回答、SQL、可視化の結果がずれることを避けられます。

## 設計思想

- **生成より先に証跡を整える**：SQL 生成前に schema、用語、リレーション、権限、過去例を typed context として構成します。
- **Prompt 連結よりグラフオーケストレーション**：重要な段階は runtime node として存在し、観測、テスト、ストリーミング投影、局所的な差し替えがしやすくなります。
- **ガバナンスを主経路に組み込む**：workspace、datasource、table-permissions、安全検証は後付けではなくワークフローの一部です。
- **黙って劣化しない実用性**：RAG lane は個別に timeout や degrade できますが、その理由は evidence に記録されます。
- **有界な修正ループ**：SQL 修正は予算付きの閉ループであり、無制限の agent retry を避けます。
- **安定した契約**：shared-types と chat-stream-protocol がフロントエンドとバックエンドの境界を担い、sync、stream、replay のずれを抑えます。

## アーキテクチャ設計

### Monorepo 構成

```text
apps/backend                  NestJS API、Text2SQL runtime、ガバナンス、知識、プラットフォーム機能
apps/frontend                 Next.js フロントエンドワークベンチ
packages/shared-types         フロントエンド/バックエンド共有型
packages/chat-stream-protocol SSE envelope、parser、terminal guard、UI projection helpers
infra                         PostgreSQL、Redis、Nginx のローカル編成
data                          ローカルアップロード、SQLite、実行時データ
docs                          ソリューション、標準、トラブルシュート、理解ドキュメント
```

### システム概要

```mermaid
flowchart LR
  User["Browser"] --> Gateway["Nginx gateway<br/>localhost:3000"]
  Gateway --> Frontend["Frontend<br/>Next.js :3001"]
  Gateway --> Backend["Backend<br/>NestJS :3002"]

  Backend --> Conversation["conversation<br/>chat + text2sql + delivery"]
  Backend --> Governance["governance<br/>workspace + datasource + table-permissions"]
  Backend --> Knowledge["knowledge<br/>RAG + glossary + semantic spine + graph"]
  Backend --> Platform["platform<br/>persistence + query + cache + config + observability"]

  Conversation --> Governance
  Conversation --> Knowledge
  Conversation --> Platform
  Governance --> Platform
  Knowledge --> Platform

  Platform --> Postgres["PostgreSQL"]
  Platform --> Redis["Redis"]
  Platform --> Datasources["SQLite / MySQL / PostgreSQL / CSV / Excel"]
```

### バックエンドの 4 つの能力ドメイン

| ドメイン | ディレクトリ | 役割 |
| --- | --- | --- |
| `conversation` | `apps/backend/src/modules/conversation` | 会話入口、Text2SQL workflow、LangGraph runtime、delivery contract |
| `governance` | `apps/backend/src/modules/governance` | ワークスペース、データソース紐付け、テーブル権限、ユーザー、設定ガバナンス |
| `knowledge` | `apps/backend/src/modules/knowledge` | RAG 検索、セマンティック資産、用語、メモリ、グラフ、モデリング文脈 |
| `platform` | `apps/backend/src/modules/platform` | 永続化、クエリ実行、キャッシュ、設定、観測、read-model guard |

クロスドメイン依存は次の方向に制限されています。

```text
conversation -> governance | knowledge | platform
governance   -> platform
knowledge    -> platform
platform     -> no business-domain dependency
```

### Text2SQL v2 ランタイム

現在の主経路は次の通りです。

```text
Text2SQLWorkflowRunner
  -> RunV2LangGraphStage
  -> Text2SqlV2LangGraphRunnerService
```

1 回の分析質問は、おおむね次のライフサイクルを通ります。

```mermaid
flowchart TD
  A["intake<br/>質問タイプとリスクを識別"] --> B{"route"}
  B -- "text_to_sql / metadata" --> C["retrieve<br/>RAG 検索"]
  B -- "general / unsafe / unsupported" --> I["answer"]
  C --> D["assemble-context<br/>selected context を構成"]
  D --> E["semantic-plan<br/>セマンティック計画とルーティング"]
  E -- "ready" --> F["generate-sql"]
  E -- "clarify / direct answer / fail closed" --> I
  F --> G["validate<br/>read-only、安全、権限、方言、dry-run"]
  G -- "pass" --> H["execute"]
  G -- "correctable" --> J["correct"]
  G -- "terminal" --> I
  J -- "retry_generation" --> F
  J -- "terminal" --> I
  H --> I["answer<br/>delivery + evidence + artifact"]
```

### RAG とセマンティックコンテキスト

RAG は単なるテキスト連結ではありません。現在の設計では次を重視しています。

- manifest-first semantic asset preparation
- lexical、dense、graph の 3 つの retrieval lane
- fusion と rerank より前に権限フィルタリング
- RRF fusion と 2 段階 rerank
- `selected_context`、`degradeReasons`、`riskTags` を実行証跡へ記録
- `runId` が trace、delivery、replay を貫通

## インストールと起動

### 必要環境

- Node.js 20 または互換バージョン
- pnpm 10.x。このリポジトリは `pnpm@10.33.0` を宣言しています
- Docker と Docker Compose

### 1. 依存関係をインストール

```bash
pnpm install
```

### 2. ローカル基盤を起動

```bash
docker compose -f infra/docker-compose.yml up -d
```

このコマンドは次を起動します。

- Nginx gateway: `http://localhost:3000`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

### 3. 環境変数を初期化

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
```

バックエンドの主要設定は `apps/backend/.env` にあります。

- `PORT=3002`
- `POSTGRES_HOST/POSTGRES_PORT/POSTGRES_DB/POSTGRES_USER/POSTGRES_PASSWORD`
- `REDIS_URL=redis://localhost:6379`
- `LLM_PROVIDER`、`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`
- `EMBEDDING_PROVIDER`、`EMBEDDING_BASE_URL`、`EMBEDDING_API_KEY`、`EMBEDDING_MODEL`
- `RERANK_*` は任意で、未設定の場合は LLM provider 設定にフォールバックできます

フロントエンドはデフォルトで同一オリジンの `/api` を使うため、通常 `NEXT_PUBLIC_API_BASE_URL` を変更する必要はありません。

### 4. Prisma を準備

```bash
pnpm --filter @text2sql/backend run prisma:generate
pnpm --filter @text2sql/backend exec node scripts/prisma-with-database-url.cjs migrate deploy
```

空のデータベースから migration を完全に再生できるか検証する場合は、独立したテスト DB で実行します。

```bash
DATABASE_URL=postgresql://admin:admin@localhost:5432/text2sql_ci \
pnpm --filter @text2sql/backend run prisma:verify-empty-db
```

### 5. フロントエンドとバックエンドを起動

```bash
pnpm dev
```

デフォルト URL:

- 統一入口: `http://localhost:3000`
- データソース入口: `http://localhost:3000/data-sources`
- フロントエンド直接デバッグ: `http://localhost:3001`
- バックエンド health check: `http://localhost:3002/health`

### 6. クイック smoke

```bash
node tests/smoke/nginx-dev-gateway-smoke.mjs
```

## よく使うワークフロー

### データソースから質問まで

1. `http://localhost:3000/data-sources` を開く
2. SQLite、MySQL、PostgreSQL、CSV、Excel のデータソースを作成または選択する
3. 現在の workspace に紐付け、セッションに入る
4. `/chat` で自然言語の質問を入力する
5. 回答、SQL、実行結果、デバッグ証跡を確認する

### 設定とガバナンス

- `/settings`: LLM model、RAG configuration、RAG run、system users などの設定入口
- `/glossary`: 業務用語の管理
- `/modeling`: データソースモデリング、リレーション、セマンティックビュー
- `/prompts`: プロンプトテンプレート管理

## 品質ゲート

リポジトリ全体:

```bash
pnpm run format:check
pnpm run test
pnpm run build
```

バックエンド:

```bash
pnpm --filter @text2sql/backend run lint
pnpm --filter @text2sql/backend run test
pnpm --filter @text2sql/backend run build
pnpm --filter @text2sql/backend run prisma:verify-empty-db
```

フロントエンド:

```bash
pnpm --filter @text2sql/frontend run lint
pnpm --filter @text2sql/frontend run test
pnpm --filter @text2sql/frontend run build
```

専用ゲート:

```bash
pnpm run governance:terminology:check
pnpm run backend:capability-boundary:check
pnpm run text2sql:no-legacy-compat:check
pnpm --filter @text2sql/backend run collect:text2sql-v2-eval-gate
pnpm --filter @text2sql/backend run collect:text2sql-v2-focused-coverage-gate
pnpm --filter @text2sql/backend run collect:modeling-parity-shadow-gate
```

## 重要なルール

- Prisma の構造変更は必ず `apps/backend/prisma/schema.prisma` から始め、migration は Prisma CLI で生成します。
- `apps/backend/prisma/migrations/*/migration.sql` を手書きまたは手動編集してはいけません。
- テーブル構造変更後は `pnpm --filter @text2sql/backend run prisma:generate` を実行します。
- フロントエンドのインタラクティブコントロールは、shadcn-ui とプロジェクト内の業務ラッパーを優先して再利用します。
- ガバナンスの active narrative は `workspace datasource binding`、`table-permissions`、`policyVersion` のみを使います。

## 詳細ドキュメント

- `AGENTS.md`: リポジトリ実行入口、ハード境界、品質ゲート
- `docs/text2sql-architecture-and-flow-2026-04-29.md`: 現在のアーキテクチャと Text2SQL メインフロー
- `docs/rag-understanding/text2sql-rag-end-to-end-understanding.md`: Text2SQL + RAG のエンドツーエンド解説
- `docs/rag-understanding/text2sql-rag-runid-replay-handbook.md`: runId replay と診断
- `docs/rag-understanding/text2sql-rag-local-learning-lab.md`: ローカル学習ラボ
- `docs/standards/backend-prisma-migration-spec.md`: Prisma migration standard
- `docs/standards/frontend-react-shadcn-spec.md`: frontend React + shadcn standard
- `docs/standards/llm-stream-tool-migration-spec.md`: LLM stream と tool calling migration standard
- `docs/standards/governance-terminology-spec.md`: governance terminology hard-cut standard
- `docs/standards/backend-business-capability-topology-spec.md`: backend capability topology standard
