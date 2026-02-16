import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSessionKey,
  decryptParsedInstance,
  type ServerInstance,
} from "./decryptInstance.js";
import type { KeyChain } from "./keyChain.js";
import { MAIL_SET, MAILBOX_GROUP_ROOT } from "./typeModels.js";

function mockKeyChain(getGroupKeyReturn: ReturnType<KeyChain["getGroupKey"]>): KeyChain {
  return {
    getGroupKey: () => getGroupKeyReturn,
    addGroupKey: () => {},
    getAvailableKeyVersions: () => [],
  };
}

describe("decryptInstance", () => {
  describe("resolveSessionKey", () => {
    test("returns null when typeModel.encrypted is false", () => {
      const keyChain = mockKeyChain(null);
      const instance: ServerInstance = { "695": "x" };
      const result = resolveSessionKey(keyChain, instance, MAILBOX_GROUP_ROOT);
      assert.equal(result, null);
    });

    test("returns null when instance has ownerGroup missing", () => {
      const keyChain = mockKeyChain(null);
      const instance: ServerInstance = { "434": "x", "1399": "0" };
      const result = resolveSessionKey(keyChain, instance, MAIL_SET);
      assert.equal(result, null);
    });

    test("returns null when instance has ownerEncSessionKey missing", () => {
      const keyChain = mockKeyChain(null);
      const instance: ServerInstance = { "589": "g", "1399": "0" };
      const result = resolveSessionKey(keyChain, instance, MAIL_SET);
      assert.equal(result, null);
    });

    test("returns null when key chain returns null for group key", () => {
      const keyChain = mockKeyChain(null);
      const instance: ServerInstance = { "589": "g", "434": "base64blob", "1399": "0" };
      const result = resolveSessionKey(keyChain, instance, MAIL_SET);
      assert.equal(result, null);
    });
  });

  describe("decryptParsedInstance", () => {
    test("with sessionKey null: encrypted value ids get defaults, unencrypted copied", () => {
      const encryptedInstance: ServerInstance = {
        "431": "folder-id",
        "436": 0,
        "435": "some-encrypted-base64",
        "589": "owner-g",
        "1399": "0",
      };
      const result = decryptParsedInstance(MAIL_SET, encryptedInstance, null);
      assert.equal(result["431"], "folder-id");
      assert.equal(result["436"], 0);
      assert.equal(result["435"], "");
      assert.equal(result["589"], "owner-g");
      assert.equal(result["1399"], "0");
    });

    test("with sessionKey null: keys not in type model are copied through", () => {
      const encryptedInstance: ServerInstance = {
        "431": "id",
        "999": "extra-key",
      };
      const result = decryptParsedInstance(MAIL_SET, encryptedInstance, null);
      assert.equal(result["999"], "extra-key");
    });
  });
});
