"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, Ban, CheckCircle2, Lock, Pencil, Printer, RefreshCw, Save, Trash2 } from "lucide-react";
import { TopbarSlot } from "@/components/shell/topbar-slot";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { zodFieldErrors } from "@/lib/action-result";
import { enterToNext } from "@/lib/keyboard";
import { calcGrn, invoiceMismatchMessage } from "@/lib/grn-calc";
import { formatAmount } from "@/lib/india";
import { fromPaise, MONEY_RE, toPaise } from "@/lib/money";
import {
  emptySummary,
  grnHeaderSchema,
  grnSummarySchema,
  MAX_LINES,
  summaryCalcOptions,
  type GrnHeaderForm,
  type GrnLineForm,
  type GrnSummaryForm,
} from "@/lib/validation/grn";
import { checkDuplicateInvoice, generateBarcodes, saveGrn, saveGrnDraft } from "../actions";
import { DeleteGrnDialog } from "./delete-grn-dialog";
import { SavedModal } from "./saved-modal";
import { LabelsModal } from "./labels-modal";
import type { EntryMasters } from "../_lib/load";
import { HeaderCard } from "./header-card";
import { ItemPanel, type Editing } from "./item-panel";
import { ItemsGrid } from "./items-grid";
import { QuickSupplierModal, type NewSupplier } from "./quick-supplier-modal";
import { SummaryCard } from "./summary-card";

type Status = "DRAFT" | "SAVED" | "CANCELLED";
type Field = keyof GrnHeaderForm;

/** Pending (not yet populated) items survive the redirect after the first draft save. */
const HANDOFF_KEY = "fd.pendingHandoff";
/** Result of the last Save GRN, shown in the success modal. */
const SAVED_KEY = "fd.lastSavedGrn";
const clearSavedKey = () => {
  try {
    sessionStorage.removeItem(SAVED_KEY);
  } catch {
    /* ignore */
  }
};

export function GrnEntry({
  id,
  version: initialVersion,
  status = "DRAFT",
  grnNo = null,
  masters: initialMasters,
  initial,
  initialLines = [],
  initialSummary,
  canEdit,
  canQuickAddSupplier,
  canAddCategoryValue,
  canGenerateBarcode,
  mode = "entry",
  canSave = false,
  canDelete = false,
  canEditSaved = false,
  cancelInfo,
}: {
  id?: number;
  version?: number;
  status?: Status;
  grnNo?: string | null;
  masters: EntryMasters;
  initial: GrnHeaderForm;
  initialLines?: GrnLineForm[];
  initialSummary?: GrnSummaryForm;
  canEdit: boolean;
  canQuickAddSupplier: boolean;
  canAddCategoryValue: boolean;
  canGenerateBarcode: boolean;
  /** entry = new/draft, view = read-only saved/cancelled, edit = editing a saved GRN */
  mode?: "entry" | "view" | "edit";
  canSave?: boolean;
  canDelete?: boolean;
  canEditSaved?: boolean;
  cancelInfo?: { reason: string | null; at: string | null; by: string | null };
}) {
  const router = useRouter();
  const toast = useToast();
  const [masters, setMasters] = useState(initialMasters);
  const [values, setValues] = useState<GrnHeaderForm>(initial);
  const [lines, setLines] = useState<GrnLineForm[]>(initialLines);
  const [pending, setPending] = useState<GrnLineForm[]>([]);
  const [editing, setEditing] = useState<Editing>(null);
  const [summary, setSummary] = useState<GrnSummaryForm>(() => initialSummary ?? emptySummary());
  const [saved, setSaved] = useState(() => JSON.stringify({ h: initial, l: initialLines, s: initialSummary ?? emptySummary() }));
  const [version, setVersion] = useState(initialVersion);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<Field, string>>>({});
  const [dupError, setDupError] = useState<string>();
  const [conflict, setConflict] = useState<string>();
  const [quickAdd, setQuickAdd] = useState<{ open: boolean; name: string }>({ open: false, name: "" });
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [removeUid, setRemoveUid] = useState<string | null>(null);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saveWarnings, setSaveWarnings] = useState<string[] | null>(null);
  const [mismatchAttempted, setMismatchAttempted] = useState(false);
  const [success, setSuccess] = useState<{ id: number; grnNo: string; totalQty: number; edited: boolean } | null>(null);
  const [saving, startSave] = useTransition();
  const submitItemRef = useRef<(() => void) | null>(null);

  const disabled = !canEdit || !!conflict;
  const dirty = JSON.stringify({ h: values, l: lines, s: summary }) !== saved || pending.length > 0;

  // ---- show the "GRN saved" modal again if the screen remounted right after Save GRN
  useEffect(() => {
    if (!id) return;
    try {
      const raw = sessionStorage.getItem(SAVED_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { id: number; grnNo: string; totalQty: number; edited: boolean; at?: number };
      sessionStorage.removeItem(SAVED_KEY); // show it once only
      if (data.id === id && Date.now() - (data.at ?? 0) < 30_000) setSuccess(data);
    } catch {
      /* ignore */
    }
  }, [id]);

  // ---- restore pending items carried over from /grn/new
  useEffect(() => {
    if (!id) return;
    try {
      const raw = sessionStorage.getItem(HANDOFF_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { id: number; pending: GrnLineForm[] };
      if (data.id === id) {
        setPending(data.pending);
        sessionStorage.removeItem(HANDOFF_KEY);
      }
    } catch {
      /* ignore */
    }
  }, [id]);

  // ---- header validation (client mirror of the server schema)
  const parsed = useMemo(() => grnHeaderSchema(masters.today).safeParse(values), [values, masters.today]);
  const schemaErrors = useMemo(() => (parsed.success ? {} : (zodFieldErrors(parsed.error) as Partial<Record<Field, string>>)), [parsed]);
  const visibleErrors: Partial<Record<Field, string>> = {};
  for (const k of Object.keys(values) as Field[]) {
    const e = serverErrors[k] ?? (k === "invoiceNo" ? dupError : undefined) ?? ((submitted || touched[k]) && schemaErrors[k]);
    if (e) visibleErrors[k] = e;
  }
  const headerComplete = parsed.success && !dupError;

  const supplier = masters.suppliers.find((s) => String(s.id) === values.supplierId);
  const location = masters.locations.find((l) => String(l.id) === values.locationId);
  const taxType = supplier && location && supplier.stateCode !== location.stateCode ? "INTER" : "INTRA";

  // ---- whole-GRN calculation (same function the server uses when saving)
  const calc = useMemo(
    () =>
      calcGrn({
        lines: lines.map((l) => ({ qty: Number(l.qty) || 0, ratePaise: toPaise(l.purchaseRate) })),
        taxType,
        ...summaryCalcOptions(summary),
      }),
    [lines, taxType, summary],
  );
  const summaryParsed = useMemo(() => grnSummarySchema.safeParse(summary), [summary]);
  const summaryErrors = summaryParsed.success ? {} : zodFieldErrors(summaryParsed.error);

  // ---- Invoice Value vs Net Payable (enforced on Save GRN; highlighted after a failed attempt)
  const invoiceClean = values.invoiceValue.replace(/,/g, "").trim();
  const invoicePaise = MONEY_RE.test(invoiceClean) ? toPaise(invoiceClean) : null;
  const netMatchesInvoice = invoicePaise !== null && invoicePaise === calc.net;
  const showMismatch = mismatchAttempted && !netMatchesInvoice && invoicePaise !== null;
  const mismatchText = invoicePaise !== null ? invoiceMismatchMessage(calc.net, invoicePaise, (p) => formatAmount(fromPaise(p))) : "";

  // A supplier without GSTIN usually bills without GST: reset GST to 0 when such a supplier is picked.
  const prevSupplier = useRef(values.supplierId);
  useEffect(() => {
    if (prevSupplier.current === values.supplierId) return;
    prevSupplier.current = values.supplierId;
    const s = masters.suppliers.find((x) => String(x.id) === values.supplierId);
    if (s && !s.gstin) setSummary((sm) => (sm.gstValue ? { ...sm, gstValue: "" } : sm));
  }, [values.supplierId, masters.suppliers]);

  const set = useCallback(<K extends Field>(k: K, v: GrnHeaderForm[K]) => {
    setValues((s) => ({ ...s, [k]: v }));
    setServerErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  }, []);
  const touch = useCallback((k: Field) => setTouched((t) => (t[k] ? t : { ...t, [k]: true })), []);

  // ---- live duplicate check (Supplier + Invoice No.)
  useEffect(() => {
    setDupError(undefined);
    const supplierId = Number(values.supplierId);
    const invoiceNo = values.invoiceNo.trim();
    if (!supplierId || !invoiceNo || disabled) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await checkDuplicateInvoice({ supplierId, invoiceNo, excludeId: id });
      if (!cancelled && r.ok && r.data?.duplicate)
        setDupError(`Invoice ${invoiceNo} from this supplier is already entered in ${r.data.duplicate.label}`);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [values.supplierId, values.invoiceNo, id, disabled]);

  // ---- warn before leaving with unsaved changes
  useEffect(() => {
    if (!dirty || disabled) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty, disabled]);

  // ---- items: add / edit / populate / remove
  const onSubmitItem = useCallback(
    (line: GrnLineForm, source: "pending" | "grid" | "new") => {
      if (source === "grid") setLines((ls) => ls.map((l) => (l.uid === line.uid ? line : l)));
      else if (source === "pending") setPending((ps) => ps.map((p) => (p.uid === line.uid ? line : p)));
      else setPending((ps) => [...ps, line]);
      setEditing(null);
      if (source === "grid") toast.success(`Line updated`);
    },
    [toast],
  );

  const populate = useCallback(() => {
    if (pending.length === 0) return;
    if (lines.length + pending.length > MAX_LINES) {
      toast.error(`A GRN can have at most ${MAX_LINES} lines`);
      return;
    }
    if (editing?.source === "pending") setEditing(null);
    setLines((ls) => [...ls, ...pending]);
    toast.success(`${pending.length} item${pending.length > 1 ? "s" : ""} added to the GRN`);
    setPending([]);
  }, [pending, lines.length, editing, toast]);

  const removeLine = (uid: string) => {
    setLines((ls) => ls.filter((l) => l.uid !== uid));
    if (editing?.line.uid === uid) setEditing(null);
    setRemoveUid(null);
  };

  // ---- shared checks before any save
  const preflight = useCallback(
    (kind: "draft" | "barcodes" | "final") => {
      if (disabled || saving) return false;
      setSubmitted(true);
      if (!parsed.success) {
        toast.error("Please fix the highlighted fields.");
        return false;
      }
      if (dupError) {
        toast.error(dupError);
        return false;
      }
      if (!summaryParsed.success || calc.discountExceedsGross) {
        toast.error("Please fix the highlighted fields in the Summary.");
        document.getElementById("sum-discount")?.scrollIntoView({ block: "center", behavior: "smooth" });
        return false;
      }
      if (kind !== "draft" && editing?.source === "grid") {
        toast.warning("Finish or cancel the line you are editing first.");
        return false;
      }
      if (kind === "final" && lines.length === 0) {
        toast.error(pending.length ? "Populate the pending items into the GRN first (Alt+P)." : "Add at least one item before saving the GRN.");
        return false;
      }
      return true;
    },
    [disabled, saving, parsed.success, dupError, summaryParsed.success, calc.discountExceedsGross, editing, lines.length, pending.length, toast],
  );

  const handleError = useCallback(
    (r: { error?: string; fieldErrors?: Record<string, string>; code?: string }) => {
      if (r.code === "CONFLICT") setConflict(r.error);
      else if (r.code === "MISMATCH") {
        setMismatchAttempted(true);
        toast.error(r.error ?? "GRN total does not match the Invoice Value");
      }
      else {
        setServerErrors((r.fieldErrors ?? {}) as Partial<Record<Field, string>>);
        toast.error(r.error ?? "Couldn't save");
      }
    },
    [toast],
  );

  // ---- save draft / generate barcodes (both save header + populated lines + summary)
  const persist = useCallback(
    (kind: "draft" | "barcodes") => {
      if (!preflight(kind)) return;
      startSave(async () => {
        const payload = { id, version, header: values, lines, summary };
        const r = kind === "draft" ? await saveGrnDraft(payload) : await generateBarcodes(payload);
        if (r.ok && r.data) {
          const data = r.data;
          const barcodes = "barcodes" in data ? data.barcodes : undefined;
          const updated = lines.map((l) => {
            const lineId = data.lineIds[l.uid] ?? l.id;
            return { ...l, id: lineId, barcode: barcodes && lineId ? barcodes[lineId] || null : l.barcode };
          });
          setLines(updated);
          setSaved(JSON.stringify({ h: values, l: updated, s: summary }));
          setServerErrors({});
          toast.success(r.message ?? "Saved");
          if (pending.length) toast.warning(`${pending.length} pending item(s) are not in the GRN yet — Populate them first.`);
          if (!id) {
            try {
              if (pending.length) sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ id: data.id, pending }));
            } catch {
              /* ignore */
            }
            router.replace(`/grn/${data.id}`);
          } else setVersion(data.version);
        } else if (!r.ok) handleError(r);
      });
    },
    [preflight, id, version, values, lines, summary, pending, router, toast, handleError],
  );
  const saveDraft = useCallback(() => persist("draft"), [persist]);
  const generate = useCallback(() => {
    if (!canGenerateBarcode || !lines.some((l) => !l.barcode)) return;
    persist("barcodes");
  }, [persist, canGenerateBarcode, lines]);

  // ---- Save GRN (final): barcodes + GRN number + stock, one transaction on the server
  const doFinalSave = useCallback(() => {
    setSaveWarnings(null);
    startSave(async () => {
      const r = await saveGrn({ id, version, header: values, lines, summary, editSaved: mode === "edit" });
      if (r.ok && r.data) {
        setSaved(JSON.stringify({ h: values, l: lines, s: summary })); // nothing unsaved any more
        setPending([]);
        setServerErrors({});
        // The page refreshes (and this screen remounts) after the save, so keep the result for the remounted screen.
        try {
          sessionStorage.setItem(SAVED_KEY, JSON.stringify({ ...r.data, at: Date.now() }));
        } catch {
          /* ignore */
        }
        setSuccess(r.data);
      } else if (!r.ok) handleError(r);
    });
  }, [id, version, values, lines, summary, mode, handleError]);

  const finalSave = useCallback(() => {
    if (!canSave || !preflight("final")) return;
    if (calc.net <= 0) {
      toast.error("Net payable must be more than ₹0 to save the GRN.");
      document.getElementById("sum-net")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (!netMatchesInvoice) {
      setMismatchAttempted(true);
      toast.error(invoicePaise === null ? "Enter the Invoice Value from the supplier's bill." : mismatchText);
      document.getElementById("grn-invoiceValue")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    const warnings: string[] = [];
    if (pending.length) warnings.push(`${pending.length} pending item(s) have not been populated and will NOT be saved.`);
    if (warnings.length) setSaveWarnings(warnings);
    else doFinalSave();
  }, [canSave, preflight, calc.net, netMatchesInvoice, invoicePaise, mismatchText, pending.length, doFinalSave, toast]);

  // ---- keyboard shortcuts
  useEffect(() => {
    if (mode === "view") return;
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector("[role=dialog]")) return; // a modal handles its own keys
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "s") {
        e.preventDefault();
        if (canSave) finalSave();
        else saveDraft();
      } else if (e.altKey && k === "a") {
        e.preventDefault();
        submitItemRef.current?.();
      } else if (e.altKey && k === "p") {
        e.preventDefault();
        populate();
      } else if (e.altKey && k === "b") {
        e.preventDefault();
        generate();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mode, canSave, finalSave, saveDraft, populate, generate]);

  const onSupplierCreated = (s: NewSupplier) => {
    setMasters((m) => ({ ...m, suppliers: [...m.suppliers, s].sort((a, b) => a.name.localeCompare(b.name)) }));
    set("supplierId", String(s.id));
    touch("supplierId");
    setQuickAdd({ open: false, name: "" });
    setTimeout(() => document.getElementById("grn-invoiceNo")?.focus(), 50);
  };

  const onCategoryAdded = (slot: number, v: { id: number; value: string }) =>
    setMasters((m) => ({
      ...m,
      categories: m.categories.map((c) => (c.slot === slot ? { ...c, values: [...c.values, { ...v, isActive: true }] } : c)),
    }));

  const leave = () => router.push(mode === "edit" && id ? `/grn/${id}` : "/grn");
  const removing = lines.find((l) => l.uid === removeUid);

  return (
    <div className="space-y-4 pb-24" data-entry-root onKeyDown={enterToNext}>
      <TopbarSlot>
        {status === "DRAFT" && (
          <Chip tone="warning" title={id ? `Draft #${id}` : "Not saved yet"}>
            Draft{!id && " · unsaved"}
          </Chip>
        )}
        {status === "SAVED" && <Chip tone="success">{mode === "edit" ? "Saved · editing" : "Saved"}</Chip>}
        {status === "CANCELLED" && <Chip tone="danger">Cancelled</Chip>}
      </TopbarSlot>

      {conflict && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          <AlertTriangle className="size-5 shrink-0" />
          <p className="flex-1">{conflict}</p>
          <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
            <RefreshCw /> Reload
          </Button>
        </div>
      )}
      {status === "CANCELLED" && cancelInfo && (
        <div role="status" className="flex items-start gap-2 rounded-md border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">
          <Ban className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong>Cancelled</strong>
            {cancelInfo.at && ` on ${cancelInfo.at}`}
            {cancelInfo.by && ` by ${cancelInfo.by}`}. Reason: {cancelInfo.reason || "—"}. Its stock was reversed.
          </p>
        </div>
      )}
      {mode === "edit" && (
        <p className="flex items-center gap-2 rounded-md bg-primary-soft px-4 py-2 text-sm text-primary">
          <Pencil className="size-4" /> Editing saved GRN {grnNo}. Update GRN re-posts its stock; the GRN number stays the same.
        </p>
      )}
      {!canEdit && status === "DRAFT" && (
        <p className="flex items-center gap-2 rounded-md bg-slate-100 px-4 py-2 text-sm text-muted">
          <Lock className="size-4" /> Read-only — you don&apos;t have permission to edit GRNs.
        </p>
      )}

      <HeaderCard
        values={values}
        set={set}
        touch={touch}
        errors={
          showMismatch && !visibleErrors.invoiceValue
            ? { ...visibleErrors, invoiceValue: `Doesn't match Net Payable ₹${formatAmount(fromPaise(calc.net))}` }
            : visibleErrors
        }
        invoiceMismatch={showMismatch}
        masters={masters}
        grnNo={grnNo}
        disabled={disabled}
        autoFocusSupplier={!id && !disabled}
        onQuickAddSupplier={canQuickAddSupplier && !disabled ? (name) => setQuickAdd({ open: true, name }) : undefined}
      />

      {!disabled && (
        <ItemPanel
          departments={masters.departments}
          categories={masters.categories}
          onCategoryAdded={onCategoryAdded}
          canAddCategoryValue={canAddCategoryValue}
          disabled={!headerComplete}
          lockedReason="Fill in Receiving Location, Supplier, Supplier Invoice No. and Invoice Date to start adding items."
          pending={pending}
          editing={editing}
          onSubmit={onSubmitItem}
          onCancelEdit={() => setEditing(null)}
          onEditPending={(uid) => {
            const line = pending.find((p) => p.uid === uid);
            if (line) setEditing({ source: "pending", line });
          }}
          onRemovePending={(uid) => {
            setPending((ps) => ps.filter((p) => p.uid !== uid));
            if (editing?.line.uid === uid) setEditing(null);
          }}
          onPopulate={populate}
          submitRef={submitItemRef}
        />
      )}

      <ItemsGrid
        lines={lines}
        departments={masters.departments}
        categories={masters.categories}
        calc={calc}
        editingUid={editing?.source === "grid" ? editing.line.uid : undefined}
        readOnly={disabled}
        onEdit={(uid) => {
          const line = lines.find((l) => l.uid === uid);
          if (line) {
            setEditing({ source: "grid", line });
            document.getElementById("item-itemName")?.scrollIntoView({ block: "center", behavior: "smooth" });
          }
        }}
        onRemove={(uid) => setRemoveUid(uid)}
        onGenerate={generate}
        onPrintLabels={() => setLabelsOpen(true)}
        generating={saving}
        canGenerate={canGenerateBarcode}
      />

      <SummaryCard
        values={summary}
        onChange={(patch) => setSummary((s) => ({ ...s, ...patch }))}
        calc={calc}
        taxType={taxType}
        errors={summaryErrors}
        disabled={disabled}
        netMismatch={showMismatch}
        supplierUnregistered={!!supplier && !supplier.gstin}
      />
      {showMismatch && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-4 py-2 text-sm text-danger">
          {mismatchText}
        </p>
      )}

      {/* Sticky bottom action bar */}
      <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur md:left-auto md:w-[calc(100%-var(--sidebar-w,240px))]">
        <div className="flex items-center gap-2 px-3 py-2.5 sm:px-4 md:px-6">
          <Button
            variant="danger"
            disabled={!id || !canDelete || status === "CANCELLED" || saving}
            onClick={() => setDeleteOpen(true)}
            title={!id ? "Nothing to delete — this GRN isn't saved" : !canDelete ? "Only an Admin can delete GRNs" : undefined}
          >
            <Trash2 /> <span className="hidden sm:inline">Delete GRN</span>
          </Button>
          {mode !== "view" && <span className="ml-2 hidden text-xs text-muted xl:inline">Alt+A add item · Alt+P populate · Alt+B barcodes · Ctrl+S save GRN</span>}
          <div className="ml-auto flex gap-1.5 sm:gap-2">
            {mode === "view" ? (
              <>
                <Button variant="secondary" onClick={leave}>
                  Back
                </Button>
                {id && status !== "DRAFT" && (
                  <Button variant="secondary" onClick={() => window.open(`/print/grn/${id}?auto=1`, "_blank", "noopener")}>
                    <Printer /> <span className="hidden sm:inline">Print GRN</span>
                  </Button>
                )}
                {id && status === "SAVED" && canEditSaved && (
                  <Button onClick={() => router.push(`/grn/${id}/edit`)}>
                    <Pencil /> Edit
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={() => (dirty && !disabled ? setConfirmLeave(true) : leave())}>
                  {disabled ? "Back" : "Cancel"}
                </Button>
                {!disabled && mode === "entry" && (
                  <Button variant="secondary" onClick={saveDraft} disabled={saving}>
                    <Save /> <span className="hidden sm:inline">{saving ? "Saving…" : "Save as Draft"}</span>
                    <span className="sm:hidden">{saving ? "…" : "Draft"}</span>
                  </Button>
                )}
                {!disabled && (
                  <Button onClick={finalSave} disabled={saving || !canSave} title={canSave ? "Ctrl+S" : "You don't have permission to save GRNs"}>
                    <CheckCircle2 /> {mode === "edit" ? "Update GRN" : "Save GRN"}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {id && version && (
        <DeleteGrnDialog
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => {
            setSaved(JSON.stringify({ h: values, l: lines, s: summary }));
            router.push("/grn");
            router.refresh();
          }}
          grn={{ id, version, label: grnNo ?? `Draft #${id}`, saved: status === "SAVED", totalQty: calc.qty }}
        />
      )}
      <SavedModal
        info={success}
        onClose={() => {
          const target = success ? `/grn/${success.id}` : "/grn";
          clearSavedKey();
          setSuccess(null);
          if (window.location.pathname !== target) router.replace(target);
          router.refresh();
        }}
        onNew={() => {
          clearSavedKey();
          setSuccess(null);
          router.push("/grn/new");
        }}
      />
      <ConfirmDialog
        open={!!saveWarnings}
        tone="warning"
        title="Save GRN anyway?"
        message={
          <ul className="list-disc space-y-1 pl-5">
            {saveWarnings?.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        }
        confirmLabel={mode === "edit" ? "Update GRN" : "Save GRN"}
        cancelLabel="Go back"
        onConfirm={doFinalSave}
        onCancel={() => setSaveWarnings(null)}
      />

      {id && (
        <LabelsModal
          open={labelsOpen}
          onClose={() => setLabelsOpen(false)}
          grnId={id}
          lines={lines.filter((l) => l.barcode && l.id)}
          departments={masters.departments}
          categories={masters.categories}
          unsaved={dirty}
        />
      )}
      <QuickSupplierModal
        open={quickAdd.open}
        initialName={quickAdd.name}
        onClose={() => setQuickAdd({ open: false, name: "" })}
        onCreated={onSupplierCreated}
      />
      <ConfirmDialog
        open={confirmLeave}
        tone="warning"
        title="Discard changes?"
        message={
          pending.length
            ? `You have unsaved changes and ${pending.length} pending item(s) on this GRN. Leave without saving?`
            : "You have unsaved changes on this GRN. Leave without saving?"
        }
        confirmLabel="Discard & leave"
        cancelLabel="Keep editing"
        onConfirm={leave}
        onCancel={() => setConfirmLeave(false)}
      />
      <ConfirmDialog
        open={!!removing}
        tone="danger"
        title="Remove line?"
        message={removing ? `Remove "${removing.itemName}" (qty ${removing.qty}) from this GRN?` : ""}
        confirmLabel="Remove"
        onConfirm={() => removeUid && removeLine(removeUid)}
        onCancel={() => setRemoveUid(null)}
      />
    </div>
  );
}
