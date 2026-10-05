import { appendFile, mkdir } from "node:fs/promises";

const DIR = "logs";

/** Appends text to logs/YYYY-MM-DD.log, one file per UTC day to match the timestamps. */
export async function append(text: string): Promise<void> {
  await mkdir(DIR, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  await appendFile(`${DIR}/${day}.log`, `${text}\n`);
}
