import { expect, test } from "bun:test";
import { loadConfig } from "./config.ts";

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
