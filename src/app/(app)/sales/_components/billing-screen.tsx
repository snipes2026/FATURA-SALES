"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScanBarcode } from "lucide-react";
import { BalanceText } from "@/components/customers/balance-text";
import { QuickCustomerModal, type NewCustomer } from "@/components/customers/quick-customer-modal";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { beep } from "@/lib/beep";
import { PaymentPanel } from "@/components/payments/payment-panel";
import { computePayment, EMPTY_PAYMENT, paymentInvalidFields, type PaymentContext, type PaymentState } from "@/components/payments/payment-state";
import type { CustomerAccount } from "@/lib/customers";
import { formatAmount, stateName } from "@/lib/india";
import { fromPaise, toPaise } from "@/lib/money";
import { calcSale, isBelowCost, type SaleGstMode } from "@/lib/sales/gst";
import type { CurrentUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import { customerAccountAction, lookupBarcodeAction, saveSaleAction, stockAtAction } from "../actions";
import { qtyByProduct, type BillItem, type SalesScreenSettings } from "../_lib/bill-types";
import type { CustomerHit } from "../_lib/queries";
import { CustomerPicker, type CustomerPickerHandle } from "./customer-picker";
import { ItemsTable } from "./items-table";
import { TotalsBar } from "./totals-bar";

type Location = CurrentUser["locations"][number];

const fieldCls = "h-9 rounded-md border border-border bg-surface px-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

export function BillingScreen({
  today,
  companyStateCode,
  locations,
  defaultLocationId,
  walkin,
  canQuickAddCustomer,
  settings,
}: {
  today: string;
  companyStateCode: string;
  locations: Location[];
  defaultLocationId: number | null;
  walkin: CustomerHit | null;
  canQuickAddCustomer: boolean;
  settings: SalesScreenSettings;
}) {
  const toast = useToast();
  const [customer, setCustomer] = useState<CustomerHit | null>(walkin);
  const [billDate, setBillDate] = useState(today);
  const [locationId, setLocationId] = useState<number | null>(defaultLocationId ?? locations[0]?.id ?? null);
  const [gstMode, setGstMode] = useState<SaleGstMode>(settings.defaultGstMode);
  const [gstOverride, setGstOverride] = useState<number | null>(null);
  const [roundOff, setRoundOff] = useState<number | null>(null);
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [payment, setPayment] = useState<PaymentState>(EMPTY_PAYMENT);
  const [items, setItems] = useState<BillItem[]>([]);
  const itemsRef = useRef<BillItem[]>([]);
  const [quickAdd, setQuickAdd] = useState<{ open: boolean; text: string }>({ open: false, text: "" });
  const [belowCostAsk, setBelowCostAsk] = useState<{ key: string; rate: string } | null>(null);
  const [scanning, setScanning] = useState(false);

  const barcodeRef = useRef<HTMLInputElement>(null);
  const customerRef = useRef<CustomerPickerHandle>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const location = locations.find((l) => l.id === locationId) ?? null;
  const interState = !!customer && !!location && customer.stateCode !== location.stateCode;

  /** All item changes go through here so back-to-back scans always see the latest rows. */
  const commit = useCallback((next: BillItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const focusBarcode = useCallback(() => setTimeout(() => barcodeRef.current?.focus(), 0), []);

  useEffect(() => {
    focusBarcode();
  }, [focusBarcode]);

  // Customer's pending bills / advance for the payment panel. A new customer starts a fresh payment.
  const customerId = customer?.id ?? null;
  useEffect(() => {
    setAccount(null);
    setPayment(EMPTY_PAYMENT);
    if (!customerId) return;
    let live = true;
    void customerAccountAction({ id: customerId }).then((r) => {
      if (!live) return;
      if (r.ok && r.data) setAccount(r.data);
      else toast.error((!r.ok && r.error) || "Could not load the customer's balance");
    });
    return () => {
      live = false;
    };
  }, [customerId, toast]);

  // F2 customer, F3 barcode, F4 cash
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        customerRef.current?.focus();
      } else if (e.key === "F3") {
        e.preventDefault();
        barcodeRef.current?.focus();
      } else if (e.key === "F4") {
        e.preventDefault();
        const cash = document.getElementById("pay-cash") as HTMLInputElement | null;
        cash?.focus();
        cash?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Don't lose a bill by closing the tab
  useEffect(() => {
    if (!items.length) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [items.length]);

  const refuse = useCallback(
    (msg: string) => {
      beep("error");
      toast.error(msg);
    },
    [toast],
  );

  /** Is `total` units of this product allowed at this location? Blocks or warns per the setting. */
  const stockOk = useCallback(
    (name: string, stock: number, total: number) => {
      if (total <= stock) return true;
      const msg = `${name}: only ${Math.max(stock, 0)} in stock at ${location?.name ?? "this location"}`;
      if (!settings.allowNegativeStock) {
        refuse(msg);
        return false;
      }
      toast.warning(`${msg} — billing more than stock`);
      return true;
    },
    [location?.name, refuse, settings.allowNegativeStock, toast],
  );

  const processScan = useCallback(
    async (raw: string) => {
      const code = raw.trim().toUpperCase();
      if (!code || !locationId) return;
      const current = itemsRef.current;
      const totals = qtyByProduct(current);

      if (settings.autoIncrementQty) {
        const row = current.find((i) => i.barcode.toUpperCase() === code);
        if (row) {
          if (!stockOk(row.itemName, row.stock, (totals.get(row.productId) ?? 0) + 1)) return;
          commit(current.map((i) => (i.key === row.key ? { ...i, qty: i.qty + 1 } : i)));
          return;
        }
      }

      const r = await lookupBarcodeAction({ barcode: code, locationId });
      if (!r.ok || !r.data) return refuse((!r.ok && r.error) || `Barcode "${code}" not found`);
      const p = r.data;
      const latest = itemsRef.current;
      if (!stockOk(p.itemName, p.stock, (qtyByProduct(latest).get(p.productId) ?? 0) + 1)) return;
      if (!p.wsp && !settings.allowPriceEdit) toast.warning(`${p.itemName} has no WSP — it can't be billed until a price is set`);
      commit([
        ...latest,
        {
          key: `${p.productId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          productId: p.productId,
          barcode: p.barcode,
          itemName: p.itemName,
          hsn: p.hsn,
          dept: p.dept,
          wsp: p.wsp,
          mrp: p.mrp,
          purchaseRate: p.purchaseRate,
          stock: p.stock,
          qty: 1,
          rate: p.wsp ?? "",
          priceEdited: false,
          belowCostConfirmed: false,
        },
      ]);
    },
    [commit, locationId, refuse, settings.allowPriceEdit, settings.autoIncrementQty, stockOk, toast],
  );

  /** Scans run one at a time, in order (a fast scanner can fire several before the first lookup returns). */
  const onScan = (code: string) => {
    setScanning(true);
    queue.current = queue.current
      .then(() => processScan(code))
      .catch(() => refuse("Could not look up the barcode. Check the connection and scan again."))
      .finally(() => {
        setScanning(false);
        focusBarcode();
      });
  };

  const onQty = (key: string, qty: number) => {
    const current = itemsRef.current;
    const row = current.find((i) => i.key === key);
    if (!row) return false;
    const total = (qtyByProduct(current).get(row.productId) ?? 0) - row.qty + qty;
    if (!stockOk(row.itemName, row.stock, total)) return false;
    commit(current.map((i) => (i.key === key ? { ...i, qty } : i)));
    return true;
  };

  const belowCost = useCallback(
    (it: BillItem) => it.rate !== "" && toPaise(it.rate) > 0 && isBelowCost(toPaise(it.rate), it.purchaseRate, it.dept, gstMode),
    [gstMode],
  );

  const applyRate = (key: string, rate: string, confirmed: boolean) =>
    commit(
      itemsRef.current.map((i) =>
        i.key === key ? { ...i, rate, priceEdited: toPaise(rate) !== toPaise(i.wsp ?? ""), belowCostConfirmed: confirmed } : i,
      ),
    );

  const onRate = (key: string, rate: string) => {
    const row = itemsRef.current.find((i) => i.key === key);
    if (!row) return;
    if (toPaise(rate) > 0 && isBelowCost(toPaise(rate), row.purchaseRate, row.dept, gstMode)) {
      beep("error");
      setBelowCostAsk({ key, rate });
      return;
    }
    applyRate(key, rate, false);
  };

  const onLocation = async (id: number) => {
    setLocationId(id);
    const current = itemsRef.current;
    if (!current.length) return;
    const r = await stockAtAction({ locationId: id, productIds: [...new Set(current.map((i) => i.productId))] });
    if (!r.ok || !r.data) return toast.error((!r.ok && r.error) || "Could not refresh stock");
    const stock = r.data;
    commit(itemsRef.current.map((i) => ({ ...i, stock: stock[i.productId] ?? 0 })));
    toast.success(`Stock refreshed for ${locations.find((l) => l.id === id)?.name}`);
  };

  const onCustomerCreated = (c: NewCustomer) => {
    setQuickAdd({ open: false, text: "" });
    setCustomer({ id: c.id, name: c.name, phone: c.phone, gstin: c.gstin, stateCode: c.stateCode, address: "", isWalkin: false, balancePaise: c.balancePaise });
    focusBarcode();
  };

  const clearBill = () => {
    commit([]);
    setCustomer(walkin);
    setBillDate(today);
    setGstMode(settings.defaultGstMode);
    setGstOverride(null);
    setRoundOff(null);
    setPayment(EMPTY_PAYMENT);
    focusBarcode();
  };

  const onGstMode = (m: SaleGstMode) => {
    setGstMode(m);
    setGstOverride(null); // an override only exists in Add GST mode
    setRoundOff(null);
  };

  const calc = useMemo(
    () =>
      calcSale({
        lines: items.map((i) => ({ qty: i.qty, ratePaise: toPaise(i.rate), hsn: i.hsn, dept: i.dept })),
        gstMode,
        taxType: interState ? "INTER" : "INTRA",
        gstOverride: gstMode === "ADD" ? gstOverride : null,
        roundOff,
      }),
    [items, gstMode, interState, gstOverride, roundOff],
  );
  const totalQty = calc.qty;

  const payCtx: PaymentContext = useMemo(
    () => ({
      billAmount: Math.max(0, calc.net),
      dues: account?.dues ?? [],
      advanceAvailable: account?.advanceAvailable ?? 0,
      isWalkin: !!customer?.isWalkin,
      walkinAllowCredit: settings.walkinAllowCredit,
      walkinAllowAdvance: settings.walkinAllowAdvance,
      bank2Enabled: settings.bank2Enabled,
    }),
    [calc.net, account, customer?.isWalkin, settings.walkinAllowCredit, settings.walkinAllowAdvance, settings.bank2Enabled],
  );
  const payResult = useMemo(() => computePayment(payment, payCtx), [payment, payCtx]);

  /** Reasons the bill can't be saved yet (shown on the Save button). */
  const blockers = useMemo(() => {
    const b: string[] = [];
    if (!customer) b.push("Select a customer");
    if (!account && customer) b.push("Loading the customer's balance…");
    if (!items.length) b.push("Add at least one item");
    if (items.some((i) => i.rate === "" || toPaise(i.rate) === 0)) b.push("Some items have no price");
    if (!settings.allowNegativeStock) {
      const t = qtyByProduct(items);
      if (items.some((i) => (t.get(i.productId) ?? 0) > i.stock)) b.push("Some items are more than the stock");
    }
    if (items.some((i) => belowCost(i) && !i.belowCostConfirmed)) b.push("Confirm the prices below purchase rate");
    if (calc.net < 0) b.push("Net payable can't be negative");
    if (paymentInvalidFields(payment).length) b.push("Fix the payment amounts");
    b.push(...payResult.errors.map((e) => e.message));
    return b;
  }, [customer, account, items, settings.allowNegativeStock, belowCost, calc.net, payment, payResult.errors]);

  const [saving, setSaving] = useState(false);
  const [advanceAsk, setAdvanceAsk] = useState<{ print: boolean } | null>(null);

  const trySave = (print: boolean) => {
    if (saving) return;
    if (blockers.length) {
      beep("error");
      toast.error(blockers[0]);
      return;
    }
    // A remainder kept as advance needs a confirmation
    if (payResult.advanceCreated > 0) return setAdvanceAsk({ print });
    void save(print);
  };

  const save = async (print: boolean) => {
    if (!customer || !locationId) return;
    // Open the print window inside the click, so the browser doesn't block it as a popup.
    const win = print ? window.open("about:blank", "_blank") : null;
    setSaving(true);
    try {
      const r = await saveSaleAction({
        customerId: customer.id,
        locationId,
        billDate,
        gstMode,
        gstOverride: gstMode === "ADD" && gstOverride !== null ? fromPaise(gstOverride) : null,
        roundOff: roundOff !== null ? fromPaise(roundOff) : null,
        lines: items.map((i) => ({ productId: i.productId, qty: i.qty, rate: fromPaise(toPaise(i.rate)) })),
        payment,
        expectedNet: fromPaise(calc.net),
      });
      if (!r.ok || !r.data) {
        win?.close();
        beep("error");
        toast.error((!r.ok && r.error) || "Could not save the bill");
        if (!r.ok && r.code === "CONFLICT" && customer) {
          // Someone else changed this customer's dues — reload them
          const a = await customerAccountAction({ id: customer.id });
          if (a.ok && a.data) setAccount(a.data);
          setPayment((p) => ({ ...p, manual: null }));
        }
        return;
      }
      const d = r.data;
      toast.success(`Saved ${d.billNo}${d.receiptNo ? ` · receipt ${d.receiptNo}` : ""}`);
      if (d.change > 0) toast.warning(`Return change ₹${formatAmount(fromPaise(d.change))}`);
      if (win) win.location.href = `/print/sales/${d.id}?auto=1`;
      commit([]);
      setCustomer(walkin);
      setGstMode(settings.defaultGstMode);
      setGstOverride(null);
      setRoundOff(null);
      setPayment(EMPTY_PAYMENT);
      if (customer.id === walkin?.id && walkin) {
        // same customer stays selected — reload its account
        const a = await customerAccountAction({ id: walkin.id });
        if (a.ok && a.data) setAccount(a.data);
      }
    } catch {
      win?.close();
      refuse("Could not save — check the connection and try again. Nothing was saved.");
    } finally {
      setSaving(false);
      focusBarcode();
    }
  };

  // Ctrl+S = Save
  const trySaveRef = useRef(trySave);
  trySaveRef.current = trySave;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!document.querySelector("[role=dialog]")) trySaveRef.current(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* ------------------------------------------------ center: the bill */}
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        {/* Customer + bill header */}
        <div className="flex flex-wrap items-stretch gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3">
          <div className="min-w-[260px] flex-1 space-y-2">
            <CustomerPicker
              ref={customerRef}
              selectedLabel={customer ? `${customer.name}${customer.phone && !customer.isWalkin ? ` · ${customer.phone}` : ""}` : ""}
              onPick={(c) => {
                setCustomer(c);
                focusBarcode();
              }}
              onAdd={canQuickAddCustomer ? (text) => setQuickAdd({ open: true, text }) : undefined}
            />
            {customer ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                {customer.isWalkin && <Chip tone="primary">Walk-in · no credit</Chip>}
                {customer.gstin && <span className="font-mono">{customer.gstin}</span>}
                <span>{stateName(customer.stateCode)}</span>
                <Chip tone={interState ? "warning" : "neutral"}>{interState ? "IGST" : "CGST + SGST"}</Chip>
              </div>
            ) : (
              <p className="text-xs text-danger">Select a customer</p>
            )}
          </div>
          <div className="flex min-w-[200px] flex-col justify-center rounded-md bg-slate-50 px-3 py-2">
            <span className="text-xs text-muted">Current Balance</span>
            {customer ? <BalanceText paise={account?.balancePaise ?? customer.balancePaise} className="text-base" /> : <span className="text-muted">—</span>}
            {!!account?.dues.length && (
              <span className="text-[11px] text-muted">
                {account.dues.length} pending {account.dues.length === 1 ? "bill" : "bills"}
              </span>
            )}
          </div>
          <div className="flex items-end gap-2">
            <label className="text-xs text-muted">
              Bill Date
              <input type="date" className={cn(fieldCls, "mt-1 block")} value={billDate} max={today} onChange={(e) => setBillDate(e.target.value)} />
            </label>
            <label className="text-xs text-muted">
              Location
              <select className={cn(fieldCls, "mt-1 block max-w-[11rem]")} value={locationId ?? ""} onChange={(e) => void onLocation(Number(e.target.value))}>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {/* Barcode */}
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            const input = barcodeRef.current!;
            const code = input.value;
            input.value = "";
            onScan(code);
          }}
        >
          <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 size-6 -translate-y-1/2 text-primary" />
          <input
            ref={barcodeRef}
            aria-label="Barcode"
            autoComplete="off"
            spellCheck={false}
            placeholder={locationId ? "Scan or type a barcode and press Enter (F3)" : "No location assigned — you can't bill"}
            disabled={!locationId}
            className="h-14 w-full rounded-[var(--radius-card)] border-2 border-primary/40 bg-surface pl-12 pr-28 font-mono text-xl tracking-wide focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15"
          />
          {scanning && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-muted">Looking up…</span>}
        </form>

        {/* Items — the only scrolling area */}
        <div className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-card)] border border-border bg-surface">
          <ItemsTable
            items={items}
            allowPriceEdit={settings.allowPriceEdit}
            allowNegativeStock={settings.allowNegativeStock}
            belowCost={belowCost}
            onQty={onQty}
            onRate={onRate}
            onRemove={(key) => commit(itemsRef.current.filter((i) => i.key !== key))}
            onDone={focusBarcode}
          />
        </div>

        <TotalsBar
          calc={calc}
          gstMode={gstMode}
          onGstMode={onGstMode}
          gstOverride={gstOverride}
          onGstOverride={setGstOverride}
          roundOff={roundOff}
          onRoundOff={setRoundOff}
          interState={interState}
          itemCount={items.length}
          totalQty={totalQty}
        />
      </section>

      {/* ------------------------------------------------ right: payment panel */}
      <aside className="flex w-[380px] shrink-0 flex-col rounded-[var(--radius-card)] border border-border bg-surface p-3">
        <PaymentPanel
          state={payment}
          onChange={setPayment}
          result={payResult}
          ctx={payCtx}
          bank1Name={settings.bank1Name}
          bank2Name={settings.bank2Name}
          showErrors={items.length > 0}
          footer={
            <>
              <Button size="lg" className="w-full" onClick={() => trySave(true)} title={blockers[0]} aria-disabled={blockers.length > 0} disabled={saving}>
                {saving ? "Saving…" : "Save & Print"}
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => trySave(false)} title={blockers[0] ?? "Ctrl+S"} aria-disabled={blockers.length > 0} disabled={saving}>
                  Save
                </Button>
                <Button variant="secondary" onClick={clearBill} disabled={saving}>
                  Clear
                </Button>
              </div>
            </>
          }
        />
      </aside>

      <QuickCustomerModal
        open={quickAdd.open}
        initialText={quickAdd.text}
        companyStateCode={companyStateCode}
        today={today}
        onClose={() => {
          setQuickAdd({ open: false, text: "" });
          focusBarcode();
        }}
        onCreated={onCustomerCreated}
      />

      <ConfirmDialog
        open={!!advanceAsk}
        tone="primary"
        title="Keep the extra as advance?"
        message={
          <>
            All bills are settled. <strong>₹{formatAmount(fromPaise(payResult.advanceCreated))}</strong> will be kept as an advance for <strong>{customer?.name}</strong>.
          </>
        }
        confirmLabel="Yes, keep as advance"
        cancelLabel="Go back"
        onConfirm={() => {
          const print = advanceAsk?.print ?? false;
          setAdvanceAsk(null);
          void save(print);
        }}
        onCancel={() => setAdvanceAsk(null)}
      />

      <ConfirmDialog
        open={!!belowCostAsk}
        tone="warning"
        title="Price below purchase rate"
        message={(() => {
          const row = belowCostAsk && items.find((i) => i.key === belowCostAsk.key);
          return row ? (
            <>
              <strong>{row.itemName}</strong>: ₹{formatAmount(belowCostAsk!.rate)} is below the purchase rate ₹{formatAmount(row.purchaseRate)}
              {gstMode === "INCLUDES" ? " (compared without GST)" : ""}. Bill at this price?
            </>
          ) : null;
        })()}
        confirmLabel="Yes, use this price"
        cancelLabel="No, keep the old price"
        onConfirm={() => {
          if (belowCostAsk) applyRate(belowCostAsk.key, belowCostAsk.rate, true);
          setBelowCostAsk(null);
          focusBarcode();
        }}
        onCancel={() => {
          if (belowCostAsk) commit(itemsRef.current.map((i) => (i.key === belowCostAsk.key ? { ...i, rev: (i.rev ?? 0) + 1 } : i)));
          setBelowCostAsk(null);
          focusBarcode();
        }}
      />
    </div>
  );
}
