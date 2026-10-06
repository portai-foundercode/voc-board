import { existsSync, readFileSync } from "node:fs";

export const devVarsPath = "apps/app/.dev.vars";

export const missingDevVarsMessage = `${devVarsPath} がありません。cp apps/app/.dev.vars.example ${devVarsPath} で作成してください`;

export function parseDevVars(text: string) {
  const vars: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) vars[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return vars;
}

export function readDevVars(path = devVarsPath) {
  if (!existsSync(path)) throw new Error(missingDevVarsMessage);
  return parseDevVars(readFileSync(path, "utf8"));
}
