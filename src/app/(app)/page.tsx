import type { Metadata } from "next";
import Link from "next/link";
import { count, eq } from "drizzle-orm";
import { FileInput, Settings } from "lucide-react";
import { db, schema } from "@/db";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requireUser();
  const { denied } = await searchParams;
  const [[suppliers], [departments], [grns]] = await Promise.all([
    db.select({ n: count() }).from(schema.suppliers).where(eq(schema.suppliers.isActive, true)),
    db.select({ n: count() }).from(schema.departments).where(eq(schema.departments.isActive, true)),
    db.select({ n: count() }).from(schema.grnHeader).where(eq(schema.grnHeader.status, "SAVED")),
  ]);
  const location = user.locations.find((l) => l.id === user.currentLocationId);

  return (
    <div className="space-y-4">
      {denied && (
        <p role="alert" className="rounded-md border border-danger/20 bg-danger-soft px-4 py-2 text-sm text-danger">
          You don&apos;t have permission to open that page.
        </p>
      )}
      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-base font-semibold">Welcome, {user.name}</p>
            <p className="text-sm text-muted">
              Working at <span className="font-medium text-ink">{location?.name ?? "—"}</span> <Chip tone="primary">{user.roleName}</Chip>
            </p>
          </div>
          <div className="flex gap-2">
            {can(user.role, "grn.create") && (
              <Button asChild>
                <Link href="/grn">
                  <FileInput /> GRN
                </Link>
              </Button>
            )}
            {can(user.role, "settings.manage") && (
              <Button variant="secondary" asChild>
                <Link href="/settings">
                  <Settings /> Settings
                </Link>
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Active suppliers" value={suppliers.n} />
        <Stat label="Departments" value={departments.n} />
        <Stat label="Saved GRNs" value={grns.n} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader title={label} />
      <CardBody>
        <p className="num text-left text-2xl font-semibold">{value.toLocaleString("en-IN")}</p>
      </CardBody>
    </Card>
  );
}
