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
