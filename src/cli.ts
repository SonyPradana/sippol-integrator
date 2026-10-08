const MAP = { "--from": "tanggal_awal", "--to": "tanggal_akhir" } as const;

const pad = (n: number): string => String(n).padStart(2, "0");

const day = (d: Date): string => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;

/**
 * Builds the target query string from CLI flags.
 * The server renders these values into the page's date inputs, which is what
 * the page's own click handler reads before calling the send endpoint.
 */
export function queryFrom(argv: string[], now: Date = new Date()): string {
  const query = new URLSearchParams();

  // Set first, so --for and then --from / --to still win over it.
  if (argv.includes("--for-month")) {
    query.set(MAP["--from"], day(new Date(now.getFullYear(), now.getMonth(), 1)));
    query.set(MAP["--to"], day(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
  }

  // Set before the loop so --from / --to still win over the side they name.
  const at = argv.indexOf("--for");
  if (at !== -1) {
    const value = argv[at + 1];
    if (value !== undefined && !value.startsWith("--")) {
      query.set(MAP["--from"], value);
      query.set(MAP["--to"], value);
    }
  }

  for (const flag of ["--from", "--to"] as const) {
    const at = argv.indexOf(flag);
    if (at === -1) continue;

    const value = argv[at + 1];
    if (value !== undefined && !value.startsWith("--")) query.set(MAP[flag], value);
  }

  return query.toString();
}
