import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { STARTING_CLOUT } from "@/core/clout";
import { activeLook, type Look } from "@/core/cosmetics";
import { schoolForEmail } from "@/core/universities";
import { openStakeSql, q, tx } from "./ledger";

/**
 * Passwordless university email login: pick your school, prove you own an email at its domain.
 * Everything lives in the Lakebase ledger (Databricks):
 *   login_tokens: SHA-256 of each one-time sign-in token (15 min, single use)
 *   sessions:     SHA-256 of each session id (30 days); the raw id only lives in an httpOnly cookie
 * No passwords are stored anywhere.
 */
export const SESSION_COOKIE = "curve_session";
const TOKEN_TTL_MIN = 15;
const SESSION_DAYS = 30;
const MAX_LINKS_PER_EMAIL = 3; // per 15 minutes
const MAX_LINKS_PER_IP = 10; // per hour, so one visitor can't email thousands of addresses
const MAX_LINKS_GLOBAL = 300; // per hour, protects the email quota if many IPs are used

/**
 * Demo mode shows the sign-in link on screen instead of emailing it, which means anyone could sign in as anyone.
 * It is OFF unless explicitly enabled: DEMO_LOGIN=1, or local `next dev`. Production without an email key refuses.
 */
export const demoLoginEnabled = () => process.env.DEMO_LOGIN === "1" || process.env.NODE_ENV === "development";

export class AuthError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type User = {
  user_id: string;
  handle: string;
  email: string;
  school_id: string;
  handle_chosen: boolean;
  clout: number; // available balance
  open_stake: number;
  is_simulated: boolean;
  title: string | null; // chosen title (validated against earned titles on display)
  avatar_v: number | null; // avatar version (epoch seconds) or null if none uploaded
  look: Look; // shop cosmetics showing right now (core/cosmetics.ts)
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const randomToken = () => randomBytes(32).toString("base64url");

/** Validate the email against the chosen university's domain. */
export function checkEmail(rawEmail: unknown, rawSchool: unknown) {
  const email = String(rawEmail ?? "").trim().toLowerCase();
  const r = schoolForEmail(email, String(rawSchool ?? ""));
  if ("error" in r) throw new AuthError(r.error);
  return { email, school: r.school };
}

/**
 * Requester IP, hashed before storage. Uses the LAST x-forwarded-for entry: that's the one our proxy (Databricks Apps)
 * appends; earlier entries come from the client and can be faked to dodge the limit.
 */
async function requestIpHash(): Promise<string> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",").pop() ?? h.get("x-real-ip") ?? "unknown").trim();
  return sha256(`ip:${ip}`);
}

/** Create a one-time sign-in link and email it (or return it in demo mode, if enabled). */
export async function requestLogin(rawEmail: unknown, rawSchool: unknown, origin: string): Promise<{ sent: boolean; devLink?: string }> {
  const { email, school } = checkEmail(rawEmail, rawSchool);
  const key = process.env.RESEND_API_KEY;
  const demo = !key && demoLoginEnabled();
  if (!key && !demo) throw new AuthError("Email sign-in isn't set up on this server yet. Ask the team to add the email key.", 503);

  const ipHash = await requestIpHash();
  const counts = (
    await q<{ by_email: number; by_ip: number; total: number }>(
      `SELECT count(*) FILTER (WHERE email = $1 AND created_at > now() - interval '${TOKEN_TTL_MIN} minutes')::int AS by_email,
              count(*) FILTER (WHERE ip_hash = $2 AND created_at > now() - interval '1 hour')::int AS by_ip,
              count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS total
       FROM login_tokens WHERE created_at > now() - interval '1 hour'`,
      [email, ipHash],
    )
  )[0];
  if (counts.by_email >= MAX_LINKS_PER_EMAIL)
    throw new AuthError("Too many sign-in links for this email. Wait a few minutes and try again.", 429);
  if (counts.by_ip >= MAX_LINKS_PER_IP)
    throw new AuthError("Too many sign-in requests from your network. Try again in an hour.", 429);
  if (counts.total >= MAX_LINKS_GLOBAL)
    throw new AuthError("Sign-in is busy right now. Try again shortly.", 429);

  const token = randomToken();
  await q(
    `INSERT INTO login_tokens (token_hash, email, school_id, ip_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '${TOKEN_TTL_MIN} minutes')`,
    [sha256(token), email, school.school_id, ipHash],
  );
  const link = `${origin}/login/verify?token=${token}`;

  if (demo) return { sent: false, devLink: link }; // explicit demo mode only
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM ?? "Yomi <onboarding@resend.dev>",
      to: [email],
      subject: "Your sign-in link for Yomi",
      text: `Sign in to Yomi: ${link}\n\nThis link works once and expires in ${TOKEN_TTL_MIN} minutes. If you didn't ask for it, ignore this email.`,
      html: `<p>Sign in to <b>Yomi</b>:</p><p><a href="${link}">Sign in</a></p><p>This link works once and expires in ${TOKEN_TTL_MIN} minutes. If you didn't ask for it, ignore this email.</p>`,
    }),
  });
  if (!res.ok) {
    console.error("Resend error", res.status, (await res.text()).slice(0, 300));
    throw new AuthError("Couldn't send the email. Try again in a minute.", 502);
  }
  return { sent: true };
}

/** Exchange a sign-in token for a session. Returns the raw session id for the cookie. */
export async function verifyLogin(
  rawToken: unknown,
  userAgent: string | null,
): Promise<{ sessionId: string; maxAge: number; needsHandle: boolean }> {
  const token = String(rawToken ?? "");
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new AuthError("This sign-in link is invalid.");
  return tx(async (c) => {
    const row = (
      await c.query(
        `UPDATE login_tokens SET used_at = now()
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
         RETURNING email, school_id`,
        [sha256(token)],
      )
    ).rows[0] as { email: string; school_id: string | null } | undefined;
    if (!row) throw new AuthError("This sign-in link has expired or was already used. Request a new one.", 401);

    // Re-derive the school from the verified email (listed school if its domain matches, else "other").
    const { school } = checkEmail(row.email, row.school_id?.startsWith("edu-") ? "other" : (row.school_id ?? "other"));
    await c.query(
      `INSERT INTO schools (school_id, name, short_name, domain, color, is_listed)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (school_id) DO NOTHING`,
      [school.school_id, school.name, school.short_name, school.domain, school.color, !school.school_id.startsWith("edu-")],
    );
    // Random placeholder handle (never derived from the email, so NetIDs aren't exposed); the user picks a real one next.
    const user = (
      await c.query(
        `INSERT INTO users (user_id, school_id, handle, email, clout, email_verified_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (email) DO UPDATE SET email_verified_at = coalesce(users.email_verified_at, now()), deleted_at = NULL
         RETURNING user_id, handle_chosen_at IS NOT NULL AS handle_chosen`,
        [`u-${crypto.randomUUID()}`, school.school_id, randomHandle(), row.email, STARTING_CLOUT],
      )
    ).rows[0] as { user_id: string; handle_chosen: boolean };

    const sessionId = randomToken();
    await c.query(
      `INSERT INTO sessions (session_hash, user_id, user_agent, expires_at)
       VALUES ($1, $2, $3, now() + interval '${SESSION_DAYS} days')`,
      [sha256(sessionId), user.user_id, userAgent?.slice(0, 300) ?? null],
    );
    return { sessionId, maxAge: SESSION_DAYS * 86400, needsHandle: !user.handle_chosen };
  });
}

export const sessionCookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

// ------------------------------------------------------------------ usernames
const ADJ = ["violet", "lucky", "sharp", "bold", "quiet", "swift", "clever", "brave", "sunny", "cosmic", "calm", "wild"];
const NOUN = ["otter", "badger", "falcon", "fox", "heron", "lynx", "owl", "panda", "raven", "tiger", "wolf", "yak"];
const RESERVED = new Set(["admin", "administrator", "root", "support", "thecurve", "the_curve", "curve", "moderator", "mod",
  "system", "null", "undefined", "deleted_user", "databricks", "official", "staff", "help"]);
export const HANDLE_RULE = /^[a-z0-9_]{3,20}$/;

function randomHandle(): string {
  const b = randomBytes(3);
  return `${ADJ[b[0] % ADJ.length]}_${NOUN[b[1] % NOUN.length]}${1000 + (((b[2] << 8) | b[0]) % 9000)}`;
}

/** Pick or change your username: 3-20 chars, lowercase letters, numbers, underscores; unique across everyone. */
export async function setHandle(userId: string, raw: unknown): Promise<string> {
  const handle = String(raw ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!HANDLE_RULE.test(handle)) throw new AuthError("Usernames are 3–20 characters: letters, numbers and underscores.");
  if (RESERVED.has(handle)) throw new AuthError("That username is reserved. Try another.");
  try {
    return await tx(async (c) => {
      const taken = await c.query("SELECT 1 FROM users WHERE lower(handle) = $1 AND user_id <> $2 LIMIT 1", [handle, userId]);
      if (taken.rowCount) throw new AuthError("That username is taken. Try another.", 409);
      await c.query("UPDATE users SET handle = $2, handle_chosen_at = now() WHERE user_id = $1", [userId, handle]);
      return handle;
    });
  } catch (e) {
    // unique index race: two people grabbing the same name at once
    if ((e as { code?: string }).code === "23505") throw new AuthError("That username is taken. Try another.", 409);
    throw e;
  }
}

/** The signed-in user, or null. */
export async function currentUser(): Promise<User | null> {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  const rows = await q<Omit<User, "look"> & { cosmetics: string | null }>(
    `SELECT u.user_id, u.handle, u.email, u.school_id, u.handle_chosen_at IS NOT NULL AS handle_chosen, u.clout, u.is_simulated,
            u.title, extract(epoch FROM u.avatar_updated_at)::int AS avatar_v, ${openStakeSql("u.user_id")} AS open_stake,
            u.cosmetics
     FROM sessions s JOIN users u USING (user_id)
     WHERE s.session_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.deleted_at IS NULL`,
    [sha256(sid)],
  );
  const r = rows[0];
  if (!r) return null;
  const { cosmetics, ...u } = r;
  return { ...u, look: activeLook(cosmetics, u.clout + u.open_stake) };
}

/** For API routes: the signed-in user or a 401. */
export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new AuthError("Sign in with your university email first.", 401);
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
                        major = NULL, dorm = NULL, club = NULL, title = NULL, cosmetics = NULL,
                        avatar = NULL, avatar_type = NULL, avatar_updated_at = NULL, deleted_at = now()
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
  if (/^yomi-[a-z0-9-]+\.[a-z0-9.-]*databricksapps\.com$/.test(host)) return `https://${host}`;
  throw new AuthError("Sign-in isn't available from this address.", 400);
}
