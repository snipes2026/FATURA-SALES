"use client";

import { useState, useTransition } from "react";
import { Check, Eye, EyeOff, Pencil, Plus, X } from "lucide-react";
import { useForm } from "@/components/forms/use-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { SelectField, TextField } from "@/components/ui/fields";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { categoryConfigSchema, CATEGORY_MODES } from "@/lib/validation/masters";
import { addCategoryValue, saveCategoryConfig, updateCategoryValue } from "./actions";

type Mode = (typeof CATEGORY_MODES)[number];
type Value = { id: number; value: string; isActive: boolean };
export type SlotData = { slot: number; label: string; mode: Mode; values: Value[] };

const MODE_OPTIONS = [
  { value: "MANDATORY", label: "Mandatory" },
  { value: "OPTIONAL", label: "Optional" },
  { value: "HIDDEN", label: "Hidden" },
];

export function CategoriesClient({ slots }: { slots: SlotData[] }) {
  const f = useForm<{ slots: { slot: number; label: string; mode: Mode }[] }>({
    slots: slots.map(({ slot, label, mode }) => ({ slot, label, mode })),
  });

  const setSlot = (i: number, patch: Partial<{ label: string; mode: Mode }>) =>
    f.set(
      "slots",
      f.values.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    );

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm text-muted">
            Name the four item categories (e.g. Style, Color, Size, Type). These names appear on the GRN screen, reports and labels. Hidden
            categories are not shown anywhere.
          </p>
          <Button onClick={() => f.submit(categoryConfigSchema, saveCategoryConfig)} disabled={f.pending}>
            {f.pending ? "Saving…" : "Save names & modes"}
          </Button>
        </CardBody>
      </Card>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {slots.map((s, i) => (
          <SlotCard
            key={s.slot}
            data={s}
            label={f.values.slots[i].label}
            mode={f.values.slots[i].mode}
            labelError={f.errors[`slots.${i}.label`]}
            onLabel={(label) => setSlot(i, { label })}
            onMode={(mode) => setSlot(i, { mode })}
          />
        ))}
      </div>
    </div>
  );
}

function SlotCard({
  data,
  label,
  mode,
  labelError,
  onLabel,
  onMode,
}: {
  data: SlotData;
  label: string;
  mode: Mode;
  labelError?: string;
  onLabel: (v: string) => void;
  onMode: (v: Mode) => void;
}) {
  const toast = useToast();
  const [newValue, setNewValue] = useState("");
  const [addError, setAddError] = useState<string>();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [pending, start] = useTransition();
  const [showInactive, setShowInactive] = useState(false);

  const add = () => {
    const value = newValue.trim();
    if (!value) return;
    start(async () => {
      const r = await addCategoryValue({ slot: data.slot, value, isActive: true });
      if (r.ok) {
        setNewValue("");
        setAddError(undefined);
      } else setAddError(r.fieldErrors?.value ?? r.error);
    });
  };

  const update = (v: Value, patch: Partial<Value>) =>
    start(async () => {
      const r = await updateCategoryValue({ id: v.id, slot: data.slot, value: patch.value ?? v.value, isActive: patch.isActive ?? v.isActive });
      if (r.ok) setEditingId(null);
      else toast.error(r.fieldErrors?.value ?? r.error ?? "Couldn't update");
    });

  const visible = data.values.filter((v) => showInactive || v.isActive);
  const inactiveCount = data.values.length - data.values.filter((v) => v.isActive).length;

  return (
    <Card className={cn(mode === "HIDDEN" && "opacity-70")}>
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">Category {data.slot}</span>
          <Chip tone={mode === "MANDATORY" ? "danger" : mode === "OPTIONAL" ? "primary" : "neutral"}>{MODE_OPTIONS.find((m) => m.value === mode)?.label}</Chip>
        </div>
        <TextField label="Name" name={`label-${data.slot}`} required value={label} onChange={(e) => onLabel(e.target.value)} error={labelError} maxLength={40} />
        <SelectField label="On GRN screen" name={`mode-${data.slot}`} options={MODE_OPTIONS} value={mode} onChange={(e) => onMode(e.target.value as Mode)} />
      </div>
      <div className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">
            {label || "Values"} values <span className="text-muted">({data.values.length - inactiveCount})</span>
          </span>
          {inactiveCount > 0 && (
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShowInactive((s) => !s)}>
              {showInactive ? "Hide" : "Show"} inactive ({inactiveCount})
            </button>
          )}
        </div>
        <ul className="max-h-72 space-y-0.5 overflow-y-auto">
          {visible.map((v) => (
            <li key={v.id} className="group flex h-8 items-center gap-1 rounded px-1.5 hover:bg-slate-50">
              {editingId === v.id ? (
                <>
                  <Input
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") update(v, { value: editText.trim() });
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="h-7"
                  />
                  <button type="button" aria-label="Save" disabled={pending} onClick={() => update(v, { value: editText.trim() })} className="p-1 text-success">
                    <Check className="size-4" />
                  </button>
                  <button type="button" aria-label="Cancel" onClick={() => setEditingId(null)} className="p-1 text-muted">
                    <X className="size-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className={cn("flex-1 truncate text-sm", !v.isActive && "text-muted line-through")}>{v.value}</span>
                  <button
                    type="button"
                    aria-label={`Rename ${v.value}`}
                    className="p-1 text-muted opacity-0 hover:text-ink group-hover:opacity-100 focus:opacity-100"
                    onClick={() => {
                      setEditingId(v.id);
                      setEditText(v.value);
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={v.isActive ? `Deactivate ${v.value}` : `Activate ${v.value}`}
                    title={v.isActive ? "Deactivate" : "Activate"}
                    disabled={pending}
                    className="p-1 text-muted opacity-0 hover:text-ink group-hover:opacity-100 focus:opacity-100"
                    onClick={() => update(v, { isActive: !v.isActive })}
                  >
                    {v.isActive ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </>
              )}
            </li>
          ))}
          {visible.length === 0 && <li className="px-1.5 py-2 text-sm text-muted">No values yet.</li>}
        </ul>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input
            placeholder={`New ${label || "value"}`}
            value={newValue}
            onChange={(e) => {
              setNewValue(e.target.value);
              setAddError(undefined);
            }}
            maxLength={60}
            invalid={!!addError}
            aria-label={`New ${label} value`}
          />
          <Button type="submit" variant="secondary" size="icon" disabled={pending || !newValue.trim()} aria-label="Add value">
            <Plus />
          </Button>
        </form>
        {addError && <p className="mt-1 text-xs text-danger">{addError}</p>}
      </div>
    </Card>
  );
}
