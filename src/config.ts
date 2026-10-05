export type Config = {
  host: string;
  loginPath: string;
  targetPath: string;
  username: string;
  password: string;
  timeoutMs: number;
};

const DEFAULT_TIMEOUT_MS = 120_000;

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`missing ${key} in .env`);
  return value;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const raw = env["TIMEOUT_MS"];
  const timeoutMs = raw === undefined ? DEFAULT_TIMEOUT_MS : Number(raw);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`invalid TIMEOUT_MS: ${String(raw)}`);
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
