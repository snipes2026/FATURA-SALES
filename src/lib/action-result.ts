import type { z } from "zod";

/** Result shape returned by every server action (safe to share with the client). */
export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error?: string; fieldErrors?: Record<string, string>; code?: "CONFLICT" | "NOT_FOUND" | "MISMATCH" };

/** First error message per field path ("locationIds", "slabThreshold", …). */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
