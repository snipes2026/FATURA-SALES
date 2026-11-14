"use client";

import { useCallback, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { useForm } from "@/components/forms/use-form";
import { Button } from "@/components/ui/button";
import { ActiveChip, Chip } from "@/components/ui/chip";
import { DataTable } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { Checkbox, FormError, FormGrid, SelectField, Switch, TextField } from "@/components/ui/fields";
import { formatDateTime } from "@/lib/dates";
import { userSchema } from "@/lib/validation/masters";
import { saveUser } from "./actions";

type Role = { id: number; code: string; name: string };
type Loc = { id: number; name: string; isActive: boolean };
export type UserRow = {
  id: number;
  name: string;
  username: string;
  roleId: number;
  roleName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  locationIds: number[];
};
type Values = { id?: number; name: string; username: string; roleId: number; locationIds: number[]; isActive: boolean; password: string };

const ROLE_HELP: Record<string, string> = {
  ADMIN: "Everything, including Settings and deleting GRNs",
  GRN_ENTRY: "Create and save GRNs, generate barcodes, add category values",
  VIEWER: "Read-only",
};

export function UsersClient({ rows, roles, locations, meId }: { rows: UserRow[]; roles: Role[]; locations: Loc[]; meId: number }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const defaultRole = roles.find((r) => r.code === "GRN_ENTRY")?.id ?? roles[0]?.id ?? 0;
  const empty: Values = { name: "", username: "", roleId: defaultRole, locationIds: [], isActive: true, password: "" };
  const f = useForm<Values>(empty);
  const close = useCallback(() => setOpen(false), []);
  const locName = (id: number) => locations.find((l) => l.id === id)?.name ?? `#${id}`;

  const openForm = (r: UserRow | null) => {
    setEditing(r);
    f.reset(
      r
        ? { id: r.id, name: r.name, username: r.username, roleId: r.roleId, locationIds: r.locationIds, isActive: r.isActive, password: "" }
        : empty,
    );
    setOpen(true);
  };

  const role = roles.find((r) => r.id === f.values.roleId);
  const isMe = editing?.id === meId;

  return (
    <>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.name} ${r.username} ${r.roleName}`}
        onRowClick={openForm}
        rowClassName={(r) => (r.isActive ? undefined : "text-muted")}
        toolbar={
          <Button onClick={() => openForm(null)}>
            <Plus /> Add User
          </Button>
        }
        columns={[
          {
            key: "name",
            header: "Name",
            cell: (r) => (
              <span className="font-medium">
                {r.name} {r.id === meId && <span className="text-xs font-normal text-muted">(you)</span>}
              </span>
            ),
          },
          { key: "username", header: "Username", cell: (r) => <span className="font-mono text-xs">{r.username}</span> },
          { key: "role", header: "Role", cell: (r) => <Chip tone="primary">{r.roleName}</Chip> },
          { key: "locs", header: "Locations", cell: (r) => r.locationIds.map(locName).join(", ") || <span className="text-warning">None</span> },
          { key: "login", header: "Last login", cell: (r) => (r.lastLoginAt ? formatDateTime(r.lastLoginAt) : "Never") },
          { key: "status", header: "Status", cell: (r) => <ActiveChip active={r.isActive} /> },
        ]}
        rowActions={(r) => (
          <Button variant="ghost" size="sm" onClick={() => openForm(r)} aria-label={`Edit ${r.name}`}>
            <Pencil />
          </Button>
        )}
      />
      <Drawer
        open={open}
        title={editing ? `Edit user — ${editing.name}` : "Add user"}
        onClose={close}
        pending={f.pending}
        onSubmit={() => f.submit(userSchema, saveUser, () => setOpen(false))}
      >
        <FormError>{f.errors._form}</FormError>
        <FormGrid>
          <TextField label="Full name" name="name" required value={f.values.name} onChange={(e) => f.set("name", e.target.value)} error={f.errors.name} />
          <TextField
            label="Username"
            name="username"
            required
            autoCapitalize="none"
            autoComplete="off"
            value={f.values.username}
            onChange={(e) => f.set("username", e.target.value.toLowerCase().replace(/\s/g, ""))}
            error={f.errors.username}
          />
          <SelectField
            className="sm:col-span-2"
            label="Role"
            name="roleId"
            required
            disabled={isMe}
            options={roles.map((r) => ({ value: String(r.id), label: r.name }))}
            value={String(f.values.roleId)}
            onChange={(e) => f.set("roleId", Number(e.target.value))}
            error={f.errors.roleId}
            hint={isMe ? "You can't change your own role" : role ? ROLE_HELP[role.code] : undefined}
          />
          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-[13px] font-medium text-slate-700">
              Allowed locations<span className="ml-0.5 text-danger">*</span>
            </legend>
            <div className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2">
              {locations.map((l) => (
                <Checkbox
                  key={l.id}
                  label={
                    <>
                      {l.name}
                      {!l.isActive && <span className="text-xs text-muted"> (inactive)</span>}
                    </>
                  }
                  checked={f.values.locationIds.includes(l.id)}
                  onChange={(on) =>
                    f.set("locationIds", on ? [...f.values.locationIds, l.id] : f.values.locationIds.filter((x) => x !== l.id))
                  }
                />
              ))}
            </div>
            {f.errors.locationIds && <p className="mt-1 text-xs text-danger">{f.errors.locationIds}</p>}
          </fieldset>
          <TextField
            className="sm:col-span-2"
            label={editing ? "New password" : "Password"}
            name="password"
            type="password"
            autoComplete="new-password"
            required={!editing}
            value={f.values.password}
            onChange={(e) => f.set("password", e.target.value)}
            error={f.errors.password}
            hint={editing ? "Leave blank to keep the current password" : "At least 8 characters"}
          />
          <div className="sm:col-span-2">
            <Switch
              checked={f.values.isActive}
              onChange={(v) => f.set("isActive", v)}
              label="Active"
              disabled={isMe}
              description={isMe ? "You can't deactivate yourself" : "Inactive users can't sign in"}
            />
            {f.errors.isActive && <p className="mt-1 text-xs text-danger">{f.errors.isActive}</p>}
          </div>
        </FormGrid>
      </Drawer>
    </>
  );
}
