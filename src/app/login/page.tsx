"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { SquaredMark } from "@/components/icons";
import { api } from "@/lib/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api("/api/auth/login", { method: "POST", body: { email, password } });
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <div className="animate-in">
        <div className="mb-8 flex flex-col items-center text-center">
          <SquaredMark className="h-11 w-11" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-[15px] text-[var(--text-muted)]">
            Sign in to see your groups and balances.
          </p>
        </div>

        <Card className="p-6">
          {/* noValidate hands validation to the app: the browser's native
              bubbles block submission silently and can't be styled. */}
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            {error && <Alert>{error}</Alert>}

            <Field label="Email" required>
              {({ id, invalid }) => (
                <Input
                  id={id}
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  value={email}
                  invalid={invalid}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>

            <Field label="Password" required>
              {({ id, invalid }) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  invalid={invalid}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>

            <Button type="submit" loading={submitting} className="mt-1 w-full">
              Sign in
            </Button>
          </form>
        </Card>

        <p className="mt-5 text-center text-[14px] text-[var(--text-muted)]">
          Don&apos;t have an account?{" "}
          <Link
            href="/register"
            className="font-medium text-[var(--brand)] underline-offset-4 hover:underline"
          >
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
