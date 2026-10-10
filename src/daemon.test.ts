import { expect, test } from "bun:test";
import { recapLine, tally, type Crawl, type Crawled, type Loop, type Stats } from "./daemon.ts";

const MB = 1024 * 1024;

const stats = (over: Partial<Stats> = {}): Stats => ({
  crawls: 0,
  sends: 0,
  rows: 0,
  durMs: 0,
  rssBytes: 0,
  ...over,
});

const crawled = (over: Partial<Crawl> = {}, rssBytes = 0): Crawled => ({
  kind: "crawl",
  crawl: { rows: 0, button: "notfound", sent: "none", ...over },
  durMs: 0,
  rssBytes,
});

const emptyLoop = (): Loop => ({ stats: stats(), empty: 0, fails: 0 });

test("averages the crawl duration and the memory", () => {
  const line = recapLine(stats({ crawls: 4, durMs: 12_000, rssBytes: 400 * MB }), 3_600_000);
  expect(line).toBe("recap crawls=4 sends=0 rows=0 avg-dur=3.0s avg-rss=100.0MB total=3600.0s");
});

test("a daemon that never crawled reports nothing instead of NaN", () => {
  expect(recapLine(stats(), 0)).toBe(
    "recap crawls=0 sends=0 rows=0 avg-dur=n/a avg-rss=n/a total=0.0s",
  );
});

test("seconds are rounded to one decimal, like every other duration here", () => {
  expect(recapLine(stats({ crawls: 3, durMs: 7_400 }), 1_000)).toContain("avg-dur=2.5s");
});

// A growing month is the case that broke the first version: the same range is
// submitted again with more rows, so the earlier row count must not be kept.
test("rows reports the last submission, not the sum of periods", () => {
  let loop = emptyLoop();
  loop = tally(loop, crawled({ rows: 142, button: "enabled", sent: "submitted" }));
  loop = tally(loop, crawled({ rows: 150, button: "enabled", sent: "submitted" }));
  expect(loop.stats.sends).toBe(2);
  expect(loop.stats.rows).toBe(150);
});

test("a crawl that did not submit leaves the reported rows alone", () => {
  let loop = tally(emptyLoop(), crawled({ rows: 142, button: "enabled", sent: "submitted" }));
  loop = tally(loop, crawled({ rows: 142, button: "disabled", sent: "already-done" }));
  expect(loop.stats.rows).toBe(142);
  expect(loop.stats.sends).toBe(1);
});

test("an enabled button resets the empty streak, including in --dry-run", () => {
  let loop = emptyLoop();
  loop = tally(loop, crawled({ button: "disabled" }));
  loop = tally(loop, crawled({ button: "disabled" }));
  expect(loop.empty).toBe(2);
  loop = tally(loop, crawled({ button: "enabled", sent: "skipped" }));
  expect(loop.empty).toBe(0);
});

test("the loop folds memory sampled per crawl into the average", () => {
  let loop = tally(emptyLoop(), crawled({}, 100 * MB));
  loop = tally(loop, crawled({}, 200 * MB));
  expect(loop.stats.rssBytes).toBe(300 * MB);
  expect(recapLine(loop.stats, 0)).toContain("avg-rss=150.0MB");
});

// Retries are not crawls: the page was never reached, so they cost neither a
// crawl nor a duration, and reporting them as empty would stop a healthy daemon.
test("a retry counts as neither a crawl nor an empty", () => {
  const settled = tally(emptyLoop(), { kind: "retry", fails: 1 });
  expect(settled.stats.crawls).toBe(0);
  expect(settled.empty).toBe(0);
  expect(settled.fails).toBe(1);
  expect(settled.stats.rssBytes).toBe(0);
});

test("a crawl clears the retry streak", () => {
  const loop = tally({ stats: stats(), empty: 0, fails: 2 }, crawled({ button: "disabled" }));
  expect(loop.fails).toBe(0);
});

test("the loop folds without mutating the state it was given", () => {
  const before = emptyLoop();
  const after = tally(before, crawled({ rows: 10, button: "enabled", sent: "submitted" }));
  expect(before.stats.crawls).toBe(0);
  expect(after.stats.crawls).toBe(1);
});
