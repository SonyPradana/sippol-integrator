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

test("--for fills both dates with the same value", () => {
  expect(queryFrom(["--for", "05-10-2026"])).toBe(
    "tanggal_awal=05-10-2026&tanggal_akhir=05-10-2026",
  );
});

test("--from and --to override the side they name", () => {
  expect(queryFrom(["--for", "05-10-2026", "--to", "06-10-2026"])).toBe(
    "tanggal_awal=05-10-2026&tanggal_akhir=06-10-2026",
  );
});

test("a trailing --for with no value is ignored", () => {
  expect(queryFrom(["--for"])).toBe("");
  expect(queryFrom(["--for", "--from", "05-10-2026"])).toBe("tanggal_awal=05-10-2026");
});

test("--for-month fills the running month", () => {
  expect(queryFrom(["--for-month"], new Date(2026, 9, 15))).toBe(
    "tanggal_awal=01-10-2026&tanggal_akhir=31-10-2026",
  );
});

test("--for-month ends on the last day of a leap February", () => {
  expect(queryFrom(["--for-month"], new Date(2028, 1, 3))).toBe(
    "tanggal_awal=01-02-2028&tanggal_akhir=29-02-2028",
  );
});

test("--for and --from/--to override --for-month", () => {
  const now = new Date(2026, 9, 7);
  expect(queryFrom(["--for-month", "--for", "05-10-2026"], now)).toBe(
    "tanggal_awal=05-10-2026&tanggal_akhir=05-10-2026",
  );
  expect(queryFrom(["--for-month", "--to", "05-10-2026"], now)).toBe(
    "tanggal_awal=01-10-2026&tanggal_akhir=05-10-2026",
  );
});
