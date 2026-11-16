"use client";

import { useForm } from "@/components/forms/use-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormError, FormGrid, SelectField, Switch, TextField } from "@/components/ui/fields";
import { formatDocNo, salesSettingsSchema } from "@/lib/validation/sales";
import { saveSalesSettings } from "./actions";

type Values = {
  allowPriceEdit: boolean;
  bank1Name: string;
  bank2Name: string;
  bank2Enabled: boolean;
  defaultGstMode: "ADD" | "INCLUDES";
  allowNegativeStock: boolean;
  autoIncrementQty: boolean;
  invoicePrefix: string;
  invoiceDigits: string;
  receiptPrefix: string;
  receiptDigits: string;
  printFormat: "A4" | "THERMAL80";
  walkinAllowCredit: boolean;
  walkinAllowAdvance: boolean;
  returnQtyCheck: "OFF" | "WARN" | "BLOCK";
  returnPrefix: string;
  returnDigits: string;
  returnPrintFormat: "A4" | "THERMAL80";
};

const clampDigits = (v: string) => Math.min(Math.max(Number(v) || 4, 1), 8);

export function SalesSettingsForm({
  initial,
  fy,
  lastInvoice,
  lastReceipt,
  lastReturn,
}: {
  initial: Values;
  fy: string;
  lastInvoice: number;
  lastReceipt: number;
  lastReturn: number;
}) {
  const f = useForm<Values>(initial);
  const v = f.values;
  const nextInvoice = formatDocNo({ prefix: v.invoicePrefix || "INV", digits: clampDigits(v.invoiceDigits) }, fy, lastInvoice + 1);
  const nextReceipt = formatDocNo({ prefix: v.receiptPrefix || "RCT", digits: clampDigits(v.receiptDigits) }, fy, lastReceipt + 1);
  const nextReturn = formatDocNo({ prefix: v.returnPrefix || "SR", digits: clampDigits(v.returnDigits) }, fy, lastReturn + 1);

  return (
    <form
      noValidate
      className="max-w-3xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        f.submit(salesSettingsSchema, saveSalesSettings);
      }}
    >
      <FormError>{f.errors._form}</FormError>

      <Card>
        <CardHeader title="Billing" />
        <CardBody className="space-y-4">
          <Switch
            checked={v.allowPriceEdit}
            onChange={(x) => f.set("allowPriceEdit", x)}
            label="Allow price edit during billing"
            description="Off: the WSP from the product is used and the price can't be changed (the server enforces it too)."
          />
          <Switch
            checked={v.allowNegativeStock}
            onChange={(x) => f.set("allowNegativeStock", x)}
            label="Allow billing when stock is insufficient"
            description="Off: a bill can't sell more than the stock at the location. On: a warning is shown instead."
          />
          <Switch
            checked={v.autoIncrementQty}
            onChange={(x) => f.set("autoIncrementQty", x)}
            label="Increase qty when the same barcode is scanned again"
            description="Off: every scan adds a new row."
          />
          <FormGrid>
            <SelectField
              label="Default GST mode"
              name="defaultGstMode"
              options={[
                { value: "INCLUDES", label: "Includes GST (WSP includes GST)" },
                { value: "ADD", label: "Add GST (GST added on top of WSP)" },
              ]}
              value={v.defaultGstMode}
              onChange={(e) => f.set("defaultGstMode", e.target.value as Values["defaultGstMode"])}
              hint="Can be changed on each bill"
            />
            <SelectField
              label="Print format"
              name="printFormat"
              options={[
                { value: "A4", label: "A4 Tax Invoice" },
                { value: "THERMAL80", label: "3-inch (80mm) thermal receipt" },
              ]}
              value={v.printFormat}
              onChange={(e) => f.set("printFormat", e.target.value as Values["printFormat"])}
            />
          </FormGrid>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Payment modes" />
        <CardBody className="space-y-4">
          <p className="text-sm text-muted">
            <strong className="text-ink">Cash</strong> and <strong className="text-ink">Credit</strong> are always available.
          </p>
          <FormGrid>
            <TextField label="Bank 1 name" name="bank1Name" required maxLength={40} value={v.bank1Name} onChange={(e) => f.set("bank1Name", e.target.value)} error={f.errors.bank1Name} hint='e.g. "ICICI Current"' />
            <div />
            <TextField label="Bank 2 name" name="bank2Name" required maxLength={40} value={v.bank2Name} onChange={(e) => f.set("bank2Name", e.target.value)} error={f.errors.bank2Name} />
            <div className="flex items-end pb-1">
              <Switch checked={v.bank2Enabled} onChange={(x) => f.set("bank2Enabled", x)} label="Enable Bank 2" description="Hidden on the payment panel when off" />
            </div>
          </FormGrid>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Walk-in Customer" />
        <CardBody className="space-y-4">
          <Switch checked={v.walkinAllowCredit} onChange={(x) => f.set("walkinAllowCredit", x)} label="Allow credit for Walk-in Customer" description="Recommended off — the bill must be paid in full." />
          <Switch checked={v.walkinAllowAdvance} onChange={(x) => f.set("walkinAllowAdvance", x)} label="Allow advance for Walk-in Customer" description="Recommended off." />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Sales Return" />
        <CardBody>
          <FormGrid>
            <SelectField
              label="Return-quantity check"
              name="returnQtyCheck"
              options={[
                { value: "WARN", label: "Warn — amber, needs confirmation" },
                { value: "BLOCK", label: "Block — can't save" },
                { value: "OFF", label: "Off — no check" },
              ]}
              value={v.returnQtyCheck}
              onChange={(e) => f.set("returnQtyCheck", e.target.value as Values["returnQtyCheck"])}
              hint="Returned qty vs qty sold to the customer (or on the linked bill), less what was already returned"
            />
            <SelectField
              label="Credit note print format"
              name="returnPrintFormat"
              options={[
                { value: "A4", label: "A4 Credit Note" },
                { value: "THERMAL80", label: "3-inch (80mm) thermal" },
              ]}
              value={v.returnPrintFormat}
              onChange={(e) => f.set("returnPrintFormat", e.target.value as Values["returnPrintFormat"])}
            />
          </FormGrid>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Numbering" />
        <CardBody>
          <FormGrid>
            <TextField label="Invoice prefix" name="invoicePrefix" required maxLength={20} inputClassName="uppercase" value={v.invoicePrefix} onChange={(e) => f.set("invoicePrefix", e.target.value.toUpperCase())} error={f.errors.invoicePrefix} />
            <TextField label="Invoice digits" name="invoiceDigits" required inputMode="numeric" value={v.invoiceDigits} onChange={(e) => f.set("invoiceDigits", e.target.value.replace(/\D/g, ""))} error={f.errors.invoiceDigits} hint="3 to 8" />
            <TextField label="Receipt prefix" name="receiptPrefix" required maxLength={20} inputClassName="uppercase" value={v.receiptPrefix} onChange={(e) => f.set("receiptPrefix", e.target.value.toUpperCase())} error={f.errors.receiptPrefix} />
            <TextField label="Receipt digits" name="receiptDigits" required inputMode="numeric" value={v.receiptDigits} onChange={(e) => f.set("receiptDigits", e.target.value.replace(/\D/g, ""))} error={f.errors.receiptDigits} hint="3 to 8" />
            <TextField label="Sales Return prefix" name="returnPrefix" required maxLength={20} inputClassName="uppercase" value={v.returnPrefix} onChange={(e) => f.set("returnPrefix", e.target.value.toUpperCase())} error={f.errors.returnPrefix} />
            <TextField label="Sales Return digits" name="returnDigits" required inputMode="numeric" value={v.returnDigits} onChange={(e) => f.set("returnDigits", e.target.value.replace(/\D/g, ""))} error={f.errors.returnDigits} hint="3 to 8" />
          </FormGrid>
          <div className="mt-4 space-y-1 rounded-md bg-slate-50 p-3 text-sm">
            <p>
              Financial year <strong>{fy}</strong> · Bills issued: <strong>{lastInvoice}</strong> · Receipts issued: <strong>{lastReceipt}</strong> · Credit notes issued: <strong>{lastReturn}</strong>
            </p>
            <p>
              Next bill: <strong className="font-mono">{nextInvoice}</strong> · Next receipt: <strong className="font-mono">{nextReceipt}</strong> · Next credit note:{" "}
              <strong className="font-mono">{nextReturn}</strong>
            </p>
            <p className="text-xs text-muted">All restart at 1 every 1 April.</p>
          </div>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={f.pending}>
          {f.pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
