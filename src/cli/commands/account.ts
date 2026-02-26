import type { Command } from "commander";
import { getApiBaseUrl } from "../../config.js";
import { loadUser, loadCustomer, loadCustomerInfo } from "../../auth/login.js";
import {
  normalizeUserReturn,
  normalizeCustomerReturn,
  normalizeCustomerInfoReturn,
} from "../../auth/types.js";
import { getErrorMessage, setVerbose } from "../../logger.js";
import { clearSession, getSessionPath } from "../../session.js";
import * as context from "../context.js";
import { exitCodeForError } from "../exitCodes.js";
import * as output from "../output.js";

export function registerAccountCommands(
  program: Command,
  getOpts: () => Record<string, unknown>
): void {
  const accountCmd = program.command("account").alias("auth").description("Account and session commands");

  accountCmd
    .command("check")
    .description("Verify credentials by logging in; prints session info on success")
    .option("--verbose, -v", "Verbose logging for debugging")
    .action(async (opts: { verbose?: boolean; V?: boolean }) => {
      const verbose = opts.V ?? false;
      const useJson = output.getOutputFormat(getOpts());
      if (verbose) {
        setVerbose(true);
        console.error("[verbose] Verbose logging enabled.");
      }
      try {
        const baseUrl = getApiBaseUrl();
        if (verbose) console.error("[verbose] API base URL:", baseUrl);
        const { result, usedStoredSession } = await context.getOrCreateSession(baseUrl, verbose);

        if (useJson) {
          console.log(
            JSON.stringify({
              ok: true,
              sessionVerified: true,
              userId: result.userId,
              sessionId: result.sessionId,
            })
          );
        } else {
          const rows = [
            ["Status", "UserId", "Session ID", "Stored?", "Storage Path"],
            ["Authenticated", String(result.userId), result.sessionId.join("/"), String(usedStoredSession), getSessionPath()],
          ];
          output.printTable(rows, output.getPlainFormat(getOpts()));
        }
      } catch (err) {
        const message = getErrorMessage(err);
        if (verbose) {
          console.error("[verbose] account check failed:", err);
          if (err instanceof Error && err.cause) console.error("[verbose] cause:", err.cause);
          if (err instanceof Error && err.stack) console.error("[verbose] stack:", err.stack);
        }
        if (output.getOutputFormat(getOpts())) {
          console.log(JSON.stringify({ ok: false, error: message }));
        } else {
          console.error("Error:", message);
        }
        process.exit(exitCodeForError(err));
      }
    });

  accountCmd
    .command("logout")
    .description("Clear the stored session (log out)")
    .action(() => {
      clearSession();
      console.log("Session cleared.");
    });

  accountCmd
    .command("profile")
    .description("Log in and show your user profile (account type, enabled, etc.)")
    .option("--verbose, -v", "Verbose logging for debugging")
    .action(async (opts: { verbose?: boolean; V?: boolean }) => {
      const verbose = opts.V ?? false;
      const useJson = output.getOutputFormat(getOpts());
      if (verbose) {
        setVerbose(true);
        console.error("[verbose] Verbose logging enabled.");
      }
      try {
        const baseUrl = getApiBaseUrl();
        if (verbose) console.error("[verbose] API base URL:", baseUrl);
        const { result } = await context.getOrCreateSession(baseUrl, verbose);
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

        if (useJson) {
          console.log(JSON.stringify(fullProfile));
        } else {
          const plainFormat = output.getPlainFormat(getOpts());
          const userRows: string[][] = [];
          if (user.accountType != null) userRows.push(["accountType", String(user.accountType)]);
          if (user.enabled != null) userRows.push(["enabled", String(user.enabled)]);
          if (user.kdfVersion != null) userRows.push(["kdfVersion", String(user.kdfVersion)]);
          if (user.requirePasswordUpdate != null) userRows.push(["requirePasswordUpdate", String(user.requirePasswordUpdate)]);
          if (user.customer != null) userRows.push(["customer", String(user.customer)]);
          console.log("User");
          output.printTable([["Key", "Value"], ...userRows], plainFormat);

          if (customer != null) {
            const customerRows: string[][] = [];
            if (customer.type != null) customerRows.push(["type", String(customer.type)]);
            if (customer.approvalStatus != null) customerRows.push(["approvalStatus", String(customer.approvalStatus)]);
            if (customer.businessUse != null) customerRows.push(["businessUse", String(customer.businessUse)]);
            if (customer.orderProcessingAgreementNeeded != null)
              customerRows.push(["orderProcessingAgreementNeeded", String(customer.orderProcessingAgreementNeeded)]);
            console.log("\nCustomer");
            output.printTable([["Key", "Value"], ...customerRows], plainFormat);
          }

          if (customerInfo != null) {
            const infoRows: string[][] = [];
            if (customerInfo.domain != null) infoRows.push(["domain", String(customerInfo.domain)]);
            if (customerInfo.company != null) infoRows.push(["company", String(customerInfo.company)]);
            if (customerInfo.plan != null) infoRows.push(["plan", String(customerInfo.plan)]);
            if (customerInfo.registrationMailAddress != null)
              infoRows.push(["registrationMailAddress", String(customerInfo.registrationMailAddress)]);
            if (customerInfo.creationTime != null) infoRows.push(["creationTime", String(customerInfo.creationTime)]);
            if (customerInfo.activationTime != null) infoRows.push(["activationTime", String(customerInfo.activationTime)]);
            if (customerInfo.includedEmailAliases != null)
              infoRows.push(["includedEmailAliases", String(customerInfo.includedEmailAliases)]);
            if (customerInfo.includedStorageCapacity != null)
              infoRows.push(["includedStorageCapacity", String(customerInfo.includedStorageCapacity)]);
            if (customerInfo.perUserStorageCapacity != null)
              infoRows.push(["perUserStorageCapacity", String(customerInfo.perUserStorageCapacity)]);
            if (customerInfo.perUserAliasCount != null)
              infoRows.push(["perUserAliasCount", String(customerInfo.perUserAliasCount)]);
            if (customerInfo.domainInfos != null && Array.isArray(customerInfo.domainInfos)) {
              infoRows.push(["domainInfos", `${customerInfo.domainInfos.length} domain(s)`]);
              customerInfo.domainInfos.forEach((di: { domain?: string } | unknown, i: number) => {
                const domain = typeof di === "object" && di !== null && "domain" in di ? (di as { domain?: string }).domain : null;
                infoRows.push([`domain_${i}`, domain ?? "(no domain name)"]);
              });
            }
            console.log("\nCustomer info");
            output.printTable([["Key", "Value"], ...infoRows], plainFormat);
          }
        }
      } catch (err) {
        const message = getErrorMessage(err);
        if (context.isSessionExpiredOrInvalid(err)) {
          clearSession();
          if (useJson) {
            console.log(JSON.stringify({ error: "Session expired, invalid, or timed out (HTTP 440). Run 'account check' (or 'auth check') to log in again." }));
          } else {
            console.error(
              "Session expired, invalid, or timed out (HTTP 440). Please run 'account check' (or 'auth check') to log in again."
            );
          }
        } else {
          if (verbose) {
            console.error("[verbose] account profile failed:", err);
            if (err instanceof Error && err.cause) console.error("[verbose] cause:", err.cause);
            if (err instanceof Error && err.stack) console.error("[verbose] stack:", err.stack);
          }
          if (useJson) {
            console.log(JSON.stringify({ error: message }));
          } else {
            console.error("Error:", message);
          }
        }
        process.exit(exitCodeForError(err));
      }
    });
}
