import { rm } from "node:fs/promises";

const LOCK = "sippol.lock";

/**
 * Refuses a second run while one is in flight, so a scheduler cannot click send twice.
 * `maxAgeMs` must exceed the run's own timeout: a legitimate run holds the lock while it
 * waits for the alert. A lock older than that is a crash leftover and is taken over.
 */
export async function withLock<T>(maxAgeMs: number, body: () => Promise<T>): Promise<T> {
  const existing = Bun.file(LOCK);
  if ((await existing.exists()) && Date.now() - existing.lastModified < maxAgeMs) {
    throw new Error("another run holds the lock; refusing to send twice");
  }

  await Bun.write(LOCK, "");
  try {
    return await body();
  } finally {
    // force: true, so a cleanup hiccup cannot replace the body's own error
    await rm(LOCK, { force: true });
  }
}
