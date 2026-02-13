import {
  createAuthVerifierAsBase64Url,
  generateKeyFromPassphraseBcrypt,
  KeyLength,
  uint8ArrayToKey,
} from "@tutao/tutanota-crypto";
import argon2 from "argon2";

/** Key type from tutanota-crypto (bit array); we use it opaquely for createAuthVerifierAsBase64Url. */
export type AesKey = ReturnType<typeof uint8ArrayToKey>;

/** Kdf version from server: "0" = Bcrypt, "1" (or other) = Argon2id */
const KDF_BCRYPT = "0";

/**
 * Normalize salt from API response (may be base64 string or array of bytes).
 */
export function saltToUint8Array(salt: Uint8Array | number[] | string): Uint8Array {
  if (typeof salt === "string") {
    return new Uint8Array(Buffer.from(salt, "base64"));
  }
  if (Array.isArray(salt)) {
    return new Uint8Array(salt);
  }
  return salt;
}

/**
 * Derive user passphrase key using the same KDF as the Tutanota client.
 * Returns a key suitable for createAuthVerifierAsBase64Url.
 */
export async function deriveUserPassphraseKey(
  passphrase: string,
  salt: Uint8Array,
  kdfVersion: string
): Promise<AesKey> {
  if (kdfVersion === KDF_BCRYPT) {
    return Promise.resolve(
      generateKeyFromPassphraseBcrypt(passphrase, salt, KeyLength.b128) as AesKey
    );
  }
  const raw = await deriveArgon2idKey(passphrase, salt);
  return uint8ArrayToKey(raw);
}

/**
 * Argon2id with same params as Tutanota (ARGON2ID_* in Argon2id.js).
 */
async function deriveArgon2idKey(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  const raw = await argon2.hash(passphrase, {
    type: argon2.argon2id,
    salt: Buffer.from(salt),
    raw: true,
    timeCost: 4,
    memoryCost: 32 * 1024,
    parallelism: 1,
    hashLength: 32,
  });
  return new Uint8Array(raw);
}

/**
 * Build auth verifier string for CreateSessionData (base64url).
 */
export function buildAuthVerifier(userPassphraseKey: AesKey): string {
  return createAuthVerifierAsBase64Url(userPassphraseKey);
}
