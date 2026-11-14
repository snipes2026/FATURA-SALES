"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export const TOPBAR_SLOT_ID = "topbar-slot";

/** Renders children into the top bar (e.g. the GRN status chip). */
export function TopbarSlot({ children }: { children: React.ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => setEl(document.getElementById(TOPBAR_SLOT_ID)), []);
  return el ? createPortal(children, el) : null;
}
