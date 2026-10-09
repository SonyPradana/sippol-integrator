# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `[Unreleased]` holds what has landed on `main` but is not in a tagged release yet.
- The `--for-month` flag: it sets `tanggal_awal` to day 1 and `tanggal_akhir` to the
  last day of the running month, read from the local clock. An explicit `--from` or
  `--to` still wins over the side it names.
- The `--daemon` mode: it keeps one browser tab open and crawls the target every
  `--interval` minutes (default 15, counted from the previous crawl's end),
  sending the moment the button enables. Each crawl logs its time, the table's
  last row number, and the outcome. It stops on Ctrl+C or after `--max-empty`
  empty crawls in a row (default 5); `--dry-run` turns it into a monitor that
  never sends.

### Changed

- Log file names and log timestamps use the machine's local time instead of UTC.
  `stamp()` renders ISO 8601 with the system's UTC offset, so a line and its file
  name both agree with the clock the run happened under.

## [0.3.0] - 2026-10-06

First release that completes a real send against the live server. Adds the Linux
x86-64 asset and the `--for` shorthand, drops the filter click, and fixes the two
separate ways a send was abandoned before the server could answer.

### Added

- A Linux x86-64 release asset, `sippol-integrator-<tag>-linux-x64.tar.gz`. The
  Release workflow builds it natively on an Ubuntu runner instead of
  cross-compiling from Windows, because a Windows build host cannot give the
  binary a Unix executable bit — NTFS stores no Unix mode bits — and a zip would
  not carry one either. Extract the tarball and run it; no `chmod` needed.
- The `--for DATE` flag, the shorthand for a single day: it sets `tanggal_awal` and
  `tanggal_akhir` together. An explicit `--from` or `--to` still wins over the side it
  names.

### Removed

- The `compile:linux` script. Nothing needed it once CI built each target on its
  own runner, and its output was never runnable on the Windows machine that
  produced it.
- The `Tampilkan Data` filter click. The page renders its table server-side from the dates
  in the URL, so navigating straight to that URL is enough; the click only reloaded the
  same URL. It had also been silently covering for `navigate()` resolving before the markup
  was in the DOM, which `waitForTable()` now handles on its own.
- The `CLICK_TIMEOUT_MS` constant and its hard 30-second cap on the click race.

### Fixed

- A real send was abandoned after 30 seconds and reported as `click-hung`, leaving the
  period unsent and the outcome unknown, no matter what `SIMPUS_TIMEOUT_MS` was set to.
  There is now no second timer: the alert wait is the deadline, and `SIMPUS_TIMEOUT_MS`
  is the number that applies.
- The send button failed with `timeout waiting for 'button.btnsubmit.sendAll' to be
  actionable` while `--dry-run` reported the same button found and enabled. The dispatch
  now runs inside `view.evaluate` instead of going through `view.click()`, which waits on
  Chrome's actionability checks the plain JS handler does not need.

### Known gaps

- The Linux smoke test is `app help`, which does not open a browser, so it proves
  the binary loads and runs but not that `Bun.WebView` drives Chrome on Linux.
  The 35 browser tests do pass on an Ubuntu runner in `test.yml`.

## [0.2.0] - 2026-10-06

Fixes the three bugs that made 0.1.0 unable to complete a run, verified against
the live app.

**Breaking:** every `.env` key is renamed with a `SIMPUS_` prefix. See Changed
below, this is a one-time edit to the file.

### Fixed

- The target page renders no table, and so no send button, until its filter
  button is clicked. `button.btnsubmit.sendAll` therefore never existed and every
  run failed with `main button not found`. The filter is now clicked before the
  button check.
- A login that had succeeded was reported as `login-failed`. The wait after
  submit polled `view.loading`, which is still false right after the click
  because the form POST has not started, so it returned immediately and read the
  URL while the page had not moved. It now waits for the real navigation.
- The guard against a silent success compared URLs with `startsWith`. The target
  path nests under the login path, so every target URL starts with the login URL
  and the guard rejected pages that had loaded correctly.

### Changed

- **`.env` keys are now `SIMPUS_`-prefixed**, matching the system written to.
  An unprefixed `USERNAME` is already set on Windows to the logged-in user, and
  dotenv does not override a variable that is already set, so the app silently
  read the Windows account name instead of the real one. Rename the keys in an
  existing `.env`; the values do not change.

### Behaviour worth knowing

## [0.1.0] - 2026-10-05

First release. A one-shot command that logs in, opens one period's page, and
clicks send exactly once.

This release could not log in, for the reasons fixed in 0.2.0. Kept for history.

### Added

- `app auth`, a read-only pre-flight that reports whether the login was accepted.
  It judges by the URL before and after submit, not by the login field, because
  an app can keep a login form in its layout on every page.
- `app --dry-run`, which reports the URL, every input the server rendered, and
  the send button's state without clicking anything.
- `--json` for machine-readable output on stdout while the log file stays human.
- `app help`, resolved before the config load so it works with no `.env`.
- A lock file, so a scheduler cannot start a second run and click twice.
- Daily UTC log files under `logs/`.
- Standalone executables from `bun run compile` and `bun run compile:linux`.

### Behaviour worth knowing

- Success is the navigation the page performs after the send, never the alert.
  The alert also fires on failure, and its text is kept because that string is
  how the page explains a refusal.
- A synchronous `alert()` freezes the page's JS thread, so `click()` would never
  return. The click is raced against the dialog event instead. A click that
  neither returns nor opens a dialog within 30 seconds is reported as
  `click-hung`, which means the outcome is unknown, not that nothing happened.
