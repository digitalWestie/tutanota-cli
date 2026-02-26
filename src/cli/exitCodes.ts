/**
 * Exit code classification for CLI failure paths.
 * 1 = usage/auth, 2 = network/server. Success (0) is implicit.
 */

import { getErrorMessage } from "../logger.js";

const NETWORK_CAUSE_CODES = ["ETIMEDOUT", "ENETUNREACH", "ECONNRESET", "ECONNREFUSED"];

/**
 * Returns exit code 2 for network or server errors (fetch failed, connection errors, HTTP 5xx),
 * and 1 for all other failures (usage, auth, session expired, HTTP 4xx, etc.).
 */
export function exitCodeForError(err: unknown): 1 | 2 {
  const msg = getErrorMessage(err);
  if (err instanceof Error && err.message === "fetch failed") return 2;
  const cause = err instanceof Error ? (err.cause as { code?: string } | undefined) : undefined;
  if (cause?.code && NETWORK_CAUSE_CODES.includes(cause.code)) return 2;
  if (/HTTP 5\d\d/.test(msg)) return 2;
  return 1;
}
