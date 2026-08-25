import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { getLesson, parseLessonId, resolveStartRef, run, type Runner } from "./lib/lesson";

type Check = { label: string; ok: boolean; recovery: string };
type Lesson = ReturnType<typeof getLesson>;

export type PortServer = {
  once: (event: "error", listener: () => void) => PortServer;
  listen: (port: number, host: string, listener: () => void) => PortServer;
  close: (listener: () => void) => PortServer;
};

export type CreatePortServer = () => PortServer;

export function isPortAvailable(
  port: number,
  createPortServer: CreatePortServer = createServer as CreatePortServer,
) {
  return new Promise<boolean>((resolve) => {
    const server = createPortServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

export function isSupportedNodeVersion(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  if (major >= 26) return true;
  if (major === 22) return minor > 22 || (minor === 22 && patch >= 2);
  return major === 24 && minor >= 15;
}

export type DoctorDependencies = {
  existsSync: (path: string) => boolean;
  readText: (path: string) => string;
  run: Runner;
  isPortAvailable: (port: number) => Promise<boolean>;
  resolveStartRef: (lesson: Lesson) => string;
  nodeVersion: string;
  report: (message: string) => void;
};

const dependencies: DoctorDependencies = {
  existsSync,
  readText: (path) => readFileSync(path, "utf8"),
  run,
  isPortAvailable,
  resolveStartRef,
  nodeVersion: process.versions.node,
  report: console.log,
};

export async function runDoctor(argv: readonly string[], deps: DoctorDependencies) {
  let lesson;
  try {
    lesson = getLesson(parseLessonId(argv));
  } catch (error) {
    deps.report(`NG: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const checks: Check[] = [];
  let packageName: string | undefined;
  let malformedPackage = false;
  if (deps.existsSync("package.json")) {
    try {
      packageName = (JSON.parse(deps.readText("package.json")) as { name?: string }).name;
    } catch {
      malformedPackage = true;
    }
  }
  checks.push({
    label: "VoC Boardのルート",
    ok: packageName === "voc-board",
    recovery: malformedPackage
      ? "package.json が壊れています。講師へstarterの復元を依頼してください"
      : "cloneしたVoC Boardフォルダへ移動してください",
  });
  checks.push({
    label: "Gitリポジトリ",
    ok: deps.run("git", ["rev-parse", "--is-inside-work-tree"], { capture: true }).status === 0,
    recovery: "GitHubから演習リポジトリをcloneしてください",
  });
  for (const command of ["node", "pnpm", "git", "claude"]) {
    checks.push({
      label: `${command} command`,
      ok: deps.run(command, ["--version"], { capture: true }).status === 0,
      recovery:
        command === "claude"
          ? "Claude Codeの公式導入手順を確認してください"
          : `${command}をインストールしてください`,
    });
  }
  checks.push({
    label: "Node.js version",
    ok: isSupportedNodeVersion(deps.nodeVersion),
    recovery: "Node.jsを ^22.22.2、^24.15.0、または26以上へ更新してください",
  });
  for (const path of ["node_modules", "apps/app/src/routes/index.tsx", "apps/app/package.json"]) {
    checks.push({
      label: path,
      ok: deps.existsSync(path),
      recovery:
        path === "node_modules"
          ? "mise bootstrap を実行してください"
          : "講師へstarterの復元を依頼してください",
    });
  }
  checks.push({
    label: "port 3000",
    ok: await deps.isPortAvailable(3000),
    recovery: "以前起動したdev serverを停止してください",
  });
  try {
    deps.resolveStartRef(lesson);
    checks.push({ label: "開始checkpoint", ok: true, recovery: "" });
  } catch {
    checks.push({
      label: "開始checkpoint",
      ok: false,
      recovery:
        "private repoをtemplateから作り直してください（Include all branchesを有効にし、作業中の変更は別フォルダへ退避）",
    });
  }

  for (const check of checks) {
    deps.report(
      `${check.ok ? "OK" : "NG"}: ${check.label}${check.ok ? "" : ` — ${check.recovery}`}`,
    );
  }
  return checks.every((check) => check.ok) ? 0 : 1;
}

export async function main(argv = process.argv.slice(2), deps = dependencies) {
  return runDoctor(argv, deps);
}

if (process.argv[1]?.endsWith("lesson-doctor.ts")) process.exitCode = await main();
