import { ZodError } from "zod";
import { SplitError } from "@/lib/splits";

/**
 * Stripe failures fall into three groups that deserve different answers:
 * the platform is misconfigured, the caller's request was wrong, or Stripe
 * is unreachable. Collapsing all three into a 500 hides which one happened
 * and leaves the user with nothing to act on.
 */
function stripeErrorResponse(error: unknown): Response | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("type" in error) ||
    typeof (error as { type?: unknown }).type !== "string" ||
    !(error as { type: string }).type.startsWith("Stripe")
  ) {
    return null;
  }

  const { type, message } = error as { type: string; message?: string };
  // Always logged in full; only a safe summary is returned.
  console.error(`Stripe ${type}:`, message);

  switch (type) {
    case "StripeCardError":
      return Response.json(
        { error: message ?? "That payment method was declined." },
        { status: 402 }
      );
    case "StripeRateLimitError":
      return Response.json(
        { error: "Too many requests to Stripe — try again in a moment." },
        { status: 429 }
      );
    case "StripeConnectionError":
    case "StripeAPIError":
      return Response.json(
        { error: "Stripe is unreachable right now. Try again shortly." },
        { status: 503 }
      );
    case "StripeAuthenticationError":
    case "StripePermissionError":
    case "StripeInvalidRequestError":
      // A misconfigured platform, not a bad user request: the caller can do
      // nothing about it, so say so plainly rather than blaming their input.
      return Response.json(
        {
          error:
            "Payments aren't fully configured on this server yet. The server log has the details.",
        },
        { status: 503 }
      );
    default:
      return null;
  }
}

/** An error with an HTTP status, thrown from anywhere below a route handler. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

type Handler<Ctx> = (req: Request, ctx: Ctx) => Promise<Response>;

/**
 * Wraps a route handler so domain errors become clean JSON responses:
 * ApiError keeps its status, validation errors (Zod, SplitError) become 400,
 * anything else is logged and returned as an opaque 500.
 */
export function apiHandler<Ctx>(handler: Handler<Ctx>): Handler<Ctx> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (error) {
      if (error instanceof ApiError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      if (error instanceof SplitError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      if (error instanceof ZodError) {
        const issue = error.issues[0];
        const path = issue.path.join(".");
        return Response.json(
          { error: path ? `${path}: ${issue.message}` : issue.message },
          { status: 400 }
        );
      }
      const stripeResponse = stripeErrorResponse(error);
      if (stripeResponse) return stripeResponse;

      console.error("Unhandled API error:", error);
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

/** True when a Postgres error is a unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505"
  );
}
