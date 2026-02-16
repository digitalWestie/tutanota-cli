/**
 * Minimal type model definitions for REST (path, version) and decryption (value id, type, encrypted).
 * Extracted from main app sys/tutanota TypeModels; only types and attributes we use.
 */

export const ValueType = {
  String: "String",
  Number: "Number",
  Date: "Date",
  Boolean: "Boolean",
  Bytes: "Bytes",
  CompressedString: "CompressedString",
} as const;

export type ValueTypeName = (typeof ValueType)[keyof typeof ValueType];

export interface ValueModel {
  id: number;
  type: ValueTypeName;
  encrypted: boolean;
}

export interface TypeModel {
  app: string;
  name: string;
  version: number;
  encrypted: boolean;
  values: Record<string, ValueModel>;
}

/** Group (sys): for loading formerGroupKeys list. Attribute 2273 = formerGroupKeys (aggregation ref with list id at 2269). */
export const GROUP: TypeModel = {
  app: "sys",
  name: "Group",
  version: 143,
  encrypted: false,
  values: {
    "2273": { id: 2273, type: "Bytes", encrypted: false },
    "2269": { id: 2269, type: "String", encrypted: false },
  },
};

/** GroupKey (sys): former key chain. Attribute 2261 = ownerEncGKey. Element id = key version (custom id). */
export const GROUP_KEY: TypeModel = {
  app: "sys",
  name: "GroupKey",
  version: 143,
  encrypted: false,
  values: {
    "2261": { id: 2261, type: "Bytes", encrypted: false },
  },
};

/** Group: attribute id for formerGroupKeys ref; inner list id is 2269. */
export const GROUP_ATTR_FORMER_GROUP_KEYS = "2273";
export const GROUP_KEYS_REF_ATTR_LIST = "2269";
export const GROUP_KEY_ATTR_OWNER_ENC_GKEY = "2261";

/** MailboxGroupRoot: unencrypted; we only need path and mailbox association id. */
export const MAILBOX_GROUP_ROOT: TypeModel = {
  app: "tutanota",
  name: "MailboxGroupRoot",
  version: 102,
  encrypted: false,
  values: {
    "695": { id: 695, type: "String", encrypted: false },
    "696": { id: 696, type: "String", encrypted: false },
    "697": { id: 697, type: "Number", encrypted: false },
    "698": { id: 698, type: "String", encrypted: false },
  },
};

/** MailBox: encrypted; owner fields + association 443 = mailSets (MailSetRef). */
export const MAIL_BOX: TypeModel = {
  app: "tutanota",
  name: "MailBox",
  version: 102,
  encrypted: true,
  values: {
    "127": { id: 127, type: "String", encrypted: false },
    "128": { id: 128, type: "String", encrypted: false },
    "129": { id: 129, type: "Number", encrypted: false },
    "569": { id: 569, type: "Date", encrypted: false },
    "590": { id: 590, type: "String", encrypted: false },
    "591": { id: 591, type: "Bytes", encrypted: false },
    "1396": { id: 1396, type: "Number", encrypted: false },
  },
};

/** MailSet: encrypted; name (435), folderType (436), color (1479), owner fields, entries (1459). */
export const MAIL_SET: TypeModel = {
  app: "tutanota",
  name: "MailSet",
  version: 102,
  encrypted: true,
  values: {
    "431": { id: 431, type: "String", encrypted: false },
    "432": { id: 432, type: "String", encrypted: false },
    "433": { id: 433, type: "Number", encrypted: false },
    "434": { id: 434, type: "Bytes", encrypted: false },
    "435": { id: 435, type: "String", encrypted: true },
    "436": { id: 436, type: "Number", encrypted: false },
    "589": { id: 589, type: "String", encrypted: false },
    "1399": { id: 1399, type: "Number", encrypted: false },
    "1479": { id: 1479, type: "String", encrypted: true },
    "1459": { id: 1459, type: "String", encrypted: false },
  },
};

/** MailSetEntry: unencrypted list element; we only need path/version and attribute 1456 (mail ref). */
export const MAIL_SET_ENTRY: TypeModel = {
  app: "tutanota",
  name: "MailSetEntry",
  version: 102,
  encrypted: false,
  values: {
    "1452": { id: 1452, type: "String", encrypted: false },
    "1456": { id: 1456, type: "String", encrypted: false },
  },
};

/** Mail: encrypted; subject, dates, flags, owner fields; extended metadata for list output. */
export const MAIL: TypeModel = {
  app: "tutanota",
  name: "Mail",
  version: 102,
  encrypted: true,
  values: {
    "99": { id: 99, type: "String", encrypted: false },
    "102": { id: 102, type: "Bytes", encrypted: false },
    "105": { id: 105, type: "String", encrypted: true },
    "107": { id: 107, type: "Date", encrypted: false },
    "108": { id: 108, type: "Number", encrypted: false },
    "109": { id: 109, type: "Boolean", encrypted: false },
    "426": { id: 426, type: "Boolean", encrypted: true },
    "466": { id: 466, type: "Number", encrypted: true },
    "587": { id: 587, type: "String", encrypted: false },
    "617": { id: 617, type: "String", encrypted: true },
    "866": { id: 866, type: "Boolean", encrypted: true },
    "896": { id: 896, type: "Date", encrypted: false },
    "1021": { id: 1021, type: "Number", encrypted: false },
    "1022": { id: 1022, type: "Number", encrypted: false },
    "1120": { id: 1120, type: "Number", encrypted: true },
    "1307": { id: 1307, type: "Number", encrypted: false },
    "1346": { id: 1346, type: "Number", encrypted: true },
    "1395": { id: 1395, type: "Number", encrypted: false },
    "1677": { id: 1677, type: "Number", encrypted: true },
    "1728": { id: 1728, type: "Number", encrypted: false },
    "1769": { id: 1769, type: "Boolean", encrypted: false },
    "1784": { id: 1784, type: "Date", encrypted: false },
  },
};

/** Attribute IDs for owner/session key resolution (same across encrypted types). */
export const ATTR_OWNER_GROUP = "590"; // MailBox; MailSet uses 589
export const ATTR_OWNER_ENC_SESSION_KEY = "591"; // MailBox; MailSet uses 434
export const ATTR_OWNER_KEY_VERSION = "1396"; // MailBox; MailSet uses 1399

export const MAIL_SET_ATTR_OWNER_GROUP = "589";
export const MAIL_SET_ATTR_OWNER_ENC_SESSION_KEY = "434";
export const MAIL_SET_ATTR_OWNER_KEY_VERSION = "1399";

export const MAIL_ATTR_OWNER_GROUP = "587";
export const MAIL_ATTR_OWNER_ENC_SESSION_KEY = "102";
export const MAIL_ATTR_OWNER_KEY_VERSION = "1395";

/** MailboxGroupRoot: mailbox association id (ELEMENT_ASSOCIATION -> MailBox id). */
export const MAILBOX_GROUP_ROOT_MAILBOX = "699";

/** MailBox: mailSets aggregation id; inner MailSetRef has 442 = list id for MailSet. */
export const MAIL_BOX_MAIL_SETS = "443";
export const MAIL_SET_REF_MAIL_SETS_LIST = "442";

export function getOwnerAttrs(typeModel: TypeModel): {
  ownerGroup: string;
  ownerEncSessionKey: string;
  ownerKeyVersion: string;
} {
  if (typeModel.name === "MailSet") {
    return {
      ownerGroup: MAIL_SET_ATTR_OWNER_GROUP,
      ownerEncSessionKey: MAIL_SET_ATTR_OWNER_ENC_SESSION_KEY,
      ownerKeyVersion: MAIL_SET_ATTR_OWNER_KEY_VERSION,
    };
  }
  if (typeModel.name === "Mail") {
    return {
      ownerGroup: MAIL_ATTR_OWNER_GROUP,
      ownerEncSessionKey: MAIL_ATTR_OWNER_ENC_SESSION_KEY,
      ownerKeyVersion: MAIL_ATTR_OWNER_KEY_VERSION,
    };
  }
  return {
    ownerGroup: ATTR_OWNER_GROUP,
    ownerEncSessionKey: ATTR_OWNER_ENC_SESSION_KEY,
    ownerKeyVersion: ATTR_OWNER_KEY_VERSION,
  };
}
