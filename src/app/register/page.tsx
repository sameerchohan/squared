"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { SquaredMark } from "@/components/icons";
import { api } from "@/lib/client";

type Errors = { name?: string; email?: string; password?: string };

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): Errors {
    const next: Errors = {};
    if (!name.trim()) next.name = "Enter your name.";
    if (!email.trim()) next.email = "Enter your email address.";
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))
      next.email = "That doesn't look like a valid email address.";
    if (password.length < 8)
      next.password = "Use at least 8 characters.";
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
      await api("/api/auth/register", {
        method: "POST",
        body: { name: name.trim(), email: email.trim(), password },
      });
      router.push("/");
      router.refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <div className="animate-in">
        <div className="mb-8 flex flex-col items-center text-center">
          <SquaredMark className="h-11 w-11" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Create your account</h1>
          <p className="mt-1 text-[15px] text-[var(--text-muted)]">
            Split expenses with friends and settle up for real.
          </p>
        </div>

        <Card className="p-6">
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            {formError && <Alert>{formError}</Alert>}

            <Field label="Name" error={errors.name} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  autoComplete="name"
                  placeholder="Alex Rivera"
                  maxLength={100}
                  value={name}
                  invalid={invalid}
                  onChange={(e) => setName(e.target.value)}
                  // Validation clears as soon as the field becomes valid, and
                  // is re-checked on blur rather than on every keystroke.
                  onBlur={() => setErrors((p) => ({ ...p, name: validate().name }))}
                />
              )}
            </Field>

            <Field label="Email" error={errors.email} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  invalid={invalid}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setErrors((p) => ({ ...p, email: validate().email }))}
                />
              )}
            </Field>

            <Field
              label="Password"
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
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => setErrors((p) => ({ ...p, password: validate().password }))}
                />
              )}
            </Field>

            <Button type="submit" loading={submitting} className="mt-1 w-full">
              Create account
            </Button>
          </form>
        </Card>

        <p className="mt-5 text-center text-[14px] text-[var(--text-muted)]">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-[var(--brand)] underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
