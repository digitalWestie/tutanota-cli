# Unofficial Tutanota CLI

ℹ️ *This tool is not affiliated or endorsed by Tuta GmbH in any way.*

A CLI to authenticate with [Tutanota](https://tuta.com), list mail folders, list envelopes (message headers) in a folder, and (in future) export mail.

This CLI was developed based on the official client repository [tutao/tutanota](https://github.com/tutao/tutanota) at version ...., commit .....

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
- **Usage:** `account check`, `account profile`, `account logout`, `folders list`, and `envelope list` use the stored session when it is present and still valid. The same commands are also available under the `auth` alias (e.g. `auth check`, `auth profile`, `auth logout`). Commands that decrypt data (e.g. `folders list`) will prompt for your password when using a stored session, since the passphrase key is not persisted. Running the CLI with **no subcommand** lists the default folder (Inbox), same as `envelope list`.
- **Recovery:** If session verification fails (e.g. network error or session expired), the CLI clears the stored session and prompts you to log in again. You may see a brief message such as "Network error while checking session; logging in again." or "Session invalid or expired; logging in again."
- **Log out:** Run `account logout` (or `auth logout`) to clear the stored session, or delete the session file manually.
- **Opt-out:** Set `TUTANOTA_NO_SESSION_PERSISTENCE=1` in the environment to disable saving and using a session file.

## Global options

- `--output`, `-o` **&lt;format&gt;** – Output format: `pretty`, `tsv`, or `json` (default: `pretty`). **pretty** shows aligned columns for easier reading in the terminal; **tsv** is tab-separated for spreadsheet paste and scripting. Use `--output tsv` when piping or copying into a spreadsheet; use `--output json` for machine-readable output.

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

- `--verbose`, `-v` – Verbose logging (request URLs, errors with cause/stack) for debugging. Use global `--output json` for JSON.

### `account logout`

Clears the stored session so that the next command will prompt for credentials again. Also available as `auth logout`.

```bash
node dist/cli.js account logout
npm start -- account logout
```

### `account profile`

Logs in (or uses the stored session) and loads your user profile. Human-readable output is three tab-separated tables: **User** (Key, Value), **Customer** (Key, Value), and **Customer info** (Key, Value). Each table has a section title line, then a header line, then one row per field. Also available as `auth profile`.

With global `--output json`, the full structure is output as JSON. With `--verbose`, extra debug logs (e.g. request URLs) are printed.

```bash
node dist/cli.js account profile
npm start -- account profile
```

Example output (with default output): section title "User", then "Key\tValue", then rows; then "Customer" and its table; then "Customer info" and its table (including domainInfos summary and domain_0, domain_1, etc.).

Options:

- `--verbose`, `-v` – Verbose logging for debugging. Use global `--output json` for JSON.

### `folders list`

Lists your mail folders (Inbox, Sent, custom folders, labels, etc.) with decrypted names. Human-readable output is tab-separated columns: Name, Id, FolderType. Uses the stored session when valid; if you have a stored session, you will be prompted for your password so the CLI can decrypt folder names (the passphrase key is not saved).

```bash
node dist/cli.js folders list
npm start -- folders list
```

Options:

- `--verbose`, `-v` – Verbose logging (request URLs, key chain summary, and failure details when relevant). Use global `--output json` for JSON.

### `envelope list [folder-id]`

Lists the latest N envelopes (message headers) in a folder. **Folder is optional and defaults to Inbox** when omitted; use a folder id from `folders list` (e.g. `L2eum1h-1k-0`) to list another folder. For each envelope, shows subject, date, from, and unread flag. Unread items are prefixed with `*` in human-readable output. Also available as `emails list`.

```bash
node dist/cli.js envelope list
npm start -- envelope list
node dist/cli.js envelope list L2eum1h-1k-0
```

Options:

- `--verbose`, `-v` – Verbose logging for debugging.
- `--count`, `-c` – Number of envelopes to list (default: 10, max: 100).
- `--unread`, `-u` – Show only unread (filters client-side). Use global `--output json` for JSON.

## Limitations

- **2FA**: Accounts with two-factor authentication enabled are not supported yet. Commands will fail with a clear message. Use the official Tutanota client or disable 2FA for the account.
- **Export**: Mail export (downloading messages) is not implemented; the CLI supports authentication, profile, listing folders, and listing envelopes in a folder.

## License

GPL-3.0. This project uses the following GPL-3.0-licensed dependencies from the [Tutanota](https://github.com/tutao/tutanota) project:

- `@tutao/tutanota-crypto`
- `@tutao/tutanota-utils`

Use of those packages means the combined work is a "covered work" under the GPL-3.0 when distributed, so this project is licensed under GPL-3.0 as well. See [LICENSE](LICENSE) for the full terms.
