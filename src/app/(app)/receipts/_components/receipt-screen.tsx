"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { customerAccountAction } from "@/app/(app)/sales/actions";
import { CustomerPicker, type CustomerPickerHandle } from "@/app/(app)/sales/_components/customer-picker";
import type { CustomerHit } from "@/app/(app)/sales/_lib/queries";
import { BalanceText } from "@/components/customers/balance-text";
import { PaymentPanel } from "@/components/payments/payment-panel";
import { computePayment, EMPTY_PAYMENT, paymentInvalidFields, type PaymentContext, type PaymentState } from "@/components/payments/payment-state";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { beep } from "@/lib/beep";
import type { CustomerAccount } from "@/lib/customers";
import { formatDate } from "@/lib/dates";
import { formatAmount } from "@/lib/india";
import { fromPaise } from "@/lib/money";
import type { CurrentUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import { saveReceiptAction } from "../actions";

const fieldCls = "h-9 rounded-md border border-border bg-surface px-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";
const amt = (p: number) => formatAmount(fromPaise(p));

/** Customer Receipt: collect money against pending bills (same panel and rules as billing). */
export function ReceiptScreen({
  today,
  locations,
  defaultLocationId,
  initialCustomer,
  bank1Name,
  bank2Name,
  bank2Enabled,
}: {
  today: string;
  locations: CurrentUser["locations"];
  defaultLocationId: number | null;
  initialCustomer: CustomerHit | null;
  bank1Name: string;
  bank2Name: string;
  bank2Enabled: boolean;
}) {
  const toast = useToast();
  const [customer, setCustomer] = useState<CustomerHit | null>(initialCustomer);
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [date, setDate] = useState(today);
  const [locationId, setLocationId] = useState<number | null>(defaultLocationId ?? locations[0]?.id ?? null);
  const [remarks, setRemarks] = useState("");
  const [payment, setPayment] = useState<PaymentState>(EMPTY_PAYMENT);
  const [saving, setSaving] = useState(false);
  const [askAdvance, setAskAdvance] = useState<{ print: boolean } | null>(null);
  const pickerRef = useRef<CustomerPickerHandle>(null);
  const [reload, setReload] = useState(0);

  const customerId = customer?.id ?? null;
  useEffect(() => {
    setAccount(null);
    if (!customerId) return;
    let live = true;
    void customerAccountAction({ id: customerId }).then((r) => {
      if (!live) return;
      if (r.ok && r.data) setAccount(r.data);
      else toast.error((!r.ok && r.error) || "Could not load the balance");
    });
    return () => {
      live = false;
    };
  }, [customerId, reload, toast]);

  useEffect(() => {
    if (!initialCustomer) pickerRef.current?.focus();
    else document.getElementById("pay-cash")?.focus();
  }, [initialCustomer]);

  // F2 customer, F4 cash, Ctrl+S save
  const saveRef = useRef<(print: boolean) => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        pickerRef.current?.focus();
      } else if (e.key === "F4") {
        e.preventDefault();
        (document.getElementById("pay-cash") as HTMLInputElement | null)?.focus();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!document.querySelector("[role=dialog]")) saveRef.current(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ctx: PaymentContext = useMemo(
    () => ({
      billAmount: 0,
      dues: account?.dues ?? [],
      advanceAvailable: 0, // advance is used on bills, not on receipts
      isWalkin: false,
      walkinAllowCredit: false,
      walkinAllowAdvance: false,
      bank2Enabled,
    }),
    [account, bank2Enabled],
  );
  const result = useMemo(() => computePayment(payment, ctx), [payment, ctx]);
  const touched = !!(payment.cash || payment.bank1 || payment.bank2);

  const blockers = [
    ...(!customer ? ["Select a customer"] : []),
    ...(customer && !account ? ["Loading the balance…"] : []),
    ...(paymentInvalidFields(payment).length ? ["Fix the amounts"] : []),
    ...result.errors.map((e) => e.message),
  ];

  const trySave = (print: boolean) => {
    if (saving) return;
    if (blockers.length) {
      beep("error");
      toast.error(blockers[0]);
      return;
    }
    if (result.advanceCreated > 0) return setAskAdvance({ print });
    void save(print);
  };
  saveRef.current = trySave;

  const save = async (print: boolean) => {
    if (!customer || !locationId) return;
    const win = print ? window.open("about:blank", "_blank") : null;
    setSaving(true);
    try {
      const r = await saveReceiptAction({ customerId: customer.id, locationId, receiptDate: date, payment, remarks });
      if (!r.ok || !r.data) {
        win?.close();
        beep("error");
        toast.error((!r.ok && r.error) || "Could not save the receipt");
        if (!r.ok && r.code === "CONFLICT") {
          setPayment((p) => ({ ...p, manual: null }));
          setReload((x) => x + 1);
        }
        return;
      }
      toast.success(`Saved receipt ${r.data.receiptNo}`);
      if (r.data.change > 0) toast.warning(`Return change ₹${amt(r.data.change)}`);
      if (win) win.location.href = `/print/receipts/${r.data.id}?auto=1`;
      setPayment(EMPTY_PAYMENT);
      setRemarks("");
      setReload((x) => x + 1);
    } catch {
      win?.close();
      beep("error");
      toast.error("Could not save — check the connection and try again. Nothing was saved.");
    } finally {
      setSaving(false);
    }
  };

  const pendingTotal = (account?.dues ?? []).reduce((a, d) => a + d.pending, 0);

  return (
    <div className="flex h-full min-h-0 gap-3">
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-stretch gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3">
          <div className="min-w-[280px] flex-1">
            <span className="mb-1 block text-xs text-muted">Customer (F2)</span>
            <CustomerPicker
              ref={pickerRef}
              selectedLabel={customer ? `${customer.name} · ${customer.phone}` : ""}
              onPick={(c) => {
                if (c.isWalkin) return toast.error("Receipts can't be taken for the Walk-in Customer");
                setCustomer(c);
                setPayment(EMPTY_PAYMENT);
                setTimeout(() => document.getElementById("pay-cash")?.focus(), 0);
              }}
            />
          </div>
          <div className="flex min-w-[200px] flex-col justify-center rounded-md bg-slate-50 px-3 py-2">
            <span className="text-xs text-muted">Current Balance</span>
            {customer ? <BalanceText paise={account?.balancePaise ?? customer.balancePaise} className="text-base" /> : <span className="text-muted">—</span>}
          </div>
          <div className="flex items-end gap-2">
            <label className="text-xs text-muted">
              Receipt Date
              <input type="date" className={cn(fieldCls, "mt-1 block")} value={date} max={today} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="text-xs text-muted">
              Location
              <select className={cn(fieldCls, "mt-1 block max-w-[11rem]")} value={locationId ?? ""} onChange={(e) => setLocationId(Number(e.target.value))}>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-card)] border border-border bg-surface">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="border-b border-border px-3 py-2 text-left">Pending bill</th>
                <th className="border-b border-border px-3 py-2 text-left">Date</th>
                <th className="border-b border-border px-3 py-2 text-right">Pending</th>
                <th className="border-b border-border px-3 py-2 text-right">This receipt</th>
              </tr>
            </thead>
            <tbody>
              {!customer && (
                <tr>
                  <td colSpan={4} className="px-3 py-10 text-center text-muted">
                    Choose a customer
                  </td>
                </tr>
              )}
              {customer && account && account.dues.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-10 text-center text-muted">
                    No pending bills — any amount received will be kept as an advance.
                  </td>
                </tr>
              )}
              {(account?.dues ?? []).map((d) => {
                const a = result.rows.find((r) => r.key === d.key)?.amount ?? 0;
                return (
                  <tr key={d.key}>
                    <td className="border-b border-border px-3 py-1.5 font-medium">{d.ref}</td>
                    <td className="border-b border-border px-3 py-1.5">{formatDate(d.date)}</td>
                    <td className="border-b border-border px-3 py-1.5 text-right tabular-nums">{amt(d.pending)}</td>
                    <td className={cn("border-b border-border px-3 py-1.5 text-right tabular-nums", a > 0 ? "font-medium text-success" : "text-muted")}>{a ? amt(a) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
            {pendingTotal > 0 && (
              <tfoot>
                <tr className="font-semibold">
                  <td className="px-3 py-2" colSpan={2}>
                    Total pending
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-danger">{amt(pendingTotal)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{amt(result.appliedToPrevious)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <input
          className={cn(fieldCls, "w-full")}
          placeholder="Remarks (optional) — e.g. cheque no., UPI ref."
          maxLength={300}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
        />
      </section>

      <aside className="flex w-[380px] shrink-0 flex-col rounded-[var(--radius-card)] border border-border bg-surface p-3">
        <PaymentPanel
          state={payment}
          onChange={setPayment}
          result={result}
          ctx={ctx}
          bank1Name={bank1Name}
          bank2Name={bank2Name}
          title="Total Pending"
          showErrors={touched}
          footer={
            <>
              <Button size="lg" className="w-full" onClick={() => trySave(true)} disabled={saving} aria-disabled={blockers.length > 0} title={blockers[0]}>
                <Printer /> {saving ? "Saving…" : "Save & Print"}
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => trySave(false)} disabled={saving} aria-disabled={blockers.length > 0} title={blockers[0] ?? "Ctrl+S"}>
                  Save
                </Button>
                <Button variant="secondary" disabled={saving} onClick={() => setPayment(EMPTY_PAYMENT)}>
                  Clear
                </Button>
              </div>
            </>
          }
        />
      </aside>

      <ConfirmDialog
        open={!!askAdvance}
        title="Keep the extra as advance?"
        message={
          <>
            {pendingTotal > 0 ? "All pending bills are settled. " : ""}
            <strong>₹{amt(result.advanceCreated)}</strong> will be kept as an advance for <strong>{customer?.name}</strong>.
          </>
        }
        confirmLabel="Yes, keep as advance"
        cancelLabel="Go back"
        onConfirm={() => {
          const p = askAdvance?.print ?? false;
          setAskAdvance(null);
          void save(p);
        }}
        onCancel={() => setAskAdvance(null)}
      />
    </div>
  );
}
