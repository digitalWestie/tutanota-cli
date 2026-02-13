import {
  base64ToBase64Ext,
  base64ToBase64Url,
  base64UrlToBase64,
  base64ToUint8Array,
  uint8ArrayToBase64,
} from "@tutao/tutanota-utils";
import { sha256Hash } from "@tutao/tutanota-crypto";
import * as http from "../http.js";
import * as logger from "../logger.js";
import {
  buildCreateSessionDataRequest,
  buildSaltDataRequest,
  normalizeCreateSessionReturn,
  normalizeSaltReturn,
} from "./types.js";
import { buildAuthVerifier, deriveUserPassphraseKey, saltToUint8Array } from "./kdf.js";

const GENERATED_ID_BYTES_LENGTH = 9;
const CLIENT_IDENTIFIER = "Tutanota CLI";

export interface LoginResult {
  accessToken: string;
  userId: string;
  sessionId: [string, string];
}

/**
 * Derive session list id and element id from access token (same as LoginFacade).
 */
export function getSessionIdFromAccessToken(accessToken: string): [string, string] {
  const bytes = base64ToUint8Array(base64UrlToBase64(accessToken));
  const listId = base64ToBase64Ext(uint8ArrayToBase64(bytes.slice(0, GENERATED_ID_BYTES_LENGTH)));
  const elementIdHash = sha256Hash(bytes.slice(GENERATED_ID_BYTES_LENGTH));
  const elementId = base64ToBase64Url(uint8ArrayToBase64(elementIdHash));
  return [listId, elementId];
}

/**
 * Perform login: get salt, derive key, create session. Fails if 2FA is required.
 */
export async function login(
  baseUrl: string,
  email: string,
  password: string
): Promise<LoginResult> {
  logger.log("Fetching salt…");
  const saltReq = buildSaltDataRequest(email);
  const saltResRaw = await http.get<Record<string, unknown>>(baseUrl, "/rest/sys/saltservice", {
    body: saltReq,
  });
  logger.log("Salt received.");
  const saltRes = normalizeSaltReturn(saltResRaw);

  const salt = saltToUint8Array(saltRes.salt);
  const userPassphraseKey = await deriveUserPassphraseKey(
    password,
    salt,
    String(saltRes.kdfVersion)
  );
  const authVerifier = buildAuthVerifier(userPassphraseKey);

  logger.log("Creating session…");
  const sessionReq = buildCreateSessionDataRequest(email, authVerifier, CLIENT_IDENTIFIER);
  const sessionResRaw = await http.post<Record<string, unknown>>(
    baseUrl,
    "/rest/sys/sessionservice",
    sessionReq
  );
  const sessionRes = normalizeCreateSessionReturn(sessionResRaw);

  if (sessionRes.challenges && sessionRes.challenges.length > 0) {
    throw new Error(
      "This account has two-factor authentication (2FA) enabled. 2FA is not supported in this CLI yet. Please log in via the official Tutanota client or disable 2FA for this account."
    );
  }

  const sessionId = getSessionIdFromAccessToken(sessionRes.accessToken);

  return {
    accessToken: sessionRes.accessToken,
    userId: sessionRes.user,
    sessionId,
  };
}

/**
 * Verify the session token by calling an authenticated endpoint.
 * Throws if the request fails (e.g. 401).
 */
export async function verifySession(baseUrl: string, accessToken: string): Promise<void> {
  logger.log("Verifying session…");
  try {
    await http.get<Record<string, unknown>>(baseUrl, "/rest/sys/systemkeysservice", {
      accessToken,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error("Session verification failed: " + message);
  }
}

function toPathSegment(id: unknown): string {
  if (Array.isArray(id)) {
    return (id as string[]).join("/");
  }
  return String(id);
}

/**
 * Load the User entity (unencrypted). userId may be a string or array from create-session return.
 */
export async function loadUser(
  baseUrl: string,
  accessToken: string,
  userId: string | string[]
): Promise<Record<string, unknown>> {
  const id = Array.isArray(userId) ? userId[0] : userId;
  logger.log("Loading user…");
  return http.get<Record<string, unknown>>(baseUrl, `/rest/sys/user/${id}`, {
    accessToken,
  });
}

/**
 * Load the Customer entity (unencrypted). customerId may be string or IdTuple from User.customer.
 */
export async function loadCustomer(
  baseUrl: string,
  accessToken: string,
  customerId: unknown
): Promise<Record<string, unknown>> {
  if (customerId == null) throw new Error("No customer id");
  const path = `/rest/sys/customer/${toPathSegment(customerId)}`;
  logger.log("Loading customer…");
  return http.get<Record<string, unknown>>(baseUrl, path, { accessToken });
}

/**
 * Load the CustomerInfo entity (unencrypted). Pass listId and elementId from Customer.customerInfo.
 */
export async function loadCustomerInfo(
  baseUrl: string,
  accessToken: string,
  listId: string,
  elementId: string
): Promise<Record<string, unknown>> {
  logger.log("Loading customer info…");
  return http.get<Record<string, unknown>>(
    baseUrl,
    `/rest/sys/customerinfo/${listId}/${elementId}`,
    { accessToken }
  );
}
