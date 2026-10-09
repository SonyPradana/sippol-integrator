import type { Config } from "./config.ts";
import { queryFrom } from "./cli.ts";

export type Selectors = {
  user: string;
  pass: string;
  submit: string;
  mainButton: string;
};

export const DEFAULT_SELECTORS: Selectors = {
  user: "#UserUsername",
  pass: "#UserPassword",
  submit: 'input.btnLogin[type="submit"]',
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
export const NAV_GRACE_MS = 5_000;

/** How long to wait for the login POST to redirect before calling it a failed login. */
const LOGIN_GRACE_MS = 15_000;

export type ButtonState = { found: boolean; disabled: boolean };

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
  await waitForTable(view, sel);

  const button = await buttonState(view, sel.mainButton);
  if (decideButton(button.found, button.disabled) !== "click") {
    if (!button.found) throw new Error(`main button not found: ${sel.mainButton}`);
    return { outcome: "already-done", url, button, alert: null, navigated: null };
  }

  // Registered before the click so a fast reload cannot be missed.
  const navigated = watchNavigation(view);
  const alerted = alertText(view, cfg.timeoutMs);

  // A synchronous alert() inside the handler freezes the page's JS thread, so the evaluate
  // below never resolves. Racing it against the dialog event means such a page still
  // reports its alert instead of hanging, and a rejected evaluate still surfaces its own
  // error rather than a bare timeout.
  //
  // The deadline is the dialog wait itself, not a second timer. A hard 30s cap used to sit
  // here and gave up on a real send while the server was still working on it, reporting
  // click-hung for a period that had not in fact gone out. SIMPUS_TIMEOUT_MS is the number
  // an operator already tunes for this server, so it is the number that applies here too.
  //
  // Dispatched rather than clicked through view.click(), which waits on Chrome's
  // actionability checks and has been observed to time out on this exact button while
  // --dry-run reports it found and enabled. A plain JS handler needs no pointer.
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

  if (message === null) {
    const outcome: Outcome = clickSettled ? "timed-out" : "click-hung";
    return { outcome, url, button, alert: null, navigated: null };
  }

  await view.cdp("Page.handleJavaScriptDialog", { accept: true });
  const hit = await navigated(NAV_GRACE_MS);
  return {
    outcome: hit ? "submitted" : "failed",
    url,
    button,
    alert: message,
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
  await waitForTable(view, sel);

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

export async function openTarget(view: Bun.WebView, cfg: Config, argv: string[]): Promise<string> {
  const url = targetUrl(cfg, argv);
  await view.navigate(url);
  await assertAuthenticated(view, cfg);
  return url;
}

export async function login(view: Bun.WebView, cfg: Config, sel: Selectors): Promise<string> {
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

export function targetUrl(cfg: Config, argv: string[]): string {
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
 * The page renders the table server-side from the query params, so there is nothing to
 * submit and no filter to click. navigate() can resolve before that markup is in the DOM,
 * so wait for the button rather than reading it the moment navigation returns. Bounded,
 * because an empty range legitimately renders no button and has to surface as
 * "main button not found" instead of a hang.
 */
export async function waitForTable(view: Bun.WebView, sel: Selectors): Promise<void> {
  for (let i = 0; i < 80; i++) {
    if (await countMatches(view, sel.mainButton)) return;
    await Bun.sleep(100);
  }
}

function countMatches(view: Bun.WebView, selector: string): Promise<number> {
  return view.evaluate<number>(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
}

export function buttonState(view: Bun.WebView, selector: string): Promise<ButtonState> {
  return view.evaluate<ButtonState>(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { found: false, disabled: false };
    const disabled =
      el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";
    return { found: true, disabled };
  })()`);
}

/** Resolves to the dialog's own text, which is the page's explanation of a refusal. */
export function alertText(view: Bun.WebView, ms: number): Promise<string | null> {
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

export function watchNavigation(view: Bun.WebView): (ms: number) => Promise<boolean> {
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
