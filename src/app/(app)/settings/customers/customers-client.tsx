"use client";

import { useCallback, useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { BalanceText } from "@/components/customers/balance-text";
import { CustomerFields, emptyCustomer, type CustomerFormValues } from "@/components/customers/customer-fields";
import { useForm } from "@/components/forms/use-form";
import { Button } from "@/components/ui/button";
import { ActiveChip, Chip } from "@/components/ui/chip";
import { DataTable } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { FormError } from "@/components/ui/fields";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { stateName } from "@/lib/india";
import { customerSchema } from "@/lib/validation/sales";
import { deleteCustomer, saveCustomer } from "./actions";

export type CustomerRow = {
  id: number;
  name: string;
  address: string;
  gstin: string;
  stateCode: string;
  phone: string;
  openingBalance: string;
  openingType: "DR" | "CR";
  openingDate: string;
  isActive: boolean;
  isWalkin: boolean;
  balancePaise: number;
  voucherCount: number;
};

export function CustomersClient({ rows, companyStateCode, today }: { rows: CustomerRow[]; companyStateCode: string; today: string }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [toDelete, setToDelete] = useState<CustomerRow | null>(null);
  const [deleting, startDelete] = useTransition();
  const toast = useToast();
  const f = useForm<CustomerFormValues>(emptyCustomer(companyStateCode, today));

  const openNew = () => {
    setEditing(null);
    f.reset(emptyCustomer(companyStateCode, today));
    setOpen(true);
  };
  const openEdit = (r: CustomerRow) => {
    setEditing(r);
    f.reset({
      id: r.id,
      name: r.name,
      address: r.address,
      gstin: r.gstin,
      stateCode: r.stateCode,
      phone: r.phone,
      openingBalance: r.openingBalance,
      openingType: r.openingType,
      openingDate: r.openingDate,
      isActive: r.isActive,
    });
    setOpen(true);
  };
  const close = useCallback(() => setOpen(false), []);

  const confirmDelete = () => {
    if (!toDelete) return;
    startDelete(async () => {
      const r = await deleteCustomer({ id: toDelete.id });
      if (r.ok) toast.success(r.message ?? "Deleted");
      else toast.error(r.error ?? "Could not delete");
      setToDelete(null);
    });
  };

  return (
    <>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.name} ${r.phone} ${r.gstin} ${stateName(r.stateCode)}`}
        searchPlaceholder="Search name, phone, GSTIN…"
        onRowClick={openEdit}
        rowClassName={(r) => (r.isActive ? undefined : "text-muted")}
        toolbar={
          <Button onClick={openNew}>
            <Plus /> Add Customer
          </Button>
        }
        columns={[
          {
            key: "name",
            header: "Customer",
            cell: (r) => (
              <span className="font-medium">
                {r.name} {r.isWalkin && <Chip tone="primary">System</Chip>}
              </span>
            ),
          },
          { key: "phone", header: "Contact", cell: (r) => r.phone },
          { key: "gstin", header: "GSTIN", cell: (r) => <span className="font-mono text-xs">{r.gstin || "—"}</span> },
          { key: "state", header: "State", cell: (r) => stateName(r.stateCode) },
          { key: "bal", header: "Balance", align: "right", cell: (r) => <BalanceText paise={r.balancePaise} short /> },
          { key: "status", header: "Status", cell: (r) => <ActiveChip active={r.isActive} /> },
        ]}
        rowActions={(r) => (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => openEdit(r)} aria-label={`Edit ${r.name}`}>
              <Pencil />
            </Button>
            {!r.isWalkin && r.voucherCount === 0 && (
              <Button variant="ghost" size="sm" onClick={() => setToDelete(r)} aria-label={`Delete ${r.name}`}>
                <Trash2 />
              </Button>
            )}
          </div>
        )}
        empty="No customers yet — add your first one."
      />

      <Drawer
        open={open}
        title={editing ? `Edit customer — ${editing.name}` : "Add customer"}
        onClose={close}
        pending={f.pending}
        width={560}
        onSubmit={() => f.submit(customerSchema, saveCustomer, () => setOpen(false))}
      >
        <FormError>{f.errors._form}</FormError>
        <CustomerFields
          f={f}
          openingLocked={!!editing && editing.voucherCount > 0}
          isWalkin={editing?.isWalkin}
          usedNote={editing && editing.voucherCount > 0 ? "Has bills or receipts — can be deactivated, not deleted" : undefined}
        />
      </Drawer>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete customer?"
        message={
          <>
            <strong>{toDelete?.name}</strong> has no bills or receipts and will be deleted permanently.
          </>
        }
        confirmLabel="Delete"
        tone="danger"
        pending={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </>
  );
}
