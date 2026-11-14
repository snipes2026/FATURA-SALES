import type { Metadata } from "next";
import Link from "next/link";
import { FileSpreadsheet, Printer } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { db } from "@/db";
import { stateName } from "@/lib/india";
import { customerLedger } from "@/lib/sales/ledger";
import { LedgerTable } from "../_components/ledger-table";
import { ReportFilters } from "../_components/report-filters";
import { readLedgerParams } from "../_lib/params";

export const metadata: Metadata = { title: "Customer Ledger" };

export default async function CustomerLedgerPage({ searchParams }: { searchParams: Promise<{ customer?: string; from?: string; to?: string }> }) {
  const { customer, from, to } = await readLedgerParams(await searchParams);
  const ledger = customer ? await customerLedger(db, customer.id, from, to) : null;
  const q = customer ? `customer=${customer.id}&from=${from}&to=${to}` : "";

  return (
    <div className="space-y-3">
      <ReportFilters basePath="/customers/ledger" customer={customer ? { id: customer.id, label: customer.name } : null} from={from} to={to} withDates />

      {!customer || !ledger ? (
        <Card className="p-8 text-center text-sm text-muted">Choose a customer to see the ledger.</Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{customer.name}</p>
              <p className="text-xs text-muted">
                {[customer.phone, customer.gstin, stateName(customer.stateCode)].filter(Boolean).join(" · ")}
              </p>
            </div>
            <Link href={`/print/customer-ledger?${q}`} target="_blank" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <Printer /> Print / PDF
            </Link>
            <a href={`/customers/ledger/export?${q}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <FileSpreadsheet /> Excel
            </a>
          </div>
          <div className="overflow-x-auto">
            <LedgerTable ledger={ledger} from={from} to={to} />
          </div>
        </Card>
      )}
    </div>
  );
}
