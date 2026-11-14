import "server-only";
import { headers } from "next/headers";
import { q } from "./ledger";

export type User = { user_id: string; handle: string; email: string; clout: number; is_simulated: boolean };

/**
 * Current user. On Databricks Apps every request carries the signed-in workspace user's email in
 * X-Forwarded-Email (only workspace members can open the app). Locally, DEV_USER_EMAIL is used.
 * First visit creates a ledger user with 0 Clout.
 */
export async function currentUser(): Promise<User> {
  const h = await headers();
  const email = (h.get("x-forwarded-email") ?? process.env.DEV_USER_EMAIL ?? "dev@wisc.edu").toLowerCase();
  const existing = await q<User>("SELECT user_id, handle, email, clout, is_simulated FROM users WHERE email = $1", [email]);
  if (existing[0]) return existing[0];
  const handle = email.split("@")[0].replace(/[^a-z0-9_]/g, "_").slice(0, 24);
  const rows = await q<User>(
    `INSERT INTO users (user_id, handle, email) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING user_id, handle, email, clout, is_simulated`,
    [`u-${crypto.randomUUID()}`, handle, email],
  );
  return rows[0];
}
