import { expect, test } from "bun:test";
import { queryFrom } from "./cli.ts";

test("no flags means no query", () => {
  expect(queryFrom([])).toBe("");
});

test("maps both flags", () => {
  expect(queryFrom(["--from", "04-10-2026", "--to", "04-10-2026"])).toBe(
    "tanggal_awal=04-10-2026&tanggal_akhir=04-10-2026",
  );
});

test("each flag works on its own", () => {
  expect(queryFrom(["--from", "04-10-2026"])).toBe("tanggal_awal=04-10-2026");
  expect(queryFrom(["--to", "04-10-2026"])).toBe("tanggal_akhir=04-10-2026");
});

test("a trailing flag with no value is ignored", () => {
  expect(queryFrom(["--from"])).toBe("");
  expect(queryFrom(["--from", "--to", "04-10-2026"])).toBe("tanggal_akhir=04-10-2026");
});

test("an absent flag never borrows another argument", () => {
  expect(queryFrom(["some-file.ts", "--to", "04-10-2026"])).toBe("tanggal_akhir=04-10-2026");
});
