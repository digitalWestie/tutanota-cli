/**
 * Minimal request/response types for Tutanota auth (sys service).
 * Request bodies use attribute IDs as keys (same as browser); responses are normalized to named keys.
 */

export interface SaltReturnResponse {
  _format: string;
  salt: Uint8Array | number[] | string; // server may send base64 or array
  kdfVersion: string;
}

export interface CreateSessionReturnResponse {
  _format: string;
  accessToken: string;
  challenges: unknown[];
  user: string; // userId (Id)
}

/** SaltData attribute IDs (TypeModels.js 417). */
const SALT_FORMAT_ID = "418";
const SALT_MAIL_ADDRESS_ID = "419";

/** CreateSessionData attribute IDs (TypeModels.js 1211). */
const SESSION_FORMAT_ID = "1212";
const SESSION_MAIL_ADDRESS_ID = "1213";
const SESSION_AUTH_VERIFIER_ID = "1214";
const SESSION_CLIENT_IDENTIFIER_ID = "1215";
const SESSION_ACCESS_KEY_ID = "1216";
const SESSION_AUTH_TOKEN_ID = "1217";
const SESSION_RECOVER_CODE_VERIFIER_ID = "1417";
const SESSION_USER_ID = "1218";

/**
 * Build salt request body with attribute IDs as keys (wire format expected by server).
 */
export function buildSaltDataRequest(mailAddress: string): Record<string, string> {
  return {
    [SALT_FORMAT_ID]: "0",
    [SALT_MAIL_ADDRESS_ID]: mailAddress.toLowerCase().trim(),
  };
}

/**
 * Build create-session request body with attribute IDs as keys (wire format expected by server).
 * 1218 (user) is an ELEMENT_ASSOCIATION: send [] when empty, not null.
 */
export function buildCreateSessionDataRequest(
  mailAddress: string,
  authVerifier: string,
  clientIdentifier: string
): Record<string, string | null | unknown[]> {
  return {
    [SESSION_FORMAT_ID]: "0",
    [SESSION_MAIL_ADDRESS_ID]: mailAddress.toLowerCase().trim(),
    [SESSION_AUTH_VERIFIER_ID]: authVerifier,
    [SESSION_CLIENT_IDENTIFIER_ID]: clientIdentifier,
    [SESSION_ACCESS_KEY_ID]: null,
    [SESSION_AUTH_TOKEN_ID]: null,
    [SESSION_RECOVER_CODE_VERIFIER_ID]: null,
    [SESSION_USER_ID]: [], // empty association, not null
  };
}

/** Server may return attribute IDs as keys; normalize to named keys. */
const SALT_RETURN_MAP: Record<string, string> = { "421": "_format", "422": "salt", "2133": "kdfVersion" };
const CREATE_SESSION_RETURN_MAP: Record<string, string> = {
  "1220": "_format",
  "1221": "accessToken",
  "1222": "challenges",
  "1223": "user",
};

function normalizeResponse<T>(raw: Record<string, unknown>, keyMap: Record<string, string>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "_type" || k === "_errors") continue;
    const name = keyMap[k] ?? k;
    out[name] = v;
  }
  return out as T;
}

export function normalizeSaltReturn(raw: Record<string, unknown>): SaltReturnResponse {
  return normalizeResponse(raw, SALT_RETURN_MAP);
}

export function normalizeCreateSessionReturn(raw: Record<string, unknown>): CreateSessionReturnResponse {
  return normalizeResponse(raw, CREATE_SESSION_RETURN_MAP);
}

/** User entity attribute IDs (TypeModels.js 84). */
const USER_RETURN_MAP: Record<string, string> = {
  "86": "_id",
  "87": "_permissions",
  "88": "_format",
  "90": "salt",
  "91": "verifier",
  "92": "accountType",
  "93": "enabled",
  "996": "_ownerGroup",
  "1117": "requirePasswordUpdate",
  "2132": "kdfVersion",
  "95": "userGroup",
  "96": "memberships",
  "97": "authenticatedDevices",
  "99": "customer",
};

export interface UserProfileResponse {
  _id?: unknown;
  _format?: string;
  accountType?: string;
  enabled?: boolean;
  kdfVersion?: string;
  requirePasswordUpdate?: boolean;
  userGroup?: unknown;
  memberships?: unknown[];
  customer?: unknown;
}

export function normalizeUserReturn(raw: Record<string, unknown>): UserProfileResponse {
  return normalizeResponse(raw, USER_RETURN_MAP);
}

/** Customer entity attribute IDs (TypeModels.js 31). */
const CUSTOMER_RETURN_MAP: Record<string, string> = {
  "33": "_id",
  "34": "_permissions",
  "35": "_format",
  "36": "type",
  "926": "approvalStatus",
  "991": "_ownerGroup",
  "1347": "orderProcessingAgreementNeeded",
  "1754": "businessUse",
  "37": "adminGroup",
  "38": "customerGroup",
  "39": "adminGroups",
  "40": "customerGroups",
  "41": "userGroups",
  "42": "teamGroups",
  "160": "customerInfo",
  "662": "properties",
  "960": "serverProperties",
  "1256": "customizations",
};

export interface CustomerProfileResponse {
  _id?: unknown;
  _format?: string;
  type?: string;
  approvalStatus?: string;
  businessUse?: boolean;
  orderProcessingAgreementNeeded?: boolean;
  customerInfo?: unknown;
  properties?: unknown;
  customizations?: unknown[];
}

export function normalizeCustomerReturn(raw: Record<string, unknown>): CustomerProfileResponse {
  return normalizeResponse(raw, CUSTOMER_RETURN_MAP);
}

/** CustomerInfo entity attribute IDs (TypeModels.js 148). */
const CUSTOMER_INFO_RETURN_MAP: Record<string, string> = {
  "150": "_id",
  "151": "_permissions",
  "152": "_format",
  "153": "company",
  "154": "domain",
  "155": "creationTime",
  "156": "testEndTime",
  "157": "activationTime",
  "597": "registrationMailAddress",
  "639": "deletionTime",
  "640": "deletionReason",
  "650": "promotionStorageCapacity",
  "725": "source",
  "976": "promotionEmailAliases",
  "977": "usedSharedEmailAliases",
  "1011": "_ownerGroup",
  "1067": "includedEmailAliases",
  "1068": "includedStorageCapacity",
  "1381": "erased",
  "2093": "perUserStorageCapacity",
  "2094": "perUserAliasCount",
  "2098": "plan",
  "158": "customer",
  "159": "accountingInfo",
  "726": "domainInfos",
};

/** DomainInfo (element in CustomerInfo.domainInfos); TypeModels.js attribute ids 697, 698, etc. */
const DOMAIN_INFO_RETURN_MAP: Record<string, string> = {
  "697": "_id",
  "698": "domain",
};

export interface DomainInfoProfileResponse {
  _id?: unknown;
  domain?: string;
}

export interface CustomerInfoProfileResponse {
  _id?: unknown;
  _format?: string;
  company?: string;
  domain?: string;
  creationTime?: string;
  activationTime?: string;
  registrationMailAddress?: string;
  plan?: string;
  includedEmailAliases?: string;
  includedStorageCapacity?: string;
  perUserStorageCapacity?: string;
  perUserAliasCount?: string;
  domainInfos?: DomainInfoProfileResponse[];
}

function normalizeDomainInfoReturn(raw: Record<string, unknown>): DomainInfoProfileResponse {
  return normalizeResponse(raw, DOMAIN_INFO_RETURN_MAP);
}

export function normalizeCustomerInfoReturn(raw: Record<string, unknown>): CustomerInfoProfileResponse {
  const out = normalizeResponse<CustomerInfoProfileResponse>(raw, CUSTOMER_INFO_RETURN_MAP);
  if (Array.isArray(out.domainInfos)) {
    out.domainInfos = out.domainInfos.map((item) =>
      typeof item === "object" && item !== null && !Array.isArray(item)
        ? normalizeDomainInfoReturn(item as Record<string, unknown>)
        : { domain: String(item) }
    );
  }
  return out;
}
