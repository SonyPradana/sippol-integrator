import type { Config } from "./config.ts";
import {
  alertText,
  buttonState,
  decideButton,
  DEFAULT_SELECTORS,
  isSamePage,
  login,
  NAV_GRACE_MS,
  openTarget,
  openView,
  type Outcome,
  type Selectors,
  targetUrl,
  waitForTable,
  watchNavigation,
} from "./flow.ts";
import { append, stamp } from "./log.ts";
import { rm } from "node:fs/promises";

const LOCK = "sippol.lock";

/** Consecutive failing crawls tolerated before giving up. Re-auth is the expected failure. */
const MAX_FAILS = 3;

/** A crawl that died on the session or the network. Retried; anything else kills the daemon. */
class AuthError extends Error {}

export type Stats = {
  crawls: number;
  sends: number;
  rows: number;
  durMs: number;
  rssBytes: number;
};

/** What one finished crawl observed: the table's last row number, and how the send went. */
export type Crawl = {
  rows: number;
  button: "enabled" | "disabled" | "notfound";
  sent: Outcome | "skipped" | "none";
};

/** The loop's own state, folded one crawl at a time. */
export type Loop = { stats: Stats; empty: number; fails: number };

/**
 * What a crawl attempt produced. The two variants are not the same thing: a crawl
 * that ran is counted, while a retry is not — retries neither add to `crawls` nor
 * count as empty, because the crawl never reached the page.
 */
export type Crawled =
  | { kind: "crawl"; crawl: Crawl; durMs: number; rssBytes: number }
  | { kind: "retry"; fails: number };

/**
 * Folds one finished crawl into the loop state. Pure, so the accounting is
 * testable without a browser — this is where the rows, duration and memory
 * bookkeeping lives, which is exactly where a wrong sum would hide.
 *
 * `rows` is the last submission's row count, not a total: the loop crawls the
 * same date range for its whole life, so a range that grows mid-month is
 * submitted again with more rows, and summing the row numbers would count the
 * first period twice.
 */
export function tally(loop: Loop, c: Crawled): Loop {
  if (c.kind === "retry") return { ...loop, fails: c.fails };

  const { stats } = loop;
  const submitted = c.crawl.sent === "submitted";
  // An enabled button resets the streak even in --dry-run: a monitor that stops
  // after five sightings of the thing it is waiting for is not a monitor.
  const empty = c.crawl.button === "enabled" ? 0 : loop.empty + 1;

  return {
    stats: {
      crawls: stats.crawls + 1,
      sends: stats.sends + (submitted ? 1 : 0),
      rows: submitted ? c.crawl.rows : stats.rows,
      durMs: stats.durMs + c.durMs,
      rssBytes: stats.rssBytes + c.rssBytes,
    },
    empty,
    fails: 0,
  };
}

const MB = 1024 * 1024;

/**
 * One line on every exit: how many periods went out, how many rows that was, and
 * what the loop cost in time and memory. `avg-rss` is the daemon's own process,
 * not Chrome: it runs as a child process and only /proc per-platform could add it.
 */
export function recapLine(s: Stats, totalMs: number): string {
  const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
  const avgDur = s.crawls === 0 ? "n/a" : secs(s.durMs / s.crawls);
  const avgRss = s.crawls === 0 ? "n/a" : `${(s.rssBytes / s.crawls / MB).toFixed(1)}MB`;
  return (
    `recap crawls=${s.crawls} sends=${s.sends} rows=${s.rows} ` +
    `avg-dur=${avgDur} avg-rss=${avgRss} total=${secs(totalMs)}`
  );
}

const crawlLine = (c: Crawl, durMs: number, monitorOnly: boolean): string =>
  `crawl rows=${c.rows} button=${c.button} ` +
  `auto=${monitorOnly ? "off" : "on"} sent=${c.sent} dur=${(durMs / 1000).toFixed(1)}s`;

/** One place that both shows a line and files it, so the two can never drift. */
async function say(line: string): Promise<void> {
  console.log(line);
  await append(line);
}

/**
 * Long-running watch: one tab for the whole loop, one crawl per interval, send
 * the moment the button enables. Stops on Ctrl+C, SIGTERM (systemctl stop), or
 * after max-empty empty crawls. --dry-run turns it into a monitor that never sends.
 */
export async function daemon(
  cfg: Config,
  argv: string[],
  sel: Selectors = DEFAULT_SELECTORS,
): Promise<void> {
  const monitorOnly = argv.includes("--dry-run");
  const intervalMs = parseInterval(argv) * 60_000;
  const maxEmpty = parseMaxEmpty(argv);
  const started = Date.now();
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  // systemctl stop sends SIGTERM, and without a handler it kills the process on
  // the spot: no finally, so sippol.lock is left behind and the recap never prints.
  const SIGNALS = ["SIGINT", "SIGTERM"] as const;
  for (const signal of SIGNALS) process.once(signal, stop);

  let loop: Loop = {
    stats: { crawls: 0, sends: 0, rows: 0, durMs: 0, rssBytes: 0 },
    empty: 0,
    fails: 0,
  };
  // Held for the whole loop, so a second process cannot click twice.
  const existing = Bun.file(LOCK);
  if ((await existing.exists()) && Date.now() - existing.lastModified < cfg.timeoutMs + 60_000) {
    throw new Error("another run holds the lock; refusing to send twice");
  }
  await Bun.write(LOCK, "");
  // One tab for the whole loop. Each crawl navigates fresh, so no page state leaks.
  await using view = openView();

  // A give-up (MAX_FAILS session failures) has to be told apart from a stop, or
  // the operator reads "max-empty reached" and looks in the wrong place.
  let gaveUp = false;
  try {
    while (!stopped && loop.empty < maxEmpty) {
      const got = await crawlOnce(view, cfg, argv, sel, monitorOnly, loop.fails);
      loop = tally(loop, got);

      // A retry never reached the page, so it is neither logged as a crawl nor
      // followed by the interval: the loop retries immediately.
      if (got.kind === "retry") continue;

      await say(`${stamp()} ${crawlLine(got.crawl, got.durMs, monitorOnly)}`);
      if (stopped || loop.empty >= maxEmpty) break;
      // Counted from the end of the crawl, so a slow send cannot overlap the next one.
      await interruptibleSleep(intervalMs, () => stopped);
    }
  } catch (err) {
    gaveUp = true;
    throw err;
  } finally {
    // Released before the recap is written, so a logging hiccup cannot strand the lock.
    for (const signal of SIGNALS) process.off(signal, stop);
    await rm(LOCK, { force: true });
    const total = Date.now() - started;
    const why = stopped ? "by signal" : gaveUp ? "giving up" : `max-empty reached (${loop.empty})`;
    await say(`${stamp()} daemon stopped ${why} (${(total / 1000).toFixed(1)}s)`);
    await say(`${stamp()} ${recapLine(loop.stats, total)}`);
  }
}

/** Same call graph as the send path in flow.ts: navigate, wait, read, decide, send. */
async function crawlOnce(
  view: Bun.WebView,
  cfg: Config,
  argv: string[],
  sel: Selectors,
  monitorOnly: boolean,
  fails: number,
): Promise<Crawled> {
  const cycle = Date.now();
  // Sampled once per crawl, so avg-rss is the loop's resting footprint, which is
  // the number that creeps up on a machine left running for weeks.
  const crawl = (c: Crawl): Crawled => ({
    kind: "crawl",
    crawl: c,
    durMs: Date.now() - cycle,
    rssBytes: process.memoryUsage().rss,
  });

  try {
    await openTargetOrLogin(view, cfg, argv, sel);
    await waitForTable(view, sel);
    const rows = await lastRowNo(view);
    const state = await buttonState(view, sel.mainButton);
    const decision = decideButton(state.found, state.disabled);

    if (decision === "click") {
      if (monitorOnly) return crawl({ rows, button: "enabled", sent: "skipped" });
      return crawl({ rows, button: "enabled", sent: await sendOnce(view, cfg, sel) });
    }
    if (decision === "done") return crawl({ rows, button: "disabled", sent: "already-done" });
    return crawl({ rows, button: "notfound", sent: "none" });
  } catch (err) {
    // Anything but the session or the network is a defect: it kills the daemon
    // rather than being retried, because a bad selector will not fix itself.
    if (!(err instanceof AuthError)) throw err;
    const count = fails + 1;
    if (count > MAX_FAILS) throw err;
    await say(`${stamp()} crawl failed (${count}/${MAX_FAILS}) ${err.message}`);
    await Bun.sleep(2_000);
    return { kind: "retry", fails: count };
  }
}

/** Redirects to the login page mean the session died, so log back in and retry the target. */
async function openTargetOrLogin(
  view: Bun.WebView,
  cfg: Config,
  argv: string[],
  sel: Selectors,
): Promise<void> {
  try {
    await view.navigate(targetUrl(cfg, argv));
    const here = await view.evaluate<string>("location.href");
    if (isSamePage(here, new URL(cfg.loginPath, cfg.host).href)) {
      await login(view, cfg, sel);
      await openTarget(view, cfg, argv);
    }
  } catch (err) {
    throw new AuthError(err instanceof Error ? err.message : String(err));
  }
}

/** The table's own last row number, falling back to the row count when it is not numeric. */
async function lastRowNo(view: Bun.WebView): Promise<number> {
  return view.evaluate<number>(`(() => {
    const rows = [...document.querySelectorAll("table tbody tr")].filter(
      (tr) => (tr.textContent || "").trim() !== "",
    );
    if (rows.length === 0) return 0;
    const first = rows[rows.length - 1].querySelector("td");
    const n = parseInt((first?.textContent || "").trim(), 10);
    return Number.isNaN(n) ? rows.length : n;
  })()`);
}

/** Same dispatch-and-race as run(): the alert races the click, navigation decides success. */
async function sendOnce(view: Bun.WebView, cfg: Config, sel: Selectors): Promise<Outcome> {
  // Registered before the click so a fast reload cannot be missed.
  const navigated = watchNavigation(view);
  const alerted = alertText(view, cfg.timeoutMs);

  let clickSettled = false;
  const clicked = view.evaluate<void>(
    `document.querySelector(${JSON.stringify(sel.mainButton)}).click()`,
  );
  clicked.then(
    () => {
      clickSettled = true;
    },
    () => {
      clickSettled = true;
    },
  );

  const message = await Promise.race([alerted, clicked.then(() => alerted)]);

  if (message === null) return clickSettled ? "timed-out" : "click-hung";

  await view.cdp("Page.handleJavaScriptDialog", { accept: true });
  return (await navigated(NAV_GRACE_MS)) ? "submitted" : "failed";
}

function parseInterval(argv: string[]): number {
  const i = argv.indexOf("--interval");
  if (i === -1) return 15;
  const v = Number(argv[i + 1]);
  if (!Number.isFinite(v)) throw new Error(`invalid --interval: ${String(argv[i + 1])}`);
  if (v < 1) return 1;
  if (v > 60) return 60;
  return Math.floor(v);
}

function parseMaxEmpty(argv: string[]): number {
  const i = argv.indexOf("--max-empty");
  if (i === -1) return 5;
  const v = Number(argv[i + 1]);
  if (!Number.isFinite(v)) throw new Error(`invalid --max-empty: ${String(argv[i + 1])}`);
  if (v < 1) return 1;
  if (v > 20) return 20;
  return Math.floor(v);
}

async function interruptibleSleep(ms: number, stopped: () => boolean): Promise<void> {
  let left = ms;
  while (left > 0) {
    if (stopped()) return;
    await Bun.sleep(Math.min(500, left));
    left -= 500;
  }
}
