import { requireUserId } from "@/server/auth";
import { requireGroupMember } from "@/server/authz";
import { apiHandler, ApiError } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import {
  isScanConfigured,
  MAX_SCAN_BYTES,
  SCANNABLE_TYPES,
  scanReceipt,
} from "@/server/receipt-scan";

/** Whether the button should be offered at all. */
export const GET = apiHandler(
  async (_req, ctx: RouteContext<"/api/groups/[groupId]/receipt-scan">) => {
    const userId = await requireUserId();
    const { groupId } = await ctx.params;
    await requireGroupMember(userId, groupId);
    return Response.json({ enabled: isScanConfigured() });
  }
);

export const POST = apiHandler(
  async (req, ctx: RouteContext<"/api/groups/[groupId]/receipt-scan">) => {
    const userId = await requireUserId();
    const { groupId } = await ctx.params;
    await requireGroupMember(userId, groupId);

    // Unlike the rest of the app, every one of these costs real money, so it
    // is limited per person rather than per address: a shared restaurant wifi
    // would otherwise put the whole table in one bucket.
    enforceRateLimit(`receipt-scan:${userId}`, 30, 60 * 60 * 1000);

    const form = await req.formData().catch(() => null);
    const image = form?.get("image");
    if (!(image instanceof File) || image.size === 0) {
      throw new ApiError(400, "No photo was uploaded");
    }
    if (image.size > MAX_SCAN_BYTES) {
      throw new ApiError(413, "That photo is too big. Try taking it again.");
    }
    if (!(SCANNABLE_TYPES as readonly string[]).includes(image.type)) {
      throw new ApiError(415, "That file isn't a photo Squared can read.");
    }

    const bytes = Buffer.from(await image.arrayBuffer());
    // The photo is read and dropped. Nothing is stored: a receipt carries the
    // last four of a card and where somebody was, and keeping it would mean
    // holding both for no benefit once the amounts are out.
    const receipt = await scanReceipt(
      bytes.toString("base64"),
      image.type as (typeof SCANNABLE_TYPES)[number]
    );

    return Response.json({ receipt });
  }
);
