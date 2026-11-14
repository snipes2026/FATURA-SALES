import { requirePermission } from "@/lib/session";
import { CustomerTabs } from "./tabs";

export default async function CustomersLayout({ children }: { children: React.ReactNode }) {
  await requirePermission("sales.view");
  return (
    <div className="space-y-4">
      <CustomerTabs />
      {children}
    </div>
  );
}
