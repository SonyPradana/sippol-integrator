import { beforeEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { withLock } from "./lock.ts";

const LOCK = "sippol.lock";
const MAX_AGE = 60_000;

beforeEach(async () => {
  await rm(LOCK, { force: true });
});

test("runs the body and leaves no lock behind", async () => {
  expect(await withLock(MAX_AGE, async () => "done")).toBe("done");
  expect(await Bun.file(LOCK).exists()).toBe(false);
});

test("refuses a second run while the lock is held", async () => {
  await withLock(MAX_AGE, async () => {
    await expect(withLock(MAX_AGE, async () => "second")).rejects.toThrow("holds the lock");
  });
});

test("releases the lock when the body throws", async () => {
  await expect(
    withLock(MAX_AGE, async () => {
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  expect(await Bun.file(LOCK).exists()).toBe(false);
});

test("takes over a lock left behind by a crashed run", async () => {
  await Bun.write(LOCK, "");
  expect(await withLock(0, async () => "recovered")).toBe("recovered");
});
