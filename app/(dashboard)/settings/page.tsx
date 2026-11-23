import { Suspense } from "react";
import { getCurrentEmployee } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SettingsClient } from "@/components/settings/settings-client";
import { getSystemRolesAction } from "@/lib/actions/role.actions";
import { getBoardColumnsAction } from "@/lib/actions/board-column.actions";
import { Skeleton } from "@/components/ui/skeleton";

interface SettingsPageProps {
  searchParams?: Promise<{ [key: string]: string | undefined }>;
}

export default function SettingsPage({ searchParams }: SettingsPageProps) {
  return (
    <div className="space-y-6 p-6 h-full overflow-y-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your workspace preferences and configurations.</p>
      </div>

      <Suspense fallback={
        <div className="space-y-4">
          <div className="rounded-xl border border-border/40 bg-card p-6 space-y-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full max-w-md" />
            <div className="space-y-3 pt-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between p-3 border border-border/40 rounded-lg">
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="h-8 w-16" />
                </div>
              ))}
            </div>
          </div>
        </div>
      }>
        <SettingsDataAsync searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SettingsDataAsync({ searchParams }: SettingsPageProps) {
  const employee = await getCurrentEmployee();

  if (employee.role !== "ADMIN") {
    redirect("/");
  }

  const [roles, columns, resolvedSearchParams] = await Promise.all([
    getSystemRolesAction(),
    getBoardColumnsAction(),
    searchParams ? searchParams : Promise.resolve<Record<string, string | undefined>>({}),
  ]);

  const defaultTab = resolvedSearchParams?.tab === "columns" ? "columns" : "roles";

  return (
    <SettingsClient
      initialRoles={roles}
      initialColumns={columns}
      defaultTab={defaultTab}
    />
  );
}

