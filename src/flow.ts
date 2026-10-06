import type { Config } from "./config.ts";
import { queryFrom } from "./cli.ts";

export type Selectors = {
  user: string;
  pass: string;
  submit: string;
  filter: string;
  mainButton: string;
};

export const DEFAULT_SELECTORS: Selectors = {
  user: "#UserUsername",
  pass: "#UserPassword",
  submit: 'input.btnLogin[type="submit"]',
  filter: "#btnSubmitFilter",
  mainButton: "button.btnsubmit.sendAll",
};

export type Outcome = "already-done" | "submitted" | "failed" | "timed-out" | "click-hung";

export type Send = {
  outcome: Outcome;
  url: string;
  button: ButtonState;
  alert: string | null;
  navigated: boolean | null;
};

export type Report = {
  url: string;
  button: ButtonState;
  inputs: { key: string; value: string }[];
};

export type Auth = { before: string; after: string; ok: boolean };

/** The page reloads itself on success, so a navigation after the alert is the success signal. */
const NAV_GRACE_MS = 5_000;

/** How long to wait for the login POST to redirect before calling it a failed login. */
const LOGIN_GRACE_MS = 15_000;

/**
 * A click normally returns in well under a second. If it has not returned and no dialog
 * opened, the page's JS thread is stuck on something else entirely and there is nothing
 * left to wait for.
 */
const CLICK_TIMEOUT_MS = 30_000;

type ButtonState = { found: boolean; disabled: boolean };

export function decideButton(found: boolean, disabled: boolean): "missing" | "done" | "click" {
  if (!found) return "missing";
  return disabled ? "done" : "click";
}

export async function run(
  cfg: Config,
  argv: string[],
  sel: Selectors = DEFAULT_SELECTORS,
): Promise<Send> {
  await using view = openView();

  await login(view, cfg, sel);
  const url = await openTarget(view, cfg, argv);
  await applyFilter(view, sel);

  const button = await buttonState(view, sel.mainButton);
  if (decideButton(button.found, button.disabled) !== "click") {
    if (!button.found) throw new Error(`main button not found: ${sel.mainButton}`);
    return { outcome: "already-done", url, button, alert: null, navigated: null };
  }

  // Registered before the click so a fast reload cannot be missed.
  const navigated = watchNavigation(view);
  const alerted = alertText(view, cfg.timeoutMs);

  // A synchronous alert() blocks the page's JS thread, so view.click() never resolves.
  // Racing the two means such a page still reports its alert instead of hanging, and a
  // click that rejects still surfaces its own error rather than a bare timeout.
  const clicked = view.click(sel.mainButton);
  clicked.catch(() => {});

  const raced = await Promise.race([
    alerted.then((message) => ({ message, hung: false })),
    clicked.then(() => alerted).then((message) => ({ message, hung: false })),
    Bun.sleep(CLICK_TIMEOUT_MS).then(() => ({ message: null, hung: true })),
  ]);

  if (raced.hung) {
    return { outcome: "click-hung", url, button, alert: null, navigated: null };
  }
  if (raced.message === null) {
    return { outcome: "timed-out", url, button, alert: null, navigated: null };
  }

  await view.cdp("Page.handleJavaScriptDialog", { accept: true });
  const hit = await navigated(NAV_GRACE_MS);
  return {
    outcome: hit ? "submitted" : "failed",
    url,
    button,
    alert: raced.message,
    navigated: hit,
  };
}

/**
 * Read-only pre-flight: submits the login form and reports whether the browser moved off
 * the login URL. Deliberately reads the URL and not the form field, because an app can
 * keep a login form in its layout on every page, which would make a field check report
 * failure after a perfectly good login.
 */
export async function authenticate(cfg: Config, sel: Selectors = DEFAULT_SELECTORS): Promise<Auth> {
  await using view = openView();
  const before = await login(view, cfg, sel);
  const after = await view.evaluate<string>("location.href");
  return { before, after, ok: !isSamePage(after, before) };
}

/**
 * Read-only. Reaches the target page and reports what the server rendered plus the
 * send button's state, so the date range can be eyeballed before a real run. Never clicks.
 */
export async function dryRun(
  cfg: Config,
  argv: string[],
  sel: Selectors = DEFAULT_SELECTORS,
): Promise<Report> {
  await using view = openView();
  await login(view, cfg, sel);
  await openTarget(view, cfg, argv);
  await applyFilter(view, sel);

  const page = await view.evaluate<Omit<Report, "button">>(`(() => ({
    url: location.href,
    inputs: [...document.querySelectorAll("input")].map((i) => ({
      key: i.name || i.id || i.type,
      value: i.value,
    })),
  }))()`);

  return { ...page, button: await buttonState(view, sel.mainButton) };
}

function openView(): Bun.WebView {
  return new Bun.WebView({ backend: { type: "chrome", url: false } });
}

async function openTarget(view: Bun.WebView, cfg: Config, argv: string[]): Promise<string> {
  const url = targetUrl(cfg, argv);
  await view.navigate(url);
  await assertAuthenticated(view, cfg);
  return url;
}

async function login(view: Bun.WebView, cfg: Config, sel: Selectors): Promise<string> {
  const url = new URL(cfg.loginPath, cfg.host).href;
  await view.navigate(url);
  // Required before Chrome will emit javascriptDialogOpening events.
  await view.cdp("Page.enable");

  await view.click(sel.user);
  await view.type(cfg.username);
  await view.click(sel.pass);
  await view.type(cfg.password);

  // Waiting on view.loading is not good enough here: right after the click the POST has
  // not started yet, so the flag is still false and the wait returns immediately, which
  // reads location.href while the page has not moved. Waiting for the real navigation
  // is the only signal that the credentials were accepted.
  const navigated = watchNavigation(view);
  await view.click(sel.submit);
  await navigated(LOGIN_GRACE_MS);

  return url;
}

function targetUrl(cfg: Config, argv: string[]): string {
  const url = new URL(cfg.targetPath, cfg.host);
  const query = queryFrom(argv);
  if (query) url.search = query;
  return url.href;
}

/** Guards against the silent-success bug: an unauthenticated request lands back on the login page. */
async function assertAuthenticated(view: Bun.WebView, cfg: Config): Promise<void> {
  const here = await view.evaluate<string>("location.href");
  if (isSamePage(here, new URL(cfg.loginPath, cfg.host).href)) {
    throw new Error(`login failed: redirected back to ${here}`);
  }
}

/**
 * Compares origin and path, never a raw string prefix. The real app's LOGIN_PATH is
 * "/j-care/" and its TARGET_PATH is "/j-care/admin-simkes", so every target URL starts with
 * the login URL and a prefix test would throw on a page that loaded perfectly well.
 */
export function isSamePage(a: string, b: string): boolean {
  const ua = new URL(a);
  const ub = new URL(b);
  const path = (p: string): string => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);
  return ua.origin === ub.origin && path(ua.pathname) === path(ub.pathname);
}

/**
 * The target page renders no table, and so no send button, until its filter button is
 * clicked. Verified against the live app: with a range that has data the click produces
 * 1 .sendAll plus one .sendRegistrasi per row; with an empty range it produces neither.
 * A miss here looks exactly like "nothing to send", so the wait is bounded and the
 * buttonState check stays the authority.
 */
async function applyFilter(view: Bun.WebView, sel: Selectors): Promise<void> {
  await view.click(sel.filter);
  for (let i = 0; i < 80; i++) {
    if (await countMatches(view, sel.mainButton)) return;
    await Bun.sleep(100);
  }
}

function countMatches(view: Bun.WebView, selector: string): Promise<number> {
  return view.evaluate<number>(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
}

function buttonState(view: Bun.WebView, selector: string): Promise<ButtonState> {
  return view.evaluate<ButtonState>(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { found: false, disabled: false };
    const disabled =
      el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";
    return { found: true, disabled };
  })()`);
}

/** Resolves to the dialog's own text, which is the page's explanation of a refusal. */
function alertText(view: Bun.WebView, ms: number): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    view.addEventListener<{ message: string }>(
      "Page.javascriptDialogOpening",
      (event) => {
        clearTimeout(timer);
        resolve(event.data.message);
      },
      { once: true },
    );
  });
}

function watchNavigation(view: Bun.WebView): (ms: number) => Promise<boolean> {
  let hit = false;
  const seen = new Promise<void>((resolve) => {
    view.onNavigated = () => {
      hit = true;
      resolve();
    };
  });

  return async (ms) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      seen,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
    clearTimeout(timer);
    return hit;
  };
}
