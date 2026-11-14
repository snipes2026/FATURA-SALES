export const APP_TZ = "Asia/Kolkata";

/** Today's date in India as YYYY-MM-DD (independent of server timezone). */
export function todayIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ }).format(now);
}

/**
 * Indian financial year (April–March) for a YYYY-MM-DD date, as "25-26".
 * 2026-03-31 -> "25-26", 2026-04-01 -> "26-27".
 */
export function financialYear(isoDate: string = todayIST()): string {
  const [y, m] = isoDate.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  const two = (n: number) => String(n % 100).padStart(2, "0");
  return `${two(start)}-${two(start + 1)}`;
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: APP_TZ, day: "2-digit", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: APP_TZ,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** "2026-11-13" or Date -> "13 Nov 2026" */
export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return "";
  const d = typeof v === "string" ? new Date(`${v.slice(0, 10)}T00:00:00+05:30`) : v;
  return dateFmt.format(d);
}

export const formatDateTime = (v: Date | string | null | undefined) => (v ? dateTimeFmt.format(new Date(v)) : "");
