import { describe, expect, it, vi } from "vitest";
import {
  isPortAvailable,
  isSupportedNodeVersion,
  runDoctor,
  type PortServer,
} from "./lesson-doctor";
import type { Runner } from "./lib/lesson";

function portServerFor(event: "available" | "busy" | "error") {
  return () => {
    let onError: (() => void) | undefined;
    const server: PortServer = {
      once: (_event, listener) => {
        onError = listener;
        return server;
      },
      listen: (_port, _host, onListening) => {
        if (event === "available") onListening();
        else onError?.();
        return server;
      },
      close: (listener) => {
        listener();
        return server;
      },
    };
    return server;
  };
}

describe("port check", () => {
  it("accepts an available port", async () => {
    await expect(isPortAvailable(3000, portServerFor("available"))).resolves.toBe(true);
  });

  it.each(["busy", "error"] as const)("rejects a %s port", async (event) => {
    await expect(isPortAvailable(3000, portServerFor(event))).resolves.toBe(false);
  });
});

describe("Node.js check", () => {
  it.each(["22.22.2", "22.99.0", "24.15.0", "24.99.0", "26.0.0"])(
    "accepts supported Node.js %s",
    (version) => {
      expect(isSupportedNodeVersion(version)).toBe(true);
    },
  );

  it.each(["22.22.1", "23.0.0", "24.14.9", "25.0.0", "invalid"])(
    "rejects unsupported Node.js %s",
    (version) => {
      expect(isSupportedNodeVersion(version)).toBe(false);
    },
  );
});

describe("doctor recovery", () => {
  it("guides a missing node_modules directory to run mise bootstrap", async () => {
    const report = vi.fn();
    const runner = vi.fn<Runner>().mockReturnValue({ status: 0, stdout: "", stderr: "" });

    const status = await runDoctor(["02"], {
      existsSync: (path) => path !== "node_modules",
      readText: () => '{"name":"voc-board"}',
      run: runner,
      isPortAvailable: async () => true,
      resolveStartRef: () => "checkpoint/02-start",
      nodeVersion: "24.16.0",
      report,
    });

    expect(status).toBe(1);
    expect(report).toHaveBeenCalledWith("NG: node_modules — mise bootstrap を実行してください");
  });

  it("guides a missing start checkpoint to recreate the private repository from the template", async () => {
    const report = vi.fn();
    const runner = vi.fn<Runner>().mockReturnValue({ status: 0, stdout: "", stderr: "" });

    const status = await runDoctor(["01"], {
      existsSync: () => true,
      readText: () => '{"name":"voc-board"}',
      run: runner,
      isPortAvailable: async () => true,
      resolveStartRef: () => {
        throw new Error("missing start ref");
      },
      nodeVersion: "24.16.0",
      report,
    });

    expect(status).toBe(1);
    expect(report).toHaveBeenCalledWith(
      "NG: 開始checkpoint — private repoをtemplateから作り直してください（Include all branchesを有効にし、作業中の変更は別フォルダへ退避）",
    );
  });

  it("reports a malformed root manifest in Japanese with starter recovery", async () => {
    const report = vi.fn();
    const runner = vi.fn<Runner>().mockReturnValue({ status: 0, stdout: "", stderr: "" });

    const status = await runDoctor(["01"], {
      existsSync: () => true,
      readText: () => "{",
      run: runner,
      isPortAvailable: async () => true,
      resolveStartRef: () => "checkpoint/01-start",
      nodeVersion: "24.16.0",
      report,
    });

    expect(status).toBe(1);
    expect(report).toHaveBeenCalledWith(
      "NG: VoC Boardのルート — package.json が壊れています。講師へstarterの復元を依頼してください",
    );
  });

  it("reports an unsupported Node.js version with a Japanese upgrade recovery", async () => {
    const report = vi.fn();
    const runner = vi.fn<Runner>().mockReturnValue({ status: 0, stdout: "", stderr: "" });

    const status = await runDoctor(["01"], {
      existsSync: () => true,
      readText: () => '{"name":"voc-board"}',
      run: runner,
      isPortAvailable: async () => true,
      resolveStartRef: () => "checkpoint/01-start",
      nodeVersion: "24.14.9",
      report,
    });

    expect(status).toBe(1);
    expect(report).toHaveBeenCalledWith(
      "NG: Node.js version — Node.jsを ^22.22.2、^24.15.0、または26以上へ更新してください",
    );
  });
});
