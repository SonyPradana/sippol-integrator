import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyEnvFile, loadConfig, parseEnv } from "./config.ts";

const OK = {
  SIMPUS_HOST: "http://example.test",
  SIMPUS_LOGIN_PATH: "/login",
  SIMPUS_TARGET_PATH: "/target",
  SIMPUS_USERNAME: "u",
  SIMPUS_PASSWORD: "p",
};

test("reads every value", () => {
  expect(loadConfig({ ...OK, SIMPUS_TIMEOUT_MS: "5000" })).toEqual({
    host: "http://example.test",
    loginPath: "/login",
    targetPath: "/target",
    username: "u",
    password: "p",
    timeoutMs: 5000,
  });
});

test("defaults the timeout to two minutes", () => {
  expect(loadConfig(OK).timeoutMs).toBe(120_000);
});

test("rejects a missing or blank value", () => {
  expect(() => loadConfig({ ...OK, SIMPUS_USERNAME: "" })).toThrow("SIMPUS_USERNAME");
  expect(() => loadConfig({ ...OK, SIMPUS_HOST: undefined })).toThrow("SIMPUS_HOST");
  expect(() => loadConfig({ ...OK, SIMPUS_PASSWORD: "  " })).toThrow("SIMPUS_PASSWORD");
});

// Windows sets USERNAME to the logged-in user, and dotenv does not override it.
test("ignores an unprefixed USERNAME left over in the environment", () => {
  const { SIMPUS_USERNAME: _absent, ...rest } = OK;
  expect(() => loadConfig({ ...rest, USERNAME: "windows-user" })).toThrow("SIMPUS_USERNAME");
});

test("parseEnv skips blanks, comments, and lines without =", () => {
  expect(
    parseEnv("# comment\n\nSIMPUS_A=1\nNOEQUALS\nSIMPUS_B=\"two words\"\nSIMPUS_C='q'\n =x\n"),
  ).toEqual([
    ["SIMPUS_A", "1"],
    ["SIMPUS_B", "two words"],
    ["SIMPUS_C", "q"],
  ]);
});

test("parseEnv drops keys outside SIMPUS_", () => {
  expect(parseEnv("PATH=/x\nUSERNAME=u\nSIMPUS_TIMEOUT_MS=5000\n")).toEqual([
    ["SIMPUS_TIMEOUT_MS", "5000"],
  ]);
});

test("--env-file fills only missing keys and never overrides", async () => {
  const path = join(tmpdir(), `sippol-env-${Date.now()}.env`);
  await Bun.write(path, "SIMPUS_USERNAME=from-file\nSIMPUS_PASSWORD=from-file\n");
  try {
    const env: Record<string, string | undefined> = { SIMPUS_PASSWORD: "from-shell" };
    await applyEnvFile(["--env-file", path], env);
    expect(env).toEqual({ SIMPUS_PASSWORD: "from-shell", SIMPUS_USERNAME: "from-file" });
    await applyEnvFile([], env);
  } finally {
    await rm(path, { force: true });
  }
});

test("--env-file without a path and with an unreadable file both throw", async () => {
  await expect(applyEnvFile(["--env-file"], {})).rejects.toThrow("--env-file PATH");
  await expect(applyEnvFile(["--env-file", "--daemon"], {})).rejects.toThrow("--env-file PATH");
  await expect(
    applyEnvFile(["--env-file", join(tmpdir(), "sippol-no-such-file.env")], {}),
  ).rejects.toThrow("cannot read --env-file");
});
