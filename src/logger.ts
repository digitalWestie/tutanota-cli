let verbose = false;

export function setVerbose(value: boolean): void {
  verbose = value;
}

export function isVerbose(): boolean {
  return verbose;
}

/** Log to stderr only when verbose mode is on. */
export function log(message: string): void {
  if (verbose) {
    console.error("[verbose]", message);
  }
}

/** Log an error (message, cause, stack) to stderr when verbose. */
export function logError(label: string, err: unknown): void {
  if (!verbose) return;
  console.error("[verbose]", label, err);
  if (err instanceof Error && err.cause) {
    console.error("[verbose] cause:", err.cause);
  }
  if (err instanceof Error && err.stack) {
    console.error("[verbose] stack:", err.stack);
  }
}
