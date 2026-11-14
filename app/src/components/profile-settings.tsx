"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Avatar } from "./avatar";

/** Crop the center square and resize to 128px WebP in the browser, so uploads are tiny (well under 64 KB). */
async function toAvatar(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  canvas.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 128, 128);
  img.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", 0.85));
  // Safari can't encode WebP; fall back to JPEG.
  return blob?.type === "image/webp" ? blob : ((await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85))) as Blob);
}

export function AvatarUpload({ userId, handle, v }: { userId: string; handle: string; v: number | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const blob = await toAvatar(file);
      const res = await fetch("/api/me/avatar", { method: "PUT", headers: { "Content-Type": blob.type }, body: blob });
      if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Upload failed.");
      else router.refresh();
    } catch {
      setError("Couldn't read that image. Try a JPEG or PNG.");
    }
    setBusy(false);
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar userId={userId} handle={handle} v={v} size={72} />
      <div className="space-y-1.5">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={() => input.current?.click()}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink disabled:opacity-50"
          >
            {busy ? "Uploading…" : v ? "Change photo" : "Upload photo"}
          </button>
          {v && (
            <button
              disabled={busy}
              onClick={async () => {
                await fetch("/api/me/avatar", { method: "DELETE" });
                router.refresh();
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-sm"
            >
              Remove
            </button>
          )}
        </div>
        <p className="text-xs text-muted">Square-cropped to 128px. Everyone can see it next to your bets and comments.</p>
        {error && <p className="text-sm text-no">{error}</p>}
      </div>
    </div>
  );
}

export function TitlePicker({ earned, current }: { earned: string[]; current: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await fetch("/api/me", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: value || null }),
        });
        const j = await res.json().catch(() => ({}));
        setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: j.error ?? "Couldn't save." });
        if (res.ok) router.refresh();
      }}
    >
      <select value={value} onChange={(e) => setValue(e.target.value)} className="rounded-lg border border-line bg-bg px-3 py-2 text-sm">
        <option value="">Automatic (highest tier)</option>
        {earned.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <button className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-ink">Save</button>
      {msg && <span className={`text-sm ${msg.ok ? "text-yes" : "text-no"}`}>{msg.text}</span>}
    </form>
  );
}
