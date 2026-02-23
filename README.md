# Unofficial Tutanota CLI

ℹ️ *This tool is not affiliated or endorsed by Tuta GmbH in any way.*

A CLI to authenticate with [Tutanota](https://tuta.com), list mail folders, list mails in a folder, and (in future) export mail.

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

If `TUTANOTA_EMAIL` or `TUTANOTA_PASSWORD` is not set, the CLI will prompt you for it when you run an auth command. The password prompt is hidden (no echo). Do not pass passwords via command-line flags. Credentials are only used when logging in (for example when there is no valid stored session or when session persistence is disabled).

You can copy `.env.example` to `.env` and fill in your values.

## Session persistence

After a successful login, the CLI stores a session in a file so that later commands can reuse it without asking for your password again.

- **Location:** `$XDG_CONFIG_HOME/tutanota-cli/session.json`, or `~/.config/tutanota-cli/session.json` if `XDG_CONFIG_HOME` is not set.
- **Usage:** `auth check`, `profile`, `folders list`, and `mails list` use the stored session when it is present and still valid. They only prompt for email/password when there is no session or it has expired. Commands that decrypt data (e.g. `folders list`) will prompt for your password when using a stored session, since the passphrase key is not persisted.
- **Recovery:** If session verification fails (e.g. network error or session expired), the CLI clears the stored session and prompts you to log in again. You may see a brief message such as "Network error while checking session; logging in again." or "Session invalid or expired; logging in again."
- **Log out:** Run `auth logout` to clear the stored session, or delete the session file manually.
- **Opt-out:** Set `TUTANOTA_NO_SESSION_PERSISTENCE=1` in the environment to disable saving and using a session file.

## Commands

### `auth check`

Verifies that you can log in (or that your stored session is still valid). On success, prints one line of tab-separated columns: Status, UserId, Session ID, Stored?, Storage Path. If a valid session is already stored, it may succeed without prompting for credentials.

```bash
node dist/cli.js auth check
# or, after npm run build:
npm start -- auth check
```

Options:

- `--json` – Output machine-readable JSON: `{ "ok": true, "userId": "...", "sessionId": ["...", "..."] }` on success, or `{ "ok": false, "error": "..." }` on failure.
- `--verbose`, `-v` – Verbose logging (request URLs, errors with cause/stack) for debugging.

### `auth logout`

Clears the stored session so that the next command will prompt for credentials again.

```bash
node dist/cli.js auth logout
npm start -- auth logout
```

### `profile`

Logs in (or uses the stored session) and loads your user profile. Human-readable output is three tab-separated tables: **User** (Key, Value), **Customer** (Key, Value), and **Customer info** (Key, Value). Each table has a section title line, then a header line, then one row per field.

With `--json`, the full structure is output as JSON. With `--verbose`, extra debug logs (e.g. request URLs) are printed.

```bash
node dist/cli.js profile
npm start -- profile
```

Example output (without `--json`): section title "User", then "Key\tValue", then rows; then "Customer" and its table; then "Customer info" and its table (including domainInfos summary and domain_0, domain_1, etc.).

Options:

- `--json` – Output profile as JSON.
- `--verbose`, `-v` – Verbose logging for debugging.

### `folders list`

Lists your mail folders (Inbox, Sent, custom folders, labels, etc.) with decrypted names. Human-readable output is tab-separated columns: Name, Id, FolderType. Uses the stored session when valid; if you have a stored session, you will be prompted for your password so the CLI can decrypt folder names (the passphrase key is not saved).

```bash
node dist/cli.js folders list
npm start -- folders list
```

Options:

- `--json` – Output as JSON: `{ "folders": [ { "name": "...", "id": "...", "folderType": ... }, ... ] }`.
- `--verbose`, `-v` – Verbose logging (request URLs, key chain summary, and failure details when relevant).

### `mails list [folder-id]`

Lists the latest N mails in a folder. **Folder is optional and defaults to Inbox** when omitted; use a folder id from `folders list` (e.g. `L2eum1h-1k-0`) to list another folder. For each mail, shows subject, date, from, and unread flag. Unread mails are prefixed with `*` in human-readable output.

```bash
node dist/cli.js mails list
npm start -- mails list
node dist/cli.js mails list L2eum1h-1k-0
```

Options:

- `--json` – Output as JSON: `{ "mails": [ { "subject": "...", "receivedDate": "...", "unread": true|false, "id": "..." }, ... ] }`.
- `--verbose`, `-v` – Verbose logging for debugging.
- `--unread`, `-u` – Show only unread mails (filters the listed mails client-side).

## Limitations

- **2FA**: Accounts with two-factor authentication enabled are not supported yet. Commands will fail with a clear message. Use the official Tutanota client or disable 2FA for the account.
- **Export**: Mail export (downloading messages) is not implemented; the CLI supports authentication, profile, listing folders, and listing mails in a folder.

## License

GPL-3.0. This project uses the following GPL-3.0-licensed dependencies from the [Tutanota](https://github.com/tutao/tutanota) project:

- `@tutao/tutanota-crypto`
- `@tutao/tutanota-utils`

Use of those packages means the combined work is a "covered work" under the GPL-3.0 when distributed, so this project is licensed under GPL-3.0 as well. See [LICENSE](LICENSE) for the full terms.
