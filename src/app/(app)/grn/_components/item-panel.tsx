"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Eraser, Pencil, Plus, Trash2 } from "lucide-react";
import { addCategoryValue } from "@/app/(app)/settings/categories/actions";
import { Autocomplete } from "@/components/ui/autocomplete";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { FieldError, Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { zodFieldErrors } from "@/lib/action-result";
import { priceOrderIssues } from "@/lib/grn-calc";
import { formatAmount, formatINR } from "@/lib/india";
import { focusNext } from "@/lib/keyboard";
import { toPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import { grnLineSchema, type GrnLineForm } from "@/lib/validation/grn";
import { suggestItemNames } from "../actions";
import type { CatSlot, DeptOption } from "../_lib/load";
import { ImageBox } from "./image-box";

type Values = Omit<GrnLineForm, "uid" | "id" | "barcode">;
type Key = keyof Values;
type CatKey = "cat1" | "cat2" | "cat3" | "cat4";

export const emptyItem = (departmentId = ""): Values => ({
  departmentId,
  itemName: "",
  cat1: "",
  cat2: "",
  cat3: "",
  cat4: "",
  qty: "",
  purchaseRate: "",
  wsp: "",
  rsp: "",
  mrp: "",
  imagePath: null,
  priceWarningOverridden: false,
});

export const newUid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export type Editing = { source: "pending" | "grid"; line: GrnLineForm } | null;

export function ItemPanel({
  departments,
  categories,
  onCategoryAdded,
  canAddCategoryValue,
  disabled,
  lockedReason,
  pending,
  editing,
  onSubmit,
  onCancelEdit,
  onEditPending,
  onRemovePending,
  onPopulate,
  submitRef,
}: {
  departments: DeptOption[];
  categories: CatSlot[];
  onCategoryAdded: (slot: number, v: { id: number; value: string }) => void;
  canAddCategoryValue: boolean;
  disabled: boolean;
  lockedReason?: string;
  pending: GrnLineForm[];
  editing: Editing;
  onSubmit: (line: GrnLineForm, source: "pending" | "grid" | "new") => void;
  onCancelEdit: () => void;
  onEditPending: (uid: string) => void;
  onRemovePending: (uid: string) => void;
  onPopulate: () => void;
  submitRef: React.MutableRefObject<(() => void) | null>;
}) {
  const toast = useToast();
  const [values, setValues] = useState<Values>(emptyItem());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [priceConfirm, setPriceConfirm] = useState<string[] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const visibleCats = categories.filter((c) => c.mode !== "HIDDEN");
  // A barcode belongs to one SKU, so its department, item, categories and MRP can't change.
  const skuLocked = !!editing?.line.barcode;
  const lineSchema = useMemo(() => grnLineSchema(categories.map((c) => ({ slot: c.slot, label: c.label, mode: c.mode }))), [categories]);
  const dept = departments.find((d) => String(d.id) === values.departmentId);
  const issues = priceOrderIssues(values);
  const catName = (slot: number, id: string) => categories[slot - 1]?.values.find((v) => String(v.id) === id)?.value ?? "";
  const deptName = (id: string) => departments.find((d) => String(d.id) === id)?.name ?? "";

  const set = <K extends Key>(k: K, v: Values[K]) => {
    setValues((s) => {
      const next = { ...s, [k]: v };
      // Any price change needs a fresh confirmation.
      if (k === "purchaseRate" || k === "wsp" || k === "rsp" || k === "mrp") next.priceWarningOverridden = false;
      return next;
    });
    setErrors((e) => (e[k] ? { ...e, [k]: "" } : e));
  };

  const focusItemName = () => setTimeout(() => document.getElementById("item-itemName")?.focus(), 0);

  // Load a line for editing (from the pending list or the GRN items grid).
  useEffect(() => {
    if (!editing) return;
    const { uid: _u, id: _i, barcode: _b, ...rest } = editing.line;
    setValues(rest);
    setErrors({});
    focusItemName();
  }, [editing]);

  const commit = useCallback(
    (v: Values) => {
      const base = editing?.line;
      onSubmit({ ...v, uid: base?.uid ?? newUid(), id: base?.id, barcode: base?.barcode ?? null }, editing?.source ?? "new");
      setValues(emptyItem(v.departmentId)); // keep the department for the next item
      setErrors({});
      focusItemName();
    },
    [editing, onSubmit],
  );

  const submit = useCallback(() => {
    if (disabled) return;
    const check = lineSchema.safeParse({ ...values, uid: "x", priceWarningOverridden: true });
    if (!check.success) {
      setErrors(zodFieldErrors(check.error));
      const first = check.error.issues[0]?.path[0];
      if (first) document.getElementById(`item-${String(first)}`)?.focus();
      return;
    }
    const problems = priceOrderIssues(values);
    if (problems.length && !values.priceWarningOverridden) {
      setPriceConfirm(problems);
      return;
    }
    commit({ ...values, priceWarningOverridden: problems.length > 0 });
  }, [disabled, lineSchema, values, commit]);

  useEffect(() => {
    submitRef.current = submit;
  }, [submit, submitRef]);

  const clear = () => {
    setValues(emptyItem(values.departmentId));
    setErrors({});
    if (editing) onCancelEdit();
    focusItemName();
  };

  // Enter moves through the item fields; Enter on the last one adds the item.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || e.defaultPrevented || e.altKey || e.ctrlKey || e.shiftKey) return;
    const t = e.target as HTMLElement;
    if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) return;
    e.preventDefault();
    if (!focusNext(t)) submit();
  };

  const fetchNames = useCallback(
    async (q: string) => {
      const id = Number(values.departmentId);
      if (!id) return [];
      const r = await suggestItemNames({ departmentId: id, q });
      return r.ok ? (r.data ?? []) : [];
    },
    [values.departmentId],
  );

  const addValue = async (slot: number, typed: string) => {
    const value = typed.trim();
    if (!value) return toast.warning("Type the new value first");
    const r = await addCategoryValue({ slot, value, isActive: true });
    if (r.ok && r.data) {
      onCategoryAdded(slot, r.data);
      set(`cat${slot}` as Key, String(r.data.id));
      toast.success(`${categories[slot - 1].label} "${r.data.value}" added`);
      const el = document.getElementById(`item-cat${slot}`);
      if (el) focusNext(el);
    } else if (!r.ok) toast.error(r.fieldErrors?.value ?? r.error ?? "Couldn't add");
  };

  const lbl = (k: Key, text: string, required: boolean) => (
    <Label htmlFor={`item-${k}`} required={required}>
      {text}
    </Label>
  );
  const err = (k: string) => (errors[k] ? <FieldError>{errors[k]}</FieldError> : null);
  const numberInput = (k: "qty" | "purchaseRate" | "wsp" | "rsp" | "mrp", decimal: boolean) => (
    <Input
      id={`item-${k}`}
      inputMode={decimal ? "decimal" : "numeric"}
      autoComplete="off"
      disabled={disabled || (k === "mrp" && skuLocked)}
      invalid={!!errors[k]}
      className="text-right tabular-nums"
      value={values[k]}
      onChange={(e) => set(k, decimal ? e.target.value.replace(/[^\d.]/g, "") : e.target.value.replace(/\D/g, ""))}
    />
  );

  return (
    <Card aria-disabled={disabled} className={cn(disabled && "opacity-60")}>
      <CardHeader
        title={editing ? (editing.source === "grid" ? "Edit GRN Item" : "Edit Pending Item") : "Add Item"}
        actions={
          editing ? (
            <Chip tone="primary">Editing</Chip>
          ) : (
            <span className="hidden text-xs text-muted sm:inline">Enter → next field · Enter on MRP or Alt+A adds the item</span>
          )
        }
      />
      <CardBody>
        {disabled && lockedReason && <p className="mb-3 rounded-md bg-slate-100 px-3 py-2 text-sm text-muted">{lockedReason}</p>}
        {skuLocked && (
          <p className="mb-3 rounded-md bg-primary-soft px-3 py-2 text-sm text-primary">
            Barcode <span className="font-mono font-medium">{editing?.line.barcode}</span> is assigned — department, item, categories and MRP are locked.
            Quantity, rates and photo can still change.
          </p>
        )}
        <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
          <div ref={rootRef} data-entry-root onKeyDown={onKeyDown} className="space-y-3">
            {/* Row 1: department, item, HSN (reference only — GRN GST is entered on the Summary) */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-3 lg:grid-cols-6">
              <div className="col-span-2">
                {lbl("departmentId", "Department", true)}
                <Combobox
                  id="item-departmentId"
                  value={values.departmentId}
                  disabled={disabled || skuLocked}
                  invalid={!!errors.departmentId}
                  placeholder="Select department"
                  options={departments
                    .filter((d) => d.isActive || String(d.id) === values.departmentId)
                    .map((d) => ({ value: String(d.id), label: d.name, hint: `HSN ${d.hsnCode}` }))}
                  onChange={(v) => set("departmentId", v)}
                />
                {err("departmentId")}
              </div>
              <div className="col-span-2">
                {lbl("itemName", "Item Name", true)}
                <Autocomplete
                  id="item-itemName"
                  value={values.itemName}
                  disabled={disabled || skuLocked}
                  invalid={!!errors.itemName}
                  maxLength={200}
                  placeholder={dept ? `e.g. past ${dept.name} items` : "Select a department first"}
                  onChange={(v) => set("itemName", v)}
                  fetchSuggestions={fetchNames}
                />
                {err("itemName")}
              </div>
              <div className="col-span-2 lg:col-span-1">
                <span className="mb-1 block text-[13px] font-medium text-slate-700">HSN</span>
                <div className="flex h-9 items-center">{dept ? <Chip className="font-mono">{dept.hsnCode}</Chip> : <span className="text-sm text-muted">—</span>}</div>
              </div>
            </div>

            {/* Row 2: categories (configured names; hidden ones skipped) */}
            {visibleCats.length > 0 && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-3 lg:grid-cols-4">
                {visibleCats.map((c) => {
                  const k = `cat${c.slot}` as CatKey;
                  return (
                    <div key={c.slot}>
                      {lbl(k, c.label, c.mode === "MANDATORY")}
                      <Combobox
                        id={`item-${k}`}
                        value={values[k]}
                        disabled={disabled || skuLocked}
                        invalid={!!errors[k]}
                        placeholder={`Select ${c.label}`}
                        options={c.values.filter((v) => v.isActive || String(v.id) === values[k]).map((v) => ({ value: String(v.id), label: v.value }))}
                        onChange={(v) => set(k, v)}
                        footer={
                          canAddCategoryValue
                            ? (close) => (
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm font-medium text-primary hover:bg-primary-soft"
                                  onClick={() => {
                                    const typed = (document.getElementById(`item-${k}`) as HTMLInputElement | null)?.value ?? "";
                                    close();
                                    void addValue(c.slot, typed);
                                  }}
                                >
                                  <Plus className="size-4" /> Add typed text as new {c.label}
                                </button>
                              )
                            : undefined
                        }
                      />
                      {err(k)}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Row 3: quantity and prices */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
              <div>
                {lbl("qty", "Quantity", true)}
                {numberInput("qty", false)}
                {err("qty")}
              </div>
              <div>
                {lbl("purchaseRate", "Purchase Rate ₹", true)}
                {numberInput("purchaseRate", true)}
                {errors.purchaseRate ? err("purchaseRate") : <p className="mt-1 text-[11px] text-muted">excl. GST</p>}
              </div>
              <div>
                {lbl("wsp", "WSP ₹", false)}
                {numberInput("wsp", true)}
                {err("wsp")}
              </div>
              <div>
                {lbl("rsp", "RSP ₹", false)}
                {numberInput("rsp", true)}
                {err("rsp")}
              </div>
              <div>
                {lbl("mrp", "MRP ₹", true)}
                {numberInput("mrp", true)}
                {err("mrp")}
              </div>
            </div>

            {issues.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning" role="status">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="font-medium">Expected Purchase Rate ≤ WSP ≤ RSP ≤ MRP</p>
                  <ul className="list-disc pl-4 text-xs">
                    {issues.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                  {values.priceWarningOverridden && <p className="mt-1 text-xs">Override confirmed.</p>}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted">
                {values.qty && values.purchaseRate && (
                  <>
                    Amount <span className="font-medium text-ink tabular-nums">{formatINR(((toPaise(values.purchaseRate) * Number(values.qty)) / 100).toFixed(2))}</span>
                  </>
                )}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={clear} disabled={disabled}>
                  <Eraser /> {editing ? "Cancel edit" : "Clear"}
                </Button>
                <Button type="button" onClick={submit} disabled={disabled} title="Alt+A">
                  {editing ? (
                    "Update Item"
                  ) : (
                    <>
                      <Plus /> Add Item
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>

          <ImageBox value={values.imagePath} onChange={(p) => set("imagePath", p)} disabled={disabled} />
        </div>

        {/* Pending items */}
        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              Pending Items <Chip tone={pending.length ? "warning" : "neutral"}>{pending.length}</Chip>
            </h3>
            <Button type="button" onClick={onPopulate} disabled={pending.length === 0} title="Alt+P">
              Populate to GRN <ArrowRight />
            </Button>
          </div>
          {pending.length === 0 ? (
            <p className="text-sm text-muted">Items you add appear here. Populate moves them into the GRN.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Item</th>
                    <th className="px-3 py-1.5 text-left font-medium">Dept</th>
                    <th className="px-3 py-1.5 text-left font-medium">{visibleCats.map((c) => c.label).join(" / ") || "Categories"}</th>
                    <th className="px-3 py-1.5 text-right font-medium">Qty</th>
                    <th className="px-3 py-1.5 text-right font-medium">Rate</th>
                    <th className="px-3 py-1.5 text-right font-medium">MRP</th>
                    <th className="w-px px-3 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {pending.map((p) => (
                    <tr key={p.uid} className={cn("border-t border-border", editing?.line.uid === p.uid && "bg-primary-soft")}>
                      <td className="px-3 py-1.5 font-medium">
                        {p.itemName}
                        {p.priceWarningOverridden && <AlertTriangle className="ml-1 inline size-3.5 text-warning" aria-label="Price order overridden" />}
                      </td>
                      <td className="px-3 py-1.5">{deptName(p.departmentId)}</td>
                      <td className="px-3 py-1.5 text-muted">
                        {visibleCats
                          .map((c) => catName(c.slot, p[`cat${c.slot}` as CatKey]))
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td className="num px-3 py-1.5">{p.qty}</td>
                      <td className="num px-3 py-1.5">{formatAmount(p.purchaseRate)}</td>
                      <td className="num px-3 py-1.5">{formatAmount(p.mrp)}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right">
                        <Button type="button" variant="ghost" size="sm" aria-label={`Edit ${p.itemName}`} onClick={() => onEditPending(p.uid)}>
                          <Pencil />
                        </Button>
                        <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${p.itemName}`} onClick={() => onRemovePending(p.uid)}>
                          <Trash2 className="text-danger" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardBody>

      <ConfirmDialog
        open={!!priceConfirm}
        tone="warning"
        title="Prices out of order"
        message={
          <>
            <p className="mb-2">Usually Purchase Rate ≤ WSP ≤ RSP ≤ MRP. For this item:</p>
            <ul className="list-disc pl-5">
              {priceConfirm?.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
            <p className="mt-2">Add it anyway?</p>
          </>
        }
        confirmLabel="Yes, add anyway"
        cancelLabel="Fix prices"
        onConfirm={() => {
          setPriceConfirm(null);
          commit({ ...values, priceWarningOverridden: true });
        }}
        onCancel={() => {
          setPriceConfirm(null);
          setTimeout(() => document.getElementById("item-purchaseRate")?.focus(), 0);
        }}
      />
    </Card>
  );
}
