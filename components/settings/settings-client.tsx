"use client";

import { KeyRound, Columns3 } from "lucide-react";
import { RolesTab, type RoleData } from "@/components/settings/roles-tab";
import { BoardColumnsTab } from "@/components/settings/board-columns-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { KanbanColumn } from "@/lib/validations/board-column";

interface SettingsClientProps {
  initialRoles: RoleData[];
  initialColumns: KanbanColumn[];
  defaultTab?: string;
}

export function SettingsClient({ initialRoles, initialColumns, defaultTab = "roles" }: SettingsClientProps) {
  return (
    <Tabs defaultValue={defaultTab} className="flex flex-col gap-6">
      <div className="w-full overflow-x-auto pb-1">
        <TabsList className="w-fit justify-start h-9">
          <TabsTrigger value="roles" className="gap-2 text-xs h-7">
            <KeyRound className="h-3.5 w-3.5" /> Roles & Permissions
          </TabsTrigger>
          <TabsTrigger value="columns" className="gap-2 text-xs h-7">
            <Columns3 className="h-3.5 w-3.5" /> Board Columns
          </TabsTrigger>
        </TabsList>
      </div>

      <div className="flex-1 min-w-0 pb-10">
        <TabsContent value="roles" className="m-0 border-0 p-0 focus-visible:outline-none">
          <RolesTab initialRoles={initialRoles} />
        </TabsContent>
        <TabsContent value="columns" className="m-0 border-0 p-0 focus-visible:outline-none">
          <BoardColumnsTab initialColumns={initialColumns} />
        </TabsContent>
      </div>
    </Tabs>
  );
}
