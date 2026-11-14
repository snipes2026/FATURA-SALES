"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/actions/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldError, Label } from "@/components/ui/label";

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <div>
        <Label htmlFor="username" required>
          Username
        </Label>
        <Input id="username" name="username" autoComplete="username" autoFocus autoCapitalize="none" defaultValue={state?.username} key={state?.username} invalid={!!state?.fieldErrors?.username} />
        <FieldError>{state?.fieldErrors?.username}</FieldError>
      </div>
      <div>
        <Label htmlFor="password" required>
          Password
        </Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" invalid={!!state?.fieldErrors?.password} />
        <FieldError>{state?.fieldErrors?.password}</FieldError>
      </div>
      {state?.error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
