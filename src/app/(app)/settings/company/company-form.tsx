"use client";

import { useRef, useTransition } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { useForm } from "@/components/forms/use-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormError, FormGrid, SelectField, TextAreaField, TextField } from "@/components/ui/fields";
import { useToast } from "@/components/ui/toast";
import { STATE_OPTIONS, stateFromGstin, GST_STATES } from "@/lib/india";
import { companySchema } from "@/lib/validation/masters";
import { removeLogo, saveCompany, uploadLogo } from "./actions";

type Values = { name: string; address: string; gstin: string; stateCode: string; phone: string; email: string };

export function CompanyForm({ initial, logoUrl }: { initial: Values; logoUrl: string | null }) {
  const f = useForm<Values>(initial);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, startUpload] = useTransition();

  const onGstin = (v: string) => {
    const g = v.toUpperCase();
    f.set("gstin", g);
    const st = stateFromGstin(g);
    if (g.length >= 2 && st && GST_STATES[st]) f.set("stateCode", st);
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.set("logo", file);
    startUpload(async () => {
      const r = await uploadLogo(fd);
      if (r.ok) toast.success(r.message ?? "Logo updated");
      else toast.error(r.error ?? "Upload failed");
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader title="Company details" />
        <CardBody>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              f.submit(companySchema, saveCompany);
            }}
          >
            <FormError>{f.errors._form}</FormError>
            <FormGrid>
              <TextField
                className="sm:col-span-2"
                label="Company name"
                name="name"
                required
                value={f.values.name}
                onChange={(e) => f.set("name", e.target.value)}
                error={f.errors.name}
              />
              <TextAreaField
                className="sm:col-span-2"
                label="Address"
                name="address"
                value={f.values.address}
                onChange={(e) => f.set("address", e.target.value)}
                error={f.errors.address}
              />
              <TextField
                label="GSTIN"
                name="gstin"
                maxLength={15}
                value={f.values.gstin}
                onChange={(e) => onGstin(e.target.value)}
                error={f.errors.gstin}
                inputClassName="uppercase"
              />
              <SelectField
                label="State"
                name="stateCode"
                placeholder="Select state"
                options={STATE_OPTIONS}
                value={f.values.stateCode}
                onChange={(e) => f.set("stateCode", e.target.value)}
                error={f.errors.stateCode}
              />
              <TextField label="Phone" name="phone" value={f.values.phone} onChange={(e) => f.set("phone", e.target.value)} error={f.errors.phone} />
              <TextField label="Email" name="email" type="email" value={f.values.email} onChange={(e) => f.set("email", e.target.value)} error={f.errors.email} />
            </FormGrid>
            <p className="mt-3 text-xs text-muted">Used on GRN printouts, reports and barcode labels.</p>
            <div className="mt-4 flex justify-end">
              <Button type="submit" disabled={f.pending}>
                {f.pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Logo" />
        <CardBody className="space-y-3">
          <div className="flex h-36 items-center justify-center rounded-md border border-dashed border-border bg-slate-50">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Company logo" className="max-h-32 max-w-[90%] object-contain" />
            ) : (
              <span className="text-sm text-muted">No logo</span>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <ImagePlus /> {uploading ? "Uploading…" : logoUrl ? "Replace" : "Upload"}
            </Button>
            {logoUrl && (
              <Button
                type="button"
                variant="ghost"
                aria-label="Remove logo"
                disabled={uploading}
                onClick={() =>
                  startUpload(async () => {
                    const r = await removeLogo();
                    if (r.ok) toast.success(r.message ?? "Logo removed");
                    else toast.error(r.error ?? "Failed");
                  })
                }
              >
                <Trash2 />
              </Button>
            )}
          </div>
          <p className="text-xs text-muted">PNG, JPEG or WebP, up to 2 MB.</p>
        </CardBody>
      </Card>
    </div>
  );
}
