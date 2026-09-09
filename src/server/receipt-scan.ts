// Reading a photo of a receipt into line items.
//
// The model transcribes; it never works anything out. Every amount comes back
// exactly as printed and every field that is not on the paper comes back null,
// because a plausible guess is worse than a gap: a gap is visible and a guess
// is not. What the numbers then mean is decided by the same arithmetic that
// handles a hand-typed bill, and checked against the printed total before
// anybody is charged.
//
// Who ordered what is never asked for. It is not on a receipt, so no amount of
// model quality would supply it; assigning items stays a person's job.

import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { parseDollarsToCents } from "@/lib/format";
import type { ScannedReceipt } from "@/lib/scanned-receipt";
import { ApiError } from "./errors";

export const SCAN_MODEL = "gpt-4o-mini";

/** Images this accepts, and what the vision API will take. */
export const SCANNABLE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export const MAX_SCAN_BYTES = 5 * 1024 * 1024;

const printedAmount = z
  .string()
  .describe(
    'The amount exactly as printed: digits with at most two decimal places, like "12.34". No currency symbol, no sign, no thousands separator.'
  );

const scannedReceiptSchema = z.object({
  items: z
    .array(
      z.object({
        label: z
          .string()
          .describe(
            'What the line is called on the receipt. If it shows a quantity, keep it in the name, like "Beer x2".'
          ),
        amount: printedAmount.describe(
          "What that whole line costs, as printed at the end of it."
        ),
      })
    )
    .describe(
      "Every line that is something ordered or bought, in the order printed. Never subtotal, tax, tip, service charge, discounts or the total."
    ),
  subtotal: printedAmount.nullable(),
  tax: printedAmount.nullable(),
  tip: printedAmount.nullable(),
  total: printedAmount.nullable(),
});

const SYSTEM = `You read photographs of receipts and transcribe them.

Transcribe only. Never calculate, correct, complete or infer anything: if a
value is not printed on the receipt, return null for it rather than working it
out from the other numbers.

- items: every line that is something ordered or bought. Never the subtotal,
  tax, tip, service charge, discounts, or the total, which have their own
  fields.
- When a line shows a quantity, keep the quantity in the label and give the
  price printed for that whole line.
- Amounts are exactly as printed, with no currency symbol and no sign.
- Tips are often handwritten. If a handwritten figure is not clearly legible,
  return null for it rather than a best guess.
- If the photograph is not a receipt, or is too unclear to read, return an
  empty items list and null for every other field.`;

/** A printed amount into cents, or null if it isn't one we can trust. */
function readAmount(printed: string | null): number | null {
  if (printed == null) return null;
  const cents = parseDollarsToCents(printed.trim());
  // Anything the model returned that is not a plain amount is dropped rather
  // than coerced. A dropped figure shows up as a gap on screen; a coerced one
  // would quietly become somebody's share.
  return cents === null ? null : cents;
}

export function isScanConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function scanReceipt(
  imageBase64: string,
  mediaType: (typeof SCANNABLE_TYPES)[number]
): Promise<ScannedReceipt> {
  if (!isScanConfigured()) {
    throw new ApiError(
      503,
      "Receipt scanning isn't switched on yet. Enter the amounts by hand for now."
    );
  }

  const client = new OpenAI();

  let completion;
  try {
    completion = await client.chat.completions.parse({
      model: SCAN_MODEL,
      // Structured outputs: the model is constrained to this shape, so what
      // comes back is either schema-valid or an outright refusal. There is no
      // half-parsed middle case to defend against.
      response_format: zodResponseFormat(scannedReceiptSchema, "receipt"),
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe this receipt." },
            {
              type: "image_url",
              image_url: {
                url: `data:${mediaType};base64,${imageBase64}`,
                // Receipt text is small and often faint. Low detail downsamples
                // far enough to lose digits, which is the one thing that must
                // not happen here.
                detail: "high",
              },
            },
          ],
        },
      ],
    });
  } catch (error) {
    if (error instanceof OpenAI.AuthenticationError) {
      throw new ApiError(503, "Receipt scanning is not set up correctly.");
    }
    if (error instanceof OpenAI.RateLimitError) {
      throw new ApiError(429, "Too many receipts at once. Try again shortly.");
    }
    if (error instanceof OpenAI.APIConnectionError) {
      throw new ApiError(503, "Couldn't reach the receipt reader. Try again.");
    }
    if (error instanceof OpenAI.APIError) {
      throw new ApiError(502, "The receipt reader failed. Try again.");
    }
    throw error;
  }

  const message = completion.choices[0]?.message;
  if (message?.refusal) {
    throw new ApiError(422, "That photo couldn't be read as a receipt.");
  }

  const parsed = message?.parsed;
  if (!parsed) {
    throw new ApiError(422, "Couldn't read that photo. Try a clearer one.");
  }

  return {
    items: parsed.items.flatMap((item) => {
      const cents = readAmount(item.amount);
      if (cents === null) return [];
      return [{ label: item.label.trim().slice(0, 60), amountCents: cents }];
    }),
    subtotalCents: readAmount(parsed.subtotal),
    taxCents: readAmount(parsed.tax),
    tipCents: readAmount(parsed.tip),
    totalCents: readAmount(parsed.total),
  };
}
