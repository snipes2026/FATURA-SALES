"use client";

import { useEffect } from "react";
import { quickCreateCustomer, type NewCustomer } from "@/app/(app)/settings/customers/actions";
import { useForm } from "@/components/forms/use-form";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/fields";
import { Modal } from "@/components/ui/modal";
import { customerSchema } from "@/lib/validation/sales";
import { CustomerFields, emptyCustomer, type CustomerFormValues } from "./customer-fields";

export type { NewCustomer };

/** "+ Add Customer" from the billing and receipt screens. A name typed in the search is pre-filled (or a phone number, if that's what was typed). */
export function QuickCustomerModal({
  open,
  initialText,
  companyStateCode,
  today,
  onClose,
  onCreated,
}: {
  open: boolean;
  initialText: string;
  companyStateCode: string;
  today: string;
  onClose: () => void;
  onCreated: (c: NewCustomer) => void;
}) {
  const f = useForm<CustomerFormValues>(emptyCustomer(companyStateCode, today));
  const { reset } = f;
  useEffect(() => {
    if (!open) return;
    const t = initialText.trim();
    const isPhone = /^[0-9+\-\s()]{6,}$/.test(t);
    reset({ ...emptyCustomer(companyStateCode, today), name: isPhone ? "" : t, phone: isPhone ? t : "" });
  }, [open, initialText, companyStateCode, today, reset]);

  const submit = () => f.submit(customerSchema, quickCreateCustomer, (r) => r.data && onCreated(r.data));

  return (
    <Modal
      open={open}
      title="Add customer"
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={f.pending}>
            {f.pending ? "Adding…" : "Add customer"}
          </Button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormError>{f.errors._form}</FormError>
        <CustomerFields f={f} idPrefix="qc" showActive={false} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
