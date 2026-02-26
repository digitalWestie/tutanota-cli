import type { Command } from "commander";
import { getApiBaseUrl } from "../../config.js";
import { loadUser } from "../../auth/login.js";
import { getErrorMessage, isVerbose, log, setVerbose } from "../../logger.js";
import { clearSession, readSession } from "../../session.js";
import {
  resolveSessionKey,
  decryptParsedInstance,
  type ServerInstance,
} from "../../crypto/decryptInstance.js";
import { MAIL } from "../../crypto/typeModels.js";
import { loadEntity } from "../../rest.js";
import { unwrapSingleElementArray } from "../../utils/bytes.js";
import * as context from "../context.js";
import { exitCodeForError } from "../exitCodes.js";
import * as output from "../output.js";
import * as mailbox from "../mailbox.js";
import { loadMailBody } from "../loadMailBody.js";
import { runAttachmentDownload } from "../loadAttachments.js";
import { htmlToPlainText } from "../../utils/htmlToPlainText.js";

/** Parse mail-id string into [listId, elementId]. Use ids from 'envelope list --output json'. */
export function parseMailId(mailId: string): [string, string] {
  const trimmed = mailId.trim();
  if (trimmed.includes("/")) {
    const parts = trimmed.split("/");
    if (parts.length >= 2 && parts[0] && parts[1]) return [parts[0].trim(), parts[1].trim()];
  }
  throw new Error(`Invalid mail-id: "${mailId}". Use format listId/elementId (e.g. from 'envelope list --output json').`);
}

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
    console.error("Error: At least one mail-id is required. Use ids from 'envelope list --output json'.");
    process.exit(1);
  }

  try {
    const baseUrl = getApiBaseUrl();
    let { result } = await context.getOrCreateSession(baseUrl, verbose);
    let userPassphraseKey = await context.getPassphraseKeyForDecryption(baseUrl, result, verbose);

    let userRaw: Record<string, unknown>;
    try {
      userRaw = (await loadUser(baseUrl, result.accessToken, result.userId)) as Record<string, unknown>;
    } catch (loadErr) {
      if (context.isSessionExpiredOrInvalid(loadErr) && readSession() != null) {
        if (verbose) console.error("[verbose] loadUser returned 401/440; clearing session and retrying.");
        clearSession();
        const retry = await context.getOrCreateSession(baseUrl, verbose);
        result = retry.result;
        userPassphraseKey = await context.getPassphraseKeyForDecryption(baseUrl, result, verbose);
        userRaw = (await loadUser(baseUrl, result.accessToken, result.userId)) as Record<string, unknown>;
      } else {
        throw loadErr;
      }
    }

    const { keyChain } = await mailbox.loadMailboxAndMailSetList({
      baseUrl,
      result,
      userPassphraseKey,
      userRaw,
      verbose,
    });

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
        log(`Mail raw: mailDetails (1308) present=${has1308}, mailDetailsDraft (1309) present=${has1309}`);
      }
      const mailSk = resolveSessionKey(keyChain, safeMail, MAIL);
      const decryptedMail = decryptParsedInstance(MAIL, safeMail, mailSk ?? null) as ServerInstance;
      if (isVerbose()) {
        const decHas1308 = decryptedMail["1308"] != null;
        log(`Mail decrypted: mailDetails (1308) present=${decHas1308}`);
      }

      const { bodyText } = await loadMailBody({
        baseUrl,
        accessToken: result.accessToken,
        decryptedMail,
        keyChain,
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
      for (const r of results) {
        console.log("From:\t" + r.from);
        console.log("Subject:\t" + r.subject.replace(/\t|\n/g, " "));
        console.log("Date:\t" + (r.date ?? ""));
        console.log("Body:\t" + (r.bodyTextPlain ?? htmlToPlainText(r.bodyText)).replace(/\n/g, " ").replace(/\t/g, " "));
        if (results.length > 1) console.log("---");
      }
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
      "Read full message(s) by mail-id (from 'envelope list --output json'). Prints headers and body. Multiple ids supported."
    )
    .option("--verbose, -v", "Verbose logging")
    .action(
      async (
        mailId: string,
        otherIds: string[],
        opts: { verbose?: boolean; V?: boolean }
      ) => {
        const ids = [mailId, ...(otherIds ?? [])].filter(Boolean);
        await runMessageRead(
          ids,
          { ...program.opts(), ...opts },
          getOpts
        );
      }
    );

  messageCmd
    .command("attachment <mail-id>")
    .description("Download attachments from a message by mail-id (from 'envelope list --output json').")
    .option("--output-dir <dir>", "Directory to save files (default: current directory)", ".")
    .option("--index <n>", "Download only the nth attachment (1-based)", (v) => parseInt(v, 10))
    .option("--verbose, -v", "Verbose logging")
    .action(
      async (
        mailId: string,
        opts: { outputDir?: string; index?: number; verbose?: boolean; V?: boolean }
      ) => {
        const verbose = opts.verbose ?? opts.V ?? false;
        if (verbose) setVerbose(true);
        const useJson = output.getOutputFormat(getOpts());

        try {
          const baseUrl = getApiBaseUrl();
          let { result } = await context.getOrCreateSession(baseUrl, verbose);
          let userPassphraseKey = await context.getPassphraseKeyForDecryption(baseUrl, result, verbose);

          let userRaw: Record<string, unknown>;
          try {
            userRaw = (await loadUser(baseUrl, result.accessToken, result.userId)) as Record<string, unknown>;
          } catch (loadErr) {
            if (context.isSessionExpiredOrInvalid(loadErr) && readSession() != null) {
              if (verbose) console.error("[verbose] loadUser returned 401/440; clearing session and retrying.");
              clearSession();
              const retry = await context.getOrCreateSession(baseUrl, verbose);
              result = retry.result;
              userPassphraseKey = await context.getPassphraseKeyForDecryption(baseUrl, result, verbose);
              userRaw = (await loadUser(baseUrl, result.accessToken, result.userId)) as Record<string, unknown>;
            } else {
              throw loadErr;
            }
          }

          const { keyChain } = await mailbox.loadMailboxAndMailSetList({
            baseUrl,
            result,
            userPassphraseKey,
            userRaw,
            verbose,
          });

          const saved = await runAttachmentDownload(
            mailId,
            {
              outputDir: opts.outputDir ?? ".",
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
