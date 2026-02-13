# Unofficial Tutanota CLI

ℹ️ *This tool is not affiliated or endorsed by Tuta GmbH in any way.*

A CLI to authenticate with [Tutanota](https://tuta.com) and (in future) export mail.
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
- **Usage:** `auth check` and `profile` use the stored session when it is present and still valid. They only prompt for email/password when there is no session or it has expired.
- **Log out:** Run `auth logout` to clear the stored session, or delete the session file manually.
- **Opt-out:** Set `TUTANOTA_NO_SESSION_PERSISTENCE=1` in the environment to disable saving and using a session file.

## Commands

### `auth check`

Verifies that you can log in (or that your stored session is still valid). On success, prints your user ID and session ID. If a valid session is already stored, it may succeed without prompting for credentials.

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

Logs in (or uses the stored session) and loads your user profile. Output is grouped into three blocks:

- **User** – Account type, enabled, KDF version, require password update, customer id.
- **Customer** – Type, approval status, business use, order processing agreement needed.
- **Customer info** – Domain, company, plan, registration mail, creation and activation time, included email aliases and storage, per-user storage capacity and alias count, and a list of your domains.

With `--json`, the same structure is output as JSON. With `--verbose`, extra debug logs (e.g. request URLs) are printed.

```bash
node dist/cli.js profile
npm start -- profile
```

Example output (without `--json`):

```
Profile
-------
User
  Account type: 3
  Enabled: 1
  KDF version: 1
  Require password update: 0
  Customer id: [ '...' ]
Customer
  Type: 3
  Approval status: 2
  Business use: 0
  Order processing agreement needed: 0
Customer info
  Plan: 6
  Registration mail: you@tuta.io
  ...
  Domain infos: 2 domain(s)
    - example.com
    - mail.example.com
```

Options:

- `--json` – Output profile as JSON.
- `--verbose`, `-v` – Verbose logging for debugging.

## Limitations

- **2FA**: Accounts with two-factor authentication enabled are not supported yet. The command will fail with a clear message. Use the official Tutanota client or disable 2FA for the account.
- **Export**: Mail export is not implemented in this version; this slice only implements authentication.

## License

GPL-3.0. This project uses the following GPL-3.0-licensed dependencies from the [Tutanota](https://github.com/tutao/tutanota) project:

- `@tutao/tutanota-crypto`
- `@tutao/tutanota-utils`

Use of those packages means the combined work is a "covered work" under the GPL-3.0 when distributed, so this project is licensed under GPL-3.0 as well. See [LICENSE](LICENSE) for the full terms.
