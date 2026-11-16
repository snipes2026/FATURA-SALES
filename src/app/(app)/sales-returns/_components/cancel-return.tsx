"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ReasonDialog } from "../../sales/_components/cancel-dialogs";
import { cancelReturnAction } from "../actions";

export function CancelReturnButton({ id, version, returnNo, consequences }: { id: number; version: number; returnNo: string; consequences: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        <Ban /> Cancel credit note
      </Button>
      <ReasonDialog
        open={open}
        title={`Cancel ${returnNo}?`}
        confirmLabel="Cancel credit note"
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
            <li>The credit note stays in the records as Cancelled; it can&apos;t be undone.</li>
          </ul>
        }
        onConfirm={(reason) =>
          start(async () => {
            const r = await cancelReturnAction({ id, version, reason });
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
