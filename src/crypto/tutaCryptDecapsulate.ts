/**
 * TutaCrypt decapsulation for pubEncBucketKey (protocol version 2).
 * Ported from tutanota PQFacade and PQMessage.
 */

import {
  aesDecrypt,
  decapsulateKyber,
  getKeyLengthInBytes,
  AesKeyLength,
  pqKeyPairsToPublicKeys,
  kyberPublicKeyToBytes,
  uint8ArrayToKey,
  x25519Decapsulate,
  hkdf,
} from "@tutao/tutanota-crypto";
import { bytesToByteArrays, concat, stringToUtf8Uint8Array } from "@tutao/tutanota-utils";
import type { LibOQSExports } from "@tutao/tutanota-crypto";
import type { PQKeyPairs, X25519PublicKey } from "@tutao/tutanota-crypto";

/** TutaCrypt protocol version (CryptoProtocolVersion.TUTA_CRYPT = "2"). */
const PROTOCOL_TUTA_CRYPT = 2;

export type PQMessage = {
  senderIdentityPubKey: X25519PublicKey;
  ephemeralPubKey: X25519PublicKey;
  encapsulation: {
    kyberCipherText: Uint8Array;
    kekEncBucketKey: Uint8Array;
  };
};

function decodePQMessage(encoded: Uint8Array): PQMessage {
  const pqMessageParts = bytesToByteArrays(encoded, 4);
  return {
    senderIdentityPubKey: pqMessageParts[0],
    ephemeralPubKey: pqMessageParts[1],
    encapsulation: {
      kyberCipherText: pqMessageParts[2],
      kekEncBucketKey: pqMessageParts[3],
    },
  };
}

function derivePQKEK(
  senderIdentityPublicKey: X25519PublicKey,
  ephemeralPublicKey: X25519PublicKey,
  recipientPublicKeys: ReturnType<typeof pqKeyPairsToPublicKeys>,
  kyberCipherText: Uint8Array,
  kyberSharedSecret: Uint8Array,
  eccSharedSecret: { ephemeralSharedSecret: Uint8Array; authSharedSecret: Uint8Array },
  cryptoProtocolVersion: number
): Uint8Array {
  const context = concat(
    senderIdentityPublicKey,
    ephemeralPublicKey,
    recipientPublicKeys.x25519PublicKey,
    kyberPublicKeyToBytes(recipientPublicKeys.kyberPublicKey),
    kyberCipherText,
    new Uint8Array([cryptoProtocolVersion])
  );
  const inputKeyMaterial = concat(
    eccSharedSecret.ephemeralSharedSecret,
    eccSharedSecret.authSharedSecret,
    kyberSharedSecret
  );
  return hkdf(context, inputKeyMaterial, stringToUtf8Uint8Array("kek"), getKeyLengthInBytes(AesKeyLength.Aes256));
}

/**
 * Decapsulate TutaCrypt-encoded pubEncBucketKey and return the decrypted bucket key (AesKey).
 */
export async function tutaCryptDecapsulate(
  liboqs: LibOQSExports,
  encodedPQMessage: Uint8Array,
  recipientKeys: PQKeyPairs
): Promise<Uint8Array> {
  const message = decodePQMessage(encodedPQMessage);
  const eccSharedSecret = x25519Decapsulate(
    message.senderIdentityPubKey,
    message.ephemeralPubKey,
    recipientKeys.x25519KeyPair.privateKey
  );
  const kyberSharedSecret = decapsulateKyber(
    liboqs,
    recipientKeys.kyberKeyPair.privateKey,
    message.encapsulation.kyberCipherText
  );
  const kek = derivePQKEK(
    message.senderIdentityPubKey,
    message.ephemeralPubKey,
    pqKeyPairsToPublicKeys(recipientKeys),
    message.encapsulation.kyberCipherText,
    kyberSharedSecret,
    eccSharedSecret,
    PROTOCOL_TUTA_CRYPT
  );
  const kekKey = uint8ArrayToKey(kek);
  const decryptedBytes = aesDecrypt(kekKey, message.encapsulation.kekEncBucketKey);
  return decryptedBytes;
}
