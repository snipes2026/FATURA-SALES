import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { db } from "@/db";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { requirePermission } from "@/lib/session";
import { GrnEntry } from "../../_components/grn-entry";
import { loadExistingGrnProps } from "../../_lib/entry-props";
import { grnLockReason } from "../../_lib/stock";

export const metadata: Metadata = { title: "Edit GRN" };

/** Edit a saved GRN — only while none of its items has been sold or transferred. */
export default async function EditSavedGrnPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("grn.edit");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const data = await loadExistingGrnProps(user, id);
  if (!data) notFound();
  if (data.header.status === "DRAFT") redirect(`/grn/${id}`);
  if (data.header.status === "CANCELLED") redirect(`/grn/${id}`);

  const reason = await db.transaction((tx) => grnLockReason(tx, id));
  if (reason)
    return (
      <Card className="mx-auto max-w-xl">
        <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
          <Lock className="size-8 text-muted" />
          <p className="font-medium">{data.header.grnNo} can&apos;t be edited</p>
          <p className="text-sm text-muted">{reason}.</p>
          <Button variant="secondary" asChild>
            <Link href={`/grn/${id}`}>Back to the GRN</Link>
          </Button>
        </CardBody>
      </Card>
    );

  return <GrnEntry key={`${id}-${data.header.version}-edit`} {...data.props} mode="edit" canEdit />;
}
