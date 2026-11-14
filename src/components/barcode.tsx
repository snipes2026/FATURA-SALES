"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

/**
 * Code 128 barcode rendered as SVG. With `fit`, the SVG scales to its CSS box
 * (all bars stretch by the same factor, so it stays scannable) — used for
 * labels sized in millimetres.
 */
export function BarcodeSvg({
  value,
  height = 40,
  width = 1.4,
  displayValue = false,
  fit = false,
  className,
  style,
  onRendered,
}: {
  value: string;
  height?: number;
  width?: number;
  displayValue?: boolean;
  fit?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onRendered?: () => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg || !value) return;
    try {
      JsBarcode(svg, value, { format: "CODE128", height, width, displayValue, margin: 0, fontSize: 12, background: "transparent" });
      if (fit) {
        const w = parseFloat(svg.getAttribute("width") ?? "0");
        const h = parseFloat(svg.getAttribute("height") ?? "0");
        if (w && h) {
          svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
          svg.removeAttribute("width");
          svg.removeAttribute("height");
          svg.setAttribute("preserveAspectRatio", "none");
        }
      }
    } catch {
      svg.innerHTML = "";
    }
    onRendered?.();
    // onRendered is a notification only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, height, width, displayValue, fit]);
  return <svg ref={ref} className={className} style={style} role="img" aria-label={`Barcode ${value}`} />;
}
