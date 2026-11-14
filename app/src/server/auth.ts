import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { STARTING_CLOUT } from "@/core/clout";
import { q, tx } from "./ledger";

/**
 * Passwordless wisc.edu login. Everything lives in the Lakebase ledger (Databricks):
 *   login_tokens: SHA-256 of each one-time sign-in token (15 min, single use)
 *   sessions:     SHA-256 of each session id (30 days); the raw id only lives in an httpOnly cookie
 * No passwords are stored anywhere.
 */
export const SESSION_COOKIE = "curve_session";
const TOKEN_TTL_MIN = 15;
const SESSION_DAYS = 30;
const MAX_LINKS_PER_WINDOW = 3;
const WISC_EMAIL = /^[a-z0-9._%+-]+@wisc\.edu$/;

export class AuthError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type User = {
  user_id: string;
  handle: string;
  email: string;
  clout: number; // available balance
  open_stake: number;
  is_simulated: boolean;
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const randomToken = () => randomBytes(32).toString("base64url");

export function normalizeEmail(raw: unknown): string {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!WISC_EMAIL.test(email)) throw new AuthError("Use your @wisc.edu email address.");
  return email;
}

/** Create a one-time sign-in link and email it (or return it in demo mode). */
export async function requestLogin(rawEmail: unknown, origin: string): Promise<{ sent: boolean; devLink?: string }> {
  const email = normalizeEmail(rawEmail);
  const recent = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM login_tokens WHERE email = $1 AND created_at > now() - interval '${TOKEN_TTL_MIN} minutes'`,
    [email],
  );
  if ((recent[0]?.n ?? 0) >= MAX_LINKS_PER_WINDOW)
    throw new AuthError("Too many sign-in links requested. Wait a few minutes and try again.", 429);

  const token = randomToken();
  await q(
    `INSERT INTO login_tokens (token_hash, email, expires_at) VALUES ($1, $2, now() + interval '${TOKEN_TTL_MIN} minutes')`,
    [sha256(token), email],
  );
  const link = `${origin}/login/verify?token=${token}`;

  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, devLink: link }; // demo mode: no email service configured
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM ?? "The Curve <onboarding@resend.dev>",
      to: [email],
      subject: "Your sign-in link for The Curve",
      text: `Sign in to The Curve: ${link}\n\nThis link works once and expires in ${TOKEN_TTL_MIN} minutes. If you didn't ask for it, ignore this email.`,
      html: `<p>Sign in to <b>The Curve</b>:</p><p><a href="${link}">Sign in</a></p><p>This link works once and expires in ${TOKEN_TTL_MIN} minutes. If you didn't ask for it, ignore this email.</p>`,
    }),
  });
  if (!res.ok) {
    console.error("Resend error", res.status, (await res.text()).slice(0, 300));
    throw new AuthError("Couldn't send the email. Try again in a minute.", 502);
  }
  return { sent: true };
}

/** Exchange a sign-in token for a session. Returns the raw session id for the cookie. */
export async function verifyLogin(rawToken: unknown, userAgent: string | null): Promise<{ sessionId: string; maxAge: number }> {
  const token = String(rawToken ?? "");
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new AuthError("This sign-in link is invalid.");
  return tx(async (c) => {
    const row = (
      await c.query(
        `UPDATE login_tokens SET used_at = now()
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
         RETURNING email`,
        [sha256(token)],
      )
    ).rows[0] as { email: string } | undefined;
    if (!row) throw new AuthError("This sign-in link has expired or was already used. Request a new one.", 401);

    const handleBase = row.email.split("@")[0].replace(/[^a-z0-9_]/g, "_").slice(0, 24);
    const user = (
      await c.query(
        `INSERT INTO users (user_id, handle, email, clout, email_verified_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (email) DO UPDATE SET email_verified_at = coalesce(users.email_verified_at, now()), deleted_at = NULL
         RETURNING user_id`,
        [`u-${crypto.randomUUID()}`, handleBase, row.email, STARTING_CLOUT],
      )
    ).rows[0] as { user_id: string };

    const sessionId = randomToken();
    await c.query(
      `INSERT INTO sessions (session_hash, user_id, user_agent, expires_at)
       VALUES ($1, $2, $3, now() + interval '${SESSION_DAYS} days')`,
      [sha256(sessionId), user.user_id, userAgent?.slice(0, 300) ?? null],
    );
    return { sessionId, maxAge: SESSION_DAYS * 86400 };
  });
}

export const sessionCookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

/** The signed-in user, or null. */
export async function currentUser(): Promise<User | null> {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  const rows = await q<User>(
    `SELECT u.user_id, u.handle, u.email, u.clout, u.is_simulated,
            coalesce((SELECT sum(t.clout_spent) FROM trades t JOIN markets m USING (market_id)
                      WHERE t.user_id = u.user_id AND m.status NOT IN ('resolved', 'final', 'voided')), 0)::float AS open_stake
     FROM sessions s JOIN users u USING (user_id)
     WHERE s.session_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.deleted_at IS NULL`,
    [sha256(sid)],
  );
  return rows[0] ?? null;
}

/** For API routes: the signed-in user or a 401. */
export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new AuthError("Sign in with your @wisc.edu email first.", 401);
  return u;
}

export async function logout(): Promise<void> {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value;
  if (sid) await q("UPDATE sessions SET revoked_at = now() WHERE session_hash = $1", [sha256(sid)]);
}

/** Delete account: revoke all sessions and anonymize. Trades stay so market history remains valid. */
export async function deleteAccount(userId: string): Promise<void> {
  await tx(async (c) => {
    await c.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
    await c.query("UPDATE comments SET deleted_at = now() WHERE user_id = $1 AND deleted_at IS NULL", [userId]);
    await c.query(
      `UPDATE users SET email = 'deleted-' || user_id || '@deleted.invalid', handle = 'deleted_user',
                        major = NULL, dorm = NULL, club = NULL, deleted_at = now()
       WHERE user_id = $1`,
      [userId],
    );
  });
}

/**
 * Public origin for sign-in links. Host headers can be forged, and a forged host would send the token to an
 * attacker's site, so only APP_ORIGIN, localhost, or our Databricks Apps domain are accepted.
 */
export async function requestOrigin(): Promise<string> {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, "");
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").toLowerCase();
  if (/^localhost(:\d+)?$/.test(host)) return `http://${host}`;
  if (/^the-curve-[a-z0-9-]+\.[a-z0-9.-]*databricksapps\.com$/.test(host)) return `https://${host}`;
  throw new AuthError("Sign-in isn't available from this address.", 400);
}
