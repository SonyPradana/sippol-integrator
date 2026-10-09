import { expect, test } from "bun:test";
import type { Config } from "./config.ts";
import { ping } from "./ping.ts";

const cfg = (host: string): Config => ({
  host,
  loginPath: "/login",
  targetPath: "/target",
  username: "u",
  password: "p",
  timeoutMs: 5000,
});

test("a 200 means reachable, with latency and the server header", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response(null, { status: 200, headers: { server: "test-server" } }),
  });
  try {
    const p = await ping(cfg(`http://127.0.0.1:${server.port}`));
    expect(p.outcome).toBe("reachable");
    expect(p.status).toBe(200);
    expect(p.server).toBe("test-server");
    expect(p.latencyMs).toBeGreaterThanOrEqual(0);
    expect(p.error).toBeNull();
  } finally {
    server.stop();
  }
});

test("even an error status means the server answered", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response(null, { status: 404 }),
  });
  try {
    const p = await ping(cfg(`http://127.0.0.1:${server.port}`));
    expect(p.outcome).toBe("reachable");
    expect(p.status).toBe(404);
  } finally {
    server.stop();
  }
});

test("a dead port is unreachable and keeps the error", async () => {
  const p = await ping(cfg("http://127.0.0.1:1"));
  expect(p.outcome).toBe("unreachable");
  expect(p.status).toBeNull();
  expect(p.server).toBeNull();
  expect(typeof p.error).toBe("string");
});
