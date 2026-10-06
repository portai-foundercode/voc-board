import { existsSync } from "node:fs";
import { devVarsPath, missingDevVarsMessage } from "./lib/dev-vars";

// 第4回以降の verify が dev server 起動前に .dev.vars の有無を確認する
if (!existsSync(devVarsPath)) {
  console.error(`NG: ${missingDevVarsMessage}`);
  process.exitCode = 1;
}
