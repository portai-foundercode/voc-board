import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const lessonIds = ["01", "02"] as const;
export type LessonId = (typeof lessonIds)[number];

const commonChecks = [
  { label: "型検査", command: "pnpm", args: ["typecheck"] },
  { label: "lint", command: "pnpm", args: ["lint"] },
  { label: "format検査", command: "pnpm", args: ["format:check"] },
  { label: "通常test", command: "pnpm", args: ["test"] },
] as const;

export const lessons = {
  "01": {
    id: "01",
    startBranch: "checkpoint/01-start",
    completeBranch: "checkpoint/01-complete",
    allowedSourcePaths: ["apps/app/src/routes/index.tsx"],
    verifyCommands: [
      ...commonChecks,
      {
        label: "第1回の到達検証",
        command: "pnpm",
        args: ["--filter", "@voc-board/app", "test:lesson", "test/lesson-01.verify.test.tsx"],
      },
    ],
  },
  "02": {
    id: "02",
    startBranch: "checkpoint/02-start",
    completeBranch: "checkpoint/02-complete",
    allowedSourcePaths: [
      "apps/app/src/routes/index.tsx",
      "apps/app/src/routes/p/$projectSlug.tsx",
      "apps/app/src/routes/app/feedback/index.tsx",
      "apps/app/src/routes/app/feedback/$feedbackId.tsx",
      "apps/app/src/routes/pricing.tsx",
      "apps/app/src/components/navigation.tsx",
      "apps/app/src/data/mock-feedback.ts",
      "apps/app/src/routeTree.gen.ts",
    ],
    verifyCommands: [
      ...commonChecks,
      {
        label: "第2回の到達検証",
        command: "pnpm",
        args: ["--filter", "@voc-board/app", "test:lesson", "test/lesson-02.verify.test.tsx"],
      },
    ],
  },
} as const;

export type RunResult = {
  status: number;
  stdout: string;
  stderr: string;
  failedToStart?: boolean;
};
export type Runner = (
  command: string,
  args: readonly string[],
  options?: { capture?: boolean },
) => RunResult;

export const run: Runner = (command, args, options = {}) => {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
    failedToStart: result.error !== undefined,
  };
};

export function parseLessonId(argv: readonly string[]) {
  if (argv.length !== 1 || !lessonIds.some((lessonId) => lessonId === argv[0])) {
    throw new Error("講義番号は 01 または 02 を1つ指定してください（例: pnpm lesson:verify 01）");
  }
  return argv[0] as LessonId;
}

export function getLesson(id: string) {
  if (!lessonIds.some((lessonId) => lessonId === id)) {
    throw new Error(`未対応の講義番号です: ${id}`);
  }
  return lessons[id as LessonId];
}

export function resolveStartRef(lesson: ReturnType<typeof getLesson>, runner: Runner = run) {
  const refs = [
    { display: lesson.startBranch, ref: `refs/heads/${lesson.startBranch}` },
    { display: `origin/${lesson.startBranch}`, ref: `refs/remotes/origin/${lesson.startBranch}` },
  ];
  for (const candidate of refs) {
    const result = runner("git", ["show-ref", "--verify", "--quiet", candidate.ref], {
      capture: true,
    });
    if (result.status === 0) return candidate.display;
    if (result.status === 1 && !result.failedToStart) continue;
    throwGitError("開始checkpointの確認", result);
  }
  throw new Error("開始checkpointがありません。講師へリポジトリの復元を依頼してください。");
}

const splitNull = (value: string) => value.split("\0").filter(Boolean);

export function findSourceViolations(source: string) {
  const forbidden: ReadonlyArray<readonly [RegExp, string]> = [
    [/\bfetch\s*\(/, "外部通信"],
    [/\bprocess\.env\b/, "process.env"],
    [/\bimport\.meta\.env\b/, "import.meta.env"],
    [/https?:\/\//, "外部URL"],
  ];
  return forbidden.filter(([pattern]) => pattern.test(source)).map(([, label]) => label);
}

export function containsSecret(source: string) {
  return /(api[_-]?key|token|password|secret|database[_-]?url)\s*[:=]\s*["']?[^\s"']{8,}/i.test(
    source,
  );
}

const protectedPaths = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.base.json",
  "scripts",
  "apps/app/package.json",
  "apps/app/test",
  "apps/app/tsconfig.json",
  "apps/app/tsr.config.json",
  "apps/app/vite.config.ts",
  "apps/app/vitest.config.ts",
  "apps/app/vitest.lesson.config.ts",
  "apps/app/wrangler.jsonc",
  "apps/app/worker-configuration.d.ts",
] as const;

const isInDirectory = (path: string, directory: string) => path.startsWith(`${directory}/`);

const isTestPath = (path: string) =>
  /(^|\/)(?:test|tests?)\//.test(path) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);

const isConfigPath = (path: string) =>
  /(^|\/)(?:vite|vitest|tsr)\.config\.[cm]?[jt]s$/.test(path) ||
  /(^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(path) ||
  /(^|\/)pnpm-workspace\.yaml$/.test(path) ||
  /(^|\/)wrangler\.jsonc$/.test(path);

const isProtectedPath = (path: string) =>
  protectedPaths.some(
    (protectedPath) => path === protectedPath || isInDirectory(path, protectedPath),
  ) ||
  isTestPath(path) ||
  isConfigPath(path);

type ChangedPath = { status: string; paths: string[] };

function parseChangedPaths(value: string) {
  const tokens = splitNull(value);
  const changes: ChangedPath[] = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (!status) break;
    const pathCount = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
    const paths = tokens.slice(index, index + pathCount);
    if (paths.length !== pathCount) throw new Error("Git差分の読み取りに失敗しました。");
    index += pathCount;
    changes.push({ status, paths });
  }
  return changes;
}

function throwGitError(action: string, result: RunResult): never {
  const detail = result.stderr || `終了コード: ${result.status}`;
  throw new Error(`${action}でGitコマンドの実行に失敗しました: ${detail}`);
}

function addChangeIssue(issues: string[], path: string, allowedSourcePaths: readonly string[]) {
  if (isProtectedPath(path)) {
    issues.push(`${path}: 保護されたファイル`);
  } else if (path.startsWith("apps/app/src/") && !allowedSourcePaths.includes(path)) {
    issues.push(`${path}: 許可されていないsourceの変更`);
  } else if (!allowedSourcePaths.includes(path)) {
    issues.push(`${path}: 許可されていない変更`);
  }
}

export function verifyLessonSafety(
  startRef: string,
  allowedSourcePaths: readonly string[],
  runner: Runner = run,
  readText: (path: string) => string = (path) => readFileSync(path, "utf8"),
) {
  const issues: string[] = [];
  const changed = runner(
    "git",
    ["diff", "--relative", "--name-status", "-z", "--find-renames", startRef, "--", "."],
    { capture: true },
  );
  if (changed.status !== 0) throwGitError("開始checkpointとの差分確認", changed);

  const changes = parseChangedPaths(changed.stdout);
  if (changes.some((change) => change.paths.some(isProtectedPath))) {
    issues.push("依存関係または検証ファイルが開始時点から変更されています");
  }

  for (const change of changes) {
    if (change.status.startsWith("D") || change.status.startsWith("R")) {
      issues.push(`${change.paths.join(" → ")}: ファイルの削除または名前変更は許可されていません`);
      continue;
    }
    const path = change.paths.at(-1);
    if (!path) continue;
    addChangeIssue(issues, path, allowedSourcePaths);
    if (
      allowedSourcePaths.includes(path) &&
      (change.status.startsWith("A") || change.status.startsWith("M"))
    ) {
      const source = readText(path);
      for (const label of findSourceViolations(source)) issues.push(`${path}: ${label}`);
      if (containsSecret(source)) issues.push(`${path}: 秘密情報の可能性`);
    }
  }

  const untracked = runner("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    capture: true,
  });
  if (untracked.status !== 0) throwGitError("管理外ファイルの確認", untracked);

  for (const path of splitNull(untracked.stdout)) {
    addChangeIssue(issues, path, allowedSourcePaths);
    if (allowedSourcePaths.includes(path)) {
      for (const label of findSourceViolations(readText(path))) issues.push(`${path}: ${label}`);
    }
  }

  const ignoredSecrets = runner(
    "git",
    [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "-z",
      "--",
      ".env*",
      ".dev.vars*",
      "apps/app/.env*",
      "apps/app/.dev.vars*",
      "*.local",
      "apps/app/*.local",
    ],
    { capture: true },
  );
  if (ignoredSecrets.status !== 0) throwGitError("ignored環境変数ファイルの確認", ignoredSecrets);
  for (const path of new Set([
    ...splitNull(untracked.stdout),
    ...splitNull(ignoredSecrets.stdout),
  ])) {
    const source = readText(path);
    if (!source.includes("\0") && containsSecret(source)) issues.push(`${path}: 秘密情報の可能性`);
  }
  return issues;
}
