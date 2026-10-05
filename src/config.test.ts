import { expect, test } from "bun:test";
import { loadConfig } from "./config.ts";

const OK = {
  HOST: "http://example.test",
  LOGIN_PATH: "/login",
  TARGET_PATH: "/target",
  USERNAME: "u",
  PASSWORD: "p",
};

test("reads every value", () => {
  expect(loadConfig({ ...OK, TIMEOUT_MS: "5000" })).toEqual({
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
  expect(() => loadConfig({ ...OK, USERNAME: "" })).toThrow("USERNAME");
  expect(() => loadConfig({ ...OK, HOST: undefined })).toThrow("HOST");
  expect(() => loadConfig({ ...OK, PASSWORD: "  " })).toThrow("PASSWORD");
});

test("rejects a non-numeric or non-positive timeout", () => {
  expect(() => loadConfig({ ...OK, TIMEOUT_MS: "soon" })).toThrow("TIMEOUT_MS");
  expect(() => loadConfig({ ...OK, TIMEOUT_MS: "0" })).toThrow("TIMEOUT_MS");
  expect(() => loadConfig({ ...OK, TIMEOUT_MS: "-1" })).toThrow("TIMEOUT_MS");
});
