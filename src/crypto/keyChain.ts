/**
 * Minimal key chain: unlock user group key from passphrase, derive mail group key from membership.
 * Uses only @tutao/tutanota-crypto (decryptKey, keyToUint8Array, uint8ArrayToKey). No dependency on main app facades.
 *
 * Key derivation and legacy compatibility:
 * - The web client uses a 128-bit mail group key for session key decryption when the account uses
 *   a 128-bit chain (e.g. bcrypt passphrase → 128-bit user group key → 128-bit mail group key).
 * - We may have a 256-bit passphrase key (e.g. Argon2). If the server still encrypted the user
 *   group with 128-bit passphrase (legacy), we must try decrypting userGroup.symEncGKey with
 *   a 128-bit passphrase key first so we obtain the same 128-bit user group key and then the
 *   same 128-bit mail group key as the client.
 * - When decrypting the mail membership we also try 128-bit user group key first if we have
 *   256-bit, for accounts where the server encrypted the mail group key with 128-bit user key.
 */

import { decryptKey, keyToUint8Array, uint8ArrayToKey } from "@tutao/tutanota-crypto";
import type { AesKey } from "../auth/kdf.js";
import type { UserKeyMaterial } from "../auth/userKeyMaterial.js";
import { getMailMembership } from "../auth/userKeyMaterial.js";
import { log } from "../logger.js";

export interface KeyChain {
  getGroupKey(groupId: string, keyVersion: string): AesKey | null;
  /** Add a group key for a specific version (e.g. former key). Use for session key resolution when instance._ownerKeyVersion differs from current. */
  addGroupKey(groupId: string, keyVersion: string, key: AesKey): void;
  /** Return all key versions currently available for a group (for retrying decryption with alternate versions). */
  getAvailableKeyVersions(groupId: string): string[];
}

/** Per-group: current version and a map of version -> key (current + any former keys added). */
interface GroupKeyEntry {
  currentVersion: string;
  keys: Map<string, AesKey>;
}

/**
 * Build a key chain from user passphrase key and parsed user key material.
 * Call unlockUserGroupKey then use getGroupKey(ownerGroup, ownerKeyVersion) for entity decryption.
 */
export function createKeyChain(
  userPassphraseKey: AesKey,
  userKeyMaterial: UserKeyMaterial
): KeyChain {
  let userGroupKey: AesKey;
  const passphraseKeyBytes = keyToUint8Array(userPassphraseKey);
  if (passphraseKeyBytes.length > 16) {
    log("Passphrase key is 256-bit; trying 128-bit passphrase for user group decryption.");
    const passphraseKey128 = uint8ArrayToKey(passphraseKeyBytes.subarray(0, 16));
    try {
      userGroupKey = decryptKey(passphraseKey128, userKeyMaterial.userGroup.symEncGKey);
      log("128-bit passphrase succeeded for user group.");
    } catch {
      log("128-bit passphrase failed for user group, using full passphrase.");
      userGroupKey = decryptKey(userPassphraseKey, userKeyMaterial.userGroup.symEncGKey);
    }
  } else {
    userGroupKey = decryptKey(userPassphraseKey, userKeyMaterial.userGroup.symEncGKey);
  }
  log(`User group key length: ${keyToUint8Array(userGroupKey).length} bytes.`);

  const userGroupId = userKeyMaterial.userGroup.group;
  const userGroupVersion = userKeyMaterial.userGroup.groupKeyVersion;

  const cache = new Map<string, GroupKeyEntry>();
  const userKeys = new Map<string, AesKey>();
  userKeys.set(userGroupVersion, userGroupKey);
  cache.set(userGroupId, { currentVersion: userGroupVersion, keys: userKeys });

  const mailMembership = getMailMembership(userKeyMaterial);
  if (mailMembership != null) {
    let mailGroupKey: AesKey;
    const userGroupKeyBytes = keyToUint8Array(userGroupKey);
    if (userGroupKeyBytes.length > 16) {
      log("User group key is 256-bit; trying 128-bit user group key for mail group decryption.");
      const userGroupKey128 = uint8ArrayToKey(userGroupKeyBytes.subarray(0, 16));
      try {
        mailGroupKey = decryptKey(userGroupKey128, mailMembership.symEncGKey);
        log("128-bit user group key succeeded for mail group.");
      } catch {
        log("128-bit user group key failed for mail group, using full user group key.");
        mailGroupKey = decryptKey(userGroupKey, mailMembership.symEncGKey);
      }
    } else {
      mailGroupKey = decryptKey(userGroupKey, mailMembership.symEncGKey);
    }
    log(`Mail group key length: ${keyToUint8Array(mailGroupKey).length} bytes.`);
    const mailKeys = new Map<string, AesKey>();
    mailKeys.set(mailMembership.groupKeyVersion, mailGroupKey);
    cache.set(mailMembership.group, {
      currentVersion: mailMembership.groupKeyVersion,
      keys: mailKeys,
    });
  }

  return {
    getGroupKey(groupId: string, keyVersion: string): AesKey | null {
      const entry = cache.get(groupId);
      if (entry == null) return null;
      return entry.keys.get(keyVersion) ?? null;
    },
    addGroupKey(groupId: string, keyVersion: string, key: AesKey): void {
      let entry = cache.get(groupId);
      if (entry == null) {
        entry = { currentVersion: keyVersion, keys: new Map() };
        cache.set(groupId, entry);
      }
      entry.keys.set(keyVersion, key);
    },
    getAvailableKeyVersions(groupId: string): string[] {
      const entry = cache.get(groupId);
      if (entry == null) return [];
      return Array.from(entry.keys.keys());
    },
  };
}

/**
 * Unlock user group key and prepare mail group key. Returns a KeyChain that can resolve
 * group keys by (groupId, keyVersion) for session key decryption.
 */
export function unlockUserGroupKey(
  userPassphraseKey: AesKey,
  userKeyMaterial: UserKeyMaterial
): KeyChain {
  return createKeyChain(userPassphraseKey, userKeyMaterial);
}
