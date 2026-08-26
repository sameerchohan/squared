import { ZodError } from "zod";
import { SplitError } from "@/lib/splits";

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
