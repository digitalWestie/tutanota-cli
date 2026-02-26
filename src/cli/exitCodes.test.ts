import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { exitCodeForError } from "./exitCodes.js";

describe("exitCodeForError", () => {
  test("returns 2 for fetch failed", () => {
    assert.equal(exitCodeForError(new Error("fetch failed")), 2);
  });

  test("returns 2 for HTTP 5xx server errors", () => {
    assert.equal(exitCodeForError(new Error("HTTP 502: Bad Gateway")), 2);
    assert.equal(exitCodeForError(new Error("HTTP 500: Internal Server Error")), 2);
    assert.equal(exitCodeForError(new Error("HTTP 503: Service Unavailable")), 2);
  });

  test("returns 2 for network cause codes", () => {
    const err = new Error("request failed");
    (err as Error & { cause: { code: string } }).cause = { code: "ETIMEDOUT" };
    assert.equal(exitCodeForError(err), 2);
  });

  test("returns 1 for HTTP 4xx and auth-like errors", () => {
    assert.equal(exitCodeForError(new Error("HTTP 401: Unauthorized")), 1);
    assert.equal(exitCodeForError(new Error("HTTP 440")), 1);
    assert.equal(exitCodeForError(new Error("HTTP 404: Not Found")), 1);
  });

  test("returns 1 for generic errors", () => {
    assert.equal(exitCodeForError(new Error("Something else")), 1);
  });
});
