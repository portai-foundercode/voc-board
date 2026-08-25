# VoC Board

FOUNDER CODEで顧客フィードバック管理SaaSを段階的に作る演習プロジェクトです。第1回は外部サービスやデータを使わないシンプルなページで動きます。

## Prerequisites

mise、Git、Claude Code CLIを用意してください。`mise bootstrap` がNode.js 24.15.0とpnpm 10.11.1を導入します。API key、password、実顧客データをsource、prompt、log、commitへ含めないでください。

## Setup and run

```bash
mise trust mise.toml
mise bootstrap
mise exec -- pnpm dev
```

Open http://localhost:3000.

初回だけmiseがリポジトリ設定の信頼を確認します。2回目以降は `mise bootstrap` を実行してください。

## 受講用リポジトリを作る

GitHubで `Use this template` を選び、VisibilityをPrivate、`Include all branches` を有効にして自分のrepoを作成します。

```bash
git clone <作成したprivate repoのURL>
cd <cloneされたフォルダ>
git switch -c work/lesson-01 checkpoint/01-start
```

## 第1回

```bash
mise exec -- pnpm lesson:doctor 01
mise exec -- pnpm dev
```

演習を完了したら `mise exec -- pnpm lesson:verify 01` を実行します。

## 第2回

第2回のstart snapshotから始める場合は、Lesson 1を完了した状態の画面と検証基盤を利用します。

```bash
git switch -c work/lesson-02 checkpoint/02-start
mise trust mise.toml
mise bootstrap
mise exec -- pnpm lesson:doctor 02
mise exec -- pnpm dev
```

演習を完了したら `mise exec -- pnpm lesson:verify 02` を実行します。

## 第3回

第3回では、認証情報不要のローカルlibSQLファイルへフィードバックを保存します。

```bash
git switch -c work/lesson-03 checkpoint/03-start
mise trust mise.toml
mise bootstrap
mise exec -- pnpm lesson:doctor 03
mise exec -- pnpm dev
```

DBの初期化は `mise exec -- pnpm --filter @voc-board/app db:setup` で行います。演習を完了したら `mise exec -- pnpm lesson:verify 03` を実行します。

## Quality

```bash
mise exec -- pnpm typecheck
mise exec -- pnpm lint
mise exec -- pnpm format:check
mise exec -- pnpm test
mise exec -- pnpm build
```
