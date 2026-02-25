import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseMailId } from "./message.js";

describe("message", () => {
  describe("parseMailId", () => {
    test("parses listId/elementId format", () => {
      assert.deepEqual(parseMailId("L2eum1h-1s-0/OmJz3mY--3-9"), ["L2eum1h-1s-0", "OmJz3mY--3-9"]);
      assert.deepEqual(parseMailId("NMUSRl2----9/OdD_5HI----D"), ["NMUSRl2----9", "OdD_5HI----D"]);
    });

    test("trims surrounding whitespace", () => {
      assert.deepEqual(parseMailId("  list/elem  "), ["list", "elem"]);
      assert.deepEqual(parseMailId("\tlistId/elementId\n"), ["listId", "elementId"]);
    });

    test("takes first two segments when multiple slashes present", () => {
      assert.deepEqual(parseMailId("a/b/c"), ["a", "b"]);
    });

    test("throws for missing slash", () => {
      assert.throws(
        () => parseMailId("no-slash"),
        /Invalid mail-id.*Use format listId\/elementId/
      );
      assert.throws(() => parseMailId(""), /Invalid mail-id/);
    });

    test("throws when part before or after slash is empty after trim", () => {
      assert.throws(() => parseMailId("/elementOnly"), /Invalid mail-id/);
      assert.throws(() => parseMailId("listOnly/"), /Invalid mail-id/);
      assert.throws(() => parseMailId("  /  "), /Invalid mail-id/);
    });
  });
});
