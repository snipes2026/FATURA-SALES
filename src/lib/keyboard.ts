const FOCUSABLE =
  "input:not([disabled]):not([type=hidden]):not([readonly]):not([tabindex='-1']), select:not([disabled]), textarea:not([disabled]), button[data-entry-stop]:not([disabled])";

/**
 * Keyboard-first entry: move focus to the next field inside the closest
 * [data-entry-root]. Returns false when `el` is the last field.
 */
export function focusNext(el: HTMLElement): boolean {
  const root = el.closest<HTMLElement>("[data-entry-root]") ?? document.body;
  const fields = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((f) => f.offsetParent !== null);
  const i = fields.indexOf(el);
  const next = i >= 0 ? fields[i + 1] : undefined;
  if (!next) return false;
  next.focus();
  if (next instanceof HTMLInputElement && next.type !== "checkbox" && next.type !== "date") next.select?.();
  return true;
}

/** onKeyDown handler for an entry root: Enter moves to the next field (textarea and buttons keep Enter). */
export function enterToNext(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== "Enter" || e.defaultPrevented || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
  const t = e.target as HTMLElement;
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLButtonElement) return;
  if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) return;
  e.preventDefault();
  focusNext(t);
}
