# sippol-integrator

Headless browser automation for the SIMKES send button. Logs in, opens the
target page, waits for the send button to become enabled, clicks it, and waits
for the result alert.

Built entirely on Bun's built-in headless browser — no Puppeteer, no Playwright,
no browser download.

## Setup

```bash
bun install
cp .env.example .env   # then fill in SIMPUS_USERNAME and SIMPUS_PASSWORD
```

Requires Chrome, Chromium, Edge, or Brave installed. Bun finds it
automatically; set `BUN_CHROME_PATH` to override.

## Run

```bash
bun run src/app.ts help
bun run start ping
bun run start auth
bun run start --dry-run --from 04-10-2026 --to 04-10-2026
bun run start
bun run start --from 04-10-2026 --to 04-10-2026
bun run start --for 04-10-2026
bun run start --for-month
bun run start --daemon --for-month
```

`app ping` sends one HEAD at the login page and reports `reachable` or
`unreachable`, then stops. Any HTTP status counts as alive — even a 404 — so
only a network error within 15 seconds is unreachable. The line carries the
status code, the round-trip latency, and the server header when there is one.
It never opens a browser and takes no lock; run it before anything else.

`app auth` logs in and reports `authenticated` or `login-failed`, then stops. It
never opens the target page and never clicks send. It decides by whether the
browser moved off the login URL, not by whether the login form is still on the
page, and it prints both URLs so you can see which way it went. If this reports
`login-failed` the credentials or the login form are wrong; everything else is
still untested until this passes.

`--dry-run` goes one step further: it opens the target page, prints the URL the
server was asked for, the state of the send button, and every input the server
rendered, then stops. Use it to confirm the date range before a real run. It
exits 0 only when the send button is present and enabled, meaning a real run
would click.

`--from` / `--to` are optional and independent. They become `tanggal_awal` and
`tanggal_akhir` on the target URL, which the server renders into the page's date
inputs. The page rejects a range wider than 30 days.

`--for DATE` is the shorthand for a single day: it sets both dates at once. An
explicit `--from` or `--to` still wins over the side it names.

`--for-month` sets both ends of the running month, day 1 to its last day,
taken from the local clock. An explicit `--from` or `--to` still wins over the
side it names.

`--env-file PATH` reads one more `.env` file, but only `SIMPUS_*` keys the
environment does not already have — the shell and the `.env` in the working
directory keep winning. A missing path or unreadable file is an error. This is how Task
Scheduler runs it with the `.env` kept elsewhere: pass
`--env-file C:\path\to\.env`, and still point "Start in" at a writable
directory, because `logs/` and `sippol.lock` always go to the working directory.

`--daemon` keeps one browser tab open and crawls the target every `--interval`
minutes (default 15, counted from the previous crawl's end), sending the moment
the button enables. Each crawl logs its time, the table's last row number, and
the outcome. It stops on Ctrl+C or SIGTERM (`systemctl stop`) or after
`--max-empty` empty crawls in a row (default 5). `--daemon --dry-run` only
watches and never sends.

Every stop prints a recap line, to stdout and to the log:

```
2026-10-10T04:12:07.221+07:00 daemon stopped by signal (7194.9s)
2026-10-10T04:12:07.222+07:00 recap crawls=240 sends=2 rows=142 avg-dur=2.4s avg-rss=91.3MB total=7194.9s
```

`rows` is only the rows the last submission sent (never a sum — one range is
re-crawled all month, and summing would double-count it), and `avg-rss` is this
process, not Chrome, which runs separately and is not included.

`systemctl stop` is trapped as well as Ctrl+C, so the lock is released and the
recap prints. Give the unit a `TimeoutStopSec` above `SIMPUS_TIMEOUT_MS`: the
stop flag is only read between crawls, so a send in flight has to finish first
and a shorter timeout kills the process before it can report anything.

Output is `submitted`, `already-done`, `failed`, `timed-out`, or `click-hung`,
prefixed with an ISO timestamp and the elapsed seconds. `auth` reports
`authenticated` or `login-failed` instead. Exit code is 0 for `submitted`,
`already-done`, and `authenticated`, 1 otherwise.

## First run

Run these in order. The first two write nothing.

```bash
bun run start auth                                          # credentials work?
bun run start --dry-run --from DD-MM-YYYY --to DD-MM-YYYY    # dates and selectors
bun run start --from DD-MM-YYYY --to DD-MM-YYYY              # the real one
bun run start --for DD-MM-YYYY                               # a single day instead
```

Check the dry-run output before the last step: the `tanggal_awal` and
`tanggal_akhir` lines must match the period you intend to send, and the main
button must read `enabled`.

## Build

```bash
bun run compile   # dist/app.exe on Windows, dist/app elsewhere
```

The executable bundles Bun and this code, but **not** a browser — Chrome,
Chromium, Edge, or Brave must still be installed on the target machine. Run the
executable from the directory holding `.env`, since it reads `.env` and writes
`logs/` relative to the working directory.

The Linux build is compiled on Ubuntu against glibc, so it will not run on a
musl-only distribution such as Alpine.

## Logs

Every run appends one line to `logs/YYYY-MM-DD.log`, one file per local day,
and every timestamp is the local wall clock with the system's UTC offset, so a
log always agrees with the machine that ran it. The
same line goes to stdout, or stderr for a thrown error. An error line records
the message only, not the stack.

## JSON output

`--json` prints one machine-readable object to stdout and leaves the log file in
human format, so a log stays readable with `tail` while a pipe gets something it
can parse. Nothing else is written to stdout.

```bash
bun run start --json --from 04-10-2026 --to 04-10-2026
```

```json
{
  "mode": "send",
  "at": "2026-10-05T14:28:57.350+07:00",
  "ms": 2742,
  "outcome": "submitted",
  "url": "http://HOST/TARGET-PATH?tanggal_awal=04-10-2026&tanggal_akhir=04-10-2026",
  "button": { "found": true, "disabled": false },
  "alert": "probe: accepted",
  "navigated": true
}
```

`alert` is the page's own text, which is how you find out it refused. `navigated`
is the actual success signal. `mode` is `send`, `auth`, `dry-run`, or `help`. For
`auth` it carries `urlBefore` and `urlAfter` instead, the pair that says whether
the login was accepted. A thrown error still produces valid JSON, with
`outcome: "error"` and an `error` field.

`outcome: "click-hung"` means the page's JS thread is stuck: `SIMPUS_TIMEOUT_MS` ran
out with no alert, and the dispatch never returned either. Treat that run as unknown:
the data may or may not have been sent. `timed-out` is the milder one — the dispatch
came back but no alert appeared, which is what a server that never responded looks
like. A send normally finishes in well under a minute.

## Overlapping runs

A lock file stops a scheduler from starting a second run while one is still in
flight, so the send button cannot be clicked twice. It is written to
`sippol.lock` in the working directory and released when the run ends, including
on failure. A lock older than the run timeout plus one minute is treated as a
crash leftover and taken over.

## How success is decided

The page raises an `alert()` on failure as well as success, so an alert alone
means nothing. The page reloads itself only on success, so the run dismisses the
alert and then waits for the resulting navigation: navigation means sent, no
navigation means failed.

## Commands

```bash
bun run start          # run the automation
bun run fmt            # format
bun run fmt:check      # verify formatting
bun run lint           # oxlint
bun run typecheck      # tsc --noEmit
bun run test           # bun test
bun run compile        # standalone executable
bun run check          # fmt:check -> lint -> typecheck -> test -> compile
```

`bun test` drives a real headless Chrome against the fake fixtures in
`src/fixture/`, so no credentials and no real data are involved. It does not
touch the live site.

## Notes

The session on the target app expires after roughly three minutes, so keep
`SIMPUS_TIMEOUT_MS` under that.

A run takes about 40 seconds end to end, mostly waiting on the internal server.

The send button exists only when the chosen range actually has rows: the page
renders its table server-side from the dates in the URL, so an empty range
renders none. `--dry-run` therefore reports `not-ready` and a real run exits 1
with `main button not found`. Check the dry run before sending anything.

## Low-spec and VPS

The daemon is built for weak machines: one browser tab for the whole loop, and
Chrome is spawned with its disk and media caches capped so nothing grows over
days. On a 2 GB box, guard it with systemd instead of hoping:

```ini
[Unit]
Description=sippol-integrator daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=sippol
WorkingDirectory=/home/sippol/sippol
ExecStart=/home/sippol/sippol/app --daemon --for-month --env-file /home/sippol/sippol/.env
Restart=always
RestartSec=60
MemoryMax=1G
# Above SIMPUS_TIMEOUT_MS, because the daemon only reads the stop flag between
# crawls and a send can legitimately be waiting that long. Shorter than that and
# systemctl stop SIGKILLs mid-crawl: no recap, no lock cleanup.
TimeoutStopSec=150

[Install]
WantedBy=multi-user.target
```

`Restart=always` pairs with the daemon dying after 3 failing crawls in a row:
a dead session restarts the service instead of hanging it. `MemoryMax` kills and
restarts before the host OOMs. `WorkingDirectory` must stay writable — `logs/`
and `sippol.lock` always go there (about 10 KB of logs a day, no rotation needed,
and Chrome's temp profile cleans itself).

On ARM64 (e.g. an Armbian STB) build on the device itself with the official
aarch64 Bun, or take the `linux-arm64` release asset. Either way a browser is
still required: `chromium-headless-shell` via `bunx playwright install
chromium-headless-shell` is the ~100 MB stripped option. Minimal distros also
need its system libraries: `sudo bunx playwright install-deps
chromium-headless-shell` (a missing `libnspr4.so` shows up as `Chrome process
closed the pipe`). `BUN_CHROME_PATH` points at the binary when it lands outside
the standard locations, e.g.
`~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux-arm64/chrome-headless-shell`.

## Releases

Push a `v*` tag and the `Release` workflow builds every target on its own
runner and attaches the assets to the GitHub release:

| Asset                                        | Extract with     |
| -------------------------------------------- | ---------------- |
| `sippol-integrator-<tag>-windows-x64.zip`    | `Expand-Archive` |
| `sippol-integrator-<tag>-linux-x64.tar.gz`   | `tar -xzf`       |
| `sippol-integrator-<tag>-linux-arm64.tar.gz` | `tar -xzf`       |

Each holds the executable, `.env.example`, `LICENSE`, and this README, flat, so
the executable and your `.env` end up side by side. Neither ever contains a real
`.env`. The Linux tarball arrives already executable; a zip would not preserve
the executable bit, which is why it is a tarball.

## License

MIT. See [LICENSE](LICENSE).
