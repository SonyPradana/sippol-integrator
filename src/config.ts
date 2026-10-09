export type Config = {
  host: string;
  loginPath: string;
  targetPath: string;
  username: string;
  password: string;
  timeoutMs: number;
};

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Every key is prefixed with SIMPUS_ on purpose. An unprefixed USERNAME is already set on
 * Windows to the logged-in user, and dotenv does not override an existing variable, so the
 * app would silently log in as the wrong account.
 */
function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[`SIMPUS_${key}`]?.trim();
  if (!value) throw new Error(`missing SIMPUS_${key} in .env`);
  return value;
}

/**
 * Explicit env file via --env-file PATH. Lowest priority: only fills keys the
 * environment does not already have, so the shell and the CWD .env keep winning.
 */
export async function applyEnvFile(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const i = argv.indexOf("--env-file");
  if (i === -1) return;
  const path = argv[i + 1];
  if (path === undefined || path.startsWith("--")) throw new Error("missing --env-file PATH");
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch {
    throw new Error(`cannot read --env-file: ${path}`);
  }
  for (const [key, value] of parseEnv(text)) {
    if (env[key] === undefined) env[key] = value;
  }
}

/**
 * Minimal KEY=VALUE parsing: skips blanks, # comments, lines without =, and keys
 * outside SIMPUS_, so an env file can never set PATH, BUN_OPTIONS, or anything else.
 */
export function parseEnv(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key.startsWith("SIMPUS_")) continue;
    out.push([key, unquote(line.slice(eq + 1).trim())]);
  }
  return out;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const raw = env["SIMPUS_TIMEOUT_MS"];
  const timeoutMs = raw === undefined ? DEFAULT_TIMEOUT_MS : Number(raw);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`invalid SIMPUS_TIMEOUT_MS: ${String(raw)}`);
  }

  return {
    host: required(env, "HOST"),
    loginPath: required(env, "LOGIN_PATH"),
    targetPath: required(env, "TARGET_PATH"),
    username: required(env, "USERNAME"),
    password: required(env, "PASSWORD"),
    timeoutMs,
  };
}
