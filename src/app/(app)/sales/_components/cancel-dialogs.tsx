"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { cancelReceiptAction, cancelSaleAction } from "../actions";

/** Mandatory-reason dialog shared by bill, receipt and credit note cancel. */
export function ReasonDialog({
  open,
  title,
  body,
  confirmLabel,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  pending: boolean;
  error: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= 5;
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Keep it
          </Button>
          <Button variant="danger" disabled={!ok || pending} onClick={() => onConfirm(reason.trim())}>
            {pending ? "Cancelling…" : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {body}
        <label className="block">
          <span className="mb-1 block font-medium">
            Reason <span className="text-danger">*</span>
          </span>
          <textarea
            autoFocus
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md border border-border px-2 py-1.5 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="Why is this being cancelled? (at least 5 characters)"
          />
        </label>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

export function CancelSaleButton({ id, version, billNo, consequences }: { id: number; version: number; billNo: string; consequences: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        <Ban /> Cancel bill
      </Button>
      <ReasonDialog
        open={open}
        title={`Cancel ${billNo}?`}
        confirmLabel="Cancel bill"
        pending={pending}
        error={error}
        onClose={() => {
          setOpen(false);
          setError(null);
        }}
        body={
          <ul className="list-disc space-y-1 pl-5 text-muted">
            {consequences.map((c) => (
              <li key={c}>{c}</li>
            ))}
            <li>The bill stays in the records as Cancelled; it can&apos;t be undone.</li>
          </ul>
        }
        onConfirm={(reason) =>
          start(async () => {
            const r = await cancelSaleAction({ id, version, reason });
            if (!r.ok) return setError(r.error ?? "Could not cancel");
            toast.success(r.message ?? "Cancelled");
            setOpen(false);
            router.refresh();
          })
        }
      />
    </>
  );
}

export function CancelReceiptButton({ id, receiptNo, amount }: { id: number; receiptNo: string; amount: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="ghost" size="sm" className="text-danger" onClick={() => setOpen(true)}>
        Cancel receipt
      </Button>
      <ReasonDialog
        open={open}
        title={`Cancel receipt ${receiptNo}?`}
        confirmLabel="Cancel receipt"
        pending={pending}
        error={error}
        onClose={() => {
          setOpen(false);
          setError(null);
        }}
        body={
          <p className="text-muted">
            ₹{amount} goes back on the customer&apos;s balance (every bill it paid becomes pending again) and is taken out of cash/bank.
          </p>
        }
        onConfirm={(reason) =>
          start(async () => {
            const r = await cancelReceiptAction({ id, reason });
            if (!r.ok) return setError(r.error ?? "Could not cancel");
            toast.success(r.message ?? "Cancelled");
            setOpen(false);
            router.refresh();
          })
        }
      />
    </>
  );
}
