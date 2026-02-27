/**
 * Resolve Mail session key with former group key retry and bucket key fallback.
 * When resolveSessionKey fails (e.g. mail uses older key version after rotation),
 * loads the former key and retries. When ownerEncSessionKey is absent (unprocessed mail),
 * tries resolveWithBucketKey using the bucket key aggregation.
 */

import {
  decryptKey,
  decryptKeyPair,
  type EncryptedPqKeyPairs,
  isPqKeyPairs,
  isRsaOrRsaX25519KeyPair,
  rsaDecrypt,
  uint8ArrayToKey,
} from "@tutao/tutanota-crypto";
import type { AesKey } from "../auth/kdf.js";
import type { KeyChain } from "./keyChain.js";
import { resolveSessionKey } from "./decryptInstance.js";
import { loadFormerGroupKey } from "./formerGroupKey.js";
import { toUint8Array, unwrapSingleElementArray } from "../utils/bytes.js";
import { isVerbose, log } from "../logger.js";
import {
  MAIL,
  GROUP,
  GROUP_ATTR_CURRENT_KEYS,
  KEYPAIR_ATTR_PUB_ECC,
  KEYPAIR_ATTR_SYM_ENC_PRIV_ECC,
  KEYPAIR_ATTR_PUB_KYBER,
  KEYPAIR_ATTR_SYM_ENC_PRIV_KYBER,
  MAIL_ATTR_OWNER_GROUP,
  MAIL_ATTR_OWNER_KEY_VERSION,
  MAIL_ATTR_BUCKET_KEY,
  BUCKET_KEY_ATTR_PUB_ENC,
  BUCKET_KEY_ATTR_GROUP_ENC,
  BUCKET_KEY_ATTR_KEY_GROUP,
  BUCKET_KEY_ATTR_BUCKET_ENC_SESSION_KEYS,
  BUCKET_KEY_ATTR_PROTOCOL_VERSION,
  BUCKET_KEY_ATTR_RECIPIENT_KEY_VERSION,
  INSTANCE_SESSION_KEY_ATTR_INSTANCE_LIST,
  INSTANCE_SESSION_KEY_ATTR_INSTANCE_ID,
  INSTANCE_SESSION_KEY_ATTR_SYM_ENC_SESSION_KEY,
} from "./typeModels.js";
import type { ServerInstance } from "./decryptInstance.js";
import type { TypeModel } from "./typeModels.js";
import { loadLibOqs } from "./loadLibOqs.js";
import { tutaCryptDecapsulate } from "./tutaCryptDecapsulate.js";
type LoadEntityFn = <T = Record<string, unknown>>(
  baseUrl: string,
  typeModel: TypeModel,
  id: string | [string, string],
  options: { accessToken: string }
) => Promise<T>;
type LoadRangeFn = <T = Record<string, unknown>>(
  baseUrl: string,
  typeModel: TypeModel,
  listId: string,
  options: { accessToken: string; start: string; count: number; reverse: boolean }
) => Promise<T[]>;

/**
 * Extract listId and elementId from raw mail for bucket key session key lookup.
 * rawMail["99"] may be [listId, elementId] for list elements; otherwise use provided params.
 */
function getMailListAndElementId(
  rawMail: ServerInstance,
  listId?: string,
  elementId?: string
): [string, string] | null {
  if (listId != null && elementId != null && listId !== "" && elementId !== "") {
    return [listId, elementId];
  }
  const idRaw = rawMail["99"];
  if (Array.isArray(idRaw) && idRaw.length >= 2) {
    const l = String(idRaw[0] ?? "");
    const e = String(idRaw[1] ?? "");
    return l && e ? [l, e] : null;
  }
  return null;
}

/**
 * Resolve session key from bucket key (groupEncBucketKey path).
 * Used for unprocessed mail where ownerEncSessionKey is absent.
 * Supports keyGroup absent (mail group key) and former key retry.
 */
/** Group (sys): for external chain. admin=224, adminGroupEncGKey=11, adminGroupKeyVersion=2270, groupKeyVersion=2271. */
const GROUP_ATTR_ADMIN = "224";
const GROUP_ATTR_ADMIN_GROUP_ENC_GKEY = "11";
const GROUP_ATTR_ADMIN_GROUP_KEY_VERSION = "2270";
const GROUP_ATTR_GROUP_KEY_VERSION = "2271";

/**
 * Resolve group key for external mail group via chain: internal user group -> external user group -> external mail group.
 * Used when internal user receives mail from secure external sender (bucket key has keyGroup set).
 */
async function resolveWithGroupReference(
  baseUrl: string,
  accessToken: string,
  keyChain: KeyChain,
  loadEntity: LoadEntityFn,
  loadRange: LoadRangeFn,
  keyGroup: string,
  groupKeyVersion: string,
  groupEncBucketKey: Uint8Array
): Promise<AesKey | null> {
  const externalMailGroupRaw = await loadEntity<ServerInstance>(baseUrl, GROUP, keyGroup, { accessToken });
  const externalUserGroupId = externalMailGroupRaw[GROUP_ATTR_ADMIN];
  if (externalUserGroupId == null || String(externalUserGroupId) === "") return null;

  const externalUserGroupRaw = await loadEntity<ServerInstance>(baseUrl, GROUP, String(externalUserGroupId), { accessToken });
  const internalUserGroupId = externalUserGroupRaw[GROUP_ATTR_ADMIN];
  if (internalUserGroupId == null || String(internalUserGroupId) === "") return null;

  const internalUserGroupKeyVersion = String(externalUserGroupRaw[GROUP_ATTR_ADMIN_GROUP_KEY_VERSION] ?? "0");
  let internalUserGroupKey = keyChain.getGroupKey(String(internalUserGroupId), internalUserGroupKeyVersion);
  if (internalUserGroupKey == null) {
    const available = keyChain.getAvailableKeyVersions(String(internalUserGroupId));
    const currentKeyVersion = available.length > 0 ? available.reduce((a, b) => (Number(a) >= Number(b) ? a : b)) : "0";
    internalUserGroupKey = await loadFormerGroupKey(baseUrl, accessToken, keyChain, loadEntity, loadRange, String(internalUserGroupId), currentKeyVersion, internalUserGroupKeyVersion);
    if (internalUserGroupKey == null) return null;
  }

  const extUserEncGKey = toUint8Array(externalUserGroupRaw[GROUP_ATTR_ADMIN_GROUP_ENC_GKEY]);
  if (extUserEncGKey.length === 0) return null;
  let externalUserGroupKey: AesKey;
  try {
    externalUserGroupKey = decryptKey(internalUserGroupKey, extUserEncGKey);
  } catch {
    return null;
  }

  const extMailEncGKey = toUint8Array(externalMailGroupRaw[GROUP_ATTR_ADMIN_GROUP_ENC_GKEY]);
  if (extMailEncGKey.length === 0) return null;
  let externalMailGroupKey: AesKey;
  try {
    externalMailGroupKey = decryptKey(externalUserGroupKey, extMailEncGKey);
  } catch {
    return null;
  }

  try {
    return decryptKey(externalMailGroupKey, groupEncBucketKey);
  } catch {
    return null;
  }
}

/** RSA = 0, TutaCrypt = 2 (CryptoProtocolVersion.TUTA_CRYPT). */
const PROTOCOL_RSA = 0;
const PROTOCOL_TUTA_CRYPT = 2;

/**
 * Convert raw KeyPair from REST (numeric attribute keys) to EncryptedPqKeyPairs format expected by decryptKeyPair.
 * Returns null if PQ attributes are missing.
 */
function rawKeyPairToEncryptedFormat(
  raw: Record<string, unknown>
): EncryptedPqKeyPairs | null {
  const pubEcc = toUint8Array(raw[KEYPAIR_ATTR_PUB_ECC]);
  const symEncPrivEcc = toUint8Array(raw[KEYPAIR_ATTR_SYM_ENC_PRIV_ECC]);
  const pubKyber = toUint8Array(raw[KEYPAIR_ATTR_PUB_KYBER]);
  const symEncPrivKyber = toUint8Array(raw[KEYPAIR_ATTR_SYM_ENC_PRIV_KYBER]);
  if (pubEcc.length === 0 || symEncPrivEcc.length === 0 || pubKyber.length === 0 || symEncPrivKyber.length === 0) {
    return null;
  }
  return {
    pubEccKey: pubEcc,
    symEncPrivEccKey: symEncPrivEcc,
    pubKyberKey: pubKyber,
    symEncPrivKyberKey: symEncPrivKyber,
    pubRsaKey: null,
    symEncPrivRsaKey: null,
    signature: null,
  };
}

/**
 * Resolve bucket key via pubEncBucketKey (asymmetric path) for internal recipients.
 * Supports RSA (protocol 0) and TutaCrypt (protocol 2). TutaCrypt requires liboqs.wasm.
 */
async function resolveWithPubEncBucketKey(
  baseUrl: string,
  accessToken: string,
  keyChain: KeyChain,
  loadEntity: LoadEntityFn,
  loadRange: LoadRangeFn,
  userGroupId: string,
  recipientKeyVersion: string,
  currentKeyVersion: string,
  pubEncBucketKey: Uint8Array,
  protocolVersion: number,
  bucketKeyRaw: Record<string, unknown>,
  listId: string,
  elementId: string
): Promise<AesKey | null> {
  if (protocolVersion !== PROTOCOL_RSA && protocolVersion !== PROTOCOL_TUTA_CRYPT) {
    if (isVerbose()) log(`resolveWithPubEncBucketKey: protocol ${protocolVersion} not supported`);
    return null;
  }

  let groupKey = keyChain.getGroupKey(userGroupId, recipientKeyVersion);
  if (groupKey == null) {
    const formerKey = await loadFormerGroupKey(
      baseUrl,
      accessToken,
      keyChain,
      loadEntity,
      loadRange,
      userGroupId,
      currentKeyVersion,
      recipientKeyVersion
    );
    if (formerKey == null) return null;
    keyChain.addGroupKey(userGroupId, recipientKeyVersion, formerKey);
    groupKey = formerKey;
  }

  const groupRaw = await loadEntity<ServerInstance>(baseUrl, GROUP, userGroupId, { accessToken });
  const currentKeysRaw = groupRaw[GROUP_ATTR_CURRENT_KEYS];
  if (currentKeysRaw == null) {
    if (isVerbose()) log(`resolveWithPubEncBucketKey: Group ${userGroupId} has no currentKeys`);
    return null;
  }
  const keyPairRaw = Array.isArray(currentKeysRaw) ? (currentKeysRaw[0] ?? currentKeysRaw) : currentKeysRaw;
  if (keyPairRaw == null || typeof keyPairRaw !== "object") {
    if (isVerbose()) log(`resolveWithPubEncBucketKey: currentKeys not a valid KeyPair`);
    return null;
  }

  const keyPairForDecrypt = rawKeyPairToEncryptedFormat(keyPairRaw as Record<string, unknown>);
  if (keyPairForDecrypt == null) {
    if (isVerbose()) log(`resolveWithPubEncBucketKey: KeyPair missing required PQ attributes`);
    return null;
  }

  let decryptedKeyPair;
  try {
    decryptedKeyPair = decryptKeyPair(groupKey, keyPairForDecrypt);
  } catch (err) {
    if (isVerbose()) log(`resolveWithPubEncBucketKey: KeyPair decrypt failed: ${err}`);
    return null;
  }

  let decryptedBucketKey: AesKey;
  if (protocolVersion === PROTOCOL_RSA) {
    if (!isRsaOrRsaX25519KeyPair(decryptedKeyPair)) {
      if (isVerbose()) log(`resolveWithPubEncBucketKey: KeyPair is not RSA for protocol 0`);
      return null;
    }
    try {
      const symKeyBytes = rsaDecrypt(decryptedKeyPair.privateKey, pubEncBucketKey);
      decryptedBucketKey = uint8ArrayToKey(symKeyBytes);
    } catch (err) {
      if (isVerbose()) log(`resolveWithPubEncBucketKey: RSA decrypt failed: ${err}`);
      return null;
    }
  } else {
    if (!isPqKeyPairs(decryptedKeyPair)) {
      if (isVerbose()) log(`resolveWithPubEncBucketKey: KeyPair is not TutaCrypt for protocol 2`);
      return null;
    }
    try {
      const liboqs = await loadLibOqs();
      const symKeyBytes = await tutaCryptDecapsulate(liboqs, pubEncBucketKey, decryptedKeyPair);
      decryptedBucketKey = uint8ArrayToKey(symKeyBytes);
    } catch (err) {
      if (isVerbose()) log(`resolveWithPubEncBucketKey: TutaCrypt decrypt failed: ${err}`);
      return null;
    }
  }

  const sessionKeysAgg = bucketKeyRaw[BUCKET_KEY_ATTR_BUCKET_ENC_SESSION_KEYS];
  const sessionKeysList = Array.isArray(sessionKeysAgg) ? sessionKeysAgg : sessionKeysAgg != null ? [sessionKeysAgg] : [];
  for (const iskRaw of sessionKeysList) {
    if (iskRaw == null || typeof iskRaw !== "object") continue;
    const isk = iskRaw as Record<string, unknown>;
    const instList = String(isk[INSTANCE_SESSION_KEY_ATTR_INSTANCE_LIST] ?? "");
    const instId = String(isk[INSTANCE_SESSION_KEY_ATTR_INSTANCE_ID] ?? "");
    if (instList !== listId || instId !== elementId) continue;

    const symEnc = isk[INSTANCE_SESSION_KEY_ATTR_SYM_ENC_SESSION_KEY];
    if (symEnc == null) continue;
    const symEncBytes = toUint8Array(symEnc);
    if (symEncBytes.length === 0) continue;

    try {
      return decryptKey(decryptedBucketKey, symEncBytes);
    } catch (err) {
      if (isVerbose()) log(`resolveWithPubEncBucketKey: session key decrypt failed: ${err}`);
      return null;
    }
  }
  if (isVerbose()) log(`resolveWithPubEncBucketKey: no matching InstanceSessionKey for ${listId}/${elementId}`);
  return null;
}

async function resolveWithBucketKey(
  baseUrl: string,
  accessToken: string,
  keyChain: KeyChain,
  loadEntity: LoadEntityFn,
  loadRange: LoadRangeFn,
  rawMail: ServerInstance,
  mailGroupId: string,
  currentKeyVersion: string,
  listId: string,
  elementId: string,
  userGroupId?: string
): Promise<AesKey | null> {
  const bucketKeyAgg = rawMail[MAIL_ATTR_BUCKET_KEY];
  if (bucketKeyAgg == null) {
    if (isVerbose()) log(`resolveWithBucketKey: bucketKey (1310) absent`);
    return null;
  }

  const bucketKeyList = Array.isArray(bucketKeyAgg) ? bucketKeyAgg : [bucketKeyAgg];
  let bucketKeyRaw = unwrapSingleElementArray(bucketKeyList) ?? bucketKeyList[0];
  if (Array.isArray(bucketKeyRaw) && bucketKeyRaw.length > 0) {
    bucketKeyRaw = bucketKeyRaw[0];
  }
  if (bucketKeyRaw == null || typeof bucketKeyRaw !== "object") {
    if (isVerbose()) log(`resolveWithBucketKey: bucketKey not object`);
    return null;
  }

  const bk = bucketKeyRaw as Record<string, unknown>;
  if (isVerbose()) log(`resolveWithBucketKey: bucketKey keys=${Object.keys(bk).join(",")}`);
  const groupEncBucketKey = bk[BUCKET_KEY_ATTR_GROUP_ENC];
  const pubEncBucketKey = bk[BUCKET_KEY_ATTR_PUB_ENC];
  if (groupEncBucketKey == null && pubEncBucketKey == null) {
    if (isVerbose()) log(`resolveWithBucketKey: groupEncBucketKey (2046) and pubEncBucketKey (2045) both absent`);
    return null;
  }

  const bucketKeyGroup = bk[BUCKET_KEY_ATTR_KEY_GROUP];
  const ownerGroup = rawMail[MAIL_ATTR_OWNER_GROUP];
  const keyGroup =
    bucketKeyGroup != null && String(bucketKeyGroup) !== ""
      ? String(bucketKeyGroup)
      : (ownerGroup != null ? String(ownerGroup) : null);
  if (keyGroup == null || keyGroup === "") {
    if (isVerbose()) log(`resolveWithBucketKey: keyGroup absent`);
    return null;
  }

  const groupKeyVersion = String(bk[BUCKET_KEY_ATTR_RECIPIENT_KEY_VERSION] ?? "0");
  const hasKeyGroup = bucketKeyGroup != null && String(bucketKeyGroup) !== "";
  if (isVerbose()) log(`resolveWithBucketKey: keyGroup=${keyGroup} keyGroupFromBucket=${hasKeyGroup} recipientKeyVersion=${groupKeyVersion} listId=${listId} elementId=${elementId}`);

  if (groupEncBucketKey == null && pubEncBucketKey != null) {
    if (userGroupId != null && keyGroup === userGroupId) {
      const protocolVersion = Number(bk[BUCKET_KEY_ATTR_PROTOCOL_VERSION] ?? 0);
      const pubEncBytes = toUint8Array(pubEncBucketKey);
      if (pubEncBytes.length > 0) {
        const sk = await resolveWithPubEncBucketKey(
          baseUrl,
          accessToken,
          keyChain,
          loadEntity,
          loadRange,
          userGroupId,
          groupKeyVersion,
          currentKeyVersion,
          pubEncBytes,
          protocolVersion,
          bk,
          listId,
          elementId
        );
        if (sk != null) return sk;
      }
    }
    if (isVerbose()) log(`resolveWithBucketKey: pubEncBucketKey (2045) present but groupEnc absent; keyGroup match=${userGroupId != null && keyGroup === userGroupId}`);
    return null;
  }

  let decryptedBucketKey: AesKey;
  if (hasKeyGroup) {
    const encBytes = toUint8Array(groupEncBucketKey);
    if (encBytes.length === 0) return null;
    const bkResult = await resolveWithGroupReference(baseUrl, accessToken, keyChain, loadEntity, loadRange, keyGroup, groupKeyVersion, encBytes);
    if (bkResult == null) return null;
    decryptedBucketKey = bkResult;
  } else {
    let groupKey = keyChain.getGroupKey(keyGroup, groupKeyVersion);
    if (groupKey == null) {
      const formerKey = await loadFormerGroupKey(
        baseUrl,
        accessToken,
        keyChain,
        loadEntity,
        loadRange,
        keyGroup,
        currentKeyVersion,
        groupKeyVersion
      );
      if (formerKey == null) return null;
      keyChain.addGroupKey(keyGroup, groupKeyVersion, formerKey);
      groupKey = formerKey;
    }
    const encBytes = toUint8Array(groupEncBucketKey);
    if (encBytes.length === 0) return null;
    try {
      decryptedBucketKey = decryptKey(groupKey, encBytes);
    } catch (err) {
      if (isVerbose()) log(`resolveWithBucketKey: bucket key decrypt failed: ${err}`);
      return null;
    }
  }

  const sessionKeysAgg = bk[BUCKET_KEY_ATTR_BUCKET_ENC_SESSION_KEYS];
  const sessionKeysList = Array.isArray(sessionKeysAgg) ? sessionKeysAgg : sessionKeysAgg != null ? [sessionKeysAgg] : [];
  if (isVerbose()) log(`resolveWithBucketKey: bucketEncSessionKeys count=${sessionKeysList.length}`);
  for (const iskRaw of sessionKeysList) {
    if (iskRaw == null || typeof iskRaw !== "object") continue;
    const isk = iskRaw as Record<string, unknown>;
    const instList = String(isk[INSTANCE_SESSION_KEY_ATTR_INSTANCE_LIST] ?? "");
    const instId = String(isk[INSTANCE_SESSION_KEY_ATTR_INSTANCE_ID] ?? "");
    if (isVerbose() && sessionKeysList.length <= 3) log(`resolveWithBucketKey: isk instList=${instList} instId=${instId} match=${instList === listId && instId === elementId}`);
    if (instList !== listId || instId !== elementId) continue;

    const symEnc = isk[INSTANCE_SESSION_KEY_ATTR_SYM_ENC_SESSION_KEY];
    if (symEnc == null) continue;
    const symEncBytes = toUint8Array(symEnc);
    if (symEncBytes.length === 0) continue;

    try {
      return decryptKey(decryptedBucketKey, symEncBytes);
    } catch (err) {
      if (isVerbose()) log(`resolveWithBucketKey: session key decrypt failed: ${err}`);
      return null;
    }
  }
  if (isVerbose()) log(`resolveWithBucketKey: no matching InstanceSessionKey for ${listId}/${elementId}`);
  return null;
}

/**
 * Resolve session key for a Mail entity. If resolution fails (e.g. mail uses
 * an older key version), tries loading the former group key and retries.
 * When ownerEncSessionKey is absent (unprocessed mail with bucket key), tries
 * resolveWithBucketKey. Pass listId and elementId when available for bucket key lookup.
 * Pass userGroupId for pubEncBucketKey (asymmetric) path when mail is for internal recipient.
 */
export async function resolveMailSessionKeyWithFormerRetry(
  baseUrl: string,
  accessToken: string,
  keyChain: KeyChain,
  loadEntity: LoadEntityFn,
  loadRange: LoadRangeFn,
  mailGroupId: string,
  currentKeyVersion: string,
  rawMail: ServerInstance,
  listId?: string,
  elementId?: string,
  userGroupId?: string
): Promise<AesKey | null> {
  let sk = resolveSessionKey(keyChain, rawMail, MAIL);
  if (sk != null) return sk;

  const targetKeyVersion = String(rawMail[MAIL_ATTR_OWNER_KEY_VERSION] ?? "");
  if (targetKeyVersion !== "") {
    // Load former key if we don't have it yet (e.g. Mail uses older version than MailSet pre-load)
    if (keyChain.getGroupKey(mailGroupId, targetKeyVersion) == null) {
      const formerKey = await loadFormerGroupKey(
        baseUrl,
        accessToken,
        keyChain,
        loadEntity,
        loadRange,
        mailGroupId,
        currentKeyVersion,
        targetKeyVersion
      );
      if (formerKey != null) {
        keyChain.addGroupKey(mailGroupId, targetKeyVersion, formerKey);
        sk = resolveSessionKey(keyChain, rawMail, MAIL);
        if (sk != null) return sk;
      }
    }
  }

  // Unprocessed mail: ownerEncSessionKey absent, use bucket key
  const ids = getMailListAndElementId(rawMail, listId, elementId);
  if (ids != null) {
    const [l, e] = ids;
    sk = await resolveWithBucketKey(
      baseUrl,
      accessToken,
      keyChain,
      loadEntity,
      loadRange,
      rawMail,
      mailGroupId,
      currentKeyVersion,
      l,
      e,
      userGroupId
    );
    if (sk != null) return sk;
  }

  return null;
}
