const MAP = { "--from": "tanggal_awal", "--to": "tanggal_akhir" } as const;

/**
 * Builds the target query string from CLI flags.
 * The server renders these values into the page's date inputs, which is what
 * the page's own click handler reads before calling the send endpoint.
 */
export function queryFrom(argv: string[]): string {
  const query = new URLSearchParams();

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
