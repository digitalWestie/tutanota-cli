/**
 * Output format helpers. All functions take opts (e.g. program.opts()) so there is no Commander dependency.
 */

import kleur from "kleur";

export type OutputOpts = { output?: string; o?: string; O?: string };

export function getOutputOption(opts: OutputOpts): string {
  return opts.output ?? opts.o ?? opts.O ?? "pretty";
}

export function getOutputFormat(opts: OutputOpts): boolean {
  return getOutputOption(opts) === "json";
}

export function getPlainFormat(opts: OutputOpts): "pretty" | "tsv" {
  const format = getOutputOption(opts);
  if (format !== "pretty" && format !== "tsv" && format !== "json") {
    console.error(`Unknown output format: ${format}. Use pretty, tsv, or json.`);
    process.exit(1);
  }
  return format === "tsv" ? "tsv" : "pretty";
}

const MAX_COL_WIDTH = 80;

export function printTable(rows: string[][], format: "pretty" | "tsv"): void {
  if (rows.length === 0) return;
  if (format === "tsv") {
    for (const row of rows) console.log(row.join("\t"));
    return;
  }
  const cols = rows[0].length;
  const widths: number[] = [];
  for (let j = 0; j < cols; j++) {
    let max = 0;
    for (const row of rows) {
      const len = (row[j] ?? "").length;
      max = Math.min(Math.max(max, len), MAX_COL_WIDTH);
    }
    widths[j] = max;
  }
  const termCols = typeof process.stdout.columns === "number" ? process.stdout.columns : null;
  const totalWidth = widths.reduce((a, b) => a + b, 0) + (cols - 1) * 2;
  if (termCols != null && totalWidth > termCols && cols > 0) {
    const maxPerCol = Math.max(10, Math.floor(termCols / cols) - 2);
    for (let j = 0; j < cols; j++) widths[j] = Math.min(widths[j], maxPerCol);
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const isHeader = i === 0;
    const parts = row.map((cell, j) => {
      const s = (cell ?? "").slice(0, widths[j]);
      const padded = s.padEnd(widths[j]);
      return isHeader ? kleur.bold(padded) : padded;
    });
    console.log(parts.join("  "));
    if (isHeader && rows.length > 1) {
      const separator = widths.map((w) => "-".repeat(w)).join("  ");
      console.log(separator);
    }
  }
}
