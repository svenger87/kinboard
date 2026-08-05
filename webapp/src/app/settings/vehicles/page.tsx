"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Car, Plus, Pencil, Trash2 } from "lucide-react";
import { useVehicles, useDeleteVehicle } from "@/hooks/use-vehicles";
import { getDriver } from "@/plugins/vehicles/drivers/registry";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function VehiclesSettingsPage() {
  const t = useTranslations("settings.vehicles");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { data: vehicles = [] } = useVehicles();
  const { mutateAsync: deleteVehicle, isPending: deleting } = useDeleteVehicle();

  return (
    <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6">
        <PageHeader
          icon={Car}
          title={t("title")}
          subtitle={t("subtitle")}
          backHref="/settings"
          actions={
            <Button asChild>
              <Link href="/settings/vehicles/new">
                <Plus className="size-4 mr-2" />
                {t("addVehicle")}
              </Link>
            </Button>
          }
        />

        <Card>
          <div className="p-6">
            {vehicles.length === 0 ? (
              <EmptyState
                icon={Car}
                title={t("emptyTitle")}
                description={t("emptyDescription")}
                action={{ label: t("addVehicle"), onClick: () => router.push("/settings/vehicles/new") }}
              />
            ) : (
              <div className="flex flex-col gap-3">
                {vehicles.map((v) => {
                  const driver = getDriver(v.vendor);
                  const configured = driver?.isConfigured(v.config) ?? false;
                  const Icon = driver?.icon;
                  return (
                    <div
                      key={v.id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background/50"
                    >
                      {Icon && <Icon className="size-5 text-muted-foreground shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">{v.nickname}</span>
                          {!configured && (
                            <Badge variant="outline" className="text-xs">
                              {t("needsConfig")}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">
                          {driver ? t(`driver.${driver.id as "tesla" | "generic-ev"}`) : v.vendor}
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button asChild variant="ghost" size="icon" className="size-8" aria-label={t("editAria")}>
                          <Link href={`/settings/vehicles/${v.id}`}>
                            <Pencil className="size-4" />
                          </Link>
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-destructive hover:text-destructive"
                              aria-label={t("deleteAria")}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t("deleteDialogTitle")}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t("confirmDelete", { name: v.nickname })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                disabled={deleting}
                                onClick={async () => {
                                  try {
                                    await deleteVehicle(v.id);
                                  } catch {
                                    // The dialog closes either way, so without
                                    // this a failed DELETE looked exactly like
                                    // a successful one.
                                    toast.error(t("deleteFailed"));
                                  }
                                }}
                              >
                                {tCommon("delete")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}
