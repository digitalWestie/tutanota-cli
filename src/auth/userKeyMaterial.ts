/**
 * Parse raw User entity (server format with numeric attribute IDs) into key material
 * needed for the key chain: userGroup and memberships with symEncGKey, groupKeyVersion, etc.
 *
 * Attribute IDs from sys TypeModels: User 95=userGroup, 96=memberships;
 * GroupMembership 26=_id, 27=symEncGKey, 29=group, 1030=groupType, 2246=groupKeyVersion, 2247=symKeyVersion.
 */

import { toUint8Array, unwrapSingleElementArray } from "../utils/bytes.js";

const USER_USER_GROUP = "95";
const USER_MEMBERSHIPS = "96";

const GM_SYM_ENC_GKEY = "27";
const GM_GROUP = "29";
const GM_GROUP_TYPE = "1030";
const GM_GROUP_KEY_VERSION = "2246";
const GM_SYM_KEY_VERSION = "2247";

function toStringOrNull(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

export interface GroupMembershipKeyMaterial {
  symEncGKey: Uint8Array;
  groupKeyVersion: string;
  symKeyVersion: string;
  group: string;
  groupType: string | null;
}

export interface UserGroupKeyMaterial {
  symEncGKey: Uint8Array;
  groupKeyVersion: string;
  symKeyVersion: string;
  group: string;
}

export interface UserKeyMaterial {
  userGroup: UserGroupKeyMaterial;
  memberships: GroupMembershipKeyMaterial[];
}

function parseGroupMembership(raw: Record<string, unknown>): GroupMembershipKeyMaterial {
  return {
    symEncGKey: toUint8Array(raw[GM_SYM_ENC_GKEY]),
    groupKeyVersion: toStringOrNull(raw[GM_GROUP_KEY_VERSION]) ?? "0",
    symKeyVersion: toStringOrNull(raw[GM_SYM_KEY_VERSION]) ?? "0",
    group: toStringOrNull(raw[GM_GROUP]) ?? "",
    groupType: toStringOrNull(raw[GM_GROUP_TYPE]),
  };
}

/**
 * Extract key material from raw User JSON (server response with numeric keys).
 * Throws if userGroup is missing or invalid.
 * Server may return userGroup (95) as a single object or as an array of one element.
 */
export function parseUserKeyMaterial(userRaw: Record<string, unknown>): UserKeyMaterial {
  const userGroupRaw = unwrapSingleElementArray(userRaw[USER_USER_GROUP]);
  if (userGroupRaw == null || typeof userGroupRaw !== "object" || Array.isArray(userGroupRaw)) {
    throw new Error("User entity missing or invalid userGroup");
  }
  const userGroup = parseGroupMembership(userGroupRaw as Record<string, unknown>);

  const membershipsRaw = userRaw[USER_MEMBERSHIPS];
  const memberships: GroupMembershipKeyMaterial[] = Array.isArray(membershipsRaw)
    ? (membershipsRaw as Record<string, unknown>[]).map((m) => parseGroupMembership(m))
    : [];

  return { userGroup, memberships };
}

/** GroupType.Mail in the main app. */
export const GROUP_TYPE_MAIL = "5";

/**
 * Return the first membership whose groupType is Mail (personal mailbox).
 */
export function getMailMembership(material: UserKeyMaterial): GroupMembershipKeyMaterial | null {
  return material.memberships.find((m) => m.groupType === GROUP_TYPE_MAIL) ?? null;
}
