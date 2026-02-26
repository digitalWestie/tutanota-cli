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

export interface PrintTableOptions {
  /** Max width per column index (0-based). Overrides MAX_COL_WIDTH for that column. */
  colMaxWidths?: Record<number, number>;
  /** Column indices that are never shrunk for terminal width and never truncated with "...". */
  keepFullWidthColumns?: number[];
  /** When table is too wide, assign leftover width (after even redistribution) to this column index (e.g. 2 for Subject). */
  preferExtraWidthForColumn?: number;
}

export function printTable(
  rows: string[][],
  format: "pretty" | "tsv",
  options?: PrintTableOptions | Record<number, number>
): void {
  if (rows.length === 0) return;
  if (format === "tsv") {
    for (const row of rows) console.log(row.join("\t"));
    return;
  }
  const opts: PrintTableOptions =
    options != null && !("colMaxWidths" in options) && !("keepFullWidthColumns" in options)
      ? { colMaxWidths: options as Record<number, number> }
      : (options as PrintTableOptions) ?? {};
  const colMaxWidths = opts.colMaxWidths;
  const keepFull = new Set(opts.keepFullWidthColumns ?? []);
  const preferExtraWidthForColumn = opts.preferExtraWidthForColumn;

  const cols = rows[0].length;

  const widths: number[] = [];
  for (let j = 0; j < cols; j++) {
    const cap = colMaxWidths?.[j] ?? MAX_COL_WIDTH;
    let max = 0;
    for (const row of rows) {
      const len = (row[j] ?? "").length;
      max = Math.min(Math.max(max, len), cap);
    }
    widths[j] = max;
  }

  const termCols = typeof process.stdout.columns === "number" ? process.stdout.columns : null;
  const totalWidth = widths.reduce((a, b) => a + b, 0) + (cols - 1) * 2;
  if (termCols != null && totalWidth > termCols && cols > 0) {
    const spacing = (cols - 1) * 2;
    const availableWidth = termCols - spacing;
    const evenShare = Math.max(10, Math.floor(availableWidth / cols));
    for (let j = 0; j < cols; j++) {
      if (!keepFull.has(j)) widths[j] = Math.min(widths[j], evenShare);
    }
    const usedAfterRedist = widths.reduce((a, b) => a + b, 0);
    const leftover = availableWidth - usedAfterRedist;
    if (leftover > 0 && preferExtraWidthForColumn != null && preferExtraWidthForColumn >= 0 && preferExtraWidthForColumn < cols) {
      const j = preferExtraWidthForColumn;
      const cap = colMaxWidths?.[j] ?? MAX_COL_WIDTH;
      const add = Math.min(leftover, cap - widths[j]);
      if (add > 0) widths[j] += add;
    }
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const isHeader = i === 0;
    const parts = row.map((cell, j) => {
      const raw = cell ?? "";
      let s: string;
      if (keepFull.has(j) || raw.length <= widths[j]) {
        s = raw;
      } else {
        s = widths[j] > 3 ? raw.slice(0, widths[j] - 3) + "..." : raw.slice(0, widths[j]);
      }
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
