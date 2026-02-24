import type { Command } from "commander";
import { getApiBaseUrl } from "../../config.js";
import { loadUser } from "../../auth/login.js";
import { getErrorMessage, setVerbose } from "../../logger.js";
import { clearSession, readSession } from "../../session.js";
import { resolveSessionKey, decryptParsedInstance, type ServerInstance } from "../../crypto/decryptInstance.js";
import { MAIL_SET } from "../../crypto/typeModels.js";
import * as context from "../context.js";
import * as output from "../output.js";
import * as mailbox from "../mailbox.js";

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
  const foldersCmd = program.command("folders").description("Mail folder commands");

  foldersCmd
    .command("list")
    .description("List mail folders (requires password when using stored session)")
    .option("--verbose, -v", "Verbose logging")
    .action(async (opts: { verbose?: boolean; V?: boolean }) => {
      const verbose = opts.V ?? false;
      if (verbose) setVerbose(true);
      try {
        const baseUrl = getApiBaseUrl();
        let { result } = await context.getOrCreateSession(baseUrl, verbose);
        let userPassphraseKey = await context.getPassphraseKeyForDecryption(baseUrl, result, verbose);

        let userRaw: Record<string, unknown>;
        try {
          userRaw = (await loadUser(baseUrl, result.accessToken, result.userId)) as Record<string, unknown>;
        } catch (loadErr) {
          const loadMsg = loadErr instanceof Error ? loadErr.message : String(loadErr);
          if ((loadMsg.includes("401") || loadMsg.includes("Unauthorized")) && readSession() != null) {
            if (verbose) console.error("[verbose] loadUser returned 401; clearing session and retrying with fresh login.");
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

        if (output.getOutputFormat(getOpts())) {
          console.log(JSON.stringify({ folders }));
        } else {
          const rows = [
            ["Name", "Id", "FolderType"],
            ...folders.map((f) => [f.name, f.id, String(f.folderType)]),
          ];
          output.printTable(rows, output.getPlainFormat(getOpts()));
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
        process.exit(1);
      }
    });
}
