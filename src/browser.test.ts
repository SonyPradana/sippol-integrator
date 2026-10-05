import { expect, test } from "bun:test";
import { pathToFileURL } from "node:url";
import type { Config } from "./config.ts";
import { authenticate, dryRun, run } from "./flow.ts";
import type { Selectors } from "./flow.ts";

/**
 * Drives the real flow against local fixtures with fake content, so no
 * credentials and no real patient data are involved.
 */

const fixture = (name: string): string => pathToFileURL(`${import.meta.dir}/fixture/${name}`).href;

const CONFIG: Config = {
  host: "http://unused.invalid",
  loginPath: fixture("login.html"),
  targetPath: fixture("target.html"),
  username: "fake-user",
  password: "fake-pass",
  timeoutMs: 2_000,
};

const selectors = (mainButton: string): Selectors => ({
  user: "#fx-user",
  pass: "#fx-pass",
  submit: "#fx-submit",
  mainButton,
});

test("a reload after the alert means submitted", async () => {
  const r = await run(CONFIG, [], selectors("#fx-ok"));
  expect(r.outcome).toBe("submitted");
  expect(r.alert).toBe("fixture: accepted");
  expect(r.navigated).toBe(true);
  expect(r.url).toContain("target.html");
}, 30_000);

test("an alert without a reload means failed", async () => {
  const r = await run(CONFIG, [], selectors("#fx-fail"));
  expect(r.outcome).toBe("failed");
  expect(r.alert).toBe("fixture: rejected");
  expect(r.navigated).toBe(false);
}, 30_000);

test("no alert within the timeout means timed-out", async () => {
  const r = await run(CONFIG, [], selectors("#fx-silent"));
  expect(r.outcome).toBe("timed-out");
  expect(r.alert).toBeNull();
  expect(r.navigated).toBeNull();
}, 30_000);

test("a disabled button means already-done", async () => {
  const r = await run(CONFIG, [], selectors("#fx-locked"));
  expect(r.outcome).toBe("already-done");
  expect(r.button).toEqual({ found: true, disabled: true });
}, 30_000);

test("a synchronous alert still reports instead of hanging the click", async () => {
  const r = await run(CONFIG, [], selectors("#fx-sync"));
  expect(r.alert).toBe("fixture: synchronous alert");
  expect(r.outcome).toBe("failed");
}, 30_000);

test("an absent button throws instead of reporting success", async () => {
  await expect(run(CONFIG, [], selectors("#fx-absent"))).rejects.toThrow("main button not found");
}, 30_000);

test("a target that bounces back to the login page throws", async () => {
  const bounced = { ...CONFIG, targetPath: CONFIG.loginPath };
  await expect(run(bounced, [], selectors("#fx-ok"))).rejects.toThrow("redirected back to");
}, 30_000);

test("auth accepts a login that moves off the login page", async () => {
  const cfg = { ...CONFIG, loginPath: fixture("login-ok.html") };
  const a = await authenticate(cfg, selectors("#fx-ok"));
  expect(a.ok).toBe(true);
  expect(a.before).not.toBe(a.after);
}, 30_000);

test("auth rejects a login that stays on the login page", async () => {
  const a = await authenticate(CONFIG, selectors("#fx-ok"));
  expect(a.ok).toBe(false);
  expect(a.before).toBe(a.after);
}, 30_000);

// The real app may keep the login form in every page's layout, same field ids included.
test("auth ignores a login form that survives a successful login", async () => {
  const cfg = { ...CONFIG, loginPath: fixture("login-ok-form.html") };
  const a = await authenticate(cfg, selectors("#fx-ok"));
  expect(a.ok).toBe(true);
}, 30_000);

test("dry run reports the rendered inputs without clicking", async () => {
  const r = await dryRun(CONFIG, [], selectors("#fx-ok"));
  expect(r.inputs).toEqual([
    { key: "tanggal_awal", value: "01-01-2030" },
    { key: "tanggal_akhir", value: "05-01-2030" },
  ]);
  expect(r.button).toEqual({ found: true, disabled: false });
  expect(r.url).toContain("target.html");
}, 30_000);

test("dry run reports a disabled button instead of clicking it", async () => {
  const r = await dryRun(CONFIG, [], selectors("#fx-locked"));
  expect(r.button).toEqual({ found: true, disabled: true });
}, 30_000);

test("dry run reports an absent button instead of claiming success", async () => {
  const r = await dryRun(CONFIG, [], selectors("#fx-absent"));
  expect(r.button).toEqual({ found: false, disabled: false });
}, 30_000);
