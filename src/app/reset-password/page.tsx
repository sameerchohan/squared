"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Alert, Button, Card, Field, Input, Skeleton } from "@/components/ui";
import { SquaredMark } from "@/components/icons";
import { api } from "@/lib/client";

type Errors = { password?: string; confirm?: string };

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // A link with no token at all never reaches the API: there is nothing for
  // the server to tell them that isn't already obvious here.
  if (!token) {
    return (
      <Card className="p-6">
        <div className="flex flex-col gap-4">
          <Alert>
            This reset link is incomplete. Open the most recent link from your
            email, or request a new one.
          </Alert>
          <Link href="/forgot-password">
            <Button variant="secondary" className="w-full">
              Request a new link
            </Button>
          </Link>
        </div>
      </Card>
    );
  }

  function validate(): Errors {
    const next: Errors = {};
    if (!password) next.password = "Choose a new password.";
    else if (password.length < 8)
      next.password = "Use at least 8 characters.";
    else if (password.length > 72)
      next.password = "Passwords can be at most 72 characters.";

    if (!next.password && confirm !== password)
      next.confirm = "These two don't match.";
    return next;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      // The API signs them in on success, so there is nothing to re-enter.
      await api("/api/auth/reset-password", {
        method: "POST",
        body: { token, password },
      });
      router.push("/");
      router.refresh();
    } catch (e) {
      setFormError(
        e instanceof Error ? e.message : "Something went wrong. Try again."
      );
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {formError && <Alert>{formError}</Alert>}

        <Field
          label="New password"
          error={errors.password}
          hint="At least 8 characters."
          required
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              invalid={invalid}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) setErrors((p) => ({ ...p, password: undefined }));
              }}
            />
          )}
        </Field>

        <Field label="Confirm new password" error={errors.confirm} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirm}
              invalid={invalid}
              onChange={(e) => {
                setConfirm(e.target.value);
                if (errors.confirm) setErrors((p) => ({ ...p, confirm: undefined }));
              }}
            />
          )}
        </Field>

        <Button type="submit" loading={submitting} className="mt-1 w-full">
          Set new password
        </Button>
      </form>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <div className="animate-in">
        <div className="mb-8 flex flex-col items-center text-center">
          <SquaredMark className="h-11 w-11" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            Choose a new password
          </h1>
          <p className="mt-1 text-[15px] text-[var(--text-muted)]">
            You&apos;ll be signed in as soon as it&apos;s set.
          </p>
        </div>

        {/* useSearchParams suspends during prerendering; without this
            boundary the page cannot be statically rendered at build time. */}
        <Suspense
          fallback={
            <Card className="flex flex-col gap-4 p-6">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </Card>
          }
        >
          <ResetPasswordForm />
        </Suspense>

        <p className="mt-5 text-center text-[14px] text-[var(--text-muted)]">
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
