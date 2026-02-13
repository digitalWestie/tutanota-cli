import { config as loadDotenv } from "dotenv";
import read from "read";

const DEFAULT_API_URL = "https://app.tuta.com";

/** Load .env from cwd (and optionally a path). Call once at startup. */
export function loadEnv(): void {
  loadDotenv();
}

export function getApiBaseUrl(): string {
  return process.env.TUTANOTA_API_URL?.trim() || DEFAULT_API_URL;
}

function prompt(options: { prompt: string; silent?: boolean }): Promise<string> {
  return new Promise((resolve, reject) => {
    read(
      {
        prompt: options.prompt,
        silent: options.silent ?? false,
      },
      (err: Error | null, result?: string) => {
        if (err) reject(err);
        else resolve((result ?? "").trim());
      }
    );
  });
}

export async function getCredentials(): Promise<{ email: string; password: string }> {
  let email = process.env.TUTANOTA_EMAIL?.trim();
  let password = process.env.TUTANOTA_PASSWORD;

  if (!email) {
    email = await prompt({ prompt: "Email:" });
    if (!email) throw new Error("Email is required.");
  }

  if (!password) {
    password = await prompt({ prompt: "Password:", silent: true });
    if (!password) throw new Error("Password is required.");
  }

  return { email, password };
}
