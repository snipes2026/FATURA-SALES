"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScanBarcode } from "lucide-react";
import { BalanceText } from "@/components/customers/balance-text";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { beep } from "@/lib/beep";
import type { CustomerAccount } from "@/lib/customers";
import { formatDate } from "@/lib/dates";
import { formatAmount, stateName } from "@/lib/india";
import { fromPaise, toPaise } from "@/lib/money";
import { calcSale, type SaleGstMode } from "@/lib/sales/gst";
import { checkReturnQty, linkedLineTax } from "@/lib/sales/return-calc";
import type { CurrentUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import { CustomerPicker, type CustomerPickerHandle } from "../../sales/_components/customer-picker";
import { TotalsBar } from "../../sales/_components/totals-bar";
import type { CustomerHit } from "../../sales/_lib/queries";
import { returnBillLinesAction, returnCustomerAction, returnHintsAction, returnLookupAction, saveReturnAction, searchReturnBillsAction } from "../actions";
import { AdjustmentPanel, adjustInvalid, computeAdjust, EMPTY_ADJUST, type AdjustState } from "./adjustment-panel";
import type { BillLine, ReturnableBill } from "../_lib/queries";
import { qtyBasis, type ReturnItem, type ReturnScreenSettings } from "../_lib/return-types";
import { ReturnItemsTable } from "./return-items";

type Location = CurrentUser["locations"][number];

const fieldCls = "h-9 rounded-md border border-border bg-surface px-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";
const newKey = (id: number) => `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export function ReturnScreen({
  today,
  locations,
  defaultLocationId,
  walkin,
  settings,
}: {
  today: string;
  locations: Location[];
  defaultLocationId: number | null;
  walkin: CustomerHit | null;
  settings: ReturnScreenSettings;
}) {
  const toast = useToast();
  const [customer, setCustomer] = useState<CustomerHit | null>(walkin);
  const [returnDate, setReturnDate] = useState(today);
  const [locationId, setLocationId] = useState<number | null>(defaultLocationId ?? locations[0]?.id ?? null);
  const [gstMode, setGstMode] = useState<SaleGstMode>(settings.defaultGstMode);
  const [gstOverride, setGstOverride] = useState<number | null>(null);
  const [roundOff, setRoundOff] = useState<number | null>(null);
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [bills, setBills] = useState<ReturnableBill[]>([]);
  const [billQuery, setBillQuery] = useState("");
  const [linked, setLinked] = useState<ReturnableBill | null>(null);
  const [lines, setLines] = useState<BillLine[]>([]);
  const [items, setItems] = useState<ReturnItem[]>([]);
  const itemsRef = useRef<ReturnItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [adjust, setAdjust] = useState<AdjustState>(EMPTY_ADJUST);

  const barcodeRef = useRef<HTMLInputElement>(null);
  const customerRef = useRef<CustomerPickerHandle>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const location = locations.find((l) => l.id === locationId) ?? null;
  const interState = linked ? linked.taxType === "INTER" : !!customer && !!location && customer.stateCode !== location.stateCode;

  const commit = useCallback((next: ReturnItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);
  const focusBarcode = useCallback(() => setTimeout(() => barcodeRef.current?.focus(), 0), []);
  useEffect(() => {
    focusBarcode();
  }, [focusBarcode]);

  const refuse = useCallback(
    (msg: string) => {
      beep("error");
      toast.error(msg);
    },
    [toast],
  );

  // Customer → balance, pending bills, credit and the bills a return can be made against.
  // The linked bill belongs to the old customer, so it goes; free-form rows get the new customer's hints.
  const customerId = customer?.id ?? null;
  useEffect(() => {
    setAccount(null);
    setBills([]);
    setBillQuery("");
    setLinked(null);
    setLines([]);
    setAdjust(EMPTY_ADJUST);
    if (!customerId) return;
    let live = true;
    void returnCustomerAction({ id: customerId }).then((r) => {
      if (!live) return;
      if (r.ok && r.data) {
        setAccount(r.data.account);
        setBills(r.data.bills);
      } else toast.error((!r.ok && r.error) || "Could not load the customer");
    });
    const current = itemsRef.current.filter((i) => !i.origin);
    if (current.length !== itemsRef.current.length) commit(current);
    if (current.length)
      void returnHintsAction({ customerId, productIds: [...new Set(current.map((i) => i.productId))] }).then((r) => {
        if (!live || !r.ok || !r.data) return;
        const h = r.data;
        commit(itemsRef.current.map((i) => (h[i.productId] ? { ...i, sold: h[i.productId].sold, returned: h[i.productId].returned, lastRate: h[i.productId].lastRate } : i)));
      });
    return () => {
      live = false;
    };
  }, [customerId, toast, commit]);

  // Walk-in Customer: search bills by number instead of listing all of them
  useEffect(() => {
    if (!customerId || !customer?.isWalkin) return;
    const t = setTimeout(() => {
      void searchReturnBillsAction({ customerId, q: billQuery }).then((r) => r.ok && r.data && setBills(r.data));
    }, 250);
    return () => clearTimeout(t);
  }, [billQuery, customerId, customer?.isWalkin]);

  const onLinkedBill = async (id: number | null) => {
    const bill = id ? (bills.find((b) => b.id === id) ?? null) : null;
    if (itemsRef.current.length) toast.warning("Items cleared — scan them again for the new selection");
    commit([]);
    setLinked(bill);
    setLines([]);
    setAdjust((s) => ({ ...s, manual: null }));
    setGstOverride(null);
    setRoundOff(null);
    if (!bill) {
      setGstMode(settings.defaultGstMode);
      return focusBarcode();
    }
    setGstMode(bill.gstMode);
    const r = await returnBillLinesAction({ salesId: bill.id });
    if (r.ok && r.data) setLines(r.data);
    else toast.error((!r.ok && r.error) || "Could not load the bill");
    focusBarcode();
  };

  // F2 customer, F3 barcode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        customerRef.current?.focus();
      } else if (e.key === "F3") {
        e.preventDefault();
        barcodeRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!items.length) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [items.length]);

  const processScan = useCallback(
    async (raw: string) => {
      const code = raw.trim().toUpperCase();
      if (!code || !locationId) return;
      if (!customerId) return refuse("Select the customer first (F2)");
      const current = itemsRef.current;

      if (linked) {
        // Against a bill: the item must be on that bill; rate, GST rate and mode come from it
        const onBill = lines.filter((l) => l.barcode.toUpperCase() === code);
        if (!onBill.length) return refuse(`${code} is not on ${linked.billNo}`);
        const row = settings.autoIncrementQty ? current.find((i) => i.origin && onBill.some((l) => l.id === i.origin!.id)) : undefined;
        if (row) return commit(current.map((i) => (i.key === row.key ? { ...i, qty: i.qty + 1 } : i)));
        const used = new Set(current.map((i) => i.origin?.id));
        const l = onBill.find((x) => !used.has(x.id)) ?? onBill[0];
        return commit([
          ...current,
          {
            key: newKey(l.productId),
            productId: l.productId,
            barcode: l.barcode,
            itemName: l.itemName,
            hsn: l.hsn,
            dept: { gstRate: String(l.gstRate), slabEnabled: false, slabThreshold: null, slabRateAbove: null },
            qty: 1,
            rate: l.rate,
            sold: 0,
            returned: 0,
            lastRate: null,
            origin: { id: l.id, qty: l.qty, rate: l.rate, amount: l.amount, gst: l.gst, gstRate: l.gstRate, returned: l.returned },
          },
        ]);
      }

      if (settings.autoIncrementQty) {
        const row = current.find((i) => i.barcode.toUpperCase() === code);
        if (row) return commit(current.map((i) => (i.key === row.key ? { ...i, qty: i.qty + 1 } : i)));
      }
      const r = await returnLookupAction({ barcode: code, locationId, customerId });
      if (!r.ok || !r.data) return refuse((!r.ok && r.error) || `Barcode "${code}" not found`);
      const p = r.data;
      const rate = p.hint.lastRate ?? p.wsp ?? "";
      if (!p.hint.lastRate) toast.warning(`${p.itemName}: never billed to this customer — ${rate ? "rate set to the WSP" : "enter the rate"}`);
      commit([
        ...itemsRef.current,
        {
          key: newKey(p.productId),
          productId: p.productId,
          barcode: p.barcode,
          itemName: p.itemName,
          hsn: p.hsn,
          dept: p.dept,
          qty: 1,
          rate,
          sold: p.hint.sold,
          returned: p.hint.returned,
          lastRate: p.hint.lastRate,
          origin: null,
        },
      ]);
    },
    [commit, customerId, linked, lines, locationId, refuse, settings.autoIncrementQty, toast],
  );

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

  const onGstMode = (m: SaleGstMode) => {
    setGstMode(m);
    setGstOverride(null);
    setRoundOff(null);
  };

  const clearReturn = () => {
    commit([]);
    setCustomer(walkin);
    setReturnDate(today);
    setLinked(null);
    setLines([]);
    setGstMode(settings.defaultGstMode);
    setGstOverride(null);
    setRoundOff(null);
    setAdjust(EMPTY_ADJUST);
    focusBarcode();
  };

  const calc = useMemo(
    () =>
      calcSale({
        lines: items.map((i) => {
          const ratePaise = toPaise(i.rate);
          const tax = i.origin && linked ? linkedLineTax({ amount: toPaise(i.origin.amount), gstRate: i.origin.gstRate, gst: toPaise(i.origin.gst) }, linked.gstOverridden, ratePaise * i.qty) : {};
          return { qty: i.qty, ratePaise, hsn: i.hsn, dept: i.dept, ...tax };
        }),
        gstMode,
        taxType: interState ? "INTER" : "INTRA",
        gstOverride: gstMode === "ADD" && !linked ? gstOverride : null,
        roundOff,
      }),
    [items, linked, gstMode, interState, gstOverride, roundOff],
  );

  const qtyCheck = useMemo(
    () =>
      checkReturnQty(
        settings.returnQtyCheck,
        items.map((i) => ({ ...qtyBasis(i), ref: i.barcode, qty: i.qty })),
      ),
    [items, settings.returnQtyCheck],
  );
  const issues = useMemo(() => new Map(qtyCheck.issues.map((x) => [x.key, x])), [qtyCheck]);

  const adjResult = useMemo(
    () =>
      computeAdjust(adjust, {
        returnValue: Math.max(0, calc.net),
        dues: account?.dues ?? [],
        advanceAvailable: account?.advanceAvailable ?? 0,
        linkedSalesId: linked?.id ?? null,
        isWalkin: !!customer?.isWalkin,
      }),
    [adjust, calc.net, account, linked?.id, customer?.isWalkin],
  );

  /** Reasons the return can't be saved yet (shown on the Save button). */
  const blockers = useMemo(() => {
    const b: string[] = [];
    if (!customer) b.push("Select a customer");
    if (customer && !account) b.push("Loading the customer's balance…");
    if (!items.length) b.push("Add at least one item");
    if (items.some((i) => i.rate === "" || toPaise(i.rate) <= 0)) b.push("Enter the rate for every item");
    if (items.length && calc.net <= 0) b.push("Net Return Value must be more than ₹0");
    if (qtyCheck.status === "BLOCK") b.push(qtyCheck.issues[0].message);
    if (adjustInvalid(adjust)) b.push("Fix the allocated amounts");
    if (items.length && calc.net > 0) b.push(...adjResult.errors.map((e) => e.message));
    return b;
  }, [customer, account, items, calc.net, qtyCheck, adjust, adjResult.errors]);

  const [saving, setSaving] = useState(false);
  const [qtyAsk, setQtyAsk] = useState<{ print: boolean } | null>(null);

  const trySave = (print: boolean) => {
    if (saving) return;
    if (blockers.length) {
      beep("error");
      toast.error(blockers[0]);
      return;
    }
    if (qtyCheck.status === "WARN") return setQtyAsk({ print });
    void save(print, false);
  };

  const save = async (print: boolean, qtyConfirmed: boolean) => {
    if (!customer || !locationId) return;
    const win = print ? window.open("about:blank", "_blank") : null; // inside the click, so it isn't blocked as a popup
    setSaving(true);
    try {
      const r = await saveReturnAction({
        customerId: customer.id,
        locationId,
        returnDate,
        againstSalesId: linked?.id ?? null,
        gstMode,
        gstOverride: gstMode === "ADD" && !linked && gstOverride !== null ? fromPaise(gstOverride) : null,
        roundOff: roundOff !== null ? fromPaise(roundOff) : null,
        lines: items.map((i) => ({ productId: i.productId, qty: i.qty, rate: fromPaise(toPaise(i.rate)), originalSalesLineId: i.origin?.id ?? null })),
        adjustment: { manual: adjust.manual, remainder: adjResult.remainder, refundMode: adjResult.refund > 0 ? adjResult.refundMode : null },
        qtyConfirmed,
        remarks: "",
        expectedNet: fromPaise(calc.net),
      });
      if (!r.ok || !r.data) {
        win?.close();
        beep("error");
        toast.error((!r.ok && r.error) || "Could not save the return");
        if (!r.ok && r.code === "CONFLICT" && customer) {
          // Someone else changed this customer's dues — reload them
          const a = await returnCustomerAction({ id: customer.id });
          if (a.ok && a.data) setAccount(a.data.account);
          setAdjust((s) => ({ ...s, manual: null }));
        }
        return;
      }
      const d = r.data;
      toast.success(`Saved ${d.returnNo}`);
      if (d.refund > 0) toast.warning(`Refund ₹${formatAmount(fromPaise(d.refund))} by ${d.refundMode === "CASH" ? "cash" : d.refundMode === "BANK1" ? settings.bank1Name : settings.bank2Name}`);
      if (win) win.location.href = `/print/sales-returns/${d.id}?auto=1`;
      const sameCustomer = customer.id === walkin?.id;
      clearReturn();
      if (sameCustomer && walkin) {
        const a = await returnCustomerAction({ id: walkin.id });
        if (a.ok && a.data) {
          setAccount(a.data.account);
          setBills(a.data.bills);
        }
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
      {/* ------------------------------------------------ center: the return */}
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-stretch gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3">
          <div className="min-w-[260px] flex-1 space-y-2">
            <CustomerPicker
              ref={customerRef}
              selectedLabel={customer ? `${customer.name}${customer.phone && !customer.isWalkin ? ` · ${customer.phone}` : ""}` : ""}
              onPick={(c) => {
                setCustomer(c);
                focusBarcode();
              }}
            />
            {customer ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                {customer.isWalkin && <Chip tone="primary">Walk-in · refund only</Chip>}
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
            {customer ? (
              <BalanceText paise={account?.balancePaise ?? customer.balancePaise} returnCredit={account?.advanceFromReturns} className="text-base" />
            ) : (
              <span className="text-muted">—</span>
            )}
            {!!account?.dues.length && (
              <span className="text-[11px] text-muted">
                {account.dues.length} pending {account.dues.length === 1 ? "bill" : "bills"}
              </span>
            )}
          </div>
          <div className="flex items-end gap-2">
            <label className="text-xs text-muted">
              Return Date
              <input type="date" className={cn(fieldCls, "mt-1 block")} value={returnDate} max={today} onChange={(e) => setReturnDate(e.target.value)} />
            </label>
            <label className="text-xs text-muted" title="Returned goods go back into stock here">
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

        {/* Against bill (optional) */}
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-3 py-2">
          <span className="text-sm font-medium">Against Bill</span>
          {customer?.isWalkin && (
            <input aria-label="Search bill number" placeholder="Search bill no." className={cn(fieldCls, "w-40")} value={billQuery} onChange={(e) => setBillQuery(e.target.value)} />
          )}
          <select
            aria-label="Against bill"
            className={cn(fieldCls, "min-w-[18rem]")}
            value={linked?.id ?? ""}
            disabled={!customer}
            onChange={(e) => void onLinkedBill(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— None (free-form return) —</option>
            {linked && !bills.some((b) => b.id === linked.id) && <option value={linked.id}>{linked.billNo}</option>}
            {bills.map((b) => (
              <option key={b.id} value={b.id}>
                {b.billNo} · {formatDate(b.billDate)} · ₹{formatAmount(b.net)}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted">
            {linked
              ? `Rate, GST mode (${linked.gstMode === "ADD" ? "Add GST" : "Includes GST"}) and GST rate come from ${linked.billNo}; only its items can be returned.`
              : customer && !bills.length
                ? customer.isWalkin && billQuery
                  ? "No bill matches"
                  : "No saved bills for this customer — free-form return"
                : "Optional — leave blank for a free-form return"}
          </span>
        </div>

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
            placeholder={locationId ? "Scan or type the barcode of the returned item and press Enter (F3)" : "No location assigned"}
            disabled={!locationId}
            className="h-14 w-full rounded-[var(--radius-card)] border-2 border-primary/40 bg-surface pl-12 pr-28 font-mono text-xl tracking-wide focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15"
          />
          {scanning && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-muted">Looking up…</span>}
        </form>

        <div className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-card)] border border-border bg-surface">
          <ReturnItemsTable
            items={items}
            issues={issues}
            issueTone={qtyCheck.status === "BLOCK" ? "danger" : "warning"}
            linkedBillNo={linked?.billNo ?? null}
            onQty={(key, qty) => commit(itemsRef.current.map((i) => (i.key === key ? { ...i, qty } : i)))}
            onRate={(key, rate) => commit(itemsRef.current.map((i) => (i.key === key ? { ...i, rate } : i)))}
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
          totalQty={calc.qty}
          netLabel="Net Return Value"
          gstModeLocked={linked ? `Fixed by ${linked.billNo}` : undefined}
        />
      </section>

      {/* ------------------------------------------------ right: adjustment panel */}
      <aside className="flex w-[380px] shrink-0 flex-col rounded-[var(--radius-card)] border border-border bg-surface p-3">
        <AdjustmentPanel
          state={adjust}
          onChange={setAdjust}
          result={adjResult}
          returnValue={calc.net}
          balanceBefore={account?.balancePaise ?? null}
          isWalkin={!!customer?.isWalkin}
          bank1Name={settings.bank1Name}
          bank2Name={settings.bank2Name}
          bank2Enabled={settings.bank2Enabled}
          showErrors={items.length > 0 && calc.net > 0}
          notice={
            qtyCheck.status !== "OK" && (
              <p className={cn("rounded-md px-3 py-2 text-xs", qtyCheck.status === "BLOCK" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>
                {qtyCheck.status === "BLOCK"
                  ? `Some items are more than ${linked ? `what is on ${linked.billNo}` : "what was sold to this customer"} — the return can't be saved.`
                  : `Some items are more than ${linked ? `what is on ${linked.billNo}` : "what was sold to this customer"} — you'll be asked to confirm.`}
              </p>
            )
          }
          footer={
            <>
              <Button size="lg" className="w-full" onClick={() => trySave(true)} title={blockers[0]} aria-disabled={blockers.length > 0} disabled={saving}>
                {saving ? "Saving…" : "Save & Print Credit Note"}
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => trySave(false)} title={blockers[0] ?? "Ctrl+S"} aria-disabled={blockers.length > 0} disabled={saving}>
                  Save
                </Button>
                <Button variant="secondary" onClick={clearReturn} disabled={saving}>
                  Clear
                </Button>
              </div>
            </>
          }
        />
      </aside>

      <ConfirmDialog
        open={!!qtyAsk}
        tone="warning"
        title="Return more than was sold?"
        message={
          <ul className="list-disc space-y-1 pl-4">
            {qtyCheck.issues.map((x) => (
              <li key={x.key}>{x.message}</li>
            ))}
          </ul>
        }
        confirmLabel="Yes, save the return"
        cancelLabel="Go back"
        onConfirm={() => {
          const print = qtyAsk?.print ?? false;
          setQtyAsk(null);
          void save(print, true);
        }}
        onCancel={() => {
          setQtyAsk(null);
          focusBarcode();
        }}
      />
    </div>
  );
}
