import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * Databricks auth for the app.
 * - On Databricks Apps: the app's service principal (DATABRICKS_CLIENT_ID/SECRET, injected) via OAuth M2M.
 * - Locally: DATABRICKS_TOKEN if set, else the CLI's DEFAULT profile (`databricks auth token`).
 */
const HOST = (process.env.DATABRICKS_HOST ?? "https://dbc-a76cc260-1137.cloud.databricks.com").replace(/\/$/, "");
export const databricksHost = HOST.startsWith("http") ? HOST : `https://${HOST}`;

/**
 * Local mode: DATABASE_URL points the app at a plain Postgres (e.g. scripts/seed_local.py on localhost) and no
 * Databricks is used at all. Gold-table reads come back empty, refresh jobs and the AI analyst are skipped.
 */
export const localMode = () => !!process.env.DATABASE_URL;

let cached: { token: string; expires: number } | null = null;

export async function databricksToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const { DATABRICKS_CLIENT_ID: id, DATABRICKS_CLIENT_SECRET: secret, DATABRICKS_TOKEN } = process.env;
  if (id && secret) {
    const res = await fetch(`${databricksHost}/oidc/v1/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=all-apis",
    });
    if (!res.ok) throw new Error(`OAuth token request failed: ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: j.access_token, expires: Date.now() + j.expires_in * 1000 };
  } else if (DATABRICKS_TOKEN) {
    cached = { token: DATABRICKS_TOKEN, expires: Date.now() + 3600_000 };
  } else {
    const { stdout } = await promisify(execFile)("databricks", ["auth", "token", "--host", databricksHost, "-o", "json"]);
    const j = JSON.parse(stdout) as { access_token: string; expiry?: string };
    cached = { token: j.access_token, expires: j.expiry ? Date.parse(j.expiry) : Date.now() + 1800_000 };
  }
  return cached.token;
}

export async function dbx<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${databricksHost}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await databricksToken()}`, "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Databricks ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export const config = {
  catalog: process.env.DATABRICKS_CATALOG ?? "the_curve",
  warehouseId: process.env.DATABRICKS_WAREHOUSE_ID ?? "cba268733f96d335",
  aiModel: process.env.DATABRICKS_AI_MODEL ?? "databricks-meta-llama-3-3-70b-instruct",
  lakebaseEndpoint:
    process.env.LAKEBASE_ENDPOINT ?? "projects/the-curve-ledger/branches/production/endpoints/primary",
};
