"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, Pencil, Printer, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteGrnDialog } from "./delete-grn-dialog";

/** View / Print / Edit / Delete for one row of the GRN list. */
export function GrnRowActions({
  grn,
  canEditSaved,
  canEditDraft,
  canDelete,
}: {
  grn: { id: number; version: number; status: "DRAFT" | "SAVED" | "CANCELLED"; label: string; totalQty: number };
  canEditSaved: boolean;
  canEditDraft: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [del, setDel] = useState(false);
  const editHref = grn.status === "SAVED" ? `/grn/${grn.id}/edit` : `/grn/${grn.id}`;
  const canEdit = grn.status === "SAVED" ? canEditSaved : grn.status === "DRAFT" && canEditDraft;

  return (
    <span className="inline-flex items-center">
      <Button variant="ghost" size="sm" asChild title="View">
        <Link href={`/grn/${grn.id}`} aria-label={`View ${grn.label}`}>
          <Eye />
        </Link>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        title="Print GRN (A4)"
        aria-label={`Print ${grn.label}`}
        onClick={() => window.open(`/print/grn/${grn.id}?auto=1`, "_blank", "noopener")}
      >
        <Printer />
      </Button>
      {canEdit && (
        <Button variant="ghost" size="sm" asChild title="Edit">
          <Link href={editHref} aria-label={`Edit ${grn.label}`}>
            <Pencil />
          </Link>
        </Button>
      )}
      {canDelete && grn.status !== "CANCELLED" && (
        <Button variant="ghost" size="sm" title="Delete" aria-label={`Delete ${grn.label}`} onClick={() => setDel(true)}>
          <Trash2 className="text-danger" />
        </Button>
      )}
      <DeleteGrnDialog
        open={del}
        onClose={() => setDel(false)}
        onDeleted={() => {
          setDel(false);
          router.refresh();
        }}
        grn={{ id: grn.id, version: grn.version, label: grn.label, saved: grn.status === "SAVED", totalQty: grn.totalQty }}
      />
    </span>
  );
}
