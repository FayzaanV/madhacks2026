import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { connection } from "next/server";

/**
 * Next's connection() marks a render as per-request, but it only works inside a request. Background work
 * (the sports/intramural poller started from instrumentation.ts) runs under inBackground(), where we skip it.
 */
const store = new AsyncLocalStorage<true>();

export const inBackground = <T>(fn: () => Promise<T>): Promise<T> => store.run(true, fn);

export async function requestScope(): Promise<void> {
  if (!store.getStore()) await connection();
}
