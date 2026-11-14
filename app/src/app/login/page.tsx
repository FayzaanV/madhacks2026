import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md py-10">
      <div className="rounded-2xl border border-line bg-panel p-6">
        <h1 className="text-2xl font-bold">Sign in to The Curve</h1>
        <p className="mt-1 text-sm text-muted">
          Pick your university and use your school email. We&apos;ll send a one-time link, so there&apos;s no password.
          New accounts start with <b className="text-ink">100 Clout</b>.
        </p>
        <LoginForm />
      </div>
      <p className="mt-4 text-center text-xs text-muted">
        Accounts and sessions are stored in Lakebase (Databricks Postgres). Links expire after 15 minutes and work once.
      </p>
    </div>
  );
}
