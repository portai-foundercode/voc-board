import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const directory = mkdtempSync(join(tmpdir(), "voc-lint-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

// 実際の .oxlintrc.json のルール設定を、fixtureへ適用できる形に変換して使う
const config = JSON.parse(readFileSync(join(root, ".oxlintrc.json"), "utf8")) as {
  jsPlugins: string[];
  overrides: { files: string[]; rules: object }[];
};
writeFileSync(
  join(directory, "oxlintrc.json"),
  JSON.stringify({
    jsPlugins: config.jsPlugins.map((plugin) => resolve(root, plugin)),
    overrides: config.overrides.map((override) => ({ ...override, files: ["**/*.ts"] })),
  }),
);

let count = 0;
function findings(source: string) {
  const file = join(directory, `case-${count++}.ts`);
  writeFileSync(file, source);
  let output: string;
  try {
    output = execFileSync(
      join(root, "node_modules/.bin/oxlint"),
      ["-c", join(directory, "oxlintrc.json"), "--format", "json", file],
      { encoding: "utf8" },
    );
  } catch (error) {
    output = (error as { stdout: string }).stdout;
  }
  return (JSON.parse(output) as { diagnostics: { code: string }[] }).diagnostics.map(
    (diagnostic) => diagnostic.code,
  );
}

describe.each([
  {
    rule: "voc(no-external-url)",
    bad: [
      'export const url = "https://example.com/api";',
      'export const url = "http://example.com";',
      'export const url = "//cdn.example.com/a.js";',
      "export const url = `https://example.com`;",
    ],
    good: [
      'export const url = "/api/projects/acme/feedback";',
      'export const label = "詳細は https://example.com を参照";',
      'export const path = "//";',
    ],
  },
  {
    rule: "voc(no-hardcoded-secret)",
    bad: [
      'export const apiKey = "abcdefgh1234";',
      'export const config = { password: "hunter2hunter2" };',
      'let token = ""; token = "abcdefgh1234"; export { token };',
      'export const DATABASE_URL = "libsql-file-name";',
    ],
    good: [
      'export const apiKey = "short";',
      'export const passwordLabel = "パスワードを入力してください";',
      'export const title = "abcdefgh1234";',
      "export const apiKey = process_value;\ndeclare const process_value: string;",
    ],
  },
  {
    rule: "voc(no-env-access)",
    bad: ["export const a = process.env.API_KEY;", "export const b = import.meta.env.MODE;"],
    good: ["export const a = { env: 1 }.env;", "export const b = import.meta.url;"],
  },
  {
    rule: "voc(no-direct-communication)",
    bad: [
      'export const net = require("node:net");',
      'export const http = require("https");',
      'navigator.sendBeacon("/api/log");',
    ],
    good: ['export const fs = require("node:fs");', 'export const response = fetch("/api/x");'],
  },
  {
    rule: "eslint(no-restricted-imports)",
    bad: [
      'import http from "node:http";\nexport { http };',
      'import https from "https";\nexport { https };',
      'import { createConnection } from "node:net";\nexport { createConnection };',
    ],
    good: ['import { readFile } from "node:fs";\nexport { readFile };'],
  },
  {
    rule: "eslint(no-restricted-globals)",
    bad: [
      'export const socket = new WebSocket("/ws");',
      "export const request = new XMLHttpRequest();",
      'export const source = new EventSource("/events");',
    ],
    good: ["export const response = fetch;"],
  },
])("$rule", ({ rule, bad, good }) => {
  it.each(bad)("detects %s", (source) => {
    expect(findings(source)).toContain(rule);
  });

  it.each(good)("allows %s", (source) => {
    expect(findings(source)).not.toContain(rule);
  });
});
