/**
 * Load and decrypt mail body (and optional full MailDetails) from MailDetailsBlob.
 * Uses Mail's session key; supports non-draft mails only.
 */

import { aesDecrypt } from "@tutao/tutanota-crypto";
import { base64ToUint8Array, utf8Uint8ArrayToString } from "@tutao/tutanota-utils";
import type { AesKey } from "../auth/kdf.js";
import type { KeyChain } from "../crypto/keyChain.js";
import { resolveMailSessionKeyWithFormerRetry } from "../crypto/resolveMailSessionKey.js";
import type { ServerInstance } from "../crypto/decryptInstance.js";
import {
  MAIL,
  MAIL_DETAILS_BLOB_ATTR_DETAILS,
  MAIL_DETAILS_ATTR_BODY,
  BODY_ATTR_TEXT,
  BODY_ATTR_COMPRESSED_TEXT,
  MAIL_ATTR_MAIL_DETAILS,
  MAIL_ATTR_MAIL_DETAILS_DRAFT,
} from "../crypto/typeModels.js";
import { isVerbose, log } from "../logger.js";
import { loadMailDetailsBlobFromBlobServer } from "../rest.js";
import { requestBlobReadTokenArchive } from "../blobToken.js";
import { decompressString } from "../utils/compression.js";
import { unwrapSingleElementArray } from "../utils/bytes.js";

/** Parse mailDetails (1308) from Mail: [[listId, elementId]], [listId, elementId], or "listId/elementId". */
export function parseMailDetailsRef(mailDetails: unknown): [string, string] | null {
  if (mailDetails == null) return null;
  // Server may send ref as [[listId, elementId]] (single-element array wrapping tuple)
  const unwrapped = unwrapSingleElementArray(mailDetails);
  const value = unwrapped ?? mailDetails;
  if (Array.isArray(value) && value.length >= 2) {
    const listId = String(value[0] ?? "");
    const elementId = String(value[1] ?? "");
    return listId && elementId ? [listId, elementId] : null;
  }
  if (typeof value === "string" && value.includes("/")) {
    const parts = value.split("/");
    if (parts.length >= 2 && parts[0] && parts[1]) return [parts[0], parts[1]];
  }
  return null;
}

function decryptBodyField(
  sessionKey: AesKey,
  encryptedBase64: unknown,
  isCompressed: boolean
): string {
  if (encryptedBase64 == null || encryptedBase64 === "") return "";
  try {
    const bytes = aesDecrypt(sessionKey, base64ToUint8Array(String(encryptedBase64)));
    return isCompressed ? decompressString(bytes) : utf8Uint8ArrayToString(bytes);
  } catch {
    return "";
  }
}

export interface MailDetailsResult {
  bodyText: string;
  /** Optional: sentDate (1284), recipients (1286), etc. for headers. */
  details?: ServerInstance;
}

/**
 * Load MailDetailsBlob by mail.mailDetails id, decrypt body using Mail's session key.
 * Returns body text (compressedText ?? text ?? ""). Fails if mail is draft or mailDetails missing.
 */
export async function loadMailBody(options: {
  baseUrl: string;
  accessToken: string;
  decryptedMail: ServerInstance;
  /** Raw (encrypted) mail for session key resolution; ownerEncSessionKey is lost after decrypt. */
  rawMail: ServerInstance;
  keyChain: KeyChain;
  mailGroupId: string;
  mailMembership: { groupKeyVersion: string };
  /** User group id for pubEncBucketKey (asymmetric) path when mail is for internal recipient. */
  userGroupId?: string;
  loadEntity: typeof import("../rest.js").loadEntity;
  loadRange: typeof import("../rest.js").loadRange;
  /** Mail listId and elementId for bucket key session key lookup (unprocessed mail). */
  listId?: string;
  elementId?: string;
}): Promise<MailDetailsResult> {
  const { baseUrl, accessToken, decryptedMail, rawMail, keyChain, mailGroupId, mailMembership, userGroupId, loadEntity, loadRange, listId: mailListId, elementId: mailElementId } = options;

  // Check both raw and decrypted: mailDetailsDraft (1309) present means draft; main client refuses to load MailDetailsBlob for drafts
  const mailDetailsDraft = rawMail[MAIL_ATTR_MAIL_DETAILS_DRAFT] ?? decryptedMail[MAIL_ATTR_MAIL_DETAILS_DRAFT];
  const isDraftRef = (v: unknown): boolean => {
    if (v == null) return false;
    if (Array.isArray(v) && v.length >= 2) return true;
    if (typeof v === "string" && v.includes("/")) return true;
    return false;
  };
  if (isDraftRef(mailDetailsDraft)) {
    throw new Error("Draft messages are not supported for read. Use a non-draft mail id from 'envelope list'.");
  }

  const mailDetailsRaw = decryptedMail[MAIL_ATTR_MAIL_DETAILS];
  const mailDetailsRef = parseMailDetailsRef(mailDetailsRaw);
  if (mailDetailsRef == null) {
    if (isVerbose()) {
      log(`loadMailBody: mailDetails (1308) raw value: ${JSON.stringify(mailDetailsRaw)}`);
    }
    throw new Error("No mail body available for this message (mailDetails missing).");
  }

  const [detailsListId, detailsElementId] = mailDetailsRef;
  const { blobAccessToken, serverUrl } = await requestBlobReadTokenArchive(baseUrl, detailsListId, accessToken);
  const blobResponse = await loadMailDetailsBlobFromBlobServer(
    serverUrl,
    detailsListId,
    detailsElementId,
    blobAccessToken,
    accessToken
  );
  const blobRaw = (Array.isArray(blobResponse) ? blobResponse[0] : blobResponse) as ServerInstance;
  if (blobRaw == null || typeof blobRaw !== "object") {
    throw new Error("MailDetailsBlob response empty or invalid.");
  }

  const sessionKey = await resolveMailSessionKeyWithFormerRetry(
    baseUrl,
    accessToken,
    keyChain,
    loadEntity,
    loadRange,
    mailGroupId,
    mailMembership.groupKeyVersion,
    rawMail,
    mailListId,
    mailElementId,
    userGroupId
  );
  if (sessionKey == null) {
    throw new Error("Could not resolve session key to decrypt mail body.");
  }

  const detailsAgg = blobRaw[MAIL_DETAILS_BLOB_ATTR_DETAILS];
  const detailsList = Array.isArray(detailsAgg) ? detailsAgg : detailsAgg != null ? [detailsAgg] : [];
  const firstDetails = detailsList[0] as ServerInstance | undefined;
  if (firstDetails == null) {
    throw new Error("MailDetailsBlob has no details.");
  }

  const bodyAgg = firstDetails[MAIL_DETAILS_ATTR_BODY];
  const bodyList = Array.isArray(bodyAgg) ? bodyAgg : bodyAgg != null ? [bodyAgg] : [];
  const bodyInstance = bodyList[0] as ServerInstance | undefined;
  if (bodyInstance == null) {
    return { bodyText: "", details: firstDetails };
  }

  const compressedText = decryptBodyField(
    sessionKey,
    bodyInstance[BODY_ATTR_COMPRESSED_TEXT],
    true
  );
  const text = decryptBodyField(sessionKey, bodyInstance[BODY_ATTR_TEXT], false);

  const bodyText = compressedText !== "" ? compressedText : text;

  return { bodyText, details: firstDetails };
}
