#!/usr/bin/env node
import { Command } from "commander";
import { loadEnv, getApiBaseUrl, getCredentials } from "./config.js";
import {
  getPassphraseKeyForSession,
  getSessionIdFromAccessToken,
  login,
  loadCustomer,
  loadCustomerInfo,
  loadUser,
  verifySession,
} from "./auth/login.js";
import type { LoginResult } from "./auth/login.js";
import {
  normalizeCustomerInfoReturn,
  normalizeCustomerReturn,
  normalizeUserReturn,
} from "./auth/types.js";
import { getErrorMessage, setVerbose } from "./logger.js";
import { clearSession, readSession, writeSession } from "./session.js";
import type { AesKey } from "./auth/kdf.js";
import { parseUserKeyMaterial, getMailMembership } from "./auth/userKeyMaterial.js";
import { unlockUserGroupKey } from "./crypto/keyChain.js";
import {
  resolveSessionKey,
  decryptParsedInstance,
  type ServerInstance,
} from "./crypto/decryptInstance.js";
import { loadFormerGroupKey } from "./crypto/formerGroupKey.js";
import {
  MAILBOX_GROUP_ROOT,
  MAIL_BOX,
  MAIL_SET,
  MAIL_SET_ENTRY,
  MAIL,
  MAILBOX_GROUP_ROOT_MAILBOX,
  MAIL_BOX_MAIL_SETS,
  MAIL_SET_REF_MAIL_SETS_LIST,
} from "./crypto/typeModels.js";
import {
  loadEntity,
  loadRange,
  GENERATED_MIN_ID,
  GENERATED_MAX_ID,
} from "./rest.js";
import { keyToUint8Array } from "@tutao/tutanota-crypto";
import { unwrapSingleElementArray } from "./utils/bytes.js";

loadEnv();

function getVerbose(opts: { verbose?: boolean; V?: boolean }): boolean {
  return opts.verbose ?? opts.V ?? false;
}

/** Run fn on each item with at most `concurrency` in flight; preserves order. */
async function mapWithConcurrency<T, R>(
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
async function getOrCreateSession(
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
async function getPassphraseKeyForDecryption(
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

const program = new Command();

program
  .name("tutanota-cli")
  .description("CLI to authenticate with and export mail from Tutanota")
  .version("0.1.0");

const authCmd = program.command("auth").description("Authentication commands");

authCmd
  .command("check")
  .description("Verify credentials by logging in; prints session info on success")
  .option("--json", "Output result as JSON")
  .option("--verbose, -v", "Verbose logging for debugging")
  .action(async (opts: { json?: boolean; verbose?: boolean; V?: boolean }) => {
    const verbose = getVerbose(opts);
    if (verbose) {
      setVerbose(true);
      console.error("[verbose] Verbose logging enabled.");
    }
    try {
      const baseUrl = getApiBaseUrl();
      if (verbose) console.error("[verbose] API base URL:", baseUrl);
      const { result, usedStoredSession } = await getOrCreateSession(baseUrl, verbose);

      if (opts.json) {
        console.log(
          JSON.stringify({
            ok: true,
            sessionVerified: true,
            userId: result.userId,
            sessionId: result.sessionId,
          })
        );
      } else {
        if (usedStoredSession) console.log("Using stored session.");
        console.log("Authenticated.");
        console.log("Session verified.");
        console.log("User ID:", result.userId);
        console.log("Session ID:", result.sessionId.join("/"));
      }
    } catch (err) {
      const message = getErrorMessage(err);
      if (verbose) {
        console.error("[verbose] auth check failed:", err);
        if (err instanceof Error && err.cause) console.error("[verbose] cause:", err.cause);
        if (err instanceof Error && err.stack) console.error("[verbose] stack:", err.stack);
      }
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, error: message }));
      } else {
        console.error("Error:", message);
      }
      process.exit(1);
    }
  });

authCmd
  .command("logout")
  .description("Clear the stored session (log out)")
  .action(() => {
    clearSession();
    console.log("Session cleared.");
  });

const foldersCmd = program.command("folders").description("Mail folder commands");

foldersCmd
  .command("list")
  .description("List mail folders (requires password when using stored session)")
  .option("--json", "Output as JSON")
  .option("--verbose, -v", "Verbose logging")
  .action(async (opts: { json?: boolean; verbose?: boolean; V?: boolean }) => {
    const verbose = getVerbose(opts);
    if (verbose) setVerbose(true);
    try {
      const baseUrl = getApiBaseUrl();
      let { result } = await getOrCreateSession(baseUrl, verbose);
      let userPassphraseKey = await getPassphraseKeyForDecryption(baseUrl, result, verbose);

      let userRaw: Record<string, unknown>;
      try {
        userRaw = await loadUser(baseUrl, result.accessToken, result.userId) as Record<string, unknown>;
      } catch (loadErr) {
        const loadMsg = loadErr instanceof Error ? loadErr.message : String(loadErr);
        if ((loadMsg.includes("401") || loadMsg.includes("Unauthorized")) && readSession() != null) {
          if (verbose) console.error("[verbose] loadUser returned 401; clearing session and retrying with fresh login.");
          clearSession();
          const retry = await getOrCreateSession(baseUrl, verbose);
          result = retry.result;
          userPassphraseKey = await getPassphraseKeyForDecryption(baseUrl, result, verbose);
          userRaw = await loadUser(baseUrl, result.accessToken, result.userId) as Record<string, unknown>;
        } else {
          throw loadErr;
        }
      }
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
          verboseResponse: verbose,
        }
      );

      // Pre-load former group keys when MailSets use an older key version (e.g. _ownerKeyVersion "0").
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
            console.error("[verbose] Loaded former mail group key for version", keyVersion, "length:", keyBytes.length, "bytes", keyBytes.length === 16 ? "(128-bit)" : keyBytes.length === 32 ? "(256-bit)" : "");
          }
        }
      }

      // System folder type (MailSetKind) to display name when MailSet name is not stored (client uses fixed labels).
      const SYSTEM_FOLDER_DISPLAY_NAMES: Record<string, string> = {
        "1": "Inbox",
        "2": "Sent",
        "3": "Trash",
        "4": "Archive",
        "5": "Spam",
        "6": "Draft",
        "10": "Scheduled",
      };
      const availableVersions = keyChain.getAvailableKeyVersions(mailGroupId);
      const FOLDER_LIST_CONCURRENCY = 5;
      const folders = await mapWithConcurrency(
        mailSetRawList,
        FOLDER_LIST_CONCURRENCY,
        async (raw, i) => {
          // Mirror client: avoid prototype pollution (client strips __proto__ in JSON parse reviver).
          const safe =
            "__proto__" in raw
              ? (Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "__proto__")) as ServerInstance)
              : raw;
          const onSessionKeyResolved =
            verbose && i === 0
              ? (method: "256" | "128" | "256-legacy" | null) => {
                  if (method == null) {
                    console.error("[verbose] Session key: all three attempts failed.");
                  }
                }
              : undefined;
          const instanceVersion = String((safe["1399"] ?? "") as string);
          const versionsToTry =
            availableVersions.length <= 1 ? [instanceVersion] : [instanceVersion, ...availableVersions.filter((v) => v !== instanceVersion)];
          const idForLog = Array.isArray(safe["431"]) ? safe["431"][(safe["431"] as unknown[]).length - 1] : safe["431"];
          let dec: ServerInstance | null = null;
          let triedVersion: string | null = null;
          for (const tryVer of versionsToTry) {
            const failedValueIds = new Set<string>();
            const onDecryptFailureInner = (valueId: string, err: unknown) => {
              failedValueIds.add(valueId);
              if (verbose) {
                console.error("[verbose] Decrypt failed for MailSet attribute", valueId, "(both 256- and 128-bit session key):", getErrorMessage(err));
              }
            };
            const sk = resolveSessionKey(keyChain, safe, MAIL_SET, onSessionKeyResolved, undefined, tryVer);
            if (sk == null) continue;
            const onDecryptFallback =
              verbose
                ? (valueId: string) => {
                    console.error("[verbose] MailSet attribute", valueId, ": full session key failed, decrypted with 128-bit session key.");
                  }
                : undefined;
            dec = decryptParsedInstance(MAIL_SET, safe, sk, onDecryptFailureInner, onDecryptFallback);
            const hadRelevantFailure = failedValueIds.has("435") || failedValueIds.has("1479");
            if (!hadRelevantFailure) {
              triedVersion = tryVer;
              break;
            }
            if (verbose) {
              console.error("[verbose] MailSet id", safe["431"], "keyVersion", tryVer, "-> invalid mac on 435/1479, trying next version.");
            }
          }
          if (dec == null) {
            dec = decryptParsedInstance(MAIL_SET, safe, null, undefined, undefined);
          }
          const name = ((dec as ServerInstance)["435"] ?? "") as string;
          if (verbose && i === 0 && dec != null) {
            console.error("[verbose] First MailSet: session key resolved, name decrypted.");
          }
          const idRaw = safe["431"];
          // Server returns 431 as [listId, elementId] for list elements; use element id for display.
          const id = Array.isArray(idRaw)
            ? String(idRaw[idRaw.length - 1] ?? "")
            : String(idRaw ?? "");
          const folderType = (dec as ServerInstance)["436"];
          const folderTypeStr = String(folderType ?? "");
          const displayName =
            String(name).trim() !== ""
              ? String(name)
              : SYSTEM_FOLDER_DISPLAY_NAMES[folderTypeStr] ??
                (folderTypeStr === "8" ? "Label (no name)" : folderTypeStr === "0" ? "(no name)" : String(name) || "(no name)");
          if (verbose && (folderTypeStr === "0" || folderTypeStr === "8") && String(name).trim() === "") {
            console.error("[verbose] Custom/label folder with empty name:", "id:", id, "_ownerKeyVersion:", safe["1399"], triedVersion != null ? "decrypted with keyVersion: " + triedVersion : "tried all versions");
          }
          return { name: displayName, id, folderType };
        }
      );

      if (opts.json) {
        console.log(JSON.stringify({ folders }));
      } else {
        console.log("Folders");
        console.log("-------");
        for (const f of folders) {
          console.log(`  ${f.name}\t${f.id}`);
        }
      }
    } catch (err) {
      const message = getErrorMessage(err);
      if (message.includes("401") || message.includes("Unauthorized")) {
        clearSession();
        console.error(
          "Session expired or invalid. Please run 'auth check' to log in again, then try 'folders list' again."
        );
      } else {
        if (verbose && err instanceof Error && err.stack) console.error("[verbose] stack:", err.stack);
        console.error("Error:", message);
      }
      process.exit(1);
    }
  });

const mailsCmd = program.command("mails").description("Mail commands");

mailsCmd
  .command("list <folder-id>")
  .description("List latest 10 mails in a folder (folder-id from 'folders list')")
  .option("--json", "Output as JSON")
  .option("--verbose, -v", "Verbose logging")
  .action(async (folderId: string, opts: { json?: boolean; verbose?: boolean; V?: boolean }) => {
    const verbose = getVerbose(opts);
    if (verbose) setVerbose(true);
    const folderIdTrimmed = typeof folderId === "string" ? folderId.trim() : "";
    if (!folderIdTrimmed) {
      console.error("Error: folder-id is required. Run 'folders list' to see folder ids.");
      process.exit(1);
    }
    try {
      const baseUrl = getApiBaseUrl();
      let { result } = await getOrCreateSession(baseUrl, verbose);
      let userPassphraseKey = await getPassphraseKeyForDecryption(baseUrl, result, verbose);

      let userRaw: Record<string, unknown>;
      try {
        userRaw = await loadUser(baseUrl, result.accessToken, result.userId) as Record<string, unknown>;
      } catch (loadErr) {
        const loadMsg = getErrorMessage(loadErr);
        if ((loadMsg.includes("401") || loadMsg.includes("Unauthorized")) && readSession() != null) {
          if (verbose) console.error("[verbose] loadUser returned 401; clearing session and retrying with fresh login.");
          clearSession();
          const retry = await getOrCreateSession(baseUrl, verbose);
          result = retry.result;
          userPassphraseKey = await getPassphraseKeyForDecryption(baseUrl, result, verbose);
          userRaw = await loadUser(baseUrl, result.accessToken, result.userId) as Record<string, unknown>;
        } else {
          throw loadErr;
        }
      }
      const keyMaterial = parseUserKeyMaterial(userRaw);
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
        }
      );

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
        }
      }

      const availableVersions = keyChain.getAvailableKeyVersions(mailGroupId);
      const MAILS_LIST_CONCURRENCY = 5;
      const folderEntries = await mapWithConcurrency(
        mailSetRawList,
        MAILS_LIST_CONCURRENCY,
        async (raw) => {
          const safe =
            "__proto__" in raw
              ? (Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "__proto__")) as ServerInstance)
              : raw;
          const instanceVersion = String((safe["1399"] ?? "") as string);
          const versionsToTry =
            availableVersions.length <= 1 ? [instanceVersion] : [instanceVersion, ...availableVersions.filter((v) => v !== instanceVersion)];
          let dec: ServerInstance | null = null;
          for (const tryVer of versionsToTry) {
            const sk = resolveSessionKey(keyChain, safe, MAIL_SET, undefined, undefined, tryVer);
            if (sk == null) continue;
            const failedValueIds = new Set<string>();
            const onFail = (valueId: string) => failedValueIds.add(valueId);
            dec = decryptParsedInstance(MAIL_SET, safe, sk, onFail);
            if (!failedValueIds.has("435") && !failedValueIds.has("1479")) break;
          }
          if (dec == null) {
            dec = decryptParsedInstance(MAIL_SET, safe, null, undefined, undefined);
          }
          const idRaw = safe["431"];
          const id = Array.isArray(idRaw)
            ? String(idRaw[idRaw.length - 1] ?? "")
            : String(idRaw ?? "");
          const entriesRaw = (dec as ServerInstance)["1459"];
          const entriesListId =
            entriesRaw != null
              ? Array.isArray(entriesRaw) && entriesRaw.length === 1
                ? String(entriesRaw[0])
                : Array.isArray(entriesRaw) && entriesRaw.length >= 2
                  ? String(entriesRaw[0])
                  : String(entriesRaw)
              : null;
          return { id, entriesListId };
        }
      );

      const folder = folderEntries.find((f) => f.id === folderIdTrimmed);
      if (folder == null || folder.entriesListId == null) {
        console.error("Error: Folder not found:", folderIdTrimmed, "(run 'folders list' to see folder ids)");
        process.exit(1);
      }

      const mailSetEntryList = await loadRange<Record<string, unknown>>(
        baseUrl,
        MAIL_SET_ENTRY,
        folder.entriesListId,
        {
          accessToken: result.accessToken,
          start: GENERATED_MAX_ID,
          count: 10,
          reverse: true,
        }
      );

      const MAIL_LOAD_CONCURRENCY = 5;
      const mails = await mapWithConcurrency(
        mailSetEntryList,
        MAIL_LOAD_CONCURRENCY,
        async (entry) => {
          const mailRefRaw = entry["1456"];
          const mailRef = unwrapSingleElementArray(mailRefRaw);
          let mailId: string | [string, string];
          if (Array.isArray(mailRef) && mailRef.length >= 2) {
            mailId = [String(mailRef[0]), String(mailRef[1])];
          } else if (Array.isArray(mailRef) && mailRef.length === 1) {
            mailId = [String(mailRef[0]), ""];
          } else {
            mailId = String(mailRef ?? "");
          }
          const mailRaw = await loadEntity<ServerInstance>(baseUrl, MAIL, mailId, {
            accessToken: result.accessToken,
          });
          const safeMail =
            "__proto__" in mailRaw
              ? (Object.fromEntries(Object.entries(mailRaw).filter(([k]) => k !== "__proto__")) as ServerInstance)
              : mailRaw;
          const mailSk = resolveSessionKey(keyChain, safeMail, MAIL);
          const mailDec = decryptParsedInstance(MAIL, safeMail, mailSk ?? null);
          const d = mailDec as ServerInstance;
          const toDateStr = (v: unknown): string | null => {
            if (v == null) return null;
            if (v instanceof Date) return v.toISOString();
            if (typeof v === "number") return new Date(v).toISOString();
            return String(v);
          };
          const senderAgg = mailRaw["111"];
          const sender = unwrapSingleElementArray(senderAgg);
          const senderAddress =
            sender != null && typeof sender === "object" && "95" in sender
              ? String((sender as Record<string, unknown>)["95"] ?? "")
              : null;
          const idForJson =
            typeof mailId === "string" ? mailId : mailId[0] + "/" + mailId[1];
          return {
            id: idForJson,
            subject: String(d["105"] ?? ""),
            senderAddress,
            receivedDate: toDateStr(d["107"]) ?? null,
            unread: d["109"] === true,
            state: d["108"] != null ? Number(d["108"]) : null,
            confidential: d["426"] === true,
            replyType: d["466"] != null ? Number(d["466"]) : null,
            differentEnvelopeSender: d["617"] != null ? String(d["617"]) : null,
            listUnsubscribe: d["866"] === true,
            movedTime: toDateStr(d["896"]) ?? null,
            phishingStatus: d["1021"] != null ? Number(d["1021"]) : null,
            authStatus: d["1022"] != null ? Number(d["1022"]) : null,
            method: d["1120"] != null ? Number(d["1120"]) : null,
            recipientCount: d["1307"] != null ? Number(d["1307"]) : null,
            encryptionAuthStatus: d["1346"] != null ? Number(d["1346"]) : null,
            keyVerificationState: d["1677"] != null ? Number(d["1677"]) : null,
            processingState: d["1728"] != null ? Number(d["1728"]) : null,
            processNeeded: d["1769"] === true,
            sendAt: toDateStr(d["1784"]) ?? null,
          };
        }
      );

      if (opts.json) {
        console.log(JSON.stringify({ mails }));
      } else {
        console.log("Mails (latest 10)");
        console.log("-----------------");
        for (const m of mails) {
          const fromPart = m.senderAddress != null ? `  ${m.senderAddress}` : "";
          console.log(`  ${m.unread ? "* " : "  "}${m.subject}\t${m.receivedDate ?? ""}${fromPart}`);
          const meta: string[] = [
            `id=${m.id}`,
            `from=${m.senderAddress ?? ""}`,
            `state=${m.state ?? ""}`,
            `unread=${m.unread}`,
            `confidential=${m.confidential}`,
            `recipientCount=${m.recipientCount ?? ""}`,
            `replyType=${m.replyType ?? ""}`,
            `method=${m.method ?? ""}`,
            `processingState=${m.processingState ?? ""}`,
            `processNeeded=${m.processNeeded}`,
          ];
          if (m.sendAt != null) meta.push(`sendAt=${m.sendAt}`);
          if (m.movedTime != null) meta.push(`movedTime=${m.movedTime}`);
          if (m.phishingStatus != null) meta.push(`phishingStatus=${m.phishingStatus}`);
          if (m.authStatus != null) meta.push(`authStatus=${m.authStatus}`);
          if (m.differentEnvelopeSender) meta.push(`differentEnvelopeSender=${m.differentEnvelopeSender}`);
          if (m.listUnsubscribe) meta.push("listUnsubscribe=true");
          if (m.encryptionAuthStatus != null) meta.push(`encryptionAuthStatus=${m.encryptionAuthStatus}`);
          if (m.keyVerificationState != null) meta.push(`keyVerificationState=${m.keyVerificationState}`);
          console.log(`    ${meta.join("  ")}`);
        }
      }
    } catch (err) {
      const message = getErrorMessage(err);
      if (message.includes("401") || message.includes("Unauthorized")) {
        clearSession();
        console.error(
          "Session expired or invalid. Please run 'auth check' to log in again, then try 'mails list' again."
        );
      } else {
        if (verbose && err instanceof Error && err.stack) console.error("[verbose] stack:", err.stack);
        console.error("Error:", message);
      }
      process.exit(1);
    }
  });

program
  .command("profile")
  .description("Log in and show your user profile (account type, enabled, etc.)")
  .option("--json", "Output result as JSON")
  .option("--verbose, -v", "Verbose logging for debugging")
  .action(async (opts: { json?: boolean; verbose?: boolean; V?: boolean }) => {
    const verbose = getVerbose(opts);
    if (verbose) {
      setVerbose(true);
      console.error("[verbose] Verbose logging enabled.");
    }
    try {
      const baseUrl = getApiBaseUrl();
      if (verbose) console.error("[verbose] API base URL:", baseUrl);
      const { result } = await getOrCreateSession(baseUrl, verbose);
      const userRaw = await loadUser(baseUrl, result.accessToken, result.userId);
      const user = normalizeUserReturn(userRaw);

      let customer: ReturnType<typeof normalizeCustomerReturn> | null = null;
      let customerInfo: ReturnType<typeof normalizeCustomerInfoReturn> | null = null;

      if (user.customer != null) {
        try {
          const customerRaw = await loadCustomer(baseUrl, result.accessToken, user.customer);
          if (verbose && "160" in customerRaw) console.error("[verbose] Customer raw 160 (customerInfo):", (customerRaw as Record<string, unknown>)["160"]);
          customer = normalizeCustomerReturn(customerRaw);
          let customerInfoId: [string, string] | undefined = undefined;
          const raw = customer.customerInfo;
          if (Array.isArray(raw) && raw.length === 1 && Array.isArray(raw[0]) && raw[0].length >= 2) {
            customerInfoId = [String(raw[0][0]), String(raw[0][1])];
          } else if (Array.isArray(raw) && raw.length >= 2 && raw[0] != null && raw[1] != null) {
            customerInfoId = [String(raw[0]), String(raw[1])];
          } else if (typeof raw === "string" && raw.includes("/")) {
            const parts = raw.split("/");
            if (parts.length >= 2) customerInfoId = [parts[0], parts[1]];
          }
          if (customerInfoId != null) {
            const customerInfoRaw = await loadCustomerInfo(
              baseUrl,
              result.accessToken,
              String(customerInfoId[0]),
              String(customerInfoId[1])
            );
            customerInfo = normalizeCustomerInfoReturn(customerInfoRaw);
          }
        } catch (e) {
          if (verbose) console.error("[verbose] Could not load customer/customerInfo:", e);
        }
      }

      const fullProfile = { user, customer: customer ?? undefined, customerInfo: customerInfo ?? undefined };

      if (opts.json) {
        console.log(JSON.stringify(fullProfile));
      } else {
        console.log("Profile");
        console.log("-------");
        console.log("User");
        if (user.accountType != null) console.log("  Account type:", user.accountType);
        if (user.enabled != null) console.log("  Enabled:", user.enabled);
        if (user.kdfVersion != null) console.log("  KDF version:", user.kdfVersion);
        if (user.requirePasswordUpdate != null)
          console.log("  Require password update:", user.requirePasswordUpdate);
        if (user.customer != null) console.log("  Customer id:", user.customer);

        if (customer != null) {
          console.log("Customer");
          if (customer.type != null) console.log("  Type:", customer.type);
          if (customer.approvalStatus != null) console.log("  Approval status:", customer.approvalStatus);
          if (customer.businessUse != null) console.log("  Business use:", customer.businessUse);
          if (customer.orderProcessingAgreementNeeded != null)
            console.log("  Order processing agreement needed:", customer.orderProcessingAgreementNeeded);
        }

        if (customerInfo != null) {
          console.log("Customer info");
          if (customerInfo.domain != null) console.log("  Domain:", customerInfo.domain);
          if (customerInfo.company != null) console.log("  Company:", customerInfo.company);
          if (customerInfo.plan != null) console.log("  Plan:", customerInfo.plan);
          if (customerInfo.registrationMailAddress != null)
            console.log("  Registration mail:", customerInfo.registrationMailAddress);
          if (customerInfo.creationTime != null) console.log("  Creation time:", customerInfo.creationTime);
          if (customerInfo.activationTime != null) console.log("  Activation time:", customerInfo.activationTime);
          if (customerInfo.includedEmailAliases != null)
            console.log("  Included email aliases:", customerInfo.includedEmailAliases);
          if (customerInfo.includedStorageCapacity != null)
            console.log("  Included storage capacity:", customerInfo.includedStorageCapacity);
          if (customerInfo.perUserStorageCapacity != null)
            console.log("  Per-user storage capacity:", customerInfo.perUserStorageCapacity);
          if (customerInfo.perUserAliasCount != null)
            console.log("  Per-user alias count:", customerInfo.perUserAliasCount);
          if (customerInfo.domainInfos != null && Array.isArray(customerInfo.domainInfos)) {
            console.log("  Domain infos:", customerInfo.domainInfos.length, "domain(s)");
            for (const di of customerInfo.domainInfos) {
              const domain = typeof di === "object" && di !== null && "domain" in di ? (di as { domain?: string }).domain : null;
              console.log("    -", domain ?? "(no domain name)");
            }
          }
        }
      }
    } catch (err) {
      const message = getErrorMessage(err);
      if (verbose) {
        console.error("[verbose] profile failed:", err);
        if (err instanceof Error && err.cause) console.error("[verbose] cause:", err.cause);
        if (err instanceof Error && err.stack) console.error("[verbose] stack:", err.stack);
      }
      if (opts.json) {
        console.log(JSON.stringify({ error: message }));
      } else {
        console.error("Error:", message);
      }
      process.exit(1);
    }
  });

program.parse();
