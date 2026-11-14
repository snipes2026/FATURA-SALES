"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { audit, db, runAction } from "@/lib/server-action";
import { assertPermission, AuthError } from "@/lib/session";
import { deleteUpload, saveImage } from "@/lib/uploads";
import { companySchema } from "@/lib/validation/masters";

export async function saveCompany(raw: unknown): Promise<ActionResult> {
  return runAction("settings.manage", companySchema, raw, async (input, user) => {
    await db.transaction(async (tx) => {
      const [old] = await tx.select().from(schema.companyProfile).where(eq(schema.companyProfile.id, 1));
      await tx
        .insert(schema.companyProfile)
        .values({ id: 1, ...input })
        .onConflictDoUpdate({ target: schema.companyProfile.id, set: input });
      await audit(tx, { userId: user.id, table: "company_profile", recordId: 1, action: old ? "UPDATE" : "CREATE", oldValue: old, newValue: input });
    });
    revalidatePath("/settings/company");
    return { ok: true, message: "Company profile saved" };
  });
}

export async function uploadLogo(formData: FormData): Promise<ActionResult<{ logoPath: string }>> {
  try {
    const user = await assertPermission("settings.manage");
    const file = formData.get("logo");
    if (!(file instanceof File)) return { ok: false, error: "Choose an image" };
    const [row] = await db.select().from(schema.companyProfile).where(eq(schema.companyProfile.id, 1));
    if (!row) return { ok: false, error: "Save the company name first" };

    const logoPath = await saveImage(file, "company", 2 * 1024 * 1024);
    await db.update(schema.companyProfile).set({ logoPath }).where(eq(schema.companyProfile.id, 1));
    await audit(db, { userId: user.id, table: "company_profile", recordId: 1, action: "UPDATE", oldValue: { logoPath: row.logoPath }, newValue: { logoPath } });
    await deleteUpload(row.logoPath);
    revalidatePath("/settings/company");
    return { ok: true, data: { logoPath }, message: "Logo updated" };
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Upload failed" };
  }
}

export async function removeLogo(): Promise<ActionResult> {
  try {
    const user = await assertPermission("settings.manage");
    const [row] = await db.select().from(schema.companyProfile).where(eq(schema.companyProfile.id, 1));
    if (!row?.logoPath) return { ok: true };
    await db.update(schema.companyProfile).set({ logoPath: null }).where(eq(schema.companyProfile.id, 1));
    await audit(db, { userId: user.id, table: "company_profile", recordId: 1, action: "UPDATE", oldValue: { logoPath: row.logoPath }, newValue: { logoPath: null } });
    await deleteUpload(row.logoPath);
    revalidatePath("/settings/company");
    return { ok: true, message: "Logo removed" };
  } catch (err) {
    return { ok: false, error: err instanceof AuthError ? err.message : "Couldn't remove the logo" };
  }
}
