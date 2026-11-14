import "server-only";
import type { z } from "zod";
import { db, schema, type DB, type Tx } from "@/db";
import { zodFieldErrors, type ActionResult } from "./action-result";
import type { Permission } from "./permissions";
// Session helpers are loaded inside runAction (not at import time) so the transaction helpers
// in this file (ActionError, audit) can also be used by tests that run outside Next.js.
import type { CurrentUser } from "./session";

/** Friendly messages for unique-constraint violations, keyed by constraint name. */
const UNIQUE_MESSAGES: Record<string, { field?: string; message: string }> = {
  suppliers_gstin_uq: { field: "gstin", message: "A supplier with this GSTIN already exists" },
  transports_name_unique: { field: "name", message: "A transporter with this name already exists" },
  departments_name_unique: { field: "name", message: "A department with this name already exists" },
  locations_name_unique: { field: "name", message: "A location with this name already exists" },
  users_username_unique: { field: "username", message: "This username is taken" },
  category_values_slot_value_uq: { field: "value", message: "This value already exists" },
  customers_gstin_uq: { field: "gstin", message: "A customer with this GSTIN already exists" },
  grn_header_supplier_invoice_uq:{ field: "invoiceNo", message: "This invoice is already entered for this supplier" },
};

function pgError(err: unknown): { code?: string; constraint?: string } | null {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  if (e?.code) return e;
  if (e?.cause?.code) return e.cause;
  return null;
}

/** Thrown inside an action to return a clean validation error. */
export class ActionError extends Error {
  constructor(
    message: string,
    public field?: string,
    public code?: "CONFLICT" | "NOT_FOUND" | "MISMATCH",
  ) {
    super(message);
  }
}

export const CONFLICT_MESSAGE = "This GRN was modified by another user. Reload to see the latest version, then make your changes again.";

/**
 * Wraps a server action: checks the permission, validates input with zod,
 * and turns known errors into an ActionResult instead of a crash.
 */
export async function runAction<S extends z.ZodType, R = undefined>(
  permission: Permission,
  schemaDef: S,
  raw: unknown,
  fn: (input: z.output<S>, user: CurrentUser) => Promise<ActionResult<R>>,
): Promise<ActionResult<R>> {
  const { assertPermission, AuthError } = await import("./session");
  try {
    const user = await assertPermission(permission);
    const parsed = schemaDef.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
    return await fn(parsed.data, user);
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, error: err.message };
    if (err instanceof ActionError)
      return { ok: false, error: err.message, code: err.code, fieldErrors: err.field ? { [err.field]: err.message } : undefined };
    const pg = pgError(err);
    if (pg?.code === "23505") {
      const m = (pg.constraint && UNIQUE_MESSAGES[pg.constraint]) || { message: "This record already exists." };
      return { ok: false, error: m.message, fieldErrors: m.field ? { [m.field]: m.message } : undefined };
    }
    console.error("[action]", err);
    return { ok: false, error: "Something went wrong while saving. Please try again." };
  }
}

/** Writes one audit_log row (inside the caller's transaction when given). */
export async function audit(
  conn: DB | Tx,
  entry: {
    userId: number;
    table: string;
    recordId: string | number;
    action: "CREATE" | "UPDATE" | "DELETE" | "CANCEL";
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string;
  },
) {
  await conn.insert(schema.auditLog).values({
    userId: entry.userId,
    tableName: entry.table,
    recordId: String(entry.recordId),
    action: entry.action,
    oldJson: stripSecrets(entry.oldValue),
    newJson: stripSecrets(entry.newValue),
    reason: entry.reason,
  });
}

function stripSecrets(v: unknown) {
  if (!v || typeof v !== "object") return v ?? null;
  const { passwordHash: _p, password: _q, ...rest } = v as Record<string, unknown>;
  return rest;
}

export { db };
