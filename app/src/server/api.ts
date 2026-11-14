import "server-only";
import { unstable_rethrow } from "next/navigation";
import { AuthError } from "./auth";
import { TradeError } from "./markets";

/** Wrap a route handler: known errors become { error } with their status; anything else is a logged 500. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    unstable_rethrow(e); // let Next.js internal control-flow errors (prerender bail-out, redirect) through
    if (e instanceof AuthError || e instanceof TradeError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}

export async function readJson<T>(req: Request): Promise<Partial<T>> {
  try {
    return (await req.json()) as Partial<T>;
  } catch {
    return {};
  }
}
