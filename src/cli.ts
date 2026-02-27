#!/usr/bin/env node
import { Command, Option } from "commander";
import { loadEnv } from "./config.js";
import { registerAccountCommands } from "./cli/commands/account.js";
import { registerFoldersCommands } from "./cli/commands/folders.js";
import { runEnvelopeList, registerEnvelopeCommands } from "./cli/commands/envelope.js";
import { registerMessageCommands } from "./cli/commands/message.js";

loadEnv();

const program = new Command();

program
  .name("tutanota-cli")
  .description("CLI to authenticate with and export mail from Tutanota")
  .version("0.1.0")
  .addOption(
    new Option("--format, -f <format>", "Output format: pretty, tsv, or json (default: pretty)")
      .choices(["pretty", "tsv", "json"])
      .default("pretty")
  );

function getOpts(): Record<string, unknown> {
  return program.opts() as Record<string, unknown>;
}

registerAccountCommands(program, getOpts);
registerFoldersCommands(program, getOpts);
registerEnvelopeCommands(program, getOpts);
registerMessageCommands(program, getOpts);

program.action(async () => {
  await runEnvelopeList(undefined, { ...program.opts(), count: 10, unread: false }, getOpts);
});

program.parse();
