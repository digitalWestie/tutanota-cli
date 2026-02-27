/**
 * Load mailbox and mail set list (shared by folders list and envelope list).
 * Caller is responsible for getOrCreateSession, getPassphraseKeyForDecryption, and loadUser with 401 retry.
 */

import type { LoginResult } from "../auth/login.js";
import type { AesKey } from "../auth/kdf.js";
import type { GroupMembershipKeyMaterial } from "../auth/userKeyMaterial.js";
import { parseUserKeyMaterial, getMailMembership } from "../auth/userKeyMaterial.js";
import type { KeyChain } from "../crypto/keyChain.js";
import { unlockUserGroupKey } from "../crypto/keyChain.js";
import {
  resolveSessionKey,
  decryptParsedInstance,
  type ServerInstance,
} from "../crypto/decryptInstance.js";
import { loadFormerGroupKey } from "../crypto/formerGroupKey.js";
import {
  MAILBOX_GROUP_ROOT,
  MAIL_BOX,
  MAIL_SET,
  MAILBOX_GROUP_ROOT_MAILBOX,
  MAIL_BOX_MAIL_SETS,
  MAIL_SET_REF_MAIL_SETS_LIST,
} from "../crypto/typeModels.js";
import { loadEntity, loadRange, GENERATED_MIN_ID } from "../rest.js";
import { keyToUint8Array } from "@tutao/tutanota-crypto";
import { unwrapSingleElementArray } from "../utils/bytes.js";

export interface LoadMailboxResult {
  result: LoginResult;
  keyChain: KeyChain;
  userGroupId: string;
  mailGroupId: string;
  mailMembership: GroupMembershipKeyMaterial;
  mailSetRawList: ServerInstance[];
}

export async function loadMailboxAndMailSetList(options: {
  baseUrl: string;
  result: LoginResult;
  userPassphraseKey: AesKey;
  userRaw: Record<string, unknown>;
  verbose?: boolean;
}): Promise<LoadMailboxResult> {
  const { baseUrl, result, userPassphraseKey, userRaw, verbose } = options;
  const keyMaterial = parseUserKeyMaterial(userRaw);
  if (verbose) {
    console.error("[verbose] User key material: userGroup present,", keyMaterial.memberships.length, "memberships.");
  }
  const mailMembership = getMailMembership(keyMaterial);
  if (mailMembership == null) {
    throw new Error("No mail group membership found.");
  }

  const keyChain = unlockUserGroupKey(userPassphraseKey, keyMaterial);
  const mailGroupId = mailMembership.group;

  const mailboxGroupRootRaw = await loadEntity<Record<string, unknown>>(
    baseUrl,
    MAILBOX_GROUP_ROOT,
    mailGroupId,
    { accessToken: result.accessToken }
  );
  const mailboxId = mailboxGroupRootRaw[MAILBOX_GROUP_ROOT_MAILBOX];
  if (mailboxId == null) {
    throw new Error("MailboxGroupRoot missing mailbox id.");
  }

  const mailboxRaw = await loadEntity<ServerInstance>(
    baseUrl,
    MAIL_BOX,
    String(mailboxId),
    { accessToken: result.accessToken }
  );
  const mailboxSk = resolveSessionKey(keyChain, mailboxRaw, MAIL_BOX);
  const mailboxDecrypted = decryptParsedInstance(MAIL_BOX, mailboxRaw, mailboxSk);
  const mailSetsAggregate = unwrapSingleElementArray(
    mailboxDecrypted[MAIL_BOX_MAIL_SETS] as Record<string, unknown> | unknown[] | undefined
  );
  const mailSetListId =
    mailSetsAggregate != null && !Array.isArray(mailSetsAggregate)
      ? (mailSetsAggregate as Record<string, unknown>)[MAIL_SET_REF_MAIL_SETS_LIST]
      : null;
  if (mailSetListId == null) {
    throw new Error("MailBox missing mailSets list id.");
  }

  const mailSetRawList = await loadRange<ServerInstance>(
    baseUrl,
    MAIL_SET,
    String(mailSetListId),
    {
      accessToken: result.accessToken,
      start: GENERATED_MIN_ID,
      count: 1000,
      reverse: false,
      verboseResponse: verbose ?? false,
    }
  );

  // Pre-load former group keys when MailSets use an older key version.
  const keyVersionsNeeded = new Set<string>();
  for (const raw of mailSetRawList) {
    const v = raw["1399"];
    if (v != null && String(v) !== mailMembership.groupKeyVersion) {
      keyVersionsNeeded.add(String(v));
    }
  }
  for (const keyVersion of keyVersionsNeeded) {
    if (keyChain.getGroupKey(mailGroupId, keyVersion) != null) continue;
    const formerKey = await loadFormerGroupKey(
      baseUrl,
      result.accessToken,
      keyChain,
      loadEntity,
      loadRange,
      mailGroupId,
      mailMembership.groupKeyVersion,
      keyVersion
    );
    if (formerKey != null) {
      keyChain.addGroupKey(mailGroupId, keyVersion, formerKey);
      if (verbose) {
        const keyBytes = keyToUint8Array(formerKey);
        console.error(
          "[verbose] Loaded former mail group key for version",
          keyVersion,
          "length:",
          keyBytes.length,
          "bytes",
          keyBytes.length === 16 ? "(128-bit)" : keyBytes.length === 32 ? "(256-bit)" : ""
        );
      }
    }
  }

  const userGroupId = keyMaterial.userGroup.group;
  return { result, keyChain, userGroupId, mailGroupId, mailMembership, mailSetRawList };
}
