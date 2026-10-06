import { describe, expect, it, vi } from "vitest";
import type { Runner } from "./lib/lesson";
import { checkDeployPreflight, deploySteps, readWranglerConfig, runDeploy } from "./lesson-deploy";

const config = (name: string, databaseId = "11111111-2222-3333-4444-555555555555") => `{
  // コメント付き
  "name": "${name}",
  "main": "src/server.ts",
  "d1_databases": [
    { "binding": "DB", "database_name": "voc-board", "database_id": "${databaseId}" },
  ],
  "observability": { "enabled": true },
}`;

const ok = { status: 0, stdout: "", stderr: "" };

function deps(env: Record<string, string | undefined>, configText: string, runner: Runner) {
  return {
    run: runner,
    readConfig: () => configText,
    env,
    report: vi.fn(),
    announce: vi.fn(),
  };
}

describe("readWranglerConfig", () => {
  it("reads name and database_id from a commented config", () => {
    expect(readWranglerConfig(config("w-taro"))).toEqual({
      name: "w-taro",
      databaseId: "11111111-2222-3333-4444-555555555555",
    });
  });
});

describe("checkDeployPreflight", () => {
  it("accepts a matching worker name and a real database_id", () => {
    expect(checkDeployPreflight("w-taro", config("w-taro"))).toEqual([]);
  });

  it("rejects a missing VOC_WORKER_NAME", () => {
    expect(checkDeployPreflight(undefined, config("w-taro"))).toEqual([
      expect.stringContaining("VOC_WORKER_NAME がありません"),
    ]);
  });

  it("rejects a worker name that differs from wrangler.jsonc", () => {
    expect(checkDeployPreflight("w-hanako", config("w-taro"))).toEqual([
      expect.stringContaining("一致しません"),
    ]);
  });

  it("rejects the dummy database_id", () => {
    expect(
      checkDeployPreflight("w-taro", config("w-taro", "00000000-0000-0000-0000-000000000000")),
    ).toEqual([expect.stringContaining("database_id")]);
  });
});

describe("runDeploy", () => {
  it("does not call anything when the preflight fails", () => {
    const runner = vi.fn<Runner>().mockReturnValue(ok);
    const d = deps({ VOC_WORKER_NAME: "w-hanako" }, config("w-taro"), runner);

    expect(runDeploy(["04"], d)).toBe(1);
    expect(runner).not.toHaveBeenCalled();
    expect(d.report).toHaveBeenCalledWith(expect.stringContaining("一致しません"));
  });

  it("builds, migrates and deploys in order when the preflight passes", () => {
    const runner = vi.fn<Runner>().mockReturnValue(ok);
    const d = deps({ VOC_WORKER_NAME: "w-taro" }, config("w-taro"), runner);

    expect(runDeploy(["04"], d)).toBe(0);
    expect(runner.mock.calls.map(([, args]) => args)).toEqual(deploySteps.map((s) => s.args));
    expect(runner.mock.calls.at(-1)?.[1]).toContain("deploy");
  });

  it.each(["07", "08"])("deploys lesson %s with the same steps", (id) => {
    const runner = vi.fn<Runner>().mockReturnValue(ok);
    const d = deps({ VOC_WORKER_NAME: "w-taro" }, config("w-taro"), runner);

    expect(runDeploy([id], d)).toBe(0);
    expect(runner.mock.calls.map(([, args]) => args)).toEqual(deploySteps.map((s) => s.args));
  });

  it("stops at the first failing step", () => {
    const runner = vi
      .fn<Runner>()
      .mockReturnValueOnce(ok)
      .mockReturnValueOnce({ ...ok, status: 3 });
    const d = deps({ VOC_WORKER_NAME: "w-taro" }, config("w-taro"), runner);

    expect(runDeploy(["04"], d)).toBe(3);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("rejects an unsupported lesson id", () => {
    const runner = vi.fn<Runner>();
    expect(runDeploy(["03"], deps({}, "", runner))).toBe(1);
    expect(runner).not.toHaveBeenCalled();
  });
});
