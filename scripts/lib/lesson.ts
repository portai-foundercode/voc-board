import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

export const lessonIds = ["01", "02", "03"] as const;
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
    allowedDeletedPaths: [],
    allowedFetchPaths: [],
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
    allowedDeletedPaths: [],
    allowedFetchPaths: [],
    verifyCommands: [
      ...commonChecks,
      {
        label: "第2回の到達検証",
        command: "pnpm",
        args: ["--filter", "@voc-board/app", "test:lesson", "test/lesson-02.verify.test.tsx"],
      },
    ],
  },
  "03": {
    id: "03",
    startBranch: "checkpoint/03-start",
    completeBranch: "checkpoint/03-complete",
    allowedSourcePaths: [
      "mise.toml",
      "apps/app/src/api/app.ts",
      "apps/app/src/server.ts",
      "apps/app/src/db/database.ts",
      "apps/app/src/db/migrate.ts",
      "apps/app/src/db/seed.ts",
      "apps/app/src/db/migrations/001_initial.ts",
      "apps/app/src/domain/feedback.ts",
      "apps/app/src/repositories/feedback-repository.ts",
      "apps/app/src/api/feedback.ts",
      "apps/app/src/data/feedback-api.ts",
      "apps/app/src/routes/p/$projectSlug.tsx",
      "apps/app/src/routes/app/feedback/index.tsx",
      "apps/app/src/routes/app/feedback/$feedbackId.tsx",
      "apps/app/src/routeTree.gen.ts",
      "apps/app/src/data/mock-feedback.ts",
    ],
    allowedDeletedPaths: ["apps/app/src/data/mock-feedback.ts"],
    allowedFetchPaths: ["apps/app/src/data/feedback-api.ts"],
    verifyCommands: [
      ...commonChecks,
      { label: "build", command: "pnpm", args: ["build"] },
      {
        label: "第3回の到達検証",
        command: "pnpm",
        args: ["--filter", "@voc-board/app", "test:lesson", "test/lesson-03.verify.test.tsx"],
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
    throw new Error(
      "講義番号は 01、02、または 03 を1つ指定してください（例: pnpm lesson:verify 03）",
    );
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

const isDeclarationName = (node: ts.Identifier) => {
  const { parent } = node;
  return (
    ((ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isPropertyAssignment(parent)) &&
      parent.name === node) ||
    (ts.isBindingElement(parent) && (parent.propertyName === node || parent.name === node))
  );
};

const isFetchPropertyName = (node: ts.PropertyName | undefined) => {
  if (!node) return false;
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text === "fetch";
  return (
    ts.isComputedPropertyName(node) &&
    ts.isStringLiteralLike(node.expression) &&
    node.expression.text === "fetch"
  );
};

const destructuresFetch = (node: ts.VariableDeclaration) =>
  ts.isObjectBindingPattern(node.name) &&
  node.name.elements.some((element) =>
    element.propertyName
      ? isFetchPropertyName(element.propertyName)
      : ts.isIdentifier(element.name) && element.name.text === "fetch",
  );

const isDirectApiPath = (node: ts.Expression | undefined) => {
  if (!node) return false;
  const prefix = ts.isStringLiteralLike(node)
    ? node.text
    : ts.isTemplateExpression(node)
      ? node.head.text
      : undefined;
  return prefix?.startsWith("/api/") === true;
};

function analyzeBrowserFetch(source: string) {
  const sourceFile = ts.createSourceFile(
    "lesson-source.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let found = false;
  let unsafe = false;
  const mark = (isSameOrigin = false) => {
    found = true;
    if (!isSameOrigin) unsafe = true;
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "fetch"
    ) {
      mark(isDirectApiPath(node.arguments[0]));
      for (const argument of node.arguments) visit(argument);
      return;
    }
    if (ts.isVariableDeclaration(node) && destructuresFetch(node)) mark();
    if (ts.isPropertyAccessExpression(node) && node.name.text === "fetch") {
      mark();
      return;
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "fetch"
    ) {
      mark();
      return;
    }
    if (ts.isIdentifier(node) && node.text === "fetch") {
      if (!isDeclarationName(node)) {
        mark();
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { found, unsafe };
}

const browserCommunicationNames = new Set([
  "WebSocket",
  "XMLHttpRequest",
  "EventSource",
  "WebTransport",
  "sendBeacon",
]);
const nodeNetworkModules = new Set([
  "http",
  "https",
  "http2",
  "net",
  "tls",
  "dgram",
  "node:http",
  "node:https",
  "node:http2",
  "node:net",
  "node:tls",
  "node:dgram",
]);

const isNodeNetworkModule = (node: ts.Expression | undefined) =>
  node !== undefined && ts.isStringLiteralLike(node) && nodeNetworkModules.has(node.text);

const isCommunicationPropertyName = (node: ts.PropertyName | undefined) => {
  if (!node) return false;
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) {
    return browserCommunicationNames.has(node.text);
  }
  return (
    ts.isComputedPropertyName(node) &&
    ts.isStringLiteralLike(node.expression) &&
    browserCommunicationNames.has(node.expression.text)
  );
};

function analyzeOtherExternalCommunication(source: string) {
  const sourceFile = ts.createSourceFile(
    "lesson-source.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let found = false;
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      isNodeNetworkModule(node.moduleSpecifier)
    ) {
      found = true;
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ((node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        isNodeNetworkModule(node.arguments[0])) ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require" &&
          isNodeNetworkModule(node.arguments[0])))
    ) {
      found = true;
      return;
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      (browserCommunicationNames.has(node.name.text) ||
        (ts.isIdentifier(node.expression) &&
          (node.expression.text === "http" || node.expression.text === "https") &&
          (node.name.text === "request" || node.name.text === "get")))
    ) {
      found = true;
      return;
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      (browserCommunicationNames.has(node.argumentExpression.text) ||
        (ts.isIdentifier(node.expression) &&
          (node.expression.text === "http" || node.expression.text === "https") &&
          (node.argumentExpression.text === "request" || node.argumentExpression.text === "get")))
    ) {
      found = true;
      return;
    }
    if (
      ts.isBindingElement(node) &&
      isCommunicationPropertyName(
        node.propertyName ?? (ts.isIdentifier(node.name) ? node.name : undefined),
      )
    ) {
      found = true;
      return;
    }
    if (
      ts.isIdentifier(node) &&
      browserCommunicationNames.has(node.text) &&
      !isDeclarationName(node)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

export function findSourceViolations(source: string, allowSameOriginFetch = false) {
  const browserFetch = analyzeBrowserFetch(source);
  const issues =
    browserFetch.found && (!allowSameOriginFetch || browserFetch.unsafe) ? ["外部通信"] : [];
  if (analyzeOtherExternalCommunication(source) && !issues.includes("外部通信")) {
    issues.push("外部通信");
  }
  const forbidden: ReadonlyArray<readonly [RegExp, string]> = [
    [/\bprocess\.env\b/, "process.env"],
    [/\bimport\.meta\.env\b/, "import.meta.env"],
    [/(?:https?:\/\/|["'`]\s*\/\/[^/\s])/i, "外部URL"],
  ];
  return [
    ...issues,
    ...forbidden.filter(([pattern]) => pattern.test(source)).map(([, label]) => label),
  ];
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
  allowedDeletedPaths: readonly string[] = [],
  allowedFetchPaths: readonly string[] = [],
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
    if (change.status.startsWith("T")) {
      issues.push(`${change.paths[0]}: ファイル種別の変更は許可されていません`);
      continue;
    }
    if (change.status.startsWith("D") && allowedDeletedPaths.includes(change.paths[0] ?? "")) {
      continue;
    }
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
      for (const label of findSourceViolations(source, allowedFetchPaths.includes(path))) {
        issues.push(`${path}: ${label}`);
      }
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
      for (const label of findSourceViolations(readText(path), allowedFetchPaths.includes(path))) {
        issues.push(`${path}: ${label}`);
      }
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
