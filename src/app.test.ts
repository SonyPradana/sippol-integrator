import { expect, test } from "bun:test";

/**
 * Exercises the real entrypoint as a subprocess. Only `help` is covered, because it is
 * the one mode that needs no config, no browser, and no network.
 */

const app = async (...argv: string[]) => {
  const p = Bun.spawn([process.execPath, `${import.meta.dir}/app.ts`, ...argv], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(p.stdout).text();
  return { code: await p.exited, out };
};

test("help prints usage and exits 0", async () => {
  const { code, out } = await app("help");
  expect(code).toBe(0);
  expect(out).toContain("app --dry-run");
  expect(out).toContain("--json");
}, 30_000);

test("--json makes help machine-readable", async () => {
  const { code, out } = await app("help", "--json");
  const parsed = JSON.parse(out) as Record<string, unknown>;
  expect(code).toBe(0);
  expect(parsed.mode).toBe("help");
  expect(parsed.text).toContain("sippol-integrator");
}, 30_000);
