import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { GrnEntry } from "../_components/grn-entry";
import { loadExistingGrnProps } from "../_lib/entry-props";

export const metadata: Metadata = { title: "GRN" };

/** Drafts open for editing; saved and cancelled GRNs open read-only (Edit is a separate page). */
export default async function GrnPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("grn.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const data = await loadExistingGrnProps(user, id);
  if (!data) notFound();
  const isDraft = data.header.status === "DRAFT";

  return (
    <GrnEntry
      key={`${id}-${data.header.version}`}
      {...data.props}
      mode={isDraft ? "entry" : "view"}
      canEdit={isDraft && can(user.role, "grn.create")}
    />
  );
}
