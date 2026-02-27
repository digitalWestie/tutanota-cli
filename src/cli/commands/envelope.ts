import type { Command } from "commander";
import type { KeyChain } from "../../crypto/keyChain.js";
import kleur from "kleur";
import { getApiBaseUrl } from "../../config.js";
import { getErrorMessage, setVerbose } from "../../logger.js";
import { clearSession } from "../../session.js";
import {
  resolveSessionKey,
  decryptParsedInstance,
  type ServerInstance,
} from "../../crypto/decryptInstance.js";
import { MAIL_SET, MAIL_SET_ENTRY, MAIL, MAIL_ADDRESS } from "../../crypto/typeModels.js";
import { loadEntity, loadRange, GENERATED_MAX_ID } from "../../rest.js";
import { unwrapSingleElementArray } from "../../utils/bytes.js";
import * as context from "../context.js";
import { exitCodeForError } from "../exitCodes.js";
import * as optsHelpers from "../opts.js";
import * as output from "../output.js";
import * as mailbox from "../mailbox.js";
import { getFolderDisplayName } from "./folders.js";

/** Folder entry from decrypted MailSet list. Shared by envelope list and folder export. */
export interface FolderEntry {
  id: string;
  entriesListId: string | null;
  folderType: string;
  name: string;
}

const FOLDER_LIST_CONCURRENCY = 5;

/**
 * Load and decrypt folder entries (MailSets) into FolderEntry list. Shared by envelope list and folder export.
 */
export async function loadFolderEntries(options: {
  keyChain: KeyChain;
  mailGroupId: string;
  mailSetRawList: ServerInstance[];
}): Promise<FolderEntry[]> {
  const { keyChain, mailGroupId, mailSetRawList } = options;
  const availableVersions = keyChain.getAvailableKeyVersions(mailGroupId);
  return context.mapWithConcurrency(
    mailSetRawList,
    FOLDER_LIST_CONCURRENCY,
    async (raw) => {
      const safe =
        "__proto__" in raw
          ? (Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "__proto__")) as ServerInstance)
          : raw;
      const instanceVersion = String((safe["1399"] ?? "") as string);
      const versionsToTry =
        availableVersions.length <= 1
          ? [instanceVersion]
          : [instanceVersion, ...availableVersions.filter((v) => v !== instanceVersion)];
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
      const folderType = String((dec as ServerInstance)["436"] ?? "");
      const name = getFolderDisplayName(dec as ServerInstance);
      return { id, entriesListId, folderType, name };
    }
  );
}

/**
 * Resolve a folder by id or name. Returns the folder, or an error for not-found / multiple name matches.
 * Empty string means Inbox (folderType "1").
 */
export function resolveFolderByIdOrName(
  folderEntries: FolderEntry[],
  folderIdOrName: string | undefined
): { folder: FolderEntry } | { error: "not_found" } | { error: "multiple_match" } {
  const trimmed = (folderIdOrName ?? "").trim();
  if (trimmed === "") {
    const inbox = folderEntries.find((f) => String(f.folderType) === "1");
    return inbox != null && inbox.entriesListId != null ? { folder: inbox } : { error: "not_found" };
  }
  const byId = folderEntries.find((f) => f.id === trimmed);
  if (byId != null) return { folder: byId };
  const byName = folderEntries.filter(
    (f) => f.name.trim().toLowerCase() === trimmed.toLowerCase()
  );
  if (byName.length === 1) return { folder: byName[0] };
  if (byName.length > 1) return { error: "multiple_match" };
  return { error: "not_found" };
}

/** Max width for Subject column in envelope list (pretty table). Used for both data truncation and table colMaxWidths. */
const ENVELOPE_LIST_SUBJECT_MAX_WIDTH = 100;

/** Max width for From column in pretty envelope list. */
const ENVELOPE_LIST_FROM_MAX_WIDTH = 40;

/** Format an ISO date string or timestamp for pretty table: "YYYY-MM-DD HH:mm" in local time. */
function formatDateForPretty(isoOrNull: string | number | null): string {
  if (isoOrNull == null || isoOrNull === "") return "";
  const parsed =
    typeof isoOrNull === "number"
      ? new Date(isoOrNull)
      : /^\d+$/.test(String(isoOrNull))
        ? new Date(Number(isoOrNull))
        : new Date(isoOrNull);
  if (Number.isNaN(parsed.getTime())) return String(isoOrNull);
  const y = parsed.getFullYear();
  const mo = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const h = String(parsed.getHours()).padStart(2, "0");
  const min = String(parsed.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${day} ${h}:${min}`;
}

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
    console.error("[verbose] output format:", output.getOutputOption(getOpts()));
    console.error("[verbose] count=", count, "onlyUnread=", onlyUnread);
  }

  const folderIdTrimmed = typeof folderId === "string" ? folderId.trim() : "";
  try {
    const baseUrl = getApiBaseUrl();
    const { result, keyChain, mailGroupId, mailSetRawList } = await context.getSessionUserAndMailbox({
      baseUrl,
      verbose,
    });

    const folderEntries = await loadFolderEntries({ keyChain, mailGroupId, mailSetRawList });

    const resolved = resolveFolderByIdOrName(folderEntries, folderIdTrimmed);
    if ("error" in resolved) {
      if (resolved.error === "multiple_match") {
        console.error("Error: Multiple folders match that name; use a folder id (run 'folders list').");
        process.exit(1);
      }
      if (folderIdTrimmed === "") {
        console.error("Error: Inbox folder not found.");
      } else {
        console.error("Error: Folder not found:", folderIdTrimmed, "(run 'folders list' to see folder ids and names)");
      }
      process.exit(1);
    }
    const folder = resolved.folder;
    const entriesListId = folder.entriesListId;
    if (entriesListId == null) {
      console.error("Error: Folder has no entries list.");
      process.exit(1);
    }

    const startId = options.cursor != null && options.cursor.trim() !== "" ? options.cursor.trim() : GENERATED_MAX_ID;
    const mailSetEntryList = await loadRange<Record<string, unknown>>(
      baseUrl,
      MAIL_SET_ENTRY,
      entriesListId,
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
        const mailSk = resolveSessionKey(keyChain, safeMail, MAIL);
        const mailDec = decryptParsedInstance(MAIL, safeMail, mailSk ?? null);
        const d = mailDec as ServerInstance;
        const toDateStr = (v: unknown): string | null => {
          if (v == null) return null;
          if (v instanceof Date) return v.toISOString();
          if (typeof v === "number") return new Date(v).toISOString();
          const s = String(v);
          if (/^\d+$/.test(s)) return new Date(Number(s)).toISOString();
          return s;
        };
        const senderAgg = mailRaw["111"];
        const sender = unwrapSingleElementArray(senderAgg);
        let senderName: string | null = null;
        let senderAddress: string | null = null;
        if (sender != null && typeof sender === "object") {
          const senderObj = sender as Record<string, unknown>;
          try {
            const decSender = decryptParsedInstance(
              MAIL_ADDRESS,
              senderObj,
              mailSk ?? null
            ) as Record<string, unknown>;
            senderName =
              decSender["94"] != null && String(decSender["94"]).trim() !== ""
                ? String(decSender["94"]).trim()
                : null;
            senderAddress =
              decSender["95"] != null && String(decSender["95"]).trim() !== ""
                ? String(decSender["95"]).trim()
                : null;
          } catch {
            senderAddress =
              "95" in senderObj && senderObj["95"] != null
                ? String(senderObj["95"]).trim()
                : null;
          }
        }
        if (senderAddress == null && sender != null && typeof sender === "object" && "95" in (sender as object)) {
          senderAddress = String((sender as Record<string, unknown>)["95"] ?? "").trim() || null;
        }
        // Use element id from loaded Mail response (99); server may return full id (listId,elementId) so extract element id only for display
        const responseId = safeMail["99"];
        const elementIdOnly = ((): string => {
          if (responseId == null) return typeof mailId === "string" ? mailId : mailId[1];
          if (Array.isArray(responseId) && responseId.length >= 2) return String(responseId[1]);
          const s = String(responseId);
          if (s === "") return typeof mailId === "string" ? mailId : mailId[1];
          const lastComma = s.lastIndexOf(",");
          return lastComma >= 0 ? s.slice(lastComma + 1).trim() : s;
        })();
        const idForJson =
          typeof mailId === "string" ? mailId : mailId[0] + "/" + elementIdOnly;
        const stateNum = d["108"] != null ? Number(d["108"]) : null;
        const stateLabel =
          stateNum === 0 ? "Draft" : stateNum === 1 ? "Sent" : stateNum === 2 ? "Received" : stateNum === 3 ? "Sending" : "Unknown";
        return {
          id: idForJson,
          subject: String(d["105"] ?? ""),
          senderName: senderName ?? null,
          senderAddress: senderAddress ?? null,
          receivedDate: toDateStr(d["107"]) ?? null,
          unread: d["109"] === true || d["109"] === 1 || d["109"] === "1",
          state: stateNum,
          stateLabel,
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
      const plainFormat = output.getPlainFormat(getOpts());
      const subjectMaxLen = plainFormat === "pretty" ? ENVELOPE_LIST_SUBJECT_MAX_WIDTH : Number.MAX_SAFE_INTEGER;

      if (plainFormat === "tsv") {
        const header = [
          "Id",
          "Subject",
          "Received Date",
          "Sender Name",
          "Sender Address",
          "Unread",
          "Attachment Count",
          "State",
          "State Label",
        ];
        const dataRows = toShow.map((m) => [
          m.id,
          m.subject.replace(/\r\n|\r|\n/g, " ").trim(),
          m.receivedDate ?? "",
          (m.senderName ?? "").trim(),
          (m.senderAddress ?? "").trim(),
          String(m.unread),
          String(m.attachmentCount),
          String(m.state ?? ""),
          m.stateLabel,
        ]);
        output.printTable([header, ...dataRows], "tsv");
      } else {
        const header = ["Id", "Flags", "Subject", "Date", "From", "State"];
        const dataRows = toShow.map((m) => {
          const namePart = (m.senderName ?? "").trim();
          const addrPart = (m.senderAddress ?? "").trim();
          const fromPart =
            namePart && addrPart ? `${namePart} (${addrPart})` : namePart || addrPart;
          const fromTrimmed =
            fromPart.length > ENVELOPE_LIST_FROM_MAX_WIDTH
              ? fromPart.slice(0, ENVELOPE_LIST_FROM_MAX_WIDTH - 3) + "..."
              : fromPart;
          const flags = (m.unread ? "*" : "") + (m.attachmentCount > 0 ? "@" : "");
          let subjectPart = m.subject.replace(/\r\n|\r|\n/g, " ").trim();
          if (subjectPart.length > subjectMaxLen) {
            subjectPart = subjectPart.slice(0, subjectMaxLen - 3) + "...";
          }
          const datePart = formatDateForPretty(m.receivedDate);
          return [m.id, flags, subjectPart, datePart, fromTrimmed, m.stateLabel];
        });
        const rows = [header, ...dataRows];
        output.printTable(rows, "pretty", {
          colMaxWidths: {
            0: 512,
            2: ENVELOPE_LIST_SUBJECT_MAX_WIDTH,
            4: ENVELOPE_LIST_FROM_MAX_WIDTH,
          },
          preferExtraWidthForColumn: 2,
        });
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
    process.exit(exitCodeForError(err));
  }
}

export function registerEnvelopeCommands(
  program: Command,
  getOpts: () => Record<string, unknown>
): void {
  const envelopeCmd = program
    .command("envelope")
    .alias("messages")
    .description("Envelope (message header) commands");

  envelopeCmd
    .command("list [folder]")
    .description("List latest N envelopes in a folder (default: Inbox; folder can be id or name from 'folders list', e.g. Inbox, Sent)")
    .option("--verbose, -v", "Verbose logging")
    .option("--count, -c <n>", "Number of envelopes to list (default: 10, max: 100)")
    .option("--unread, -u", "Show only unread")
    .option("--cursor <id>", "Cursor for next page (use nextCursor from previous JSON or hint)")
    .action(
      async function (
        this: Command,
        folderId: string | undefined,
        opts: { verbose?: boolean; V?: boolean; C?: number; count?: number; unread?: boolean; U?: boolean; cursor?: string }
      ) {
        const merged = optsHelpers.getOptsWithGlobalsLeafWins(this);
        const getOptsWithGlobals = () => merged;
        if (opts.verbose ?? opts.V) {
          output.logVerboseArgv();
          output.logVerboseOptions(merged);
          console.error("[verbose] output format:", output.getOutputOption(merged));
        }
        await runEnvelopeList(
          folderId,
          {
            ...merged,
            ...opts,
            count: opts.C != null ? Math.max(1, Math.min(100, opts.C)) : opts.count ?? 10,
            cursor: opts.cursor,
          },
          getOptsWithGlobals
        );
      }
    );
}
