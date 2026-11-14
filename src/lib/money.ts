/**
 * Money is handled as integer paise everywhere in calculations so there is no
 * floating-point drift. Strings with up to 2 decimals come in, strings go out.
 */

/** "1,234.5" -> 123450. Assumes the value was validated (≤ 2 decimals). */
export function toPaise(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const s = String(v).replace(/,/g, "").trim();
  const neg = s.startsWith("-");
  const [i = "0", f = ""] = s.replace(/^-/, "").split(".");
  const p = Number(i || 0) * 100 + Number((f + "00").slice(0, 2));
  return neg ? -p : p;
}

/** 123450 -> "1234.50" */
export function fromPaise(p: number): string {
  const neg = p < 0;
  const a = Math.abs(Math.round(p));
  const s = `${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

/** Round half away from zero to whole paise. */
export const roundPaise = (x: number) => Math.sign(x) * Math.round(Math.abs(x));

/** `rate`% of an amount in paise (rate may have decimals, e.g. 0.25). */
export function percentOf(paise: number, rate: number): number {
  const bp = Math.round(rate * 100); // basis points
  return roundPaise((paise * bp) / 10000);
}

/** Validated money string: up to 10 digits + 2 decimals. */
export const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;
