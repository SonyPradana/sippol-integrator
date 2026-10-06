# AGENTS.md

## How to write code here

**Short and direct beats long and clever.** The owner explicitly values this.

- No speculative abstraction layers, interfaces, or config for cases that cannot happen.
- No defensive branches, try/catch, or validation for inputs you control.
- No comments restating the code. Comment only a non-obvious _why_.
- If a branch, helper, or config option is not needed, delete it. Adding is not free.
- Prefer a `throw` over a silent default. Silent fallbacks have already caused one
  real bug here (see "silent success" below).

## Current state

Automation is complete and tested. `src/` is six modules (`app`, `cli`, `config`,
`flow`, `lock`, `log`) plus fixtures; no framework, and no dependency outside the
dev tooling.

## Commands

```bash
bun run check      # fmt:check -> lint -> typecheck -> test -> compile. Run this before you finish.
bun run start      # the automation. Needs .env filled in.
bun run start --from 04-10-2026 --to 04-10-2026
bun run compile    # standalone executable for this platform
bun run fmt        # oxfmt, writes
```

`bun test` launches a real headless Chrome against `src/fixture/`. It needs
Chrome/Edge installed and takes ~15s. Never point a test at the live site.

## Bun headless browser — the facts that are easy to get wrong

- **`bun headless` is not a command.** It does not exist. The browser is
  `new Bun.WebView({ backend: { type: "chrome", url: false } })`.
- It is **headless by default**. `headless: true` is the only implemented value;
  `headless: false` throws. There is no window to configure.
- **There is no dialog API.** No `onDialog`, no `alert` helper. Alerts require raw
  CDP: `await view.cdp("Page.enable")`, listen for the
  `"Page.javascriptDialogOpening"` event, then
  `await view.cdp("Page.handleJavaScriptDialog", { accept: true })`. Skip
  `Page.enable` and Chrome never emits the event.
- **An open dialog freezes the page's JS thread**, so `view.evaluate()` hangs
  while a dialog is up. Never poll with `evaluate()` to detect an alert — await
  the CDP event.
- `url: false` in the backend forces a fresh headless Chrome. Without it Bun
  auto-connects to an already-running Chrome if it finds a `DevToolsActivePort`
  file, which opens tabs in the developer's real browser.
- **`cdp()` throws `ERR_INVALID_STATE` until the first `navigate()`** has
  completed, because that navigation establishes the session.
- Each view has one slot per operation kind. Concurrent `navigate()`,
  `evaluate()`, `cdp()`, or `click()` throw `ERR_INVALID_STATE` rather than
  queueing. `navigate`/`reload` share a slot, which is why `flow.ts` waits for
  `loading` to clear after the login submit.
- Chrome spawns once per Bun process and is reused across `new Bun.WebView()`
  calls; only the tabs are new. `await using` closes the tab.

## Target app — verified facts, do not re-derive

Login page and target page selectors live in `DEFAULT_SELECTORS` in `src/flow.ts`.

- **`button.btnsubmit` is ambiguous.** Every per-row button
  (`sendRegistrasi`) carries `btnsubmit` too. The send-all button must be matched
  as `button.btnsubmit.sendAll`, or you get N matches instead of 1.
- **An unauthenticated request to the target path silently redirects to the login
  page.** A naive "button missing means done" check then reports success on a
  failed login. `assertAuthenticated()` in `flow.ts` exists to catch this — keep
  it.
- **Login is judged by URL, never by the login field.** The one real attempt against
  the live server logged `login-failed` with good credentials, and the likeliest
  reason is that the app renders a login form in every page's layout, same field ids
  included. A field check would then fail forever on a working login, and
  `assertAuthenticated` would throw on every run. `authenticate()` compares the URL
  before and after submit; `assertAuthenticated()` compares against `loginPath`.
  `src/fixture/target-form.html` is the regression fixture. If the URL turns out not
  to be a valid signal either, change this deliberately and update this note.
- **The alert fires on failure too**, including the page's own
  "range wider than 30 days" rejection. Success is detected by waiting for the
  navigation the page performs only on success, not by the alert's presence.
- **The alert's own text is worth keeping.** `Page.javascriptDialogOpening` carries
  `message` in `event.data`, and `alertText()` in `flow.ts` resolves with it. That
  string is the page's explanation of a refusal, so `--json` surfaces it. It used
  to be discarded.
- **A synchronous `alert()` in the click handler hangs `view.click()` forever.** The
  click only resolves once WebContent has finished processing the event, and an open
  dialog freezes the page's JS thread, so the await never returns and nothing in the
  flow times it out. `run()` therefore races the click against the alert event rather
  than awaiting it, and `src/fixture/target.html` has `#fx-sync` to cover that case.
  The three race arms are all `{ message, hung }` on purpose: `Promise.race` over an
  array of differently typed promises collapses the union badly and will not narrow.
- The page disables the send-all button while its request is in flight, and
  re-enables it on failure.
- The page's session check redirects to the login page after about three
  minutes, so keep total runtime under that.
- The click reads the date inputs, not the URL, but the server populates those
  inputs from the `tanggal_awal` / `tanggal_akhir` query params — which is why
  `--from` / `--to` work by going through the URL. Confirmed: the dry run renders
  exactly the requested dates back into the inputs.
- **The send button does not exist until the filter button is clicked.** On arrival
  the page carries `btnSubmitFilter` ("Tampilkan Data"), `btnProcessBackdate`, and
  `btnBackdateSync`, but no `.sendAll` at all. `applyFilter()` in `flow.ts` clicks
  it and polls for the button. Verified live: a range with data then yields 1
  `.sendAll` plus one `.sendRegistrasi` per row; a range with no data yields
  neither, and the run correctly exits 1 on `main button not found`.
- **The target page nests under the login path.** `LOGIN_PATH` is `/j-care/` and
  `TARGET_PATH` is `/j-care/admin-simkes`, so any string-prefix test for "am I still
  on the login page" throws on a perfectly good page. Use `isSamePage()`.
- `btnProcessBackdate` carries the bare `btnsubmit` class, so `button.btnsubmit`
  on its own still matches more than the send button.

## Entry point, lock, and logs

- `src/app.ts` is the entrypoint. **`help` / `--help` / `-h` is checked before
  `loadConfig()`**, so it works on a machine with no `.env`. Moving it after the
  config load turns `app help` into a "missing SIMPUS_PASSWORD" error.
- `app auth` is the read-only pre-flight: it logs in and reports whether the
  browser moved off the login page, then stops. It never opens the target page and
  takes no lock. Use it before any real run — it is the only check that isolates bad
  credentials from every other failure mode.
- `--dry-run` is the second pre-flight: it opens the target, dumps the URL and
  every rendered input, and reports the button state without clicking. Exit 0
  only when the button is present and enabled. This is the only way to see the
  date range the server actually rendered before committing to a real run.
- `--json` replaces stdout with one object carrying `mode`, `outcome`, `ms`, and
  whatever the mode knows: `url`, `button`, `alert`, `navigated` for a send, and
  `inputs` for a dry run. The log file stays human format on purpose.
- `click-hung` is a last-resort bucket: the click neither returned nor opened a
  dialog within `CLICK_TIMEOUT_MS`, so the page's JS thread is stuck on something
  else. It is deliberately untested, because a fixture that actually freezes
  Chrome would be the thing that hangs CI.
- `app.ts` has exactly one `process.exit()` outside the help check. `main()`
  returns `[result, human, code]` and never throws, so JSON formatting, logging,
  and the exit code all live in one place.
- Neither `auth` nor `--dry-run` takes the lock, because neither can send.
- "authenticated" means the browser moved off the login URL, not that a session token
  was issued. The target page can still bounce back to the login page later, which is
  what `assertAuthenticated` guards.
- `loadConfig()` sits inside the `try` in `app.ts` so config failures reach the
  log too.
- `lock.ts` writes `sippol.lock` in the working directory. Its `maxAgeMs` is
  `timeoutMs + 60_000` and **must stay above the run's own timeout** — a
  legitimate run holds the lock while it waits for the alert, and a shorter
  window would let a second run in and click twice.
- `Bun.file().delete()` throws ENOENT on a missing file, unlike
  `rm(path, { force: true })`. In a `finally`, that would replace the body's own
  error with an unlink error, so `lock.ts` uses `rm`.
- `log.ts` appends to `logs/YYYY-MM-DD.log`, one file per **UTC** day to match
  the ISO timestamps. Bun has no append mode, hence `appendFile`. It is one
  exported function because `app.ts` builds the human string itself.
- The executable reads `.env` and writes `logs/` and `sippol.lock` relative to the
  **working directory**, so it must be launched from the directory holding
  `.env`. This bites under Task Scheduler, where "Start in" defaults elsewhere.

## Standalone executable

- `bun run compile` produces `dist/app.exe` on Windows, `dist/app` elsewhere;
  Bun adds the extension. `compile:linux` cross-compiles with
  `--target=bun-linux-x64`. Both write to `dist/` without colliding.
- **`--compile` bundles Bun and the JS, not a browser.** Chrome, Chromium, Edge,
  or Brave must be installed on the target machine or `new Bun.WebView()` throws.
- `--compile` rejects `--outdir`; it needs `--outfile`. It implies `--production`,
  and `.env` autoload defaults to on.
- No `--minify`: the bundle is a few KB, and minified stack traces are unreadable
  without a sourcemap.

## Tooling

- Formatter is **`oxfmt`** (not "oxformat"). Linter is `oxlint`.
- Both read **JSON config only** — `.oxfmtrc.json`, `.oxlintrc.json`. A `.js`
  config is rejected, including by `oxc-project/oxlint-action`.
- `oxfmt` also formats `.html` and `.yml`, so the fixtures and the CI workflow are
  covered by `fmt:check`.
- TypeScript is **7**, not 5.x. `tsconfig.json` sets `noEmit`; `check` runs
  `compile` to verify the executable still builds.
- `tsconfig` traps: `verbatimModuleSyntax` (type imports need `import type`),
  `noUncheckedIndexedAccess` (indexing yields `T | undefined`), and extension-ful
  imports under `moduleResolution: "bundler"`.
- Shell is Windows PowerShell 5.1: `&&` is unsupported. Chain with `;`. Inside
  `package.json` scripts `&&` is fine because `bun run` uses Bun's own shell.

## Environment

- **Every `.env` key is prefixed with `SIMPUS_`. This is not cosmetic.** Windows
  already defines `USERNAME` as the logged-in user, and Bun's dotload does **not**
  override a variable that is already set. With a bare `USERNAME` key the app read
  the Windows account name instead of the real one and reported `login-failed`
  four times in a row against correct credentials, while the very same credentials
  worked over a plain HTTP POST. Any new key must carry the prefix too.
- Dotenv precedence is the other half of that trap: a real environment variable
  beats `.env`. That is what makes `SIMPUS_*` overridable from the shell, and what
  made the unprefixed version silently wrong. `src/config.test.ts` pins it.
- **Login is judged by URL, never by the login field.** See the Target app section.
- `.env` holds real credentials and is gitignored. `.env.example` is the shape.
- The host is an internal RFC1918 address and is deliberately replaced with
  `HOST` / `TARGET-PATH` placeholders in every committed file.
- The real page also ships `jquery.watermark.min.js` and registers a Service
  Worker, neither of which turned out to break the submit. `view.click` can still
  time out with "not actionable" intermittently on the login page, because it
  loads a dozen jQuery files from a slow link.
- The real login form posts to `/j-care/` with `_method=POST` and
  `data[User][username]`, `data[User][password]`, and redirects to `/j-care/home`
  on success. There is a second guest form on the same page with the same field
  names, so match on ids, not names.
- It is a CakePHP app. `/j-care/js/...` and the `data[_Token]` convention mean the
  login page may gain a CSRF field; if login starts failing again, dump the form
  before touching `src/flow.ts`.
- CI does not run the automation; it needs the internal network and credentials.
  `.github/workflows/test.yml` and `release.yml` have never run.
