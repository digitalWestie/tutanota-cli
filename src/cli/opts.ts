import type { Command } from "commander";

/**
 * Merge options from root command down to the current (leaf) command.
 * Later commands overwrite earlier ones, so the executing command's options win.
 * Use this instead of cmd.optsWithGlobals() when global options have defaults
 * that would otherwise overwrite subcommand-parsed options (e.g. --format tsv).
 */
export function getOptsWithGlobalsLeafWins(cmd: Command): Record<string, unknown> {
  const chain: Command[] = [];
  for (let c: Command | null = cmd; c; c = c.parent) {
    chain.push(c);
  }
  chain.reverse(); // [root, ..., leaf]
  return chain.reduce(
    (acc, c) => Object.assign(acc, c.opts()),
    {} as Record<string, unknown>
  ) as Record<string, unknown>;
}
