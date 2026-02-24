import type { Command } from "commander";
import kleur from "kleur";
import { getApiBaseUrl } from "../../config.js";
import { loadUser } from "../../auth/login.js";
import { getErrorMessage, setVerbose } from "../../logger.js";
import { clearSession, readSession } from "../../session.js";
import {
  resolveSessionKey,
  decryptParsedInstance,
  type ServerInstance,
} from "../../crypto/decryptInstance.js";
import { MAIL_SET, MAIL_SET_ENTRY, MAIL } from "../../crypto/typeModels.js";
import { loadEntity, loadRange, GENERATED_MAX_ID } from "../../rest.js";
import { unwrapSingleElementArray } from "../../utils/bytes.js";
import * as context from "../context.js";
import * as output from "../output.js";
import * as mailbox from "../mailbox.js";
import { getFolderDisplayName } from "./folders.js";

export interface EnvelopeListOptions {
  output?: string;
  verbose?: boolean;
  V?: boolean;
  count?: number;
  C?: number;
  unread?: boolean;
  U?: boolean;
  cursor?: string;
}

export async function runEnvelopeList(
  folderId: string | undefined,
  options: EnvelopeListOptions,
  getOpts: () => Record<string, unknown>
): Promise<void> {
  const verbose = options.verbose ?? options.V ?? false;
  if (verbose) setVerbose(true);
  const count = options.count ?? (options.C != null ? Math.max(1, Math.min(100, options.C)) : 10);
  const onlyUnread = options.unread ?? options.U ?? false;
  const useJson = output.getOutputFormat(getOpts());

  if (verbose) {
    console.error("[verbose] Running with options:", JSON.stringify(options));
    console.error("[verbose] count=", count, "onlyUnread=", onlyUnread);
  }

  const folderIdTrimmed = typeof folderId === "string" ? folderId.trim() : "";
  try {
    const baseUrl = getApiBaseUrl();
    let { result } = await context.getOrCreateSession(baseUrl, verbose);
    let userPassphraseKey = await context.getPassphraseKeyForDecryption(baseUrl, result, verbose);

    let userRaw: Record<string, unknown>;
    try {
      userRaw = (await loadUser(baseUrl, result.accessToken, result.userId)) as Record<string, unknown>;
    } catch (loadErr) {
      if (context.isSessionExpiredOrInvalid(loadErr) && readSession() != null) {
        if (verbose) console.error("[verbose] loadUser returned 401/440; clearing session and retrying with fresh login.");
        clearSession();
        const retry = await context.getOrCreateSession(baseUrl, verbose);
        result = retry.result;
        userPassphraseKey = await context.getPassphraseKeyForDecryption(baseUrl, result, verbose);
        userRaw = (await loadUser(baseUrl, result.accessToken, result.userId)) as Record<string, unknown>;
      } else {
        throw loadErr;
      }
    }
    const { keyChain, mailGroupId, mailSetRawList } = await mailbox.loadMailboxAndMailSetList({
      baseUrl,
      result,
      userPassphraseKey,
      userRaw,
      verbose,
    });

    const availableVersions = keyChain.getAvailableKeyVersions(mailGroupId);
    const MAILS_LIST_CONCURRENCY = 5;
    const folderEntries = await context.mapWithConcurrency(
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
        const folderType = (dec as ServerInstance)["436"];
        const name = getFolderDisplayName(dec as ServerInstance);
        return { id, entriesListId, folderType, name };
      }
    );

    let folder: (typeof folderEntries)[number] | undefined;
    if (folderIdTrimmed === "") {
      folder = folderEntries.find((f) => String(f.folderType) === "1");
    } else {
      folder = folderEntries.find((f) => f.id === folderIdTrimmed);
      if (folder == null) {
        const byName = folderEntries.filter(
          (f) => f.name.trim().toLowerCase() === folderIdTrimmed.trim().toLowerCase()
        );
        if (byName.length === 1) {
          folder = byName[0];
        } else if (byName.length > 1) {
          console.error("Error: Multiple folders match that name; use a folder id (run 'folders list').");
          process.exit(1);
        }
      }
    }
    if (folder == null || folder.entriesListId == null) {
      if (folderIdTrimmed === "") {
        console.error("Error: Inbox folder not found.");
      } else {
        console.error("Error: Folder not found:", folderIdTrimmed, "(run 'folders list' to see folder ids and names)");
      }
      process.exit(1);
    }

    const startId = options.cursor != null && options.cursor.trim() !== "" ? options.cursor.trim() : GENERATED_MAX_ID;
    const mailSetEntryList = await loadRange<Record<string, unknown>>(
      baseUrl,
      MAIL_SET_ENTRY,
      folder.entriesListId,
      {
        accessToken: result.accessToken,
        start: startId,
        count: count,
        reverse: true,
      }
    );

    let nextCursor: string | undefined;
    if (mailSetEntryList.length === count && mailSetEntryList.length > 0) {
      const lastEntry = mailSetEntryList[mailSetEntryList.length - 1] as Record<string, unknown>;
      const elementIdFrom = (idRaw: unknown): string | undefined => {
        if (idRaw == null) return undefined;
        if (Array.isArray(idRaw) && idRaw.length >= 2) return String(idRaw[idRaw.length - 1] ?? "");
        if (Array.isArray(idRaw) && idRaw.length === 1) return String(idRaw[0] ?? "");
        const s = String(idRaw);
        return s === "" ? undefined : s;
      };
      nextCursor = elementIdFrom(lastEntry["1452"]) ?? elementIdFrom(lastEntry["431"]) ?? elementIdFrom(lastEntry["_id"]);
    }

    const MAIL_LOAD_CONCURRENCY = 5;
    const mails = await context.mapWithConcurrency(
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
        const attachments115 = safeMail["115"];
        const attachmentCount = Array.isArray(attachments115) ? attachments115.length : 0;
        if (verbose) {
          console.error("[verbose] Mail", typeof mailId === "string" ? mailId : mailId[0] + "/" + mailId[1], "attachments (115):", attachments115, typeof attachments115 === "object" ? `(length ${Array.isArray(attachments115) ? attachments115.length : "n/a"})` : "");
        }
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
        const idForJson = typeof mailId === "string" ? mailId : mailId[0] + "/" + mailId[1];
        return {
          id: idForJson,
          subject: String(d["105"] ?? ""),
          senderAddress,
          receivedDate: toDateStr(d["107"]) ?? null,
          unread: d["109"] === true || d["109"] === 1 || d["109"] === "1",
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
          attachmentCount,
        };
      }
    );

    const toShow = onlyUnread ? mails.filter((m) => m.unread) : mails;

    if (useJson) {
      const jsonPayload: { mails: typeof toShow; nextCursor?: string } = { mails: toShow };
      if (nextCursor != null) jsonPayload.nextCursor = nextCursor;
      console.log(JSON.stringify(jsonPayload));
    } else {
      const header = ["Subject", "Date", "From", "Unread", "State", "Attachments"];
      const dataRows = toShow.map((m) => {
        const fromPart = m.senderAddress != null ? m.senderAddress : "";
        let statePart = "Unknown";
        if (m.state === 0) statePart = "Draft";
        if (m.state === 1) statePart = "Sent";
        if (m.state === 2) statePart = "Received";
        if (m.state === 3) statePart = "Sending";
        const subjectPart = m.subject.replace(/\r\n|\r|\n/g, " ").trim();
        return [subjectPart, m.receivedDate ?? "", fromPart, m.unread ? "Yes" : "No", statePart, String(m.attachmentCount)];
      });
      const rows = [header, ...dataRows];
      const plainFormat = output.getPlainFormat(getOpts());
      output.printTable(rows, plainFormat);
      if (verbose) {
        for (const m of toShow) {
          const meta: string[] = [
            `id=${m.id}`,
            `from=${m.senderAddress ?? ""}`,
            `state=${m.state ?? ""}`,
            `unread=${m.unread}`,
            `attachmentCount=${m.attachmentCount}`,
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
      if (plainFormat === "pretty" && nextCursor != null) {
        const total = toShow.length;
        const unreadCount = toShow.filter((m) => m.unread).length;
        const listPart = folderIdTrimmed !== "" ? ` envelope list ${folderIdTrimmed}` : " envelope list";
        const hint = `Showing ${total} email${total === 1 ? "" : "s"} (${unreadCount} unread) from ${folder.id}. To list older emails: tutanota-cli${listPart} --cursor "${nextCursor}"`;
        console.log("");
        console.log(kleur.dim(hint));
      }
    }
  } catch (err) {
    const message = getErrorMessage(err);
    if (context.isSessionExpiredOrInvalid(err)) {
      clearSession();
      console.error(
        "Session expired, invalid, or timed out (HTTP 440). Please run 'account check' (or 'auth check') to log in again, then try 'envelope list' again."
      );
    } else {
      if (verbose && err instanceof Error && err.stack) console.error("[verbose] stack:", err.stack);
      console.error("Error:", message);
    }
    process.exit(1);
  }
}

export function registerEnvelopeCommands(
  program: Command,
  getOpts: () => Record<string, unknown>
): void {
  const envelopeCmd = program.command("envelope").alias("emails").description("Envelope (message header) commands");

  envelopeCmd
    .command("list [folder]")
    .description("List latest N envelopes in a folder (default: Inbox; folder can be id or name from 'folders list', e.g. Inbox, Sent)")
    .option("--verbose, -v", "Verbose logging")
    .option("--count, -c <n>", "Number of envelopes to list (default: 10, max: 100)")
    .option("--unread, -u", "Show only unread")
    .option("--cursor <id>", "Cursor for next page (use nextCursor from previous JSON or hint)")
    .action(
      async (
        folderId: string | undefined,
        opts: { verbose?: boolean; V?: boolean; C?: number; count?: number; unread?: boolean; U?: boolean; cursor?: string }
      ) => {
        await runEnvelopeList(
          folderId,
          {
            ...program.opts(),
            ...opts,
            count: opts.C != null ? Math.max(1, Math.min(100, opts.C)) : opts.count ?? 10,
            cursor: opts.cursor,
          },
          getOpts
        );
      }
    );
}
