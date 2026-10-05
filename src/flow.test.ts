import { expect, test } from "bun:test";
import { decideButton } from "./flow.ts";

test("an absent button is never clickable", () => {
  expect(decideButton(false, false)).toBe("missing");
  expect(decideButton(false, true)).toBe("missing");
});

test("a disabled button means there is nothing left to send", () => {
  expect(decideButton(true, true)).toBe("done");
});

test("an enabled button gets clicked", () => {
  expect(decideButton(true, false)).toBe("click");
});
