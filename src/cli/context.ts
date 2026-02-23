/**
 * Shared CLI context: session handling and concurrency helper.
 */

import { getCredentials } from "../config.js";
import {
  getPassphraseKeyForSession,
  getSessionIdFromAccessToken,
  login,
  loadUser,
  verifySession,
} from "../auth/login.js";
import type { LoginResult } from "../auth/login.js";
import { getErrorMessage } from "../logger.js";
import { clearSession, readSession, writeSession } from "../session.js";
import type { AesKey } from "../auth/kdf.js";

/** True if the error indicates an expired, invalid, or timed-out session (e.g. HTTP 401 or 440). */
export function isSessionExpiredOrInvalid(err: unknown): boolean {
  const msg = getErrorMessage(err);
  return msg.includes("401") || msg.includes("440") || msg.includes("Unauthorized");
}

/** Run fn on each item with at most concurrency in flight; preserves order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: (R | undefined)[] = new Array(items.length);
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const i = index++;
        if (i >= items.length) break;
        results[i] = await fn(items[i], i);
      }
    })
  );
  return results as R[];
}

/** Get a valid session: use stored session if valid, otherwise prompt and login, then persist. */
export async function getOrCreateSession(
  baseUrl: string,
  verbose: boolean
): Promise<{ result: LoginResult; usedStoredSession: boolean }> {
  let session = null;
  try {
    session = readSession();
  } catch {
    session = null;
  }

  if (session != null) {
    try {
      await verifySession(baseUrl, session.accessToken);
      if (verbose) console.error("[verbose] Using stored session.");
      return {
        result: {
          accessToken: session.accessToken,
          userId: session.userId,
          sessionId: session.sessionId ?? getSessionIdFromAccessToken(session.accessToken),
        },
        usedStoredSession: true,
      };
    } catch (err) {
      const cause = err instanceof Error ? (err.cause as { code?: string } | undefined) : undefined;
      const isNetworkError =
        (err instanceof Error && err.message === "fetch failed") ||
        (cause?.code && ["ETIMEDOUT", "ENETUNREACH", "ECONNRESET", "ECONNREFUSED"].includes(cause.code));
      console.error(
        isNetworkError
          ? "Network error while checking session; logging in again."
          : "Session invalid or expired; logging in again."
      );
      clearSession();
    }
  } else if (verbose) {
    console.error("[verbose] No stored session found, logging in.");
  }

  const { email, password } = await getCredentials();
  const result = await login(baseUrl, email, password);
  const userIdRaw = result.userId as string | string[];
  const userId =
    typeof userIdRaw === "string"
      ? userIdRaw
      : Array.isArray(userIdRaw) && userIdRaw.length > 0
        ? String(userIdRaw[0])
        : String(userIdRaw);
  writeSession({
    baseUrl,
    accessToken: result.accessToken,
    userId,
    sessionId: result.sessionId,
  });
  return { result, usedStoredSession: false };
}

/**
 * Get user passphrase key for decryption. Uses result.userPassphraseKey if present (just logged in),
 * otherwise prompts for email and password and derives key via getPassphraseKeyForSession.
 */
export async function getPassphraseKeyForDecryption(
  baseUrl: string,
  result: LoginResult,
  verbose: boolean
): Promise<AesKey> {
  if (result.userPassphraseKey != null) {
    return result.userPassphraseKey;
  }
  if (verbose) console.error("[verbose] No passphrase key in session; prompting for credentials to decrypt.");
  const { email, password } = await getCredentials();
  return getPassphraseKeyForSession(baseUrl, email, password);
}
