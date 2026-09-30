import { getLesson, parseLessonId, run, type Runner } from "./lib/lesson";

type Lesson = ReturnType<typeof getLesson>;

export type VerifyDependencies = {
  run: Runner;
  report: (message: string) => void;
  announce: (message: string) => void;
};

const dependencies: VerifyDependencies = {
  run,
  report: console.error,
  announce: console.log,
};

export function runLessonVerification(
  lesson: Lesson,
  { run: runner, report, announce }: VerifyDependencies,
) {
  for (const check of lesson.verifyCommands) {
    announce(`確認中: ${check.label}`);
    const result = runner(check.command, check.args);
    if (result.status !== 0) {
      report(`NG: ${check.label}`);
      return result.status;
    }
    announce(`OK: ${check.label}`);
  }
  announce(`OK: 第${Number(lesson.id)}回の完了条件を満たしています`);
  return 0;
}

export function main(argv = process.argv.slice(2), deps = dependencies) {
  try {
    return runLessonVerification(getLesson(parseLessonId(argv)), deps);
  } catch (error) {
    deps.report(`NG: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (process.argv[1]?.endsWith("lesson-verify.ts")) process.exitCode = main();
