# Unofficial Tutanota CLI

ℹ️ *This tool is not affiliated or endorsed by Tuta GmbH in any way.*

**This tool is in early stages of development — use at your own risk; behaviour and APIs may change.**

**Disclosure: This tool has been developed with LLM assistance.**

A CLI to authenticate with [Tutanota](https://tuta.com), list mail folders, list envelopes (message headers) in a folder, read full messages, and export mail to EML files.

This CLI was developed based on the official client repository [tutao/tutanota](https://github.com/tutao/tutanota) at version 327.260210.0, commit 6b43e845bc18b17dc3b047d186a8490129887911.

This is a stateless CLI rather than a TUI client. There is no event loop so it's not interactive, but hey, that means you can use it in scripts.

## Requirements

- Node.js 18+
- A Tutanota (Tuta) account

## Setup

```bash
npm install
npm run build
```

## Credentials

Credentials are read from the environment. You can use a `.env` file in the project root (or current working directory):

```env
TUTANOTA_EMAIL=you@tuta.com
TUTANOTA_PASSWORD=yourpassword
```

Optional:

- `TUTANOTA_API_URL` – API base URL, from env or `.env` (default: `https://app.tuta.com`)

If `TUTANOTA_EMAIL` or `TUTANOTA_PASSWORD` is not set, the CLI will prompt you for it when you run an account command (e.g. `account check`). The password prompt is hidden (no echo). Do not pass passwords via command-line flags. Credentials are only used when logging in (for example when there is no valid stored session or when session persistence is disabled).

You can copy `.env.example` to `.env` and fill in your values.

## Session persistence

After a successful login, the CLI stores a session in a file so that later commands can reuse it without asking for your password again.

- **Location:** `$XDG_CONFIG_HOME/tutanota-cli/session.json`, or `~/.config/tutanota-cli/session.json` if `XDG_CONFIG_HOME` is not set.
- **Usage:** `account check`, `account profile`, `account logout`, `folders list`, `folders export`, `envelope list`, `message read`, `message export`, and `message attachment` use the stored session when it is present and still valid. The same commands are also available under the `auth` alias (e.g. `auth check`, `auth profile`, `auth logout`). Commands that decrypt data (e.g. `folders list`, `message read`) will prompt for your password when using a stored session, since the passphrase key is not persisted. Running the CLI with **no subcommand** lists the default folder (Inbox), same as `envelope list`.
- **Recovery:** If session verification fails (e.g. network error or session expired), the CLI clears the stored session and prompts you to log in again. You may see a brief message such as "Network error while checking session; logging in again." or "Session invalid or expired; logging in again."
- **Log out:** Run `account logout` (or `auth logout`) to clear the stored session, or delete the session file manually.
- **Opt-out:** Set `TUTANOTA_NO_SESSION_PERSISTENCE=1` in the environment to disable saving and using a session file.

## Global options

- `--format`, `-f` **&lt;format&gt;** – Output format: `pretty`, `tsv`, or `json` (default: `pretty`). **pretty** shows aligned columns for easier reading in the terminal; **tsv** is tab-separated for spreadsheet paste and scripting. Use `--format tsv` when piping or copying into a spreadsheet; use `--format json` for machine-readable output.

### Colours and formatting

In **pretty** output only, the CLI uses a bold table header and a line under the header. Colours are not used for `tsv` or `json`. Output respects your environment: colour is disabled when stdout is not a TTY (e.g. when piping), and when `NO_COLOR` is set. Set `FORCE_COLOR=1` to enable colour when piping. There is no CLI flag for colour; behaviour is driven by these environment variables and TTY detection.

## Default behavior

Running the CLI with **no subcommand** (e.g. `node dist/cli.js` or `npm start`) lists the default folder (Inbox), same as `envelope list` with default options.

## Commands

### `account check`

Verifies that you can log in (or that your stored session is still valid). On success, prints session info (Status, UserId, Session ID, Stored?, Storage Path) in the default output format. If a valid session is already stored, it may succeed without prompting for credentials. Also available as `auth check`.

```bash
node dist/cli.js account check
# or, after npm run build:
npm start -- account check
```

Options:

- `--verbose`, `-v` – Verbose logging (request URLs, errors with cause/stack) for debugging. Use global `--format json` for JSON.

### `account logout`

Clears the stored session so that the next command will prompt for credentials again. Also available as `auth logout`.

```bash
node dist/cli.js account logout
npm start -- account logout
```

### `account profile`

Logs in (or uses the stored session) and loads your user profile. Human-readable output is three tab-separated tables: **User** (Key, Value), **Customer** (Key, Value), and **Customer info** (Key, Value). Each table has a section title line, then a header line, then one row per field. Also available as `auth profile`.

With global `--format json`, the full structure is output as JSON. With `--verbose`, extra debug logs (e.g. request URLs) are printed.

```bash
node dist/cli.js account profile
npm start -- account profile
```

Example output (with default output): section title "User", then "Key\tValue", then rows; then "Customer" and its table; then "Customer info" and its table (including domainInfos summary and domain_0, domain_1, etc.).

Options:

- `--verbose`, `-v` – Verbose logging for debugging. Use global `--format json` for JSON.

### `folders list`

Lists your mail folders (Inbox, Sent, custom folders, labels, etc.) with decrypted names. Human-readable output is tab-separated columns: Name, Id, FolderType. Uses the stored session when valid; if you have a stored session, you will be prompted for your password so the CLI can decrypt folder names (the passphrase key is not saved).

```bash
node dist/cli.js folders list
npm start -- folders list
```

Options:

- `--verbose`, `-v` – Verbose logging (request URLs, key chain summary, and failure details when relevant). Use global `--format json` for JSON.

### `envelope list [folder]`

Lists the latest N envelopes (message headers) in a folder. **Folder is optional and defaults to Inbox** when omitted; use a folder id or folder name from `folders list` (e.g. `L2eum1h-1k-0` or `Inbox`, `Sent`) to list another folder. For each envelope, shows subject, date, from, unread flag, and attachment count. Unread items are prefixed with `*` in human-readable output. With `--format tsv` or `--format json`, various additional columns are included. Also available as `messages list`.

```bash
node dist/cli.js envelope list
npm start -- envelope list
node dist/cli.js envelope list L2eum1h-1k-0
node dist/cli.js envelope list Inbox
```

Options:

- `--verbose`, `-v` – Verbose logging for debugging.
- `--count`, `-c` – Number of envelopes to list (default: 10, max: 100).
- `--unread`, `-u` – Show only unread (filters client-side). Use global `--format json` for JSON.
- `--cursor <id>` – Cursor for the next page (older emails). With `--format json`, the response includes `nextCursor` when more mail is available; use that value as `--cursor` on the next run. With pretty output, a one-line hint on a separate line after the table shows a copy-pasteable command for the next page when applicable. TSV output does not include cursor or hint.

### `message read <mail-id> [other-ids...]`

Reads one or more full messages (headers and body) by mail-id. Also available as `msg read`. The **mail-id** is the same format as the `id` field in `envelope list --format json` (e.g. `listId/elementId`). Run `envelope list --format json` to get mail ids, then pass them to `message read`. Output is human-friendly by default: From, Subject, Date, **Attachment(s)** (comma-separated filenames, or "(none)"), then a blank line, then the body (HTML is converted to plain text for pretty output). The Attachment(s) field is included in all formats (pretty, tsv, json). Draft messages are not supported.

```bash
npm start -- envelope list --format json -c 5
# Copy an id from the "mails" array, then:
npm start -- message read "LISTID/ELEMENTID"
npm start -- message read id1 id2 id3
```

Options:

- `--verbose`, `-v` – Verbose logging for debugging.
- Use global `--format json` for JSON (each message as object with `id`, `from`, `subject`, `date`, `attachments`, `body`).

### `message attachment <mail-id>`

Downloads attachments from a message. Use the same **mail-id** format as `message read` (from `envelope list --format json`). Saves files to the current directory by default; use `--output` to choose a folder. If a file with the same name already exists, a suffix ` (1)`, ` (2)`, etc. is added.

```bash
npm start -- message attachment "LISTID/ELEMENTID"
npm start -- message attachment "LISTID/ELEMENTID" --output ./downloads
npm start -- message attachment "LISTID/ELEMENTID" --index 1
```

Options:

- `--output <dir>` – Directory to save files (default: current directory).
- `--index <n>` – Download only the nth attachment (1-based).
- `--verbose`, `-v` – Verbose logging.
- Use global `--format json` for JSON (array of `{ name, path, size }` for each saved file).

### `message export <mail-id>`

Exports one message to an EML file. The **mail-id** is the same format as for `message read` (from `envelope list --format json`). By default the file is written in the current directory with a name derived from the message date and subject. Use `--output` to specify an exact path. Optionally save attachments in a sibling directory next to the EML file with `--include-attachments`.

**Note:** Exported mail is stored in plain text (headers + body). Ensure your device and storage are secured and that you keep exported files in a safe place.

```bash
npm start -- message export "LISTID/ELEMENTID"
npm start -- message export "LISTID/ELEMENTID" --output ./mail.eml
npm start -- message export "LISTID/ELEMENTID" --include-attachments
```

Options:

- `--output <path>` – Output file path (default: current directory with date-subject.eml).
- `--include-attachments` – Save attachments in a sibling directory next to the EML file.
- `--verbose`, `-v` – Verbose logging.

### `folders export <folder>`

Exports all messages in a folder to EML files in the given directory. Use a folder id or folder name from `folders list` (e.g. `Inbox`, `Sent`, or a folder id). Each message is written as a separate EML file named from its date and subject. Use `--resume` to skip messages that already have an EML file (useful to continue an interrupted export).

**Note:** Exported mail is stored in plain text. Secure your device and the output directory.

```bash
npm start -- folders export Inbox --path ./inbox-export
npm start -- folders export Sent --path ./sent --resume --include-attachments
```

Options:

- `--path <dir>` – **Required.** Output directory for EML files.
- `--format <format>` – Export format (default: `eml`).
- `--resume` – Skip messages that already have an EML file in the output directory.
- `--concurrency <n>` – Max concurrent message exports per page (default: 5).
- `--include-attachments` – Save attachments in a sibling directory next to each EML file.
- `--verbose`, `-v` – Verbose logging.

## Limitations

- **2FA**: Accounts with two-factor authentication enabled are not supported yet. Commands will fail with a clear message. Use the official Tutanota client or disable 2FA for the account.
- **Export**: Export produces EML files (plain text headers + body). Attachments can be saved alongside with `--include-attachments` (in a separate directory per message). mbox and JSON export formats are not implemented. Export strips encryption; store exported files securely.
- **Drafts**: `message read` and `message export` do not support draft messages; use a mail id from a non-draft folder (e.g. Inbox, Sent).

## License

GPL-3.0. This project uses the following GPL-3.0-licensed dependencies from the [Tutanota](https://github.com/tutao/tutanota) project:

- `@tutao/tutanota-crypto`
- `@tutao/tutanota-utils`

Use of those packages means the combined work is a "covered work" under the GPL-3.0 when distributed, so this project is licensed under GPL-3.0 as well. See [LICENSE](LICENSE) for the full terms.
