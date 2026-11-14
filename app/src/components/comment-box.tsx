"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CommentBox({ marketId }: { marketId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const res = await fetch(`/api/markets/${marketId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        });
        if (!res.ok) return setError((await res.json()).error);
        setBody("");
        router.refresh();
      }}
    >
      <input
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={500}
        placeholder="Add a comment (no posts about individual students)"
        className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm"
      />
      <button className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-ink">Post</button>
      {error && <span className="text-sm text-no">{error}</span>}
    </form>
  );
}
