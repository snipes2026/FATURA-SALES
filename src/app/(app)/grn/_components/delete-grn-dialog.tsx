"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError, Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { cancelGrn } from "../actions";

/**
 * Delete GRN = soft delete. A reason is mandatory; a saved GRN's stock is
 * reversed. Used from the entry screen and from the GRN list.
 */
export function DeleteGrnDialog({
  open,
  onClose,
  onDeleted,
  grn,
}: {
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
  grn: { id: number; version: number; label: string; saved: boolean; totalQty?: number };
}) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  useEffect(() => {
    if (open) {
      setReason("");
      setError(undefined);
    }
  }, [open]);

  const submit = () => {
    if (reason.trim().length < 5) {
      setError("Enter a reason (at least 5 characters)");
      return;
    }
    start(async () => {
      const r = await cancelGrn({ id: grn.id, version: grn.version, reason });
      if (r.ok) {
        toast.success(r.message ?? "GRN deleted");
        onDeleted();
      } else {
        setError(r.fieldErrors?.reason ?? r.error);
        if (r.error && !r.fieldErrors?.reason) toast.error(r.error);
      }
    });
  };

  return (
    <Modal
      open={open}
      title={`Delete ${grn.label}?`}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep GRN
          </Button>
          <Button variant="danger" onClick={submit} disabled={pending}>
            <Trash2 /> {pending ? "Deleting…" : "Delete GRN"}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <p>
          {grn.saved
            ? `The GRN is marked Cancelled and its stock${grn.totalQty ? ` (${grn.totalQty} pcs)` : ""} is reversed. The GRN number is not reused.`
            : "The draft is marked Cancelled. Barcodes already given to its items stay reserved for those items."}{" "}
          This can&apos;t be undone.
        </p>
      </div>
      <Label htmlFor="cancel-reason" required>
        Reason
      </Label>
      <textarea
        id="cancel-reason"
        rows={3}
        maxLength={500}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          setError(undefined);
        }}
        placeholder="e.g. Entered against the wrong supplier"
        className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
      <FieldError>{error}</FieldError>
    </Modal>
  );
}
