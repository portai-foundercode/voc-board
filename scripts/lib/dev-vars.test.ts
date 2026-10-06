import { describe, expect, it } from "vitest";
import { parseDevVars, readDevVars } from "./dev-vars";

describe("parseDevVars", () => {
  it("reads KEY=VALUE lines and ignores comments and blanks", () => {
    expect(parseDevVars("# comment\n\nA=1\n B = two \nC=\"three\"\nD='four'\n")).toEqual({
      A: "1",
      B: "two",
      C: "three",
      D: "four",
    });
  });
});

describe("readDevVars", () => {
  it("explains how to create a missing .dev.vars in Japanese", () => {
    expect(() => readDevVars("does-not-exist/.dev.vars")).toThrow("cp apps/app/.dev.vars.example");
  });
});
