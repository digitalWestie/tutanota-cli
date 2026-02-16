let verbose = false;

/** Extract a string message from an unknown error (Error.message or String(err)). */
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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
