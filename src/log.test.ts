import { expect, test } from "bun:test";
import { stamp } from "./log.ts";

test("stamp reads the local wall clock, not UTC", () => {
  const at = new Date(2026, 9, 7, 5, 4, 3, 2);
  const text = stamp(at);
  expect(text.slice(0, 19)).toBe("2026-10-07T05:04:03");
  expect(new Date(text).getTime()).toBe(at.getTime());
});
