import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readFileMock = vi.hoisted(() => vi.fn());
const homedirMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
}));

vi.mock("node:os", () => ({
  homedir: homedirMock,
}));

vi.mock("nano-spawn", () => ({
  default: spawnMock,
}));

vi.mock("../../src/main/logger", () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { getCodexUsage } from "../../src/main/codex-usage";

const fetchMock = vi.fn();

function makeEnoentError() {
  const error = new Error("not found") as NodeJS.ErrnoException;
  error.code = "ENOENT";
  return error;
}

function buildAuthJson(accountId = "acct-1") {
  return JSON.stringify({
    OPENAI_API_KEY: null,
    tokens: {
      access_token: "access-token",
      refresh_token: "refresh-token",
      id_token: "id-token",
      account_id: accountId,
    },
    last_refresh: "2026-01-28T08:05:37Z",
  });
}

function buildUsageResponseJson(balance: number | string = 5.39) {
  return JSON.stringify({
    plan_type: "plus",
    rate_limit: {
      primary_window: {
        used_percent: 6,
        reset_at: 1_738_300_000,
        limit_window_seconds: 18_000,
      },
      secondary_window: {
        used_percent: 24,
        reset_at: 1_738_900_000,
        limit_window_seconds: 604_800,
      },
    },
    credits: {
      has_credits: true,
      unlimited: false,
      balance,
    },
  });
}

describe("getCodexUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CODEX_HOME = undefined;
    homedirMock.mockReturnValue("/home/tester");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers CODEX_HOME/auth.json when CODEX_HOME is set", async () => {
    process.env.CODEX_HOME = "/custom-codex-home";
    readFileMock.mockImplementation(async (filePath: string) => {
      if (filePath === "/custom-codex-home/auth.json") {
        return buildAuthJson();
      }
      throw makeEnoentError();
    });

    fetchMock.mockResolvedValue(
      new Response(buildUsageResponseJson(), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await getCodexUsage();

    expect(readFileMock).toHaveBeenCalledTimes(1);
    expect(readFileMock).toHaveBeenCalledWith(
      "/custom-codex-home/auth.json",
      "utf8",
    );
    expect(result).toMatchObject({
      ok: true,
      usage: {
        primaryWindow: { utilization: 6, windowSeconds: 18_000 },
        secondaryWindow: { utilization: 24, windowSeconds: 604_800 },
      },
    });
  });

  it("falls back to ~/.codex/auth.json when ~/.config/codex/auth.json is missing", async () => {
    readFileMock.mockImplementation(async (filePath: string) => {
      if (filePath === "/home/tester/.codex/auth.json") {
        return buildAuthJson();
      }
      throw makeEnoentError();
    });

    fetchMock.mockResolvedValue(
      new Response(buildUsageResponseJson(), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await getCodexUsage();

    expect(readFileMock).toHaveBeenNthCalledWith(
      1,
      "/home/tester/.config/codex/auth.json",
      "utf8",
    );
    expect(readFileMock).toHaveBeenNthCalledWith(
      2,
      "/home/tester/.codex/auth.json",
      "utf8",
    );
    expect(result).toMatchObject({ ok: true });
  });

  it("falls back to macOS keychain when auth files are unavailable", async () => {
    readFileMock.mockRejectedValue(makeEnoentError());
    spawnMock.mockResolvedValue({ output: buildAuthJson() });

    fetchMock.mockResolvedValue(
      new Response(buildUsageResponseJson(), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await getCodexUsage();

    expect(spawnMock).toHaveBeenCalledWith(
      "security",
      ["find-generic-password", "-s", "Codex Auth", "-w"],
      { timeout: 5_000, stdin: "ignore" },
    );
    expect(result).toMatchObject({ ok: true });
  });

  it("sends ChatGPT-Account-Id header when account_id is present", async () => {
    readFileMock.mockResolvedValue(buildAuthJson("account-123"));
    fetchMock.mockResolvedValue(
      new Response(buildUsageResponseJson(), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await getCodexUsage();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/wham/usage",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer access-token",
          Accept: "application/json",
          "ChatGPT-Account-Id": "account-123",
        }),
      }),
    );
  });

  it("omits ChatGPT-Account-Id header when account_id is absent", async () => {
    readFileMock.mockResolvedValue(buildAuthJson(""));
    fetchMock.mockResolvedValue(
      new Response(buildUsageResponseJson(), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await getCodexUsage();

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as
      | Record<string, string>
      | undefined;
    expect(headers).toBeDefined();
    expect(headers?.["ChatGPT-Account-Id"]).toBeUndefined();
  });

  it("returns an error when the API responds with non-2xx", async () => {
    readFileMock.mockResolvedValue(buildAuthJson());
    fetchMock.mockResolvedValue(
      new Response("forbidden", {
        status: 403,
        statusText: "Forbidden",
      }),
    );

    const result = await getCodexUsage();

    expect(result).toEqual({
      ok: false,
      message: "Codex usage API returned 403 Forbidden",
    });
  });

  it("returns an error when usage response schema is invalid", async () => {
    readFileMock.mockResolvedValue(buildAuthJson());
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ rate_limit: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await getCodexUsage();

    expect(result).toEqual({
      ok: false,
      message: "Codex usage response has unexpected format",
    });
  });

  it("accepts numeric string credits balance values", async () => {
    readFileMock.mockResolvedValue(buildAuthJson());
    fetchMock.mockResolvedValue(
      new Response(buildUsageResponseJson("0"), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await getCodexUsage();

    expect(result).toMatchObject({
      ok: true,
      usage: {
        credits: {
          balance: 0,
        },
      },
    });
  });
});
