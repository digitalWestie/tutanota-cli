import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { htmlToPlainText } from "./htmlToPlainText.js";

describe("htmlToPlainText", () => {
  test("returns empty string for empty or whitespace-only input", () => {
    assert.strictEqual(htmlToPlainText(""), "");
    assert.strictEqual(htmlToPlainText("   "), "");
    assert.strictEqual(htmlToPlainText("\n\t  "), "");
  });

  test("strips HTML tags", () => {
    assert.strictEqual(htmlToPlainText("<p>hello</p>"), "hello");
    assert.strictEqual(htmlToPlainText("<div>foo</div>"), "foo");
    assert.strictEqual(htmlToPlainText("a <span>b</span> c"), "a b c");
  });

  test("converts br and closing p to newlines", () => {
    for (const input of ["a<br>b", "a<br/>b", "a<br />b"]) {
      const r = htmlToPlainText(input);
      assert.ok(r.includes("a") && r.includes("b") && r.includes("\n"), `input: ${input}`);
    }
    assert.ok(htmlToPlainText("<p>a</p><p>b</p>").includes("a") && htmlToPlainText("<p>a</p><p>b</p>").includes("b") && htmlToPlainText("<p>a</p><p>b</p>").includes("\n"));
  });

  test("decodes HTML entities", () => {
    assert.strictEqual(htmlToPlainText("&lt;tag&gt;"), "<tag>");
    assert.strictEqual(htmlToPlainText("a &amp; b"), "a & b");
    assert.strictEqual(htmlToPlainText("&quot;quote&quot;"), '"quote"');
    assert.ok(htmlToPlainText("&nbsp;").includes(" ") || htmlToPlainText("x&nbsp;y") === "x y");
  });

  test("turns 8+ spaces into a newline", () => {
    assert.strictEqual(htmlToPlainText("a         b"), "a\nb");
    assert.strictEqual(htmlToPlainText("word                more"), "word\nmore");
  });

  test("trims each line", () => {
    assert.strictEqual(htmlToPlainText("  hello  \n  world  "), "hello\nworld");
  });

  test("collapses 3+ newlines to 2", () => {
    assert.strictEqual(htmlToPlainText("a\n\n\n\nb"), "a\n\nb");
  });

  test("combined: layout-style HTML with many spaces", () => {
    const input = "Try Xero&nbsp;&nbsp;&nbsp;free                View in browser.                Hi Rory,";
    const out = htmlToPlainText(input);
    assert.ok(out.includes("Try Xero   free"));
    assert.ok(out.includes("View in browser."));
    assert.ok(out.includes("Hi Rory,"));
    assert.ok(out.includes("\n"));
    assert.ok(!out.includes("                "));
  });
});
