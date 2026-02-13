import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as logger from "./logger.js";

const SESSION_DIR = "tutanota-cli";
const SESSION_FILE = "session.json";

const ENV_NO_PERSISTENCE = "TUTANOTA_NO_SESSION_PERSISTENCE";

export interface Session {
  baseUrl: string;
  accessToken: string;
  userId: string;
  sessionId?: [string, string];
}

function isPersistenceDisabled(): boolean {
  const v = process.env[ENV_NO_PERSISTENCE];
  return v === "1" || v?.toLowerCase() === "true" || v === "yes";
}

/**
 * Return the path to the session file.
 * Uses $XDG_CONFIG_HOME/tutanota-cli/session.json or ~/.config/tutanota-cli/session.json.
 */
export function getSessionPath(): string {
  const configDir =
    process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config");
  return path.join(configDir, SESSION_DIR, SESSION_FILE);
}

/**
 * Read and parse the session file. Returns null if persistence is disabled,
 * file is missing, JSON is invalid, or required fields are missing.
 * May throw on permission errors; caller should treat as "no session".
 */
export function readSession(): Session | null {
  if (isPersistenceDisabled()) {
    logger.log("Session persistence is disabled.");
    return null;
  }
  const filePath = getSessionPath();
  try {
    const data = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(data) as Record<string, unknown>;
    const baseUrl = parsed.baseUrl;
    const accessToken = parsed.accessToken;
    const userIdRaw = parsed.userId;
    if (typeof baseUrl !== "string" || typeof accessToken !== "string") {
      logger.log("Session file invalid or incomplete.");
      return null;
    }
    const userId =
      typeof userIdRaw === "string"
        ? userIdRaw
        : Array.isArray(userIdRaw) && userIdRaw.length > 0
          ? String(userIdRaw[0])
          : null;
    if (userId === null) {
      logger.log("Session file invalid or incomplete.");
      return null;
    }
    const session: Session = { baseUrl, accessToken, userId };
    if (
      Array.isArray(parsed.sessionId) &&
      parsed.sessionId.length >= 2 &&
      typeof parsed.sessionId[0] === "string" &&
      typeof parsed.sessionId[1] === "string"
    ) {
      session.sessionId = [parsed.sessionId[0], parsed.sessionId[1]];
    }
    return session;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      logger.log("No session file at " + filePath);
      return null;
    }
    logger.log("Failed to read session file: " + (err instanceof Error ? err.message : String(err)));
    throw err;
  }
}

/**
 * Write the session to the file. Creates parent directory if needed and sets mode 0o600.
 * No-op if persistence is disabled. On write failure, logs a warning but does not throw.
 */
export function writeSession(session: Session): void {
  if (isPersistenceDisabled()) return;
  const filePath = getSessionPath();
  logger.log("Saving session to " + filePath);
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, JSON.stringify(session), { mode: 0o600 });
  } catch (err) {
    logger.log("Session write failed: " + (err instanceof Error ? err.message : String(err)));
    console.error("Warning: could not save session to", filePath, err instanceof Error ? err.message : err);
    if (logger.isVerbose()) logger.logError("writeSession", err);
  }
}

/**
 * Remove the session file if it exists. Ignores errors (e.g. already missing).
 */
export function clearSession(): void {
  if (isPersistenceDisabled()) return;
  const filePath = getSessionPath();
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}
