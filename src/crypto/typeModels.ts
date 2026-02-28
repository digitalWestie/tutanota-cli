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
  /** Version of the sys model this type depends on; sent as `dv` header for tutanota entity requests. */
  dependsOnVersion?: number;
  encrypted: boolean;
  values: Record<string, ValueModel>;
}

/** Group (sys): for loading formerGroupKeys list and currentKeys (KeyPair). Attribute 13 = currentKeys, 2273 = formerGroupKeys. */
export const GROUP: TypeModel = {
  app: "sys",
  name: "Group",
  version: 143,
  encrypted: false,
  values: {
    "13": { id: 13, type: "Bytes", encrypted: false },
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

/** Group: attribute id for currentKeys (KeyPair, encrypted with group key). */
export const GROUP_ATTR_CURRENT_KEYS = "13";
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

/** MailAddress: aggregated under Mail (111 = sender). Name (94) encrypted, address (95) not. */
export const MAIL_ADDRESS: TypeModel = {
  app: "tutanota",
  name: "MailAddress",
  version: 102,
  encrypted: false,
  values: {
    "94": { id: 94, type: "String", encrypted: true },
    "95": { id: 95, type: "String", encrypted: false },
  },
};

/** Mail: encrypted; subject, dates, flags, owner fields; extended metadata for list output. */
export const MAIL: TypeModel = {
  app: "tutanota",
  name: "Mail",
  version: 105,
  dependsOnVersion: 144,
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
    "1308": { id: 1308, type: "String", encrypted: false },
    "1309": { id: 1309, type: "String", encrypted: false },
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
/** Mail: ref to MailDetailsBlob (listId/elementId). Omitted for drafts. */
export const MAIL_ATTR_MAIL_DETAILS = "1308";
/** Mail: ref to MailDetailsDraft. Set for drafts instead of 1308. */
export const MAIL_ATTR_MAIL_DETAILS_DRAFT = "1309";
/** Mail: list of attachment refs (File [listId, elementId][]). */
export const MAIL_ATTR_ATTACHMENTS = "115";
/** Mail: bucket key aggregation (1310). Used for unprocessed mail when ownerEncSessionKey (102) is absent. */
export const MAIL_ATTR_BUCKET_KEY = "1310";

/** BucketKey (sys 2043) attribute ids. */
export const BUCKET_KEY_ATTR_PUB_ENC = "2045";
export const BUCKET_KEY_ATTR_GROUP_ENC = "2046";
export const BUCKET_KEY_ATTR_KEY_GROUP = "2047";
export const BUCKET_KEY_ATTR_BUCKET_ENC_SESSION_KEYS = "2048";
/** BucketKey: protocol version for pubEncBucketKey (0 = RSA, 2 = TutaCrypt). */
export const BUCKET_KEY_ATTR_PROTOCOL_VERSION = "2158";
export const BUCKET_KEY_ATTR_RECIPIENT_KEY_VERSION = "2252";

/** KeyPair (sys): PQ key attributes. Raw REST uses these numeric keys. */
export const KEYPAIR_ATTR_PUB_ECC = "2144";
export const KEYPAIR_ATTR_SYM_ENC_PRIV_ECC = "2145";
export const KEYPAIR_ATTR_PUB_KYBER = "2146";
export const KEYPAIR_ATTR_SYM_ENC_PRIV_KYBER = "2147";

/** InstanceSessionKey (sys 2037) attribute ids. */
export const INSTANCE_SESSION_KEY_ATTR_INSTANCE_LIST = "2040";
export const INSTANCE_SESSION_KEY_ATTR_INSTANCE_ID = "2041";
export const INSTANCE_SESSION_KEY_ATTR_SYM_ENC_SESSION_KEY = "2042";

/** MailDetailsBlob: encrypted blob containing details (1305 = aggregation MailDetails with body). Load by mail.mailDetails id. */
export const MAIL_DETAILS_BLOB: TypeModel = {
  app: "tutanota",
  name: "MailDetailsBlob",
  version: 105,
  dependsOnVersion: 144,
  encrypted: true,
  values: {
    "1300": { id: 1300, type: "String", encrypted: false },
    "1301": { id: 1301, type: "String", encrypted: false },
    "1302": { id: 1302, type: "Number", encrypted: false },
    "1303": { id: 1303, type: "String", encrypted: false },
    "1304": { id: 1304, type: "Bytes", encrypted: false },
    "1408": { id: 1408, type: "Number", encrypted: false },
  },
};

/** Attribute ids inside Body aggregate (1273): 1275 = text, 1276 = compressedText (both encrypted). */
export const BODY_ATTR_TEXT = "1275";
export const BODY_ATTR_COMPRESSED_TEXT = "1276";
/** MailDetails aggregate (1282): 1288 = body, 1286 = recipients. */
export const MAIL_DETAILS_ATTR_BODY = "1288";
export const MAIL_DETAILS_ATTR_RECIPIENTS = "1286";
/** Recipients (1277): 1279 = to, 1280 = cc, 1281 = bcc (each aggregation to MailAddress). */
export const RECIPIENTS_ATTR_TO = "1279";
export const RECIPIENTS_ATTR_CC = "1280";
export const RECIPIENTS_ATTR_BCC = "1281";
/** MailDetailsBlob: 1305 = details (aggregation to MailDetails, array of one). */
export const MAIL_DETAILS_BLOB_ATTR_DETAILS = "1305";

/** File (tutanota): encrypted; attachments. Owner 580/18/1391; name 21, size 22, mimeType 23; blobs 1225. */
export const FILE: TypeModel = {
  app: "tutanota",
  name: "File",
  version: 102,
  encrypted: true,
  values: {
    "15": { id: 15, type: "String", encrypted: false },
    "18": { id: 18, type: "Bytes", encrypted: false },
    "21": { id: 21, type: "String", encrypted: true },
    "22": { id: 22, type: "Number", encrypted: false },
    "23": { id: 23, type: "String", encrypted: true },
    "580": { id: 580, type: "String", encrypted: false },
    "1391": { id: 1391, type: "Number", encrypted: false },
  },
};

export const FILE_ATTR_OWNER_GROUP = "580";
export const FILE_ATTR_OWNER_ENC_SESSION_KEY = "18";
export const FILE_ATTR_OWNER_KEY_VERSION = "1391";
export const FILE_ATTR_NAME = "21";
export const FILE_ATTR_SIZE = "22";
export const FILE_ATTR_MIME_TYPE = "23";
/** File: blobs aggregation (list of { archiveId, blobId }). Sys Blob: 1884=archiveId, 1906=blobId. */
export const FILE_ATTR_BLOBS = "1225";
export const BLOB_ATTR_ARCHIVE_ID = "1884";
export const BLOB_ATTR_BLOB_ID = "1906";

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
  if (typeModel.name === "File") {
    return {
      ownerGroup: FILE_ATTR_OWNER_GROUP,
      ownerEncSessionKey: FILE_ATTR_OWNER_ENC_SESSION_KEY,
      ownerKeyVersion: FILE_ATTR_OWNER_KEY_VERSION,
    };
  }
  return {
    ownerGroup: ATTR_OWNER_GROUP,
    ownerEncSessionKey: ATTR_OWNER_ENC_SESSION_KEY,
    ownerKeyVersion: ATTR_OWNER_KEY_VERSION,
  };
}
