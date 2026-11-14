import { requirePermission } from "@/lib/session";
import { SettingsTabs } from "./tabs";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requirePermission("settings.manage");
  return (
    <div className="space-y-4">
      <SettingsTabs />
      {children}
    </div>
  );
}
