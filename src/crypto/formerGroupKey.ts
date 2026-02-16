/**
 * Load a former group key by version (from Group.formerGroupKeys).
 * Used when instance._ownerKeyVersion is less than the current group key version.
 */

import { decryptKey } from "@tutao/tutanota-crypto";
import { base64ToBase64Url, stringToUtf8Uint8Array, uint8ArrayToBase64 } from "@tutao/tutanota-utils";
import type { AesKey } from "../auth/kdf.js";
import { toUint8Array, unwrapSingleElementArray } from "../utils/bytes.js";
import type { KeyChain } from "./keyChain.js";
import {
  GROUP,
  GROUP_ATTR_FORMER_GROUP_KEYS,
  GROUP_KEY,
  GROUP_KEY_ATTR_OWNER_ENC_GKEY,
} from "./typeModels.js";
import type { TypeModel } from "./typeModels.js";

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

function stringToCustomId(s: string): string {
  return base64ToBase64Url(uint8ArrayToBase64(stringToUtf8Uint8Array(s)));
}

/**
 * Load the group key for the given version by walking the former-key chain.
 * Requires current key to be in the key chain (from membership).
 *
 * @param keyChain - must already have the current group key for groupId
 * @param groupId - group id (e.g. mail group id)
 * @param currentKeyVersion - current version (e.g. from membership.groupKeyVersion)
 * @param targetKeyVersion - requested version (e.g. instance._ownerKeyVersion "0")
 * @returns the key for targetKeyVersion, or null if not found
 */
export async function loadFormerGroupKey(
  baseUrl: string,
  accessToken: string,
  keyChain: KeyChain,
  loadEntity: LoadEntityFn,
  loadRange: LoadRangeFn,
  groupId: string,
  currentKeyVersion: string,
  targetKeyVersion: string
): Promise<AesKey | null> {
  const currentVer = parseKeyVersion(currentKeyVersion);
  const targetVer = parseKeyVersion(targetKeyVersion);
  if (currentVer <= targetVer) return keyChain.getGroupKey(groupId, targetKeyVersion);

  let currentKey = keyChain.getGroupKey(groupId, currentKeyVersion);
  if (currentKey == null) return null;

  const groupRaw = await loadEntity<Record<string, unknown>>(baseUrl, GROUP, groupId, {
    accessToken,
  });
  const formerRef = groupRaw[GROUP_ATTR_FORMER_GROUP_KEYS];
  if (formerRef == null) return null;
  const refList = unwrapSingleElementArray(formerRef);
  if (refList == null || typeof refList !== "object" || Array.isArray(refList)) return null;
  const listAttr = (refList as Record<string, unknown>)["2269"];
  const listId = Array.isArray(listAttr) ? listAttr[0] : listAttr;
  if (listId == null || typeof listId !== "string") return null;

  const startId = stringToCustomId(String(currentVer));
  const count = currentVer - targetVer;
  const formerKeysRaw = await loadRange<Record<string, unknown>>(baseUrl, GROUP_KEY, listId, {
    accessToken,
    start: startId,
    count,
    reverse: true,
  });

  for (const item of formerKeysRaw) {
    const ownerEncGKey = item[GROUP_KEY_ATTR_OWNER_ENC_GKEY];
    if (ownerEncGKey == null) continue;
    const encBytes = toUint8Array(ownerEncGKey);
    if (encBytes.length === 0) continue;
    try {
      currentKey = decryptKey(currentKey, encBytes);
    } catch {
      return null;
    }
  }

  return currentKey;
}

function parseKeyVersion(s: string): number {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) throw new Error("Invalid key version: " + s);
  return n;
}
