import {
  getLesson,
  parseLessonId,
  resolveStartRef,
  run,
  type Runner,
  verifyLessonSafety,
} from "./lib/lesson";

type Lesson = ReturnType<typeof getLesson>;

export type VerifyDependencies = {
  run: Runner;
  resolveStartRef: (lesson: Lesson) => string;
  verifyLessonSafety: (startRef: string) => string[];
  report: (message: string) => void;
  announce: (message: string) => void;
};

const dependencies: VerifyDependencies = {
  run,
  resolveStartRef,
  verifyLessonSafety,
  report: console.error,
  announce: console.log,
};

export function runLessonVerification(
  lesson: Lesson,
  {
    run: runner,
    resolveStartRef: resolve,
    verifyLessonSafety: verify,
    report,
    announce,
  }: VerifyDependencies,
) {
  const issues = verify(resolve(lesson));
  if (issues.length > 0) {
    for (const issue of issues) report(`NG: ${issue}`);
    return 1;
  }

  for (const check of lesson.verifyCommands) {
    announce(`確認中: ${check.label}`);
    const result = runner(check.command, check.args);
    if (result.status !== 0) {
      report(`NG: ${check.label}`);
      return result.status;
    }
    announce(`OK: ${check.label}`);
  }
  announce("OK: 第1回の完了条件を満たしています");
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
