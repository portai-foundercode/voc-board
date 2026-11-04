import { spawnSync } from "node:child_process";

export const lessonIds = ["01", "02", "03", "04", "05", "06", "07", "08"] as const;
export type LessonId = (typeof lessonIds)[number];

const qualityChecks = [
  { label: "型検査", command: "pnpm", args: ["typecheck"] },
  { label: "lint", command: "pnpm", args: ["lint"] },
  { label: "format検査", command: "pnpm", args: ["format:check"] },
  { label: "通常test", command: "pnpm", args: ["test"] },
] as const;

const e2eCheck = (id: LessonId) => ({
  label: `第${Number(id)}回のE2E`,
  command: "pnpm",
  args: ["exec", "playwright", "test", `e2e/lesson-${id}.spec.ts`],
});

const buildCheck = { label: "build", command: "pnpm", args: ["build"] } as const;

const databaseChecks = [
  buildCheck,
  { label: "DBリセット", command: "pnpm", args: ["--filter", "@voc-board/app", "db:reset"] },
] as const;

const devVarsCheck = {
  label: ".dev.vars",
  command: "pnpm",
  args: ["exec", "tsx", "scripts/check-dev-vars.ts"],
} as const;

export const lessons = {
  "01": { id: "01", verifyCommands: [...qualityChecks, e2eCheck("01")] },
  "02": { id: "02", verifyCommands: [...qualityChecks, e2eCheck("02")] },
  // 第3・4回のE2Eは毎回別の投稿を作るので、DBを空に戻さずに判定する（DBの作り方を受講者に指定しないため）
  "03": { id: "03", verifyCommands: [...qualityChecks, buildCheck, e2eCheck("03")] },
  "04": {
    id: "04",
    verifyCommands: [devVarsCheck, ...qualityChecks, buildCheck, e2eCheck("04")],
  },
  "05": {
    id: "05",
    verifyCommands: [devVarsCheck, ...qualityChecks, ...databaseChecks, e2eCheck("05")],
  },
  "06": {
    id: "06",
    verifyCommands: [devVarsCheck, ...qualityChecks, ...databaseChecks, e2eCheck("06")],
  },
  "07": {
    id: "07",
    verifyCommands: [devVarsCheck, ...qualityChecks, ...databaseChecks, e2eCheck("07")],
  },
  "08": {
    id: "08",
    verifyCommands: [devVarsCheck, ...qualityChecks, ...databaseChecks, e2eCheck("08")],
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
  const spawnOptions = {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  } as const;
  // Windows では pnpm などが .cmd として入っていることがあり、シェル経由でないと起動できない
  const result =
    process.platform === "win32"
      ? spawnSync([command, ...args].join(" "), { ...spawnOptions, shell: true })
      : spawnSync(command, [...args], spawnOptions);

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
    failedToStart: result.error !== undefined,
  };
};

export function parseLessonId(argv: readonly string[]) {
  const id = lessonIds.find((lessonId) => lessonId === argv[0]);
  if (argv.length !== 1 || !id) {
    throw new Error(
      "講義番号は 01、02、03、04、05、06、07、08 のいずれかを1つ指定してください（例: pnpm lesson:verify 01）",
    );
  }
  return id;
}

export function getLesson(id: LessonId) {
  return lessons[id];
}
