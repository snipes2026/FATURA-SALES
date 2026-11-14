"use client";

import { useCallback, useState, useTransition } from "react";
import type { z } from "zod";
import { useToast } from "@/components/ui/toast";
import { zodFieldErrors, type ActionResult } from "@/lib/action-result";

/**
 * Small form-state helper: values + per-field errors + submit that validates
 * with the same zod schema the server action uses, then calls the action.
 */
export function useForm<T extends Record<string, unknown>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => {
      if (!e[key as string] && !e._form) return e;
      const next = { ...e };
      delete next[key as string];
      delete next._form;
      return next;
    });
  }, []);

  const reset = useCallback((next: T) => {
    setValues(next);
    setErrors({});
  }, []);

  function submit<R>(
    schema: z.ZodType,
    action: (input: T) => Promise<ActionResult<R>>,
    onSuccess?: (r: Extract<ActionResult<R>, { ok: true }>) => void,
  ) {
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    startTransition(async () => {
      try {
        const r = await action(values);
        if (r.ok) {
          setErrors({});
          if (r.message) toast.success(r.message);
          onSuccess?.(r);
        } else {
          const hasFieldErrors = !!r.fieldErrors && Object.keys(r.fieldErrors).length > 0;
          setErrors({ ...(r.fieldErrors ?? {}), ...(r.error && !hasFieldErrors ? { _form: r.error } : {}) });
          if (r.error) toast.error(r.error);
        }
      } catch {
        toast.error("Something went wrong. Please try again.");
      }
    });
  }

  return { values, set, reset, errors, setErrors, pending, submit };
}
