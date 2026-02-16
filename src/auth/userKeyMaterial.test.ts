import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  parseUserKeyMaterial,
  getMailMembership,
  GROUP_TYPE_MAIL,
  type UserKeyMaterial,
} from "./userKeyMaterial.js";

const minimalUserGroup = {
  "27": new Uint8Array(0),
  "29": "group-id-1",
  "1030": "0",
  "2246": "1",
  "2247": "0",
};

const minimalMembership = {
  "27": new Uint8Array(0),
  "29": "group-id-2",
  "1030": "5",
  "2246": "1",
  "2247": "0",
};

describe("userKeyMaterial", () => {
  describe("parseUserKeyMaterial", () => {
    test("parses valid userRaw with userGroup as object and memberships array", () => {
      const userRaw: Record<string, unknown> = {
        "95": minimalUserGroup,
        "96": [minimalMembership],
      };
      const result = parseUserKeyMaterial(userRaw);
      assert.equal(result.userGroup.group, "group-id-1");
      assert.equal(result.userGroup.groupKeyVersion, "1");
      assert.equal(result.memberships.length, 1);
      assert.equal(result.memberships[0].group, "group-id-2");
      assert.equal(result.memberships[0].groupType, "5");
    });

    test("unwraps userGroup when single-element array", () => {
      const userRaw: Record<string, unknown> = {
        "95": [minimalUserGroup],
        "96": [],
      };
      const result = parseUserKeyMaterial(userRaw);
      assert.equal(result.userGroup.group, "group-id-1");
      assert.equal(result.userGroup.groupKeyVersion, "1");
    });

    test("throws when userGroup is missing", () => {
      const userRaw: Record<string, unknown> = {
        "96": [],
      };
      assert.throws(
        () => parseUserKeyMaterial(userRaw),
        /User entity missing or invalid userGroup/
      );
    });

    test("throws when userGroup is invalid (array with length !== 1)", () => {
      const userRaw: Record<string, unknown> = {
        "95": [],
        "96": [],
      };
      assert.throws(
        () => parseUserKeyMaterial(userRaw),
        /User entity missing or invalid userGroup/
      );
    });
  });

  describe("getMailMembership", () => {
    test("returns membership when groupType is GROUP_TYPE_MAIL (5)", () => {
      const material: UserKeyMaterial = {
        userGroup: {
          symEncGKey: new Uint8Array(0),
          groupKeyVersion: "0",
          symKeyVersion: "0",
          group: "ug",
        },
        memberships: [
          {
            symEncGKey: new Uint8Array(0),
            groupKeyVersion: "0",
            symKeyVersion: "0",
            group: "other",
            groupType: "4",
          },
          {
            symEncGKey: new Uint8Array(0),
            groupKeyVersion: "0",
            symKeyVersion: "0",
            group: "mail-group",
            groupType: GROUP_TYPE_MAIL,
          },
        ],
      };
      const found = getMailMembership(material);
      assert.ok(found);
      assert.equal(found.group, "mail-group");
      assert.equal(found.groupType, "5");
    });

    test("returns null when no membership has groupType 5", () => {
      const material: UserKeyMaterial = {
        userGroup: {
          symEncGKey: new Uint8Array(0),
          groupKeyVersion: "0",
          symKeyVersion: "0",
          group: "ug",
        },
        memberships: [
          {
            symEncGKey: new Uint8Array(0),
            groupKeyVersion: "0",
            symKeyVersion: "0",
            group: "other",
            groupType: "4",
          },
        ],
      };
      const found = getMailMembership(material);
      assert.equal(found, null);
    });
  });
});
