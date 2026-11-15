"use client";

import { useEffect } from "react";

/**
 * Keeps simulated test markets alive: once per page load (and at most once a minute per browser), ping
 * /api/sim/tick so closed test markets get settled and open ones get a few simulated bets. Renders nothing.
 */
export function SimTicker() {
  useEffect(() => {
    try {
      const last = Number(sessionStorage.getItem("yomi-tick") ?? 0);
      if (Date.now() - last < 60e3) return;
      sessionStorage.setItem("yomi-tick", String(Date.now()));
    } catch {
      /* storage blocked: tick anyway, the server throttles */
    }
    fetch("/api/sim/tick", { method: "POST" }).catch(() => {});
  }, []);
  return null;
}
