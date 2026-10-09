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

/**
 * Long-running watch: one tab for the whole loop, one crawl per interval, send
 * the moment the button enables. Stops on Ctrl+C or after max-empty empty
 * crawls in a row. --dry-run turns it into a monitor that never sends.
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
  process.once("SIGINT", stop);

  // Held for the whole loop, so a second process cannot click twice.
  const existing = Bun.file(LOCK);
  if ((await existing.exists()) && Date.now() - existing.lastModified < cfg.timeoutMs + 60_000) {
    throw new Error("another run holds the lock; refusing to send twice");
  }
  await Bun.write(LOCK, "");
  // One tab for the whole loop. Each crawl navigates fresh, so no page state leaks.
  await using view = openView();

  try {
    let empty = 0;
    let fails = 0;

    while (!stopped) {
      const cycle = Date.now();
      let rows = 0;
      let button: "enabled" | "disabled" | "notfound" = "notfound";
      let sent: Outcome | "skipped" | "none" = "none";

      try {
        await openTargetOrLogin(view, cfg, argv, sel);
        await waitForTable(view, sel);
        rows = await lastRowNo(view);
        const state = await buttonState(view, sel.mainButton);
        const decision = decideButton(state.found, state.disabled);

        if (decision === "click" && !monitorOnly) {
          button = "enabled";
          sent = await sendOnce(view, cfg, sel);
          empty = 0;
        } else if (decision === "click") {
          button = "enabled";
          sent = "skipped";
        } else if (decision === "done") {
          button = "disabled";
          sent = "already-done";
          empty++;
        } else {
          empty++;
        }
        fails = 0;
      } catch (err) {
        if (!(err instanceof AuthError)) throw err;
        fails++;
        if (fails > MAX_FAILS) throw err;
        const error = err.message;
        const retry = `${stamp()} crawl failed (${fails}/${MAX_FAILS}) ${error}`;
        console.log(retry);
        await append(retry);
        await Bun.sleep(2_000);
        continue;
      }

      const dur = ((Date.now() - cycle) / 1000).toFixed(1);
      const line =
        `${stamp()} crawl rows=${rows} button=${button} ` +
        `auto=${monitorOnly ? "off" : "on"} sent=${sent} dur=${dur}s`;
      console.log(line);
      await append(line);

      if (stopped || empty >= maxEmpty) break;
      // Counted from the end of the crawl, so a slow send cannot overlap the next one.
      await interruptibleSleep(intervalMs, () => stopped);
    }

    const total = ((Date.now() - started) / 1000).toFixed(1);
    const end = `${stamp()} daemon stopped${stopped ? " by signal" : `: max-empty reached (${empty})`} (${total}s)`;
    console.log(end);
    await append(end);
  } finally {
    process.off("SIGINT", stop);
    // force: true, so a cleanup hiccup cannot replace the body's own error
    await rm(LOCK, { force: true });
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
