import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseMailDetailsRef } from "./loadMailBody.js";

describe("loadMailBody", () => {
  describe("parseMailDetailsRef", () => {
    test("returns null for null and undefined", () => {
      assert.strictEqual(parseMailDetailsRef(null), null);
      assert.strictEqual(parseMailDetailsRef(undefined), null);
    });

    test("parses server format [[listId, elementId]]", () => {
      assert.deepEqual(parseMailDetailsRef([["NMUSRl2----9", "OmJz3mY--3-9"]]), [
        "NMUSRl2----9",
        "OmJz3mY--3-9",
      ]);
      assert.deepEqual(parseMailDetailsRef([["list1", "elem1"]]), ["list1", "elem1"]);
    });

    test("parses tuple [listId, elementId]", () => {
      assert.deepEqual(parseMailDetailsRef(["L2eum1h-1s-0", "OmJEcZB--7-9"]), [
        "L2eum1h-1s-0",
        "OmJEcZB--7-9",
      ]);
    });

    test("parses string listId/elementId", () => {
      assert.deepEqual(parseMailDetailsRef("NMUSRl2----9/OdD_5HI----D"), [
        "NMUSRl2----9",
        "OdD_5HI----D",
      ]);
    });

    test("returns null for empty array or single-element array without tuple", () => {
      assert.strictEqual(parseMailDetailsRef([]), null);
      assert.strictEqual(parseMailDetailsRef(["onlyOne"]), null);
    });

    test("returns null for tuple with empty listId or elementId", () => {
      assert.strictEqual(parseMailDetailsRef(["", "elem"]), null);
      assert.strictEqual(parseMailDetailsRef(["list", ""]), null);
      assert.strictEqual(parseMailDetailsRef([["", "x"]]), null);
    });

    test("returns null for non-array non-string values", () => {
      assert.strictEqual(parseMailDetailsRef(42), null);
      assert.strictEqual(parseMailDetailsRef({}), null);
      assert.strictEqual(parseMailDetailsRef("no-slash"), null);
    });
  });
});
