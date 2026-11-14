import "server-only";
import { earnedTitles } from "@/core/titles";
import { AuthError } from "./auth";
import { q } from "./ledger";
import { querySql } from "./warehouse";

/** Flair earned in gold (e.g. "Oracle of ECON 301"), computed by the Databricks pipeline. */
export async function userFlair(userId: string): Promise<{ flair: string; kind: string }[]> {
  return querySql<{ flair: string; kind: string }>("SELECT flair, kind FROM {catalog}.gold.user_flair WHERE user_id = :id", {
    id: userId,
  }).catch(() => []);
}

/** Pick which earned title shows next to your name. null clears it (falls back to your tier title). */
export async function setTitle(user: { user_id: string; clout: number; open_stake: number }, raw: unknown): Promise<string | null> {
  if (raw === null || raw === "") {
    await q("UPDATE users SET title = NULL WHERE user_id = $1", [user.user_id]);
    return null;
  }
  const title = String(raw).trim();
  const flair = (await userFlair(user.user_id)).map((f) => f.flair);
  if (!earnedTitles(user.clout + user.open_stake, flair).includes(title)) throw new AuthError("You haven't earned that title yet.");
  await q("UPDATE users SET title = $2 WHERE user_id = $1", [user.user_id, title]);
  return title;
}

const AVATAR_TYPES = new Set(["image/webp", "image/png", "image/jpeg"]);
export const MAX_AVATAR_BYTES = 64 * 1024;

/** Store a profile picture. The browser already cropped it to 128px; we only check type, magic bytes and size. */
export async function setAvatar(userId: string, type: string, bytes: Buffer): Promise<number> {
  if (!AVATAR_TYPES.has(type)) throw new AuthError("Upload a WebP, PNG or JPEG image.", 415);
  if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) throw new AuthError("That image is too big (64 KB max after resizing).", 413);
  const magic =
    (type === "image/png" && bytes.subarray(0, 4).toString("hex") === "89504e47") ||
    (type === "image/jpeg" && bytes.subarray(0, 3).toString("hex") === "ffd8ff") ||
    (type === "image/webp" && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP");
  if (!magic) throw new AuthError("That file isn't a valid image.", 415);
  const r = await q<{ v: number }>(
    `UPDATE users SET avatar = $2, avatar_type = $3, avatar_updated_at = now() WHERE user_id = $1
     RETURNING extract(epoch FROM avatar_updated_at)::int AS v`,
    [userId, bytes, type],
  );
  return r[0].v;
}

export async function clearAvatar(userId: string): Promise<void> {
  await q("UPDATE users SET avatar = NULL, avatar_type = NULL, avatar_updated_at = NULL WHERE user_id = $1", [userId]);
}

export async function getAvatar(userId: string): Promise<{ type: string; bytes: Buffer } | null> {
  const r = await q<{ avatar: Buffer | null; avatar_type: string | null }>(
    "SELECT avatar, avatar_type FROM users WHERE user_id = $1 AND deleted_at IS NULL",
    [userId],
  );
  return r[0]?.avatar && r[0].avatar_type ? { type: r[0].avatar_type, bytes: r[0].avatar } : null;
}
