/**
 * Resolve session key from encrypted instance and key chain; decrypt instance values.
 * Uses only @tutao/tutanota-crypto (decryptKey, decryptKeyUnauthenticatedWithDeviceKeyChain, aesDecrypt, keyToUint8Array, uint8ArrayToKey) and @tutao/tutanota-utils.
 */

import {
  aesDecrypt,
  decryptKey,
  decryptKeyUnauthenticatedWithDeviceKeyChain,
  keyToUint8Array,
  uint8ArrayToKey,
} from "@tutao/tutanota-crypto";
import { base64ToUint8Array, utf8Uint8ArrayToString } from "@tutao/tutanota-utils";
import type { AesKey } from "../auth/kdf.js";
import type { KeyChain } from "./keyChain.js";
import {
  type TypeModel,
  type ValueModel,
  getOwnerAttrs,
  ValueType,
} from "./typeModels.js";

/** Server-side instance: object keyed by numeric attribute id (string keys). */
export type ServerInstance = Record<string, unknown>;

/**
 * Callback after resolving session key: which method worked, or null if all failed.
 */
export type OnSessionKeyResolved = (method: "256" | "128" | "256-legacy" | null) => void;

/**
 * Callback for each session key attempt (for verbose logging).
 * Called with method name, success flag, and error if failed.
 */
export type OnSessionKeyAttempt = (
  method: "256-legacy" | "256" | "128",
  success: boolean,
  err?: unknown
) => void;

/**
 * Resolve session key for an encrypted entity using key chain and owner fields.
 * Tries (1) 256-legacy, (2) 256 normal, (3) 128-bit. When onSessionKeyAttempt is provided, it is called for every attempt.
 * @param tryKeyVersion - when set, use this version instead of instance._ownerKeyVersion (for retrying with alternate group keys).
 */
export function resolveSessionKey(
  keyChain: KeyChain,
  instance: ServerInstance,
  typeModel: TypeModel,
  onSessionKeyResolved?: OnSessionKeyResolved,
  onSessionKeyAttempt?: OnSessionKeyAttempt,
  tryKeyVersion?: string
): AesKey | null {
  if (!typeModel.encrypted) return null;
  const attrs = getOwnerAttrs(typeModel);
  const ownerGroup = instance[attrs.ownerGroup];
  const ownerEncSessionKey = instance[attrs.ownerEncSessionKey];
  const ownerKeyVersion = instance[attrs.ownerKeyVersion];
  if (ownerGroup == null || ownerEncSessionKey == null) {
    return null;
  }
  const groupId = String(ownerGroup);
  const keyVersion = tryKeyVersion != null ? tryKeyVersion : String(ownerKeyVersion ?? "");
  const groupKey = keyChain.getGroupKey(groupId, keyVersion);
  if (groupKey == null) return null;
  const encKey =
    ownerEncSessionKey instanceof Uint8Array
      ? ownerEncSessionKey
      : base64ToUint8Array(String(ownerEncSessionKey));
  const groupKeyBytes = keyToUint8Array(groupKey);
  const groupKey128 = uint8ArrayToKey(groupKeyBytes.subarray(0, 16));
  const is128BitGroupKey = groupKeyBytes.length === 16;

  // When group key is 128-bit (e.g. former key for version 0), try 128-bit path first to match web client.
  if (is128BitGroupKey) {
    try {
      const sk = decryptKey(groupKey128, encKey);
      onSessionKeyAttempt?.("128", true);
      onSessionKeyResolved?.("128");
      return sk;
    } catch (err128) {
      onSessionKeyAttempt?.("128", false, err128);
      try {
        const sk = decryptKeyUnauthenticatedWithDeviceKeyChain(groupKey, encKey);
        onSessionKeyAttempt?.("256-legacy", true);
        onSessionKeyResolved?.("256-legacy");
        return sk;
      } catch (errLegacy) {
        onSessionKeyAttempt?.("256-legacy", false, errLegacy);
        try {
          const sk = decryptKey(groupKey, encKey);
          onSessionKeyAttempt?.("256", true);
          onSessionKeyResolved?.("256");
          return sk;
        } catch (err256) {
          onSessionKeyAttempt?.("256", false, err256);
          onSessionKeyResolved?.(null);
          return null;
        }
      }
    }
  }

  // 256-bit group key: legacy first, then normal, then 128-bit fallback.
  try {
    const sk = decryptKeyUnauthenticatedWithDeviceKeyChain(groupKey, encKey);
    onSessionKeyAttempt?.("256-legacy", true);
    onSessionKeyResolved?.("256-legacy");
    return sk;
  } catch (err1) {
    onSessionKeyAttempt?.("256-legacy", false, err1);
    try {
      const sk = decryptKey(groupKey, encKey);
      onSessionKeyAttempt?.("256", true);
      onSessionKeyResolved?.("256");
      return sk;
    } catch (err2) {
      onSessionKeyAttempt?.("256", false, err2);
      try {
        const sk = decryptKey(groupKey128, encKey);
        onSessionKeyAttempt?.("128", true);
        onSessionKeyResolved?.("128");
        return sk;
      } catch (err3) {
        onSessionKeyAttempt?.("128", false, err3);
        onSessionKeyResolved?.(null);
        return null;
      }
    }
  }
}

function convertDbToJsType(
  type: string,
  decryptedValue: string | Uint8Array | null
): unknown {
  if (decryptedValue == null) return null;
  if (type === ValueType.Bytes) return decryptedValue;
  const str =
    typeof decryptedValue === "string"
      ? decryptedValue
      : utf8Uint8ArrayToString(decryptedValue);
  switch (type) {
    case ValueType.String:
    case ValueType.CompressedString:
      return str;
    case ValueType.Number:
      return str === "" ? 0 : Number(str);
    case ValueType.Date:
      return new Date(parseInt(str, 10));
    case ValueType.Boolean:
      return str !== "0";
    default:
      return str;
  }
}

/**
 * Optional callback when decryption of an encrypted value fails (catch block).
 * Used for verbose logging to diagnose empty folder names etc.
 */
export type OnDecryptFailure = (valueId: string, err: unknown) => void;

/**
 * Optional callback when decryption succeeded only after retry with 128-bit session key.
 */
export type OnDecryptFallback = (valueId: string, used128BitSessionKey: true) => void;

/**
 * Decrypt an encrypted instance: for each encrypted value, aesDecrypt with session key
 * then convert by value type. Tries full session key first, then 128-bit session key on failure.
 * Non-encrypted values are copied through.
 * If onDecryptFailure is provided, it is called when both attempts throw.
 * If onDecryptFallback is provided, it is called when the first attempt threw and the 128-bit retry succeeded.
 */
export function decryptParsedInstance(
  typeModel: TypeModel,
  encryptedInstance: ServerInstance,
  sessionKey: AesKey | null,
  onDecryptFailure?: OnDecryptFailure,
  onDecryptFallback?: OnDecryptFallback
): ServerInstance {
  const result: ServerInstance = {};
  const sessionKey128 =
    sessionKey != null
      ? uint8ArrayToKey(keyToUint8Array(sessionKey).subarray(0, 16))
      : null;

  for (const [valueIdStr, valueInfo] of Object.entries(typeModel.values)) {
    const valueInfoTyped = valueInfo as ValueModel;
    const encryptedValue = encryptedInstance[valueIdStr];
    try {
      if (!valueInfoTyped.encrypted) {
        result[valueIdStr] = encryptedValue;
        continue;
      }
      if (sessionKey == null) {
        result[valueIdStr] = valueToDefault(valueInfoTyped.type);
        continue;
      }
      if (encryptedValue == null || encryptedValue === "") {
        result[valueIdStr] = valueToDefault(valueInfoTyped.type);
        continue;
      }
      const bytes = base64ToUint8Array(String(encryptedValue));

      // Try full session key first, then 128-bit (legacy).
      let decryptedBytes: Uint8Array;
      try {
        decryptedBytes = aesDecrypt(sessionKey, bytes);
      } catch (err1) {
        if (sessionKey128 != null) {
          try {
            decryptedBytes = aesDecrypt(sessionKey128, bytes);
            onDecryptFallback?.(valueIdStr, true);
          } catch {
            onDecryptFailure?.(valueIdStr, err1);
            result[valueIdStr] = valueToDefault(valueInfoTyped.type);
            continue;
          }
        } else {
          onDecryptFailure?.(valueIdStr, err1);
          result[valueIdStr] = valueToDefault(valueInfoTyped.type);
          continue;
        }
      }

      if (valueInfoTyped.type === ValueType.Bytes) {
        result[valueIdStr] = decryptedBytes;
      } else if (valueInfoTyped.type === ValueType.CompressedString) {
        result[valueIdStr] = utf8Uint8ArrayToString(decryptedBytes);
      } else {
        result[valueIdStr] = convertDbToJsType(
          valueInfoTyped.type,
          utf8Uint8ArrayToString(decryptedBytes)
        );
      }
    } catch (err) {
      onDecryptFailure?.(valueIdStr, err);
      result[valueIdStr] = valueToDefault(valueInfoTyped.type);
    }
  }
  // Copy through association ids and any other keys not in values (e.g. 443 = mailSets)
  for (const k of Object.keys(encryptedInstance)) {
    if (!(k in typeModel.values)) {
      result[k] = encryptedInstance[k];
    }
  }
  return result;
}

function valueToDefault(type: string): unknown {
  switch (type) {
    case ValueType.String:
    case ValueType.CompressedString:
      return "";
    case ValueType.Number:
      return 0;
    case ValueType.Bytes:
      return new Uint8Array(0);
    case ValueType.Date:
      return new Date(0);
    case ValueType.Boolean:
      return false;
    default:
      return "";
  }
}
