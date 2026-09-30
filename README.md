# VoC Board

FOUNDER CODEで顧客フィードバック管理SaaSを段階的に作る演習プロジェクトです。第1回は外部サービスやデータを使わないシンプルなページで動きます。

## Prerequisites

mise、Git、Claude Code CLIを用意してください。`mise bootstrap` がNode.js 24.15.0とpnpm 10.11.1、依存関係、E2E用のChromiumを導入します。API key、password、実顧客データをsource、prompt、log、commitへ含めないでください。

## Setup and run

```bash
mise trust mise.toml
mise bootstrap
mise exec -- pnpm dev
```

Open http://localhost:3000.

初回だけmiseがリポジトリ設定の信頼を確認します。2回目以降は `mise bootstrap` を実行してください。

## 受講用リポジトリを作る

GitHubで `Use this template` を選び、VisibilityをPrivateにして自分のrepoを作成します。

```bash
git clone <作成したprivate repoのURL>
cd <cloneされたフォルダ>
```

作業は `main` ブランチのまま最後まで進めます。各回の演習が終わったらcommitしてください。

## 各回の進め方

```bash
mise exec -- pnpm lesson:doctor 01
mise exec -- pnpm dev
```

演習を完了したら、その回の番号で `lesson:verify` を実行します（第1回は `01`、第2回は `02`、第3回は `03`）。

```bash
mise exec -- pnpm lesson:verify 01
```

型検査、lint、format検査、通常test、その回のE2Eを順に実行し、すべて通れば完了です。通ったらcommitして次の回へ進みます。前の回が終わっていない場合は、その回の演習契約をClaude Codeへ渡して実装し、`lesson:verify` が通ってから進んでください。

## Quality

```bash
mise exec -- pnpm typecheck
mise exec -- pnpm lint
mise exec -- pnpm format:check
mise exec -- pnpm test
mise exec -- pnpm build
```
