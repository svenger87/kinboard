"use client";

import { useState } from "react";
import { Plus, LayoutGrid, Zap, MoreHorizontal, Pencil, Trash2, GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Dashboard } from "@/types/home-assistant";
import { DashboardEditor } from "./dashboard-editor";

interface DashboardSelectorProps {
  dashboards: Dashboard[];
  activeDashboardId: string | null;
  onSelect: (dashboardId: string) => void;
  onCreateDashboard: (name: string, icon?: string, type?: "custom" | "energy") => Promise<void>;
  onUpdateDashboard: (id: string, updates: Partial<Dashboard>) => Promise<void>;
  onDeleteDashboard: (id: string) => Promise<void>;
  isCreating?: boolean;
}

// Icon mapping for dashboard icons
const DASHBOARD_ICONS: Record<string, React.ReactNode> = {
  home: <LayoutGrid className="size-4" />,
  energy: <Zap className="size-4" />,
  default: <LayoutGrid className="size-4" />,
};

function getDashboardIcon(dashboard: Dashboard) {
  if (dashboard.type === "energy") {
    return DASHBOARD_ICONS.energy;
  }
  if (dashboard.icon) {
    // Check if it's an emoji (short string with non-ASCII or high Unicode)
    // Emojis are typically 1-2 characters and outside basic ASCII
    const isEmoji = dashboard.icon.length <= 2 && !/^[a-zA-Z0-9_-]+$/.test(dashboard.icon);
    if (isEmoji) {
      return <span className="text-sm">{dashboard.icon}</span>;
    }
    return DASHBOARD_ICONS[dashboard.icon] || DASHBOARD_ICONS.default;
  }
  return DASHBOARD_ICONS.default;
}

export function DashboardSelector({
  dashboards,
  activeDashboardId,
  onSelect,
  onCreateDashboard,
  onUpdateDashboard,
  onDeleteDashboard,
  isCreating,
}: DashboardSelectorProps) {
  const t = useTranslations("homeAutomation.selector");
  const tCommon = useTranslations("common");
  const [showEditor, setShowEditor] = useState(false);
  const [editingDashboard, setEditingDashboard] = useState<Dashboard | null>(null);

  const handleCreate = async (name: string, icon?: string, type?: "custom" | "energy") => {
    await onCreateDashboard(name, icon, type);
    setShowEditor(false);
  };

  const handleEdit = async (name: string, icon?: string) => {
    if (editingDashboard) {
      await onUpdateDashboard(editingDashboard.id, { name, icon });
      setEditingDashboard(null);
    }
  };

  const handleDelete = async (id: string) => {
    await onDeleteDashboard(id);
    // If we deleted the active dashboard, select the first available
    if (activeDashboardId === id && dashboards.length > 1) {
      const remaining = dashboards.filter((d) => d.id !== id);
      if (remaining.length > 0) {
        onSelect(remaining[0].id);
      }
    }
  };

  const sortedDashboards = [...dashboards].sort((a, b) => a.position - b.position);

  return (
    <>
      <div className="flex items-center gap-1 overflow-x-auto pb-1 -mb-1 scrollbar-hide">
        {sortedDashboards.map((dashboard) => (
          <div key={dashboard.id} className="flex items-center group">
            <button
              onClick={() => onSelect(dashboard.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap min-h-[44px]",
                activeDashboardId === dashboard.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {getDashboardIcon(dashboard)}
              {dashboard.name}
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("optionsAria")}
                  className={cn(
                    "size-6 opacity-0 group-hover:opacity-100 transition-opacity",
                    activeDashboardId === dashboard.id && "opacity-100"
                  )}
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => setEditingDashboard(dashboard)}>
                  <Pencil className="size-4 mr-2" />
                  {tCommon("edit")}
                </DropdownMenuItem>
                {dashboards.length > 1 && (
                  <DropdownMenuItem
                    onClick={() => handleDelete(dashboard.id)}
                    className="text-destructive"
                  >
                    <Trash2 className="size-4 mr-2" />
                    {tCommon("delete")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}

        <Button
          variant="ghost"
          size="sm"
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground shrink-0"
          onClick={() => setShowEditor(true)}
          disabled={isCreating}
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">{t("newDashboard")}</span>
        </Button>
      </div>

      {/* Create Dashboard Modal */}
      <DashboardEditor
        open={showEditor}
        onOpenChange={setShowEditor}
        onSave={handleCreate}
        mode="create"
      />

      {/* Edit Dashboard Modal */}
      {editingDashboard && (
        <DashboardEditor
          open={!!editingDashboard}
          onOpenChange={(open) => !open && setEditingDashboard(null)}
          onSave={handleEdit}
          mode="edit"
          initialName={editingDashboard.name}
          initialIcon={editingDashboard.icon}
          dashboardType={editingDashboard.type}
        />
      )}
    </>
  );
}
