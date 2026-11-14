import { Suspense } from "react";
import { VerifyButton } from "@/components/login-form";

/** Landing page for emailed links. Signing in needs a click (POST), so email link scanners can't burn the token. */
export default function VerifyPage({ searchParams }: PageProps<"/login/verify">) {
  return (
    <div className="mx-auto max-w-md py-10">
      <div className="rounded-2xl border border-line bg-panel p-6 text-center">
        <h1 className="text-2xl font-bold">Almost there</h1>
        <p className="mt-1 text-sm text-muted">Click below to finish signing in on this device.</p>
        <Suspense fallback={null}>
          <Verify searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function Verify({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return <VerifyButton token={typeof sp.token === "string" ? sp.token : ""} />;
}
