import { readFileSync } from "node:fs";
import { run, type Runner } from "./lib/lesson";

export const deployableLessonIds = ["04", "07", "08"] as const;

const wranglerConfigPath = "apps/app/wrangler.jsonc";
const dummyDatabaseId = "00000000-0000-0000-0000-000000000000";

// wrangler.jsonc はコメント付きなので、先頭階層の "name" と d1 の database_id だけを正規表現で読む
export function readWranglerConfig(text: string) {
  return {
    name: /^ {2}"name"\s*:\s*"([^"]*)"/m.exec(text)?.[1],
    databaseId: /"database_id"\s*:\s*"([^"]*)"/.exec(text)?.[1],
  };
}

export function checkDeployPreflight(workerName: string | undefined, configText: string) {
  const config = readWranglerConfig(configText);
  const errors: string[] = [];
  if (!workerName) {
    errors.push(
      "環境変数 VOC_WORKER_NAME がありません。運営から配布されたWorker名を指定してください（例: VOC_WORKER_NAME=<配布された名前> pnpm lesson:deploy 04）",
    );
  } else if (config.name !== workerName) {
    errors.push(
      `VOC_WORKER_NAME（${workerName}）と ${wranglerConfigPath} の name（${config.name ?? "未設定"}）が一致しません。他人のWorkerを上書きしないよう、デプロイを中止しました`,
    );
  }
  if (!config.databaseId || config.databaseId === dummyDatabaseId) {
    errors.push(
      `${wranglerConfigPath} の database_id がダミーのままです。運営から配布された値に書き換えてください`,
    );
  }
  return errors;
}

const wrangler = (...args: string[]) => ["--filter", "@voc-board/app", "exec", "wrangler", ...args];

export const deploySteps = [
  { label: "build", args: ["build"] },
  { label: "リモートD1のmigration", args: wrangler("d1", "migrations", "apply", "DB", "--remote") },
  {
    label: "リモートD1のseed",
    args: wrangler("d1", "execute", "DB", "--remote", "--file=seed.sql"),
  },
  { label: "デプロイ", args: wrangler("deploy") },
] as const;

export type DeployDependencies = {
  run: Runner;
  readConfig: () => string;
  env: Record<string, string | undefined>;
  report: (message: string) => void;
  announce: (message: string) => void;
};

const dependencies: DeployDependencies = {
  run,
  readConfig: () => readFileSync(wranglerConfigPath, "utf8"),
  env: process.env,
  report: console.error,
  announce: console.log,
};

export function runDeploy(argv: readonly string[], deps: DeployDependencies) {
  const id = deployableLessonIds.find((lessonId) => lessonId === argv[0]);
  if (argv.length !== 1 || !id) {
    deps.report(`NG: 講義番号は ${deployableLessonIds.join("、")} のいずれかを1つ指定してください`);
    return 1;
  }

  const errors = checkDeployPreflight(deps.env.VOC_WORKER_NAME, deps.readConfig());
  if (errors.length > 0) {
    for (const error of errors) deps.report(`NG: ${error}`);
    return 1;
  }

  for (const step of deploySteps) {
    deps.announce(`実行中: ${step.label}`);
    const result = deps.run("pnpm", step.args);
    if (result.status !== 0) {
      deps.report(`NG: ${step.label}`);
      return result.status;
    }
  }
  deps.announce(`OK: 第${Number(id)}回をデプロイしました`);
  return 0;
}

if (process.argv[1]?.endsWith("lesson-deploy.ts")) {
  process.exitCode = runDeploy(process.argv.slice(2), dependencies);
}
