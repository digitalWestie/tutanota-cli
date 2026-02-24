import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import kleur from "kleur";
import {
  getOutputOption,
  getOutputFormat,
  getPlainFormat,
  printTable,
  type OutputOpts,
} from "./output.js";

describe("output", () => {
  describe("getOutputOption", () => {
    test("returns output when set", () => {
      assert.equal(getOutputOption({ output: "json" }), "json");
      assert.equal(getOutputOption({ output: "tsv" }), "tsv");
      assert.equal(getOutputOption({ output: "pretty" }), "pretty");
    });

    test("returns o when output is missing", () => {
      assert.equal(getOutputOption({ o: "json" }), "json");
      assert.equal(getOutputOption({ O: "tsv" }), "tsv");
    });

    test("prefers output over o over O", () => {
      assert.equal(getOutputOption({ output: "json", o: "tsv", O: "pretty" }), "json");
      assert.equal(getOutputOption({ o: "tsv", O: "pretty" }), "tsv");
      assert.equal(getOutputOption({ O: "pretty" }), "pretty");
    });

    test("returns default pretty when opts empty or all missing", () => {
      assert.equal(getOutputOption({}), "pretty");
      assert.equal(getOutputOption({ output: undefined, o: undefined }), "pretty");
    });
  });

  describe("getOutputFormat", () => {
    test("returns true when format is json", () => {
      assert.equal(getOutputFormat({ output: "json" }), true);
      assert.equal(getOutputFormat({ o: "json" }), true);
    });

    test("returns false for pretty and tsv", () => {
      assert.equal(getOutputFormat({ output: "pretty" }), false);
      assert.equal(getOutputFormat({ output: "tsv" }), false);
      assert.equal(getOutputFormat({}), false);
    });
  });

  describe("getPlainFormat", () => {
    test("returns tsv when format is tsv", () => {
      assert.equal(getPlainFormat({ output: "tsv" }), "tsv");
    });

    test("returns pretty for pretty and json (json is valid but plain is pretty)", () => {
      assert.equal(getPlainFormat({ output: "pretty" }), "pretty");
      assert.equal(getPlainFormat({ output: "json" }), "pretty");
      assert.equal(getPlainFormat({}), "pretty");
    });

    test("exits with code 1 and logs error for unknown format", () => {
      const exit = process.exit;
      const errLog: unknown[] = [];
      const consoleError = console.error;
      try {
        (process as NodeJS.Process & { exit: (code?: number) => never }).exit = ((code?: number) => {
          throw { exitCode: code, isExit: true };
        }) as (code?: number) => never;
        console.error = (...args: unknown[]) => {
          errLog.push(args);
        };
        assert.throws(
          () => getPlainFormat({ output: "invalid" as string }),
          (thrown: { exitCode?: number; isExit?: boolean }) => thrown.isExit === true && thrown.exitCode === 1
        );
        assert.equal(errLog.length, 1);
        assert.match(String(errLog[0]), /Unknown output format/);
        assert.match(String(errLog[0]), /invalid/);
      } finally {
        process.exit = exit;
        console.error = consoleError;
      }
    });
  });

  describe("printTable", () => {
    let kleurEnabled: boolean;
    before(() => {
      kleurEnabled = kleur.enabled;
      kleur.enabled = false;
    });
    after(() => {
      kleur.enabled = kleurEnabled;
    });

    test("does nothing when rows is empty", () => {
      const logCalls: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => logCalls.push(args.map(String).join(" "));
      try {
        printTable([], "pretty");
        printTable([], "tsv");
        assert.equal(logCalls.length, 0);
      } finally {
        console.log = originalLog;
      }
    });

    test("tsv format joins with tab and logs each row", () => {
      const logCalls: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => logCalls.push(args.map(String).join(" "));
      try {
        printTable(
          [
            ["A", "B"],
            ["1", "2"],
          ],
          "tsv"
        );
        assert.equal(logCalls.length, 2);
        assert.equal(logCalls[0], "A\tB");
        assert.equal(logCalls[1], "1\t2");
      } finally {
        console.log = originalLog;
      }
    });

    test("pretty format pads columns to same width per column", () => {
      const logCalls: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => logCalls.push(args.map(String).join(" "));
      try {
        printTable(
          [
            ["Name", "Id"],
            ["Inbox", "abc"],
            ["Sent", "x"],
          ],
          "pretty"
        );
        assert.equal(logCalls.length, 4);
        // First column width 5 (max of Name=4, Inbox=5, Sent=4), second width 3 (Id, abc, x)
        assert.equal(logCalls[0], "Name   Id ");
        assert.equal(logCalls[1], "-----  ---"); // separator under header
        assert.equal(logCalls[2], "Inbox  abc"); // "abc" is already length 3, no trailing pad
        assert.equal(logCalls[3], "Sent   x  ");
      } finally {
        console.log = originalLog;
      }
    });

    test("pretty format uses two spaces between columns", () => {
      const logCalls: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => logCalls.push(args.map(String).join(" "));
      try {
        printTable([["X", "Y"], ["a", "b"]], "pretty");
        assert.ok(logCalls[0].includes("  "));
      } finally {
        console.log = originalLog;
      }
    });
  });
});
