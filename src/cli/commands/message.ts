import type { Command } from "commander";
import { getApiBaseUrl } from "../../config.js";
import { getErrorMessage, isVerbose, log, setVerbose } from "../../logger.js";
import { clearSession } from "../../session.js";
import {
  decryptParsedInstance,
  type ServerInstance,
} from "../../crypto/decryptInstance.js";
import { resolveMailSessionKeyWithFormerRetry } from "../../crypto/resolveMailSessionKey.js";
import { MAIL } from "../../crypto/typeModels.js";
import { loadEntity, loadRange } from "../../rest.js";
import { unwrapSingleElementArray } from "../../utils/bytes.js";
import * as context from "../context.js";
import { exitCodeForError } from "../exitCodes.js";
import * as optsHelpers from "../opts.js";
import * as output from "../output.js";
import { loadMailBody } from "../loadMailBody.js";
import { runAttachmentDownload } from "../loadAttachments.js";
import { exportOneMessageToPath } from "../exportMessage.js";
import { htmlToPlainText } from "../../utils/htmlToPlainText.js";
import { parseMailId } from "../mailId.js";

export { parseMailId };

function getSenderFromMail(decryptedMail: ServerInstance): string {
  const senderAgg = decryptedMail["111"];
  const sender = unwrapSingleElementArray(senderAgg);
  if (sender != null && typeof sender === "object" && "95" in sender) {
    return String((sender as Record<string, unknown>)["95"] ?? "");
  }
  return "";
}

function toDateStr(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") return new Date(v).toISOString();
  return String(v);
}

export interface MessageReadOptions {
  output?: string;
  verbose?: boolean;
  V?: boolean;
}

export interface MessageReadResult {
  id: string;
  from: string;
  subject: string;
  date: string | null;
  bodyText: string;
  bodyTextPlain?: string;
}

export async function runMessageRead(
  mailIds: string[],
  options: MessageReadOptions,
  getOpts: () => Record<string, unknown>
): Promise<void> {
  const verbose = options.verbose ?? options.V ?? false;
  if (verbose) setVerbose(true);
  const useJson = output.getOutputFormat(getOpts());
  const plainFormat = output.getPlainFormat(getOpts());

  if (mailIds.length === 0) {
    console.error("Error: At least one mail-id is required. Use ids from 'envelope list --format json'.");
    process.exit(1);
  }

  try {
    const baseUrl = getApiBaseUrl();
    const { result, keyChain, userGroupId, mailGroupId, mailMembership } = await context.getSessionUserAndMailbox({ baseUrl, verbose });

    const results: MessageReadResult[] = [];

    for (const mailIdStr of mailIds) {
      const [listId, elementId] = parseMailId(mailIdStr);
      if (isVerbose()) {
        log(`Loading mail via loadEntity: ${listId}/${elementId}`);
      }
      const mailRaw = await loadEntity<ServerInstance>(baseUrl, MAIL, [listId, elementId], {
        accessToken: result.accessToken,
      });
      const safeMail =
        "__proto__" in mailRaw
          ? (Object.fromEntries(Object.entries(mailRaw).filter(([k]) => k !== "__proto__")) as ServerInstance)
          : mailRaw;
      if (isVerbose()) {
        const has1308 = safeMail["1308"] != null;
        const has1309 = safeMail["1309"] != null;
        const has1310 = safeMail["1310"] != null;
        const processNeeded = safeMail["1769"];
        const has102 = safeMail["102"] != null && safeMail["102"] !== "";
        const ownerKeyVer = safeMail["1395"];
        log(`Mail raw: mailDetails (1308) present=${has1308}, mailDetailsDraft (1309) present=${has1309}, bucketKey (1310) present=${has1310}, processNeeded (1769)=${processNeeded}, ownerEncSessionKey (102) present=${has102}, ownerKeyVersion (1395)=${ownerKeyVer}`);
      }
      const mailSk = await resolveMailSessionKeyWithFormerRetry(
        baseUrl,
        result.accessToken,
        keyChain,
        loadEntity,
        loadRange,
        mailGroupId,
        mailMembership.groupKeyVersion,
        safeMail,
        listId,
        elementId,
        userGroupId
      );
      const decryptedMail = decryptParsedInstance(MAIL, safeMail, mailSk ?? null) as ServerInstance;
      if (isVerbose()) {
        const decHas1308 = decryptedMail["1308"] != null;
        log(`Mail decrypted: mailDetails (1308) present=${decHas1308}`);
      }

      const { bodyText } = await loadMailBody({
        baseUrl,
        accessToken: result.accessToken,
        decryptedMail,
        rawMail: safeMail,
        keyChain,
        mailGroupId,
        mailMembership,
        userGroupId,
        listId,
        elementId,
        loadEntity,
        loadRange,
      });

      const from = getSenderFromMail(decryptedMail);
      const subject = String(decryptedMail["105"] ?? "");
      const date = toDateStr(decryptedMail["107"]);
      const idForOutput = listId + "/" + elementId;
      const bodyPlain = htmlToPlainText(bodyText);

      results.push({
        id: idForOutput,
        from,
        subject,
        date,
        bodyText,
        bodyTextPlain: bodyPlain,
      });
    }

    if (useJson) {
      const out = results.map((r) => ({
        id: r.id,
        from: r.from,
        subject: r.subject,
        date: r.date,
        body: r.bodyText,
      }));
      console.log(JSON.stringify(results.length === 1 ? out[0] : out));
    } else if (plainFormat === "tsv") {
      const header = ["Id", "From", "Subject", "Date", "Body"];
      const bodyPlain = (r: (typeof results)[0]) =>
        (r.bodyTextPlain ?? htmlToPlainText(r.bodyText)).replace(/\n/g, " ").replace(/\t/g, " ");
      const dataRows = results.map((r) => [
        r.id,
        r.from,
        r.subject.replace(/\t|\n/g, " "),
        r.date ?? "",
        bodyPlain(r),
      ]);
      output.printTable([header, ...dataRows], "tsv");
    } else {
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        console.log("From: " + r.from);
        console.log("Subject: " + r.subject);
        console.log("Date: " + (r.date ?? ""));
        console.log("");
        console.log(r.bodyTextPlain ?? htmlToPlainText(r.bodyText));
        if (i < results.length - 1) console.log("\n----------\n");
      }
    }
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

export function registerMessageCommands(
  program: Command,
  getOpts: () => Record<string, unknown>
): void {
  const messageCmd = program
    .command("message")
    .alias("msg")
    .description("Full message commands (read, export). Aligned with Himalaya-style message subcommands.");

  messageCmd
    .command("read <mail-id> [other-ids...]")
    .description(
      "Read full message(s) by mail-id (from 'envelope list --format json'). Prints headers and body. Multiple ids supported."
    )
    .option("--verbose, -v", "Verbose logging")
    .action(
      async function (
        this: Command,
        mailId: string,
        otherIds: string[],
        opts: { verbose?: boolean; V?: boolean }
      ) {
        const merged = optsHelpers.getOptsWithGlobalsLeafWins(this);
        const getOptsWithGlobals = () => merged;
        const ids = [mailId, ...(otherIds ?? [])].filter(Boolean);
        if (opts.verbose ?? opts.V) {
          output.logVerboseArgv();
          output.logVerboseOptions(merged);
          console.error("[verbose] output format:", output.getOutputOption(merged));
        }
        await runMessageRead(
          ids,
          { ...merged, ...opts },
          getOptsWithGlobals
        );
      }
    );

  messageCmd
    .command("export <mail-id>")
    .description("Export one message to an EML file. Mail-id from 'envelope list --format json'.")
    .option("--output <path>", "Output file path (default: current directory with date-subject.eml)")
    .option("--include-attachments", "Save attachments in a sibling directory next to the EML file")
    .option("--verbose, -v", "Verbose logging")
    .action(
      async (
        mailId: string,
        opts: { output?: string; includeAttachments?: boolean; verbose?: boolean; V?: boolean }
      ) => {
        const verbose = opts.verbose ?? opts.V ?? false;
        if (verbose) setVerbose(true);
        try {
          const baseUrl = getApiBaseUrl();
          const { result, keyChain, userGroupId, mailGroupId, mailMembership } = await context.getSessionUserAndMailbox({ baseUrl, verbose });

          const { path: writtenPath } = await exportOneMessageToPath({
            mailId,
            outputPath: opts.output,
            context: {
              baseUrl,
              accessToken: result.accessToken,
              keyChain,
              mailGroupId,
              mailMembership,
              userGroupId,
            },
            includeAttachments: opts.includeAttachments,
            verbose,
          });
          console.log("Exported to", writtenPath);
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

  messageCmd
    .command("attachment <mail-id>")
    .description("Download attachments from a message by mail-id (from 'envelope list --format json').")
    .option("--output <dir>", "Directory to save files (default: current directory)", ".")
    .option("--index <n>", "Download only the nth attachment (1-based)", (v) => parseInt(v, 10))
    .option("--verbose, -v", "Verbose logging")
    .action(
      async function (
        this: Command,
        mailId: string,
        opts: { output?: string; index?: number; verbose?: boolean; V?: boolean }
      ) {
        const verbose = opts.verbose ?? opts.V ?? false;
        if (verbose) setVerbose(true);
        const merged = optsHelpers.getOptsWithGlobalsLeafWins(this);
        const getOptsWithGlobals = () => merged;
        if (verbose) {
          output.logVerboseArgv();
          output.logVerboseOptions(merged);
          console.error("[verbose] output format:", output.getOutputOption(merged));
        }
        const useJson = output.getOutputFormat(getOptsWithGlobals());
        const plainFormat = output.getPlainFormat(getOptsWithGlobals());

        try {
          const baseUrl = getApiBaseUrl();
          const { result, keyChain } = await context.getSessionUserAndMailbox({ baseUrl, verbose });

          const saved = await runAttachmentDownload(
            mailId,
            {
              outputDir: opts.output ?? ".",
              index: opts.index,
              verbose,
            },
            {
              baseUrl,
              accessToken: result.accessToken,
              keyChain,
            }
          );

          if (saved.length === 0) {
            if (useJson) {
              console.log(JSON.stringify({ message: "No attachments.", saved: [] }));
            } else {
              console.error("No attachments.");
            }
            return;
          }

          if (useJson) {
            console.log(JSON.stringify(saved.map((s) => ({ name: s.name, path: s.path, size: s.size }))));
          } else if (plainFormat === "tsv") {
            const header = ["Name", "Path", "Size"];
            const dataRows = saved.map((s) => [s.name, s.path, String(s.size)]);
            output.printTable([header, ...dataRows], "tsv");
          } else {
            for (const s of saved) {
              console.log("Saved:", s.path);
            }
          }
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
