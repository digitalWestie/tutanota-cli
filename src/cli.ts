#!/usr/bin/env node
import { Command } from "commander";
import { loadEnv, getApiBaseUrl, getCredentials } from "./config.js";
import {
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
import { setVerbose } from "./logger.js";
import { clearSession, readSession, writeSession } from "./session.js";

loadEnv();

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
    } catch {
      if (verbose) console.error("[verbose] Stored session invalid or expired, logging in again.");
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
    const verbose = opts.verbose ?? opts.V ?? false;
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
      const message = err instanceof Error ? err.message : String(err);
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

program
  .command("profile")
  .description("Log in and show your user profile (account type, enabled, etc.)")
  .option("--json", "Output result as JSON")
  .option("--verbose, -v", "Verbose logging for debugging")
  .action(async (opts: { json?: boolean; verbose?: boolean; V?: boolean }) => {
    const verbose = opts.verbose ?? opts.V ?? false;
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
      const message = err instanceof Error ? err.message : String(err);
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
