"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { CheckIcon, SquaredMark } from "@/components/icons";
import { api } from "@/lib/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const value = email.trim();
    if (!value) {
      setFieldError("Enter your email address.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      setFieldError("That doesn't look like a valid email address.");
      return;
    }
    setFieldError(undefined);
    setSubmitting(true);
    try {
      await api("/api/auth/forgot-password", {
        method: "POST",
        body: { email: value },
      });
      setSentTo(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <div className="animate-in">
        <div className="mb-8 flex flex-col items-center text-center">
          <SquaredMark className="h-11 w-11" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            {sentTo ? "Check your email" : "Reset your password"}
          </h1>
          <p className="mt-1 text-[15px] text-[var(--text-muted)]">
            {sentTo
              ? "If that address has an account, a reset link is on its way."
              : "We'll email you a link to choose a new one."}
          </p>
        </div>

        <Card className="p-6">
          {sentTo ? (
            // The confirmation never claims the address exists — saying "we
            // sent it" for an unregistered address would give away exactly
            // what the endpoint refuses to.
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-2 rounded-lg border border-[var(--positive)]/25 bg-[var(--positive-subtle)] px-3 py-2.5 text-[13px] leading-relaxed text-[var(--positive)]">
                <CheckIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  We&apos;ve sent a reset link to{" "}
                  <span className="font-medium">{sentTo}</span> if an account is
                  registered there. It expires in an hour.
                </span>
              </div>
              <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">
                Nothing arrived? Check the spam folder, or{" "}
                <button
                  type="button"
                  onClick={() => setSentTo(null)}
                  className="cursor-pointer font-medium text-[var(--brand)] underline-offset-4 hover:underline"
                >
                  try a different address
                </button>
                .
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
              {error && <Alert>{error}</Alert>}

              <Field label="Email" error={fieldError} required>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder="you@example.com"
                    value={email}
                    invalid={invalid}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (fieldError) setFieldError(undefined);
                    }}
                  />
                )}
              </Field>

              <Button type="submit" loading={submitting} className="mt-1 w-full">
                Send reset link
              </Button>
            </form>
          )}
        </Card>

        <p className="mt-5 text-center text-[14px] text-[var(--text-muted)]">
          Remembered it?{" "}
          <Link
            href="/login"
            className="font-medium text-[var(--brand)] underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
