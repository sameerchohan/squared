"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Skeleton,
} from "@/components/ui";
import {
  ArrowRightIcon,
  CardIcon,
  CheckIcon,
  PlusIcon,
  UsersIcon,
} from "@/components/icons";
import { api, UnauthorizedError } from "@/lib/client";

type Me = {
  id: string;
  email: string;
  name: string;
  stripeOnboardingStatus: string;
};
type GroupSummary = {
  id: string;
  name: string;
  createdAt: string;
  memberCount: number;
};

export default function HomePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<{ user: Me }>("/api/auth/me"),
      api<{ groups: GroupSummary[] }>("/api/groups"),
    ])
      .then(([meRes, groupsRes]) => {
        if (cancelled) return;
        setMe(meRes.user);
        setGroups(groupsRes.groups);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        setError(e instanceof Error ? e.message : "Couldn't load your groups.");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, router]);

  if (!me || groups === null) {
    return (
      <div className="mx-auto w-full max-w-5xl px-5 py-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-6 h-24 w-full" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );
  }

  return (
    <AppShell user={me}>
      <div className="animate-in">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Your groups</h1>
            <p className="mt-1 text-[14px] text-[var(--text-muted)]">
              {groups.length === 0
                ? "Create a group to start tracking shared expenses."
                : `${groups.length} group${groups.length === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-5">
            <Alert>{error}</Alert>
          </div>
        )}

        <PaymentSetupCard status={me.stripeOnboardingStatus} onChanged={reload} />

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader
              title="Groups"
              description="Everyone you split expenses with."
            />
            {groups.length === 0 ? (
              <EmptyState
                icon={<UsersIcon className="h-5 w-5" />}
                title="No groups yet"
                description="A group is where you and your friends log shared expenses. Create one to get started."
              />
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {groups.map((g) => (
                  <li key={g.id}>
                    <Link
                      href={`/groups/${g.id}`}
                      className="group flex items-center justify-between gap-4 px-5 py-4 transition-colors duration-150 hover:bg-[var(--surface-subtle)]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-medium">{g.name}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]">
                          <UsersIcon className="h-3.5 w-3.5" />
                          {g.memberCount} member{g.memberCount === 1 ? "" : "s"}
                        </p>
                      </div>
                      <ArrowRightIcon className="h-4 w-4 shrink-0 text-[var(--text-faint)] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[var(--brand)]" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <CreateGroupCard onCreated={reload} />
        </div>
      </div>
    </AppShell>
  );
}

function CreateGroupCard({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [justCreated, setJustCreated] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!name.trim()) {
      setFieldError("Give the group a name.");
      return;
    }
    setFieldError(undefined);
    setSubmitting(true);
    try {
      await api("/api/groups", { method: "POST", body: { name: name.trim() } });
      setName("");
      onCreated();
      // A brief confirmation so the action visibly succeeded, rather than the
      // field simply going blank.
      setJustCreated(true);
      setTimeout(() => setJustCreated(false), 2500);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Couldn't create the group.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="h-fit">
      <CardHeader title="New group" description="Trip, apartment, dinner club." />
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 p-5">
        {formError && <Alert>{formError}</Alert>}
        {justCreated && (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--positive)]/25 bg-[var(--positive-subtle)] px-3 py-2 text-[13px] text-[var(--positive)]">
            <CheckIcon className="h-4 w-4" />
            Group created.
          </div>
        )}

        <Field label="Group name" error={fieldError} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              placeholder="Barcelona trip"
              maxLength={100}
              value={name}
              invalid={invalid}
              onChange={(e) => {
                setName(e.target.value);
                if (fieldError) setFieldError(undefined);
              }}
            />
          )}
        </Field>

        <Button type="submit" loading={submitting} className="w-full">
          <PlusIcon className="h-4 w-4" />
          Create group
        </Button>
      </form>
    </Card>
  );
}

const STATUS_COPY: Record<
  string,
  { tone: "warning" | "positive" | "negative"; label: string; detail: string; action: string | null }
> = {
  not_started: {
    tone: "warning",
    label: "Payments not set up",
    detail:
      "Connect a payout account to receive money when someone settles up with you. You can still log expenses and pay others without it.",
    action: "Set up payments",
  },
  pending: {
    tone: "warning",
    label: "Setup in progress",
    detail:
      "Stripe still needs a few details before you can receive money. Picking up where you left off takes about a minute.",
    action: "Finish setup",
  },
  restricted: {
    tone: "negative",
    label: "Payments restricted",
    detail:
      "Stripe needs more information before you can receive money. Until it's resolved, others can't settle up with you.",
    action: "Review with Stripe",
  },
  active: {
    tone: "positive",
    label: "Payments active",
    detail: "You're set up to receive money when someone settles up with you.",
    action: null,
  },
};

function PaymentSetupCard({
  status,
  onChanged,
}: {
  status: string;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const copy = STATUS_COPY[status] ?? STATUS_COPY.not_started;

  async function startOnboarding() {
    setError(null);
    setStarting(true);
    try {
      const { url } = await api<{ url: string }>("/api/stripe/onboard", {
        method: "POST",
      });
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach Stripe.");
      setStarting(false);
    }
  }

  // Webhooks drive status normally; this covers a missed delivery or local
  // development without a forwarder running.
  async function refreshStatus() {
    setError(null);
    setSyncing(true);
    try {
      await api("/api/stripe/sync", { method: "POST" });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't refresh status.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Card className="mt-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3">
          <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--surface-subtle)] text-[var(--text-muted)]">
            <CardIcon className="h-4.5 w-4.5" />
          </div>
          <div className="max-w-xl">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold tracking-tight">{copy.label}</h2>
              <Badge tone={copy.tone}>
                {status === "active" && <CheckIcon className="h-3 w-3" />}
                {status.replace("_", " ")}
              </Badge>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
              {copy.detail}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          {status !== "not_started" && (
            <Button variant="secondary" size="sm" onClick={refreshStatus} loading={syncing}>
              Refresh
            </Button>
          )}
          {copy.action && (
            <Button size="sm" onClick={startOnboarding} loading={starting}>
              {copy.action}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
    </Card>
  );
}

