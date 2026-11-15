import type { Look } from "@/core/cosmetics";

/**
 * Shop cosmetics drawn on top of avatars and usernames. Server-safe (no hooks). Frame and name-color styles live in
 * globals.css (.frame-*, .name-*); hats are small inline SVGs so they scale with any avatar size.
 */

/** Ring drawn just outside the avatar. */
export function frameClass(look?: Look): string | null {
  if (!look?.frame) return null;
  return look.frame; // e.g. "frame-gold" -> .frame-gold in globals.css
}

/** Class for the @username text. */
export function nameClass(look?: Look): string {
  if (!look?.color) return "";
  return look.color.replace("color-", "name-"); // "color-sunset" -> .name-sunset
}

const HATS: Record<string, React.ReactNode> = {
  "hat-party": (
    <>
      <path d="M16 1 L25 22 H7 Z" fill="#f472b6" />
      <path d="M13 8 L19 8 L20.3 11 L11.7 11 Z M10.4 14 L21.6 14 L22.9 17 L9.1 17 Z" fill="#fde047" />
      <circle cx="16" cy="2" r="2.4" fill="#60a5fa" />
      <rect x="6" y="21" width="20" height="2.5" rx="1.2" fill="#a855f7" />
    </>
  ),
  "hat-beanie": (
    <>
      <path d="M5 18 C5 8 27 8 27 18 Z" fill="#c5050c" />
      <rect x="4" y="16.5" width="24" height="6" rx="2" fill="#f8fafc" />
      <path d="M8 19.5 H24" stroke="#c5050c" strokeWidth="1" strokeDasharray="1.5 1.5" />
      <circle cx="16" cy="6" r="3" fill="#f8fafc" />
    </>
  ),
  "hat-grad": (
    <>
      <path d="M9 13 V19 C9 21.5 23 21.5 23 19 V13 Z" fill="#1f2937" />
      <path d="M16 5 L31 11 L16 17 L1 11 Z" fill="#111827" />
      <path d="M16 11 L27 13.5 V20" stroke="#facc15" strokeWidth="1.2" fill="none" />
      <circle cx="27" cy="21" r="1.6" fill="#facc15" />
      <circle cx="16" cy="11" r="1.2" fill="#facc15" />
    </>
  ),
  "hat-wizard": (
    <>
      <path d="M17 0 C14 6 12 13 9 20 H24 C22 13 21 8 17 0 Z" fill="#4338ca" />
      <ellipse cx="16" cy="20.5" rx="14" ry="3" fill="#3730a3" />
      <path d="M15 9 l0.8 1.6 1.7.2-1.3 1.2.4 1.7-1.6-.9-1.6.9.4-1.7-1.3-1.2 1.7-.2Z" fill="#fde047" />
      <circle cx="19" cy="15" r="0.9" fill="#fde047" />
      <circle cx="13.5" cy="16.5" r="0.7" fill="#fde047" />
    </>
  ),
  "hat-crown-silver": (
    <>
      <defs>
        <linearGradient id="cs" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f8fafc" />
          <stop offset="1" stopColor="#94a3b8" />
        </linearGradient>
      </defs>
      <path d="M4 21 L3 7 L10 13 L16 3 L22 13 L29 7 L28 21 Z" fill="url(#cs)" stroke="#64748b" strokeWidth="0.8" />
      <rect x="4" y="19" width="24" height="3" rx="1" fill="#cbd5e1" stroke="#64748b" strokeWidth="0.6" />
      <circle cx="16" cy="15" r="1.8" fill="#60a5fa" />
      <circle cx="9.5" cy="16.5" r="1.2" fill="#a78bfa" />
      <circle cx="22.5" cy="16.5" r="1.2" fill="#a78bfa" />
    </>
  ),
  "hat-crown-gold": (
    <>
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fef08a" />
          <stop offset="0.5" stopColor="#facc15" />
          <stop offset="1" stopColor="#ca8a04" />
        </linearGradient>
      </defs>
      <path d="M4 21 L3 6 L10 12.5 L16 2 L22 12.5 L29 6 L28 21 Z" fill="url(#cg)" stroke="#a16207" strokeWidth="0.8" />
      <rect x="4" y="19" width="24" height="3" rx="1" fill="#eab308" stroke="#a16207" strokeWidth="0.6" />
      <circle cx="16" cy="14.5" r="2" fill="#ef4444" />
      <circle cx="9.5" cy="16.5" r="1.3" fill="#22c55e" />
      <circle cx="22.5" cy="16.5" r="1.3" fill="#3b82f6" />
      <circle cx="3" cy="6" r="1.3" fill="#fef9c3" />
      <circle cx="16" cy="2" r="1.4" fill="#fef9c3" />
      <circle cx="29" cy="6" r="1.3" fill="#fef9c3" />
    </>
  ),
  "hat-dunce": (
    <>
      <path d="M16 0 L24 22 H8 Z" fill="#f8fafc" stroke="#94a3b8" strokeWidth="0.8" />
      <text x="16" y="18" textAnchor="middle" fontSize="7" fontWeight="800" fill="#1f2937" fontFamily="sans-serif">D</text>
    </>
  ),
};

/** Hat sitting on top of an avatar of `size` px, tilted a little. */
export function Hat({ id, size }: { id: string; size: number }) {
  const art = HATS[id];
  if (!art) return null;
  const w = size * 0.9;
  return (
    <svg
      aria-hidden
      viewBox="0 0 32 24"
      width={w}
      height={(w * 24) / 32}
      className="pointer-events-none absolute left-1/2 drop-shadow-sm"
      style={{ top: -size * 0.5, transform: "translateX(-50%) rotate(-8deg)" }}
    >
      {art}
    </svg>
  );
}
