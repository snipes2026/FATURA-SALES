"use client";

import { useEffect, useRef, useState } from "react";
import { Printer, X } from "lucide-react";
import { BarcodeSvg } from "@/components/barcode";
import { Button } from "@/components/ui/button";

export type Label = {
  barcode: string;
  itemName: string | null;
  cats: string | null;
  mrp: string | null;
  rsp: string | null;
  showText: boolean;
};

const GAP_MM = 2; // between labels (thermal rolls with 2-up/3-up stock, A4 sheets)
const A4_MARGIN_MM = 8;

/**
 * Labels laid out in real millimetres.
 *  - thermal: one printer "page" per row of `perRow` labels (page = row width × label height)
 *  - a4: as many columns as fit on A4 portrait, rows flow onto new pages
 */
export function LabelSheet({
  labels,
  layout,
  widthMm,
  heightMm,
  perRow,
  company,
  grnLabel,
  autoPrint,
}: {
  labels: Label[];
  layout: "a4" | "thermal";
  widthMm: number;
  heightMm: number;
  perRow: number;
  company: string;
  grnLabel: string;
  autoPrint: boolean;
}) {
  const rendered = useRef(0);
  const [ready, setReady] = useState(labels.length === 0);
  const printed = useRef(false);

  const cols = layout === "a4" ? Math.max(1, Math.floor((210 - 2 * A4_MARGIN_MM + GAP_MM) / (widthMm + GAP_MM))) : perRow;
  const rows: Label[][] = [];
  for (let i = 0; i < labels.length; i += cols) rows.push(labels.slice(i, i + cols));
  const rowWidth = cols * widthMm + (cols - 1) * GAP_MM;

  useEffect(() => {
    document.title = `Labels · ${grnLabel} · Fatura Desk`;
  }, [grnLabel]);

  useEffect(() => {
    if (ready && autoPrint && !printed.current && labels.length) {
      printed.current = true;
      const t = setTimeout(() => window.print(), 300);
      return () => clearTimeout(t);
    }
  }, [ready, autoPrint, labels.length]);

  const onRendered = () => {
    rendered.current += 1;
    if (rendered.current >= labels.length) setReady(true);
  };

  const pageCss =
    layout === "thermal"
      ? `@page { size: ${rowWidth}mm ${heightMm}mm; margin: 0; }
         .label-row { height: ${heightMm}mm; break-after: page; page-break-after: always; }
         .label-row:last-child { break-after: auto; page-break-after: auto; }`
      : `@page { size: A4 portrait; margin: ${A4_MARGIN_MM}mm; }
         .label-row { margin-bottom: ${GAP_MM}mm; break-inside: avoid; page-break-inside: avoid; }`;

  const small = widthMm < 45;

  return (
    <>
      <style>{`
        ${pageCss}
        @media print { .no-print { display: none !important; } body { background: #fff !important; } .sheet { padding: 0 !important; } }
        .label { font-family: Arial, Helvetica, sans-serif; color: #000; }
      `}</style>

      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm">
        <strong>{grnLabel}</strong>
        <span className="text-slate-600">
          {labels.length.toLocaleString("en-IN")} label{labels.length === 1 ? "" : "s"} · {widthMm}×{heightMm} mm ·{" "}
          {layout === "a4" ? `A4 sheet, ${cols} per row` : `thermal roll, ${perRow} per row`}
        </span>
        <span className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => window.print()} disabled={!ready || labels.length === 0}>
            <Printer /> Print
          </Button>
          <Button size="sm" variant="secondary" onClick={() => window.close()}>
            <X /> Close
          </Button>
        </span>
      </div>

      {labels.length === 0 && <p className="p-8 text-center text-slate-500">No labels selected.</p>}

      <div className="sheet p-4">
        {rows.map((row, r) => (
          <div key={r} className="label-row flex" style={{ gap: `${GAP_MM}mm`, width: `${rowWidth}mm` }}>
            {row.map((l, i) => (
              <div
                key={i}
                className="label flex shrink-0 flex-col items-center justify-between overflow-hidden text-center outline outline-1 outline-dashed outline-slate-200 print:outline-none"
                style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, padding: "1.2mm 1.5mm" }}
              >
                {company && (
                  <div className="w-full truncate font-bold uppercase" style={{ fontSize: small ? "5.5pt" : "6pt", lineHeight: 1.1 }}>
                    {company}
                  </div>
                )}
                {l.itemName && (
                  <div className="w-full truncate" style={{ fontSize: small ? "6.5pt" : "7pt", lineHeight: 1.15 }}>
                    {l.itemName}
                  </div>
                )}
                {l.cats && (
                  <div className="w-full truncate" style={{ fontSize: "6pt", lineHeight: 1.1 }}>
                    {l.cats}
                  </div>
                )}
                <BarcodeSvg value={l.barcode} fit height={40} width={2} style={{ width: "100%", height: small ? "7mm" : "8mm" }} onRendered={onRendered} />
                {l.showText && (
                  <div className="font-mono tracking-wider" style={{ fontSize: "7pt", lineHeight: 1 }}>
                    {l.barcode}
                  </div>
                )}
                {(l.mrp || l.rsp) && (
                  <div className="flex w-full justify-center gap-[2mm] font-bold" style={{ fontSize: small ? "6.5pt" : "7.5pt", lineHeight: 1.1 }}>
                    {l.mrp && <span>{l.mrp}</span>}
                    {l.rsp && <span>{l.rsp}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
