import type { Config } from "./config.ts";

export type Ping = {
  outcome: "reachable" | "unreachable";
  url: string;
  status: number | null;
  latencyMs: number;
  server: string | null;
  error: string | null;
};

/** Bound for one HEAD round-trip. A live server answers fast or not at all. */
const PING_TIMEOUT_MS = 15_000;

/**
 * Read-only pre-flight: one HEAD against the login page. Any HTTP status means
 * the server is alive — even a 404 or 405 — so only a network error counts as
 * unreachable. Never throws; the failure is the value.
 */
export async function ping(cfg: Config): Promise<Ping> {
  const url = new URL(cfg.loginPath, cfg.host).href;
  const start = Date.now();
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
    return {
      outcome: "reachable",
      url,
      status: res.status,
      latencyMs: Date.now() - start,
      server: res.headers.get("server"),
      error: null,
    };
  } catch (err) {
    return {
      outcome: "unreachable",
      url,
      status: null,
      latencyMs: Date.now() - start,
      server: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
