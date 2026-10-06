import { expect, test } from "bun:test";
import { decideButton, isSamePage } from "./flow.ts";

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

// The real app nests its pages: LOGIN_PATH /j-care/ and TARGET_PATH /j-care/admin-simkes.
test("a target path nested under the login path is a different page", () => {
  expect(isSamePage("http://h/j-care/admin-simkes?a=1", "http://h/j-care/")).toBe(false);
});

test("the same path with a different query is the same page", () => {
  expect(isSamePage("http://h/j-care/?error=1", "http://h/j-care/")).toBe(true);
});

test("a trailing slash does not make a different page", () => {
  expect(isSamePage("http://h/j-care", "http://h/j-care/")).toBe(true);
});

test("a different host is a different page", () => {
  expect(isSamePage("http://other/j-care/", "http://h/j-care/")).toBe(false);
});
