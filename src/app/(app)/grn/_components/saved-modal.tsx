"use client";

import { CheckCircle2, FilePlus2, Printer, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

export const labelLayout = () => {
  try {
    return localStorage.getItem("fd.labelLayout") === "a4" ? "a4" : "thermal";
  } catch {
    return "thermal";
  }
};

/** Shown after Save GRN: Print GRN (A4), Print Labels, New GRN. */
export function SavedModal({
  info,
  onClose,
  onNew,
}: {
  info: { id: number; grnNo: string; totalQty: number; edited: boolean } | null;
  onClose: () => void;
  onNew: () => void;
}) {
  if (!info) return null;
  const open = (url: string) => window.open(url, "_blank", "noopener");
  return (
    <Modal open title={info.edited ? "GRN updated" : "GRN saved"} onClose={onClose} width={460}>
      <div className="flex flex-col items-center py-2 text-center">
        <CheckCircle2 className="size-12 text-success" />
        <p className="mt-3 font-mono text-xl font-semibold">{info.grnNo}</p>
        <p className="mt-1 text-sm text-muted">
          {info.totalQty.toLocaleString("en-IN")} pcs {info.edited ? "re-posted to" : "added to"} stock
        </p>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Button variant="secondary" onClick={() => open(`/print/grn/${info.id}?auto=1`)} data-autofocus>
          <Printer /> Print GRN
        </Button>
        <Button variant="secondary" onClick={() => open(`/print/grn/${info.id}/labels?layout=${labelLayout()}&c=all&auto=1`)}>
          <Tags /> Print Labels
        </Button>
        <Button onClick={onNew}>
          <FilePlus2 /> New GRN
        </Button>
      </div>
      <button type="button" onClick={onClose} className="mt-4 w-full text-center text-sm text-primary hover:underline">
        Close and view the GRN
      </button>
    </Modal>
  );
}
