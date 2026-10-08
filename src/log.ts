import { appendFile, mkdir } from "node:fs/promises";

const DIR = "logs";

const pad = (n: number, len = 2): string => String(n).padStart(len, "0");

/** The local wall clock as ISO 8601 with the system's UTC offset, so logs match the machine. */
export function stamp(at: Date = new Date()): string {
  const offset = -at.getTimezoneOffset();
  const abs = Math.abs(offset);
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}` +
    `.${pad(at.getMilliseconds(), 3)}` +
    `${offset < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Appends text to logs/YYYY-MM-DD.log, one file per local day to match the timestamps. */
export async function append(text: string): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await appendFile(`${DIR}/${stamp().slice(0, 10)}.log`, `${text}\n`);
}
