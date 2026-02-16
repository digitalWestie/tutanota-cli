import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getOwnerAttrs, MAIL_SET, MAIL_BOX } from "./typeModels.js";

describe("typeModels", () => {
  describe("getOwnerAttrs", () => {
    test("returns MailSet owner attrs for MAIL_SET", () => {
      const attrs = getOwnerAttrs(MAIL_SET);
      assert.equal(attrs.ownerGroup, "589");
      assert.equal(attrs.ownerEncSessionKey, "434");
      assert.equal(attrs.ownerKeyVersion, "1399");
    });

    test("returns default owner attrs for MAIL_BOX", () => {
      const attrs = getOwnerAttrs(MAIL_BOX);
      assert.equal(attrs.ownerGroup, "590");
      assert.equal(attrs.ownerEncSessionKey, "591");
      assert.equal(attrs.ownerKeyVersion, "1396");
    });
  });

  describe("MAIL_SET", () => {
    test("has encrypted true", () => {
      assert.equal(MAIL_SET.encrypted, true);
    });

    test("has expected value entries for owner and key fields", () => {
      assert.ok("435" in MAIL_SET.values);
      assert.ok("436" in MAIL_SET.values);
      assert.ok("434" in MAIL_SET.values);
      assert.ok("589" in MAIL_SET.values);
      assert.ok("1399" in MAIL_SET.values);
      assert.equal(MAIL_SET.values["435"].encrypted, true);
      assert.equal(MAIL_SET.values["434"].encrypted, false);
    });
  });
});
