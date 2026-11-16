import "server-only";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { schema, type DB, type Tx } from "@/db";
import { fromPaise, toPaise } from "@/lib/money";

/**
 * The customer credit pool: every rupee a customer holds with us (opening Cr,
 * advances, sales-return credit) is a `customer_credits` row; every use of it is
 * a `credit_applications` row. All writes here must run inside the transaction
 * that holds the customer row lock (SELECT … FOR UPDATE on customers).
 */

export type CreditSource = (typeof schema.creditSourceEnum.enumValues)[number];
export type CreditTarget = { type: "BILL"; salesId: number } | { type: "OPENING" } | { type: "REFUND" };

export type CreditSummary = {
  /** Unused credit, paise. */
  total: number;
  /** Of which from sales returns. */
  fromReturns: number;
};

export async function creditSummary(conn: DB | Tx, customerId: number): Promise<CreditSummary> {
  const { rows } = await conn.execute<{ source_type: CreditSource; remaining: string }>(sql`
    select source_type, coalesce(sum(remaining), 0)::numeric(14,2) as remaining
    from ${schema.customerCredits}
    where customer_id = ${customerId} and reversed_at is null
    group by source_type`);
  const total = rows.reduce((a, r) => a + toPaise(r.remaining), 0);
  const fromReturns = toPaise(rows.find((r) => r.source_type === "SALES_RETURN")?.remaining ?? "0");
  return { total, fromReturns };
}

export async function addCredit(
  tx: Tx,
  p: { customerId: number; sourceType: CreditSource; sourceId: number; date: string; amount: number; userId: number | null },
) {
  if (p.amount <= 0) return null;
  const [row] = await tx
    .insert(schema.customerCredits)
    .values({
      customerId: p.customerId,
      sourceType: p.sourceType,
      sourceId: p.sourceId,
      creditDate: p.date,
      amount: fromPaise(p.amount),
      remaining: fromPaise(p.amount),
      createdBy: p.userId,
    })
    .returning({ id: schema.customerCredits.id });
  return row.id;
}

/**
 * Uses `amount` paise of the customer's credit for `target`, oldest credit first
 * (or only from `creditId` when given). Throws if there isn't enough.
 */
export async function applyCredit(
  tx: Tx,
  p: { customerId: number; amount: number; target: CreditTarget; date: string; userId: number; creditId?: number },
) {
  if (p.amount <= 0) return [];
  const credits = await tx
    .select({ id: schema.customerCredits.id, remaining: schema.customerCredits.remaining })
    .from(schema.customerCredits)
    .where(
      and(
        eq(schema.customerCredits.customerId, p.customerId),
        isNull(schema.customerCredits.reversedAt),
        gt(schema.customerCredits.remaining, "0"),
        p.creditId ? eq(schema.customerCredits.id, p.creditId) : undefined,
      ),
    )
    .orderBy(asc(schema.customerCredits.creditDate), asc(schema.customerCredits.id))
    .for("update");

  let left = p.amount;
  const applied: { creditId: number; amount: number }[] = [];
  for (const c of credits) {
    if (left <= 0) break;
    const take = Math.min(left, toPaise(c.remaining));
    if (take <= 0) continue;
    await tx
      .update(schema.customerCredits)
      .set({ remaining: sql`${schema.customerCredits.remaining} - ${fromPaise(take)}` })
      .where(eq(schema.customerCredits.id, c.id));
    await tx.insert(schema.creditApplications).values({
      creditId: c.id,
      customerId: p.customerId,
      targetType: p.target.type,
      salesId: p.target.type === "BILL" ? p.target.salesId : null,
      appliedDate: p.date,
      amount: fromPaise(take),
      createdBy: p.userId,
    });
    applied.push({ creditId: c.id, amount: take });
    left -= take;
  }
  if (left > 0) throw new Error(`Customer ${p.customerId}: not enough credit (short by ${left} paise)`);
  return applied;
}

/**
 * Reverses live applications (e.g. all applied to a bill being cancelled) and
 * puts the amounts back into their credits. Returns the total released, paise.
 */
export async function reverseApplications(tx: Tx, where: { salesId?: number; creditId?: number }, userId: number) {
  const conds = [isNull(schema.creditApplications.reversedAt)];
  if (where.salesId !== undefined) conds.push(eq(schema.creditApplications.salesId, where.salesId));
  if (where.creditId !== undefined) conds.push(eq(schema.creditApplications.creditId, where.creditId));
  const rows = await tx
    .update(schema.creditApplications)
    .set({ reversedAt: new Date(), reversedBy: userId })
    .where(and(...conds))
    .returning({ creditId: schema.creditApplications.creditId, amount: schema.creditApplications.amount });
  const byCredit = new Map<number, number>();
  for (const r of rows) byCredit.set(r.creditId, (byCredit.get(r.creditId) ?? 0) + toPaise(r.amount));
  for (const [creditId, amount] of byCredit)
    await tx
      .update(schema.customerCredits)
      .set({ remaining: sql`${schema.customerCredits.remaining} + ${fromPaise(amount)}` })
      .where(and(eq(schema.customerCredits.id, creditId), isNull(schema.customerCredits.reversedAt)));
  return [...byCredit.values()].reduce((a, b) => a + b, 0);
}

/** The live credit row for a source (e.g. the ADVANCE row of a receipt allocation). */
export async function creditFor(conn: DB | Tx, sourceType: CreditSource, sourceId: number) {
  const [c] = await conn
    .select()
    .from(schema.customerCredits)
    .where(and(eq(schema.customerCredits.sourceType, sourceType), eq(schema.customerCredits.sourceId, sourceId)));
  return c ?? null;
}

/**
 * Withdraws a credit entirely (its source was cancelled). Only allowed while none
 * of it has been used — returns the amount already used (0 = withdrawn).
 */
export async function withdrawCredit(tx: Tx, creditId: number, userId: number): Promise<number> {
  const [c] = await tx.select().from(schema.customerCredits).where(eq(schema.customerCredits.id, creditId)).for("update");
  if (!c || c.reversedAt) return 0;
  const used = toPaise(c.amount) - toPaise(c.remaining);
  if (used > 0) return used;
  await tx.update(schema.customerCredits).set({ remaining: "0", reversedAt: new Date(), reversedBy: userId }).where(eq(schema.customerCredits.id, creditId));
  return 0;
}
