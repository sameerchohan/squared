import { destroySession } from "@/server/auth";
import { apiHandler } from "@/server/errors";

export const POST = apiHandler(async () => {
  await destroySession();
  return Response.json({ ok: true });
});
