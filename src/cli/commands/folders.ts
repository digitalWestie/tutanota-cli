import * as fs from "fs";
import * as path from "path";
import type { Command } from "commander";
import { getApiBaseUrl } from "../../config.js";
import { getErrorMessage, setVerbose } from "../../logger.js";
import { clearSession } from "../../session.js";
import { resolveSessionKey, decryptParsedInstance, type ServerInstance } from "../../crypto/decryptInstance.js";
import { MAIL_SET, MAIL_SET_ENTRY } from "../../crypto/typeModels.js";
import { loadRange, GENERATED_MAX_ID } from "../../rest.js";
import { unwrapSingleElementArray } from "../../utils/bytes.js";
import * as context from "../context.js";
import { exitCodeForError } from "../exitCodes.js";
import * as optsHelpers from "../opts.js";
import * as output from "../output.js";
import { loadFolderEntries, resolveFolderByIdOrName } from "./envelope.js";
import { exportOneMessageToPath } from "../exportMessage.js";

const SYSTEM_FOLDER_DISPLAY_NAMES: Record<string, string> = {
  "1": "Inbox",
  "2": "Sent",
  "3": "Trash",
  "4": "Archive",
  "5": "Spam",
  "6": "Draft",
  "10": "Scheduled",
};

/**
 * Returns the display name for a decrypted MailSet instance (e.g. "Inbox", "Sent", or the decrypted name).
 * Shared by folders list and envelope list for consistent folder resolution by name.
 */
export function getFolderDisplayName(dec: ServerInstance): string {
  const name = ((dec["435"] ?? "") as string) || "";
  const folderTypeStr = String(dec["436"] ?? "");
  return String(name).trim() !== ""
    ? String(name)
    : SYSTEM_FOLDER_DISPLAY_NAMES[folderTypeStr] ??
        (folderTypeStr === "8" ? "Label (no name)" : folderTypeStr === "0" ? "(no name)" : String(name) || "(no name)");
}

export function registerFoldersCommands(
  program: Command,
  getOpts: () => Record<string, unknown>
): void {
  const foldersCmd = program
    .command("folders")
    .description("Mail folder commands");

  foldersCmd
    .command("list")
    .description("List mail folders (requires password when using stored session)")
    .option("--verbose, -v", "Verbose logging")
    .action(async function (this: Command, opts: { verbose?: boolean; V?: boolean; f?: string }) {
      const verbose = opts.V ?? false;
      if (verbose) setVerbose(true);
      const merged = optsHelpers.getOptsWithGlobalsLeafWins(this);
      const getOptsWithGlobals = () => merged;
      if (verbose) {
        output.logVerboseArgv();
        output.logVerboseOptions(merged);
        console.error("[verbose] output format:", output.getOutputOption(merged));
      }
      try {
        const baseUrl = getApiBaseUrl();
        const { keyChain, mailGroupId, mailSetRawList } = await context.getSessionUserAndMailbox({
          baseUrl,
          verbose,
        });

        const availableVersions = keyChain.getAvailableKeyVersions(mailGroupId);
        const FOLDER_LIST_CONCURRENCY = 5;
        const folders = await context.mapWithConcurrency(
          mailSetRawList,
          FOLDER_LIST_CONCURRENCY,
          async (raw, i) => {
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
            const id = Array.isArray(idRaw)
              ? String(idRaw[idRaw.length - 1] ?? "")
              : String(idRaw ?? "");
            const folderType = (dec as ServerInstance)["436"];
            const folderTypeStr = String(folderType ?? "");
            const displayName = getFolderDisplayName(dec as ServerInstance);
            if (verbose && (folderTypeStr === "0" || folderTypeStr === "8") && String(name).trim() === "") {
              console.error(
                "[verbose] Custom/label folder with empty name:",
                "id:",
                id,
                "_ownerKeyVersion:",
                safe["1399"],
                triedVersion != null ? "decrypted with keyVersion: " + triedVersion : "tried all versions"
              );
            }
            return { name: displayName, id, folderType };
          }
        );

        if (output.getOutputFormat(getOptsWithGlobals())) {
          console.log(JSON.stringify({ folders }));
        } else {
          const rows = [
            ["Name", "Id", "Folder Type"],
            ...folders.map((f) => [f.name, f.id, String(f.folderType)]),
          ];
          output.printTable(rows, output.getPlainFormat(getOptsWithGlobals()));
        }
      } catch (err) {
        const message = getErrorMessage(err);
        if (context.isSessionExpiredOrInvalid(err)) {
          clearSession();
          console.error(
            "Session expired, invalid, or timed out (HTTP 440). Please run 'account check' (or 'auth check') to log in again, then try 'folders list' again."
          );
        } else {
          if (verbose && err instanceof Error && err.stack) console.error("[verbose] stack:", err.stack);
          console.error("Error:", message);
        }
        process.exit(exitCodeForError(err));
      }
    });

  foldersCmd
    .command("export <folder>")
    .description("Export all messages in a folder to EML files in the given directory.")
    .requiredOption("--path <dir>", "Output directory for EML files")
    .option("--format <format>", "Export format (default: eml)", "eml")
    .option("--resume", "Skip messages that already have an EML file")
    .option("--concurrency <n>", "Max concurrent message exports per page", (v) => parseInt(v, 10), 5)
    .option("--include-attachments", "Save attachments in a sibling directory next to each EML file")
    .option("--verbose, -v", "Verbose logging")
    .action(
      async (
        folderArg: string,
        opts: {
          path: string;
          format?: string;
          resume?: boolean;
          concurrency?: number;
          includeAttachments?: boolean;
          verbose?: boolean;
          V?: boolean;
        }
      ) => {
        const verbose = opts.verbose ?? opts.V ?? false;
        if (verbose) setVerbose(true);
        const outDir = opts.path;
        const concurrency = Math.max(1, Math.min(20, opts.concurrency ?? 5));

        try {
          const baseUrl = getApiBaseUrl();
          const { result, keyChain, userGroupId, mailGroupId, mailMembership, mailSetRawList } = await context.getSessionUserAndMailbox({
            baseUrl,
            verbose,
          });

          const folderEntries = await loadFolderEntries({ keyChain, mailGroupId, mailSetRawList });
          const resolved = resolveFolderByIdOrName(folderEntries, folderArg?.trim());

          if ("error" in resolved) {
            if (resolved.error === "multiple_match") {
              console.error("Error: Multiple folders match that name; use a folder id (run 'folders list').");
              process.exit(1);
            }
            if ((folderArg ?? "").trim() === "") {
              console.error("Error: Inbox folder not found.");
            } else {
              console.error("Error: Folder not found:", folderArg, "(run 'folders list' to see folder ids and names)");
            }
            process.exit(1);
          }
          const folder = resolved.folder;
          const entriesListId = folder.entriesListId;
          if (entriesListId == null) {
            console.error("Error: Folder has no entries list.");
            process.exit(1);
          }

          fs.mkdirSync(outDir, { recursive: true });

          const ctx = {
            baseUrl,
            accessToken: result.accessToken,
            keyChain,
            mailGroupId,
            mailMembership,
            userGroupId,
          };

          let cursor: string | undefined = undefined;
          let totalExported = 0;
          const PAGE_SIZE = 100;

          function mailIdFromEntry(entry: Record<string, unknown>): string {
            const mailRefRaw = entry["1456"];
            const mailRef = unwrapSingleElementArray(mailRefRaw);
            if (Array.isArray(mailRef) && mailRef.length >= 2) {
              return String(mailRef[0]) + "/" + String(mailRef[1]);
            }
            if (Array.isArray(mailRef) && mailRef.length === 1) {
              return String(mailRef[0]) + "/";
            }
            return String(mailRef ?? "");
          }

          function nextCursorFromPage(entries: Record<string, unknown>[]): string | undefined {
            if (entries.length < PAGE_SIZE || entries.length === 0) return undefined;
            const last = entries[entries.length - 1];
            const elementIdFrom = (idRaw: unknown): string | undefined => {
              if (idRaw == null) return undefined;
              if (Array.isArray(idRaw) && idRaw.length >= 2) return String(idRaw[idRaw.length - 1] ?? "");
              if (Array.isArray(idRaw) && idRaw.length === 1) return String(idRaw[0] ?? "");
              const s = String(idRaw);
              return s === "" ? undefined : s;
            };
            return elementIdFrom(last["1452"]) ?? elementIdFrom(last["431"]) ?? elementIdFrom(last["_id"]);
          }

          while (true) {
            const startId = cursor != null && cursor !== "" ? cursor : GENERATED_MAX_ID;
            const mailSetEntryList = await loadRange<Record<string, unknown>>(
              baseUrl,
              MAIL_SET_ENTRY,
              entriesListId,
              {
                accessToken: result.accessToken,
                start: startId,
                count: PAGE_SIZE,
                reverse: true,
              }
            );

            const mailIds = mailSetEntryList.map((e) => mailIdFromEntry(e));
            await context.mapWithConcurrency(mailIds, concurrency, async (mailId) => {
              await exportOneMessageToPath({
                mailId,
                outputDir: outDir,
                context: ctx,
                includeAttachments: opts.includeAttachments,
                skipIfExists: opts.resume,
                verbose,
              });
            });
            totalExported += mailIds.length;
            cursor = nextCursorFromPage(mailSetEntryList);
            if (cursor == null) break;
          }

          console.error("Exported", totalExported, "messages to", outDir);
        } catch (err) {
          const message = getErrorMessage(err);
          if (context.isSessionExpiredOrInvalid(err)) {
            clearSession();
            console.error("Session expired or invalid. Run 'account check' to log in again.");
          } else {
            if (verbose && err instanceof Error && err.stack) console.error("[verbose] stack:", err.stack);
            console.error("Error:", message);
          }
          process.exit(exitCodeForError(err));
        }
      }
    );
}
