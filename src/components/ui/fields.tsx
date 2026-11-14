"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "./input";
import { FieldError, Label } from "./label";

const controlCls =
  "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-muted";

type Base = { label: string; name: string; error?: string; required?: boolean; hint?: React.ReactNode; className?: string };

export function TextField({
  label,
  name,
  error,
  required,
  hint,
  className,
  inputClassName,
  ...props
}: Base & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name"> & { inputClassName?: string }) {
  const id = `f-${name}`;
  return (
    <div className={className}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      <Input id={id} name={name} invalid={!!error} className={inputClassName} {...props} />
      {error ? <FieldError>{error}</FieldError> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function TextAreaField({
  label,
  name,
  error,
  required,
  hint,
  className,
  ...props
}: Base & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "name">) {
  const id = `f-${name}`;
  return (
    <div className={className}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      <textarea id={id} name={name} rows={2} className={cn(controlCls, "h-auto py-2", error && "border-danger")} {...props} />
      {error ? <FieldError>{error}</FieldError> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function SelectField({
  label,
  name,
  error,
  required,
  hint,
  className,
  options,
  placeholder,
  ...props
}: Base &
  Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "name"> & {
    options: { value: string; label: string }[];
    placeholder?: string;
  }) {
  const id = `f-${name}`;
  return (
    <div className={className}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      <select id={id} name={name} className={cn(controlCls, "px-2", error && "border-danger")} aria-invalid={!!error || undefined} {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? <FieldError>{error}</FieldError> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3", disabled && "cursor-not-allowed opacity-60")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          checked ? "bg-primary" : "bg-slate-300",
        )}
      >
        <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
      </button>
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2 text-sm", disabled && "cursor-not-allowed opacity-60")}>
      <input
        type="checkbox"
        className="size-4 rounded border-border accent-[#1e40af]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function FormGrid({ children, cols = 2 }: { children: React.ReactNode; cols?: 1 | 2 | 3 }) {
  return <div className={cn("grid gap-x-4 gap-y-3", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-3")}>{children}</div>;
}

export function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="mb-3 rounded-md border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
      {children}
    </p>
  );
}
