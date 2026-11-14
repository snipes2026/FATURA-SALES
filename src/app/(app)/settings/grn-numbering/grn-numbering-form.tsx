"use client";

import { useForm } from "@/components/forms/use-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormError, FormGrid, TextField } from "@/components/ui/fields";
import { formatGrnNo, grnNumberSettingsSchema } from "@/lib/validation/masters";
import { saveGrnNumberSettings } from "./actions";

type Values = { prefix: string; digits: string };

export function GrnNumberingForm({ initial, fy, lastIssued }: { initial: Values; fy: string; lastIssued: number }) {
  const f = useForm<Values>(initial);
  const digits = Math.min(Math.max(Number(f.values.digits) || 4, 1), 8);
  const prefix = f.values.prefix.toUpperCase() || "GRN";
  const next = formatGrnNo({ prefix, digits }, fy, lastIssued + 1);
  const [a, b] = fy.split("-").map(Number);
  const nextFy = `${String(a + 1).padStart(2, "0")}-${String(b + 1).padStart(2, "0")}`;

  return (
    <Card className="max-w-2xl">
      <CardHeader title="GRN number format" />
      <CardBody>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            f.submit(grnNumberSettingsSchema, saveGrnNumberSettings);
          }}
        >
          <FormError>{f.errors._form}</FormError>
          <FormGrid>
            <TextField label="Prefix" name="prefix" required maxLength={20} inputClassName="uppercase" value={f.values.prefix} onChange={(e) => f.set("prefix", e.target.value.toUpperCase())} error={f.errors.prefix} />
            <TextField label="Digits" name="digits" required inputMode="numeric" value={f.values.digits} onChange={(e) => f.set("digits", e.target.value.replace(/\D/g, ""))} error={f.errors.digits} hint="3 to 8" />
          </FormGrid>
          <div className="mt-4 space-y-1 rounded-md bg-slate-50 p-3 text-sm">
            <p>
              Current financial year <strong>{fy}</strong> · GRNs issued: <strong>{lastIssued}</strong>
            </p>
            <p>
              Next GRN number: <strong className="font-mono">{next}</strong>
            </p>
            <p className="text-xs text-muted">
              Numbering restarts at 1 every 1 April (next year starts with {formatGrnNo({ prefix, digits }, nextFy, 1)}). Numbers are given only when a GRN is
              saved, so drafts never leave gaps.
            </p>
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="submit" disabled={f.pending}>
              {f.pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
