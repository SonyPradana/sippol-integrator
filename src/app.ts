import { applyEnvFile, loadConfig } from "./config.ts";
import { daemon } from "./daemon.ts";
import { authenticate, dryRun, run } from "./flow.ts";
import { ping } from "./ping.ts";
import { withLock } from "./lock.ts";
import { append, stamp } from "./log.ts";

type Result = Record<string, unknown>;

const HELP = `sippol-integrator - sends a SIMKES period through a headless browser.

Usage
  app                  send with no date range
  app --from D --to D  send one period
  app --for D          send a single day
  app --for-month      send the running month
  app --daemon         watch the target, send whenever the button enables
  app ping             check the server answers, sends nothing
  app auth             log in only and report whether it worked, sends nothing
  app --dry-run        reach the target, print what the server rendered, sends nothing
  app help             this text

Flags
  --from DATE   becomes tanggal_awal   (DD-MM-YYYY)
  --to   DATE   becomes tanggal_akhir   (DD-MM-YYYY)
  --for  DATE   both dates at once, one single day
  --for-month   both ends of the running month, day 1 to its last day
  --dry-run     read only, combines with --for, --for-month, --from and --to
  --daemon      long-running watch, one crawl per --interval, sends when enabled
  --interval N  minutes between crawls, counted from the previous crawl's end
                (default 15, 1-60)
  --max-empty N stop after this many empty crawls in a row (default 5, 1-20)
  --env-file P  read one more .env from P, fills only keys missing from the env
  --json        machine-readable result on stdout, log file stays human
  Dates are optional and independent. --from and --to each override the side
  they name if --for or --for-month was given too. The page rejects ranges
  over 30 days.

Environment (.env in the working directory)
  SIMPUS_HOST          origin, no trailing slash
  SIMPUS_LOGIN_PATH    login page path
  SIMPUS_TARGET_PATH   target page path
  SIMPUS_USERNAME
  SIMPUS_PASSWORD
  SIMPUS_TIMEOUT_MS    alert wait, default 120000

Output
  submitted     the page reloaded, so the period was sent
  already-done  the button was disabled, nothing left to send
  failed        the page reported an error
  timed-out     no alert within TIMEOUT_MS
  click-hung    the click never returned and no alert opened, the page is stuck
  authenticated auth only, the browser moved off the login page
  login-failed  auth only, still on the login page
  reachable     ping only, the server answered (any status counts)
  unreachable   ping only, no answer within 15s

With --json the result carries the target url, the send button's state, the
alert text the page raised, and whether it navigated afterwards.

Exit code 0 for submitted, already-done, authenticated, and reachable, 1 otherwise.

Examples
  app ping --json
  app auth
  app --dry-run --from 04-10-2026 --to 04-10-2026
  app --from 04-10-2026 --to 04-10-2026
  app --for 04-10-2026 --json
  app --for-month
  app --daemon --for-month
  app --daemon --dry-run --interval 5
  app help

Run from the directory holding .env. Every run appends one line to
logs/YYYY-MM-DD.log. A second run is refused while one is in flight, so the
send button cannot be clicked twice. Chrome, Chromium, Edge, or Brave must be
installed.`;

async function main(args: string[]): Promise<[Result, string, number]> {
  const started = Date.now();
  const secs = (): string => ((Date.now() - started) / 1000).toFixed(1);
  const mode = args.includes("ping")
    ? "ping"
    : args.includes("auth")
      ? "auth"
      : args.includes("--dry-run")
        ? "dry-run"
        : "send";

  try {
    await applyEnvFile(args);
    const cfg = loadConfig(process.env);

    if (mode === "ping") {
      const p = await ping(cfg);
      const human =
        p.outcome === "reachable"
          ? `${stamp()} ping ${p.url} ${p.status} ${p.latencyMs}ms`
          : `${stamp()} ping ${p.url} unreachable ${p.error}`;
      return [
        { mode, at: stamp(), ms: Date.now() - started, ...p },
        human,
        p.outcome === "reachable" ? 0 : 1,
      ];
    }

    if (mode === "auth") {
      const a = await authenticate(cfg);
      const outcome = a.ok ? "authenticated" : "login-failed";
      return [
        {
          mode,
          at: stamp(),
          outcome,
          ms: Date.now() - started,
          urlBefore: a.before,
          urlAfter: a.after,
        },
        [`${stamp()} ${outcome} ${secs()}s`, `  login: ${a.before}`, `  after: ${a.after}`].join(
          "\n",
        ),
        a.ok ? 0 : 1,
      ];
    }

    if (mode === "dry-run") {
      const r = await dryRun(cfg, args);
      const ready = r.button.found && !r.button.disabled;
      const button = !r.button.found ? "not found" : r.button.disabled ? "disabled" : "enabled";
      return [
        {
          mode,
          at: stamp(),
          outcome: ready ? "ready" : "not-ready",
          ms: Date.now() - started,
          ...r,
        },
        [
          stamp(),
          `url: ${r.url}`,
          `main button: ${button}`,
          "inputs:",
          ...r.inputs.map((i) => `  ${i.key} = ${JSON.stringify(i.value)}`),
          "dry run: nothing was sent",
        ].join("\n"),
        ready ? 0 : 1,
      ];
    }

    const r = await withLock(cfg.timeoutMs + 60_000, () => run(cfg, args));
    return [
      { mode, at: stamp(), ms: Date.now() - started, ...r },
      `${stamp()} ${r.outcome} ${secs()}s`,
      r.outcome === "submitted" || r.outcome === "already-done" ? 0 : 1,
    ];
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return [
      { mode, at: stamp(), outcome: "error", ms: Date.now() - started, error },
      `${stamp()} error ${error}`,
      1,
    ];
  }
}

const args = Bun.argv.slice(2);
const json = args.includes("--json");

// Before loadConfig, so help works on a machine with no .env and is not logged as a run.
if (args.some((a) => a === "help" || a === "--help" || a === "-h")) {
  console.log(json ? JSON.stringify({ mode: "help", text: HELP }) : HELP);
  process.exit(0);
}

// Before main(), so a daemon never falls through to the one-shot send path.
if (args.includes("--daemon") || args.includes("daemon")) {
  try {
    await applyEnvFile(args);
    await daemon(loadConfig(process.env), args);
    process.exit(0);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const line = `${stamp()} error ${error}`;
    console.error(line);
    await append(line);
    process.exit(1);
  }
}

const [result, human, code] = await main(args);
console.log(json ? JSON.stringify(result, null, 2) : human);
await append(human);
process.exit(code);
