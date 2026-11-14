import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { uploadUrl } from "@/lib/uploads";
import { CompanyForm } from "./company-form";

export const metadata: Metadata = { title: "Company Profile" };

export default async function CompanyPage() {
  const [row] = await db.select().from(schema.companyProfile).where(eq(schema.companyProfile.id, 1));
  return (
    <CompanyForm
      initial={{
        name: row?.name ?? "",
        address: row?.address ?? "",
        gstin: row?.gstin ?? "",
        stateCode: row?.stateCode ?? "",
        phone: row?.phone ?? "",
        email: row?.email ?? "",
      }}
      logoUrl={uploadUrl(row?.logoPath)}
    />
  );
}
