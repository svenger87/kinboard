"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  Calendar,
  RefreshCw,
  AlertCircle,
  Clock,
  Plus,
  Trash2,
  Users,
  GripVertical,
  TestTube2,
  Loader2,
  PartyPopper,
  Recycle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { IntegrationStatusBanner } from "@/components/integration-status-banner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { IntegrationConfigHint } from "@/components/integration-config-hint";
import { toast } from "sonner";
import {
  PersonMappingRule,
  MatchType,
  testRules,
} from "@/lib/calendar-person-matcher";
import {
  useGoogleConfigured,
  useGoogleCalendarStatus,
  useGoogleCalendars,
  useUpdateEnabledCalendars,
  useGoogleCalendarSync,
  useDisconnectGoogleCalendar,
  useUpdateMappingRules,
  useUpdateAutoSync,
  getGoogleAuthUrl,
  usePeople,
  useCalendars,
  useUpdateCalendar,
  useEvents,
} from "@/hooks";
import { useFamilyStore } from "@/stores/family-store";

import { addDays, startOfDay } from "date-fns";

export default function GoogleSettingsPage() {
  const t = useTranslations("settings.google");
  const searchParams = useSearchParams();
  const { family } = useFamilyStore();

  // Query hooks
  const { data: googleConfigured } = useGoogleConfigured();
  const isUnconfigured = googleConfigured === false;
  const { data: googleStatus, isLoading: statusLoading } = useGoogleCalendarStatus();
  const { data: calendars, isLoading: calendarsLoading } = useGoogleCalendars();
  const { data: people } = usePeople();
  const { data: localCalendars } = useCalendars();

  // Fetch recent events for testing rules - memoized to prevent infinite refetches
  const { startDate, endDate } = useMemo(() => {
    const today = new Date();
    return {
      startDate: startOfDay(today).toISOString(),
      endDate: addDays(today, 30).toISOString(),
    };
  }, []);
  const { data: events } = useEvents(startDate, endDate);

  // Get unique event titles for testing
  const eventTitles = events?.map((e) => e.title).slice(0, 10) || [];

  // Mutation hooks
  const updateEnabledCalendars = useUpdateEnabledCalendars();
  const syncCalendar = useGoogleCalendarSync();
  const disconnectGoogle = useDisconnectGoogleCalendar();
  const updateMappingRules = useUpdateMappingRules();
  const updateCalendar = useUpdateCalendar();
  const updateAutoSync = useUpdateAutoSync();

  // Local state
  const [enabledCalendarIds, setEnabledCalendarIds] = useState<string[]>([]);
  const [mappingRules, setMappingRules] = useState<PersonMappingRule[]>([]);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [newRulePattern, setNewRulePattern] = useState("");
  const [newRulePerson, setNewRulePerson] = useState("");
  const [newRuleMatchType, setNewRuleMatchType] = useState<MatchType>("contains");
  const [showTestResults, setShowTestResults] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);

  const isConnected = !!googleStatus?.access_token;

  // Initialize local state from server data
  useEffect(() => {
    if (googleStatus?.enabled_calendars) {
      setEnabledCalendarIds(googleStatus.enabled_calendars);
    }
    if (googleStatus?.mapping_rules) {
      setMappingRules(googleStatus.mapping_rules);
    }
  }, [googleStatus]);

  // Handle OAuth callback messages
  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");

    if (success) {
      toast.success(t("connectedToastTitle"), {
        description: t("connectedToastDescription"),
      });
      // Clear URL params
      window.history.replaceState({}, "", "/settings/google");
    } else if (error) {
      toast.error(t("errorToastTitle"), {
        description: t("errorToastDescriptionPrefix", { error }),
      });
      window.history.replaceState({}, "", "/settings/google");
    }
  }, [searchParams, t]);

  const handleConnect = () => {
    if (!family?.id) return;
    window.location.href = getGoogleAuthUrl(family.id);
  };

  const handleDisconnect = async () => {
    try {
      await disconnectGoogle.mutateAsync();
      toast.success(t("disconnectedToastTitle"), {
        description: t("disconnectedToastDescription"),
      });
    } catch {
      toast.error(t("errorToastTitle"), {
        description: t("disconnectFailedToast"),
      });
    }
  };

  const handleToggleCalendar = async (id: string) => {
    const newEnabled = enabledCalendarIds.includes(id)
      ? enabledCalendarIds.filter((c) => c !== id)
      : [...enabledCalendarIds, id];

    setEnabledCalendarIds(newEnabled);

    try {
      await updateEnabledCalendars.mutateAsync(newEnabled);
    } catch {
      // Revert on error
      setEnabledCalendarIds(enabledCalendarIds);
      toast.error(t("errorToastTitle"), {
        description: t("toggleFailedToast"),
      });
    }
  };

  const handleAddRule = async () => {
    if (!newRulePattern.trim() || !newRulePerson) return;

    const newRule: PersonMappingRule = {
      id: Date.now().toString(),
      person_id: newRulePerson,
      match_type: newRuleMatchType,
      pattern: newRulePattern.trim(),
      priority: mappingRules.length > 0 ? Math.max(...mappingRules.map((r) => r.priority)) + 1 : 1,
    };

    const newRules = [...mappingRules, newRule];
    setMappingRules(newRules);
    setNewRulePattern("");
    setNewRulePerson("");
    setNewRuleMatchType("contains");
    setRuleDialogOpen(false);

    try {
      await updateMappingRules.mutateAsync(newRules);
    } catch {
      setMappingRules(mappingRules);
      toast.error(t("errorToastTitle"), {
        description: t("ruleAddFailedToast"),
      });
    }
  };

  const handleDeleteRule = async (id: string) => {
    const newRules = mappingRules.filter((r) => r.id !== id);
    setMappingRules(newRules);

    try {
      await updateMappingRules.mutateAsync(newRules);
    } catch {
      setMappingRules(mappingRules);
      toast.error(t("errorToastTitle"), {
        description: t("ruleDeleteFailedToast"),
      });
    }
  };

  const getPersonById = (id: string) => people?.find((p) => p.id === id);

  const handleSync = async () => {
    setSyncProgress(0);

    // Simulate progress
    const interval = setInterval(() => {
      setSyncProgress((prev) => Math.min(prev + 10, 90));
    }, 200);

    try {
      const result = await syncCalendar.mutateAsync();
      clearInterval(interval);
      setSyncProgress(100);

      toast.success(t("syncedToastTitle"), {
        description: t("syncedToastDescription", {
          created: result.created,
          updated: result.updated,
          deleted: result.deleted,
        }),
      });

      setTimeout(() => setSyncProgress(0), 1000);
    } catch {
      clearInterval(interval);
      setSyncProgress(0);
      toast.error(t("syncFailedToastTitle"), {
        description: t("syncFailedToastDescription"),
      });
    }
  };

  const formatLastSync = (dateStr?: string) => {
    if (!dateStr) return t("syncNever");
    const date = new Date(dateStr);
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return t("syncJustNow");
    if (diffMins < 60) return t("syncMinutes", { minutes: diffMins });
    return t("syncHours", { hours: Math.floor(diffMins / 60) });
  };

  const matchTypeLabel = (matchType: MatchType): string => {
    return t(`matchType_${matchType}`);
  };

  const enabledCount = enabledCalendarIds.length;
  const isLoading = statusLoading;

  if (isLoading) {
    return (
      <TooltipProvider>
        <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
          <div className="relative z-10 max-w-2xl mx-auto">
            <PageHeader
              icon={Calendar}
              title={t("title")}
              subtitle={t("subtitle")}
              backHref="/settings"
              className="mb-8"
            />
            <Skeleton className="h-24 w-full rounded-xl mb-6" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        </main>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="relative z-10 max-w-2xl mx-auto">
          <PageHeader
            icon={Calendar}
            title={t("title")}
            subtitle={t("subtitle")}
            backHref="/settings"
            className="mb-8"
          />

          {isUnconfigured && (
            <IntegrationConfigHint
              title={t("notConfiguredTitle")}
              description={t("notConfiguredDescription")}
              envKey="GOOGLE_CLIENT_ID"
              docsHref="https://github.com/svenger87/kinboard/wiki/Google-Calendar"
              docsLabel={t("notConfiguredDocsLabel")}
            />
          )}

          <IntegrationStatusBanner
            connected={isConnected && !googleStatus?.needs_reauth}
            needsReauth={isConnected && !!googleStatus?.needs_reauth}
            icon={<Calendar className="size-6" strokeWidth={1.75} />}
            serviceName={t("accountTitle")}
            connectedLabel={t("connectedBadge")}
            connectedSubtitle={googleStatus?.email ?? undefined}
            lastSync={isConnected ? formatLastSync(googleStatus?.last_sync) : undefined}
            onConnect={isUnconfigured ? undefined : handleConnect}
            onDisconnect={isConnected && !googleStatus?.needs_reauth ? handleDisconnect : undefined}
            connectLabel={t("connectButton")}
            disconnectLabel={t("disconnectButton")}
            reauthLabel={t("reauthButton")}
            reauthTitle={t("reauthTitle")}
            reauthBody={t("reauthBody")}
            disconnectedTitle={t("notConnectedTitle")}
            disconnectedBody={t("notConnectedDescription")}
            className="mb-6"
          />

          {isConnected && (
            <>
              {/* Sync Status */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="mb-6"
              >
                <Card className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Clock className="size-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{t("lastSyncTitle")}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatLastSync(googleStatus?.last_sync)}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSync}
                      disabled={syncCalendar.isPending}
                    >
                      {syncCalendar.isPending ? (
                        <Loader2 className="size-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4 mr-2" />
                      )}
                      {syncCalendar.isPending ? t("syncing") : t("syncNow")}
                    </Button>
                  </div>
                  {syncProgress > 0 && (
                    <div className="mt-4">
                      <Progress value={syncProgress} className="h-1" />
                    </div>
                  )}
                </Card>
              </motion.div>

              {/* Auto Sync Toggle */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                className="mb-6"
              >
                <Card className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <RefreshCw className="size-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{t("autoSyncTitle")}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("autoSyncDescription")}
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={googleStatus?.auto_sync ?? false}
                      onCheckedChange={(checked) => updateAutoSync.mutate(checked)}
                      disabled={updateAutoSync.isPending}
                    />
                  </div>
                  {googleStatus?.auto_sync && (
                    <div className="mt-3 pt-3 border-t border-border/50">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          {t("lastAutoSync", { time: formatLastSync(googleStatus?.last_auto_sync) })}
                        </span>
                        {googleStatus?.auto_sync_error && (
                          <Badge variant="destructive" className="text-xs">
                            <AlertCircle className="size-3 mr-1" />
                            {t("autoSyncErrorBadge")}
                          </Badge>
                        )}
                      </div>
                      {googleStatus?.auto_sync_error && (
                        <p className="text-xs text-destructive mt-2">
                          {googleStatus.auto_sync_error}
                        </p>
                      )}
                    </div>
                  )}
                </Card>
              </motion.div>

              {/* Calendars List */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <div className="flex items-center justify-between mb-3 px-1">
                  <h2 className="text-sm font-medium text-muted-foreground">
                    {t("calendarsHeading", { count: enabledCount })}
                  </h2>
                </div>

                <Card className="divide-y divide-border/50">
                  {calendarsLoading ? (
                    <div className="p-8 flex justify-center">
                      <Loader2 className="size-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : calendars && calendars.length > 0 ? (
                    calendars.map((calendar, index) => {
                      // Find local calendar that matches this Google calendar
                      const localCal = localCalendars?.find(
                        (lc) => lc.google_calendar_id === calendar.id
                      );

                      return (
                        <motion.div
                          key={calendar.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.3 + index * 0.05 }}
                          className="flex items-center justify-between p-4 gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className="size-4 rounded-full shrink-0"
                              style={{ backgroundColor: calendar.color }}
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Label className="font-medium truncate">{calendar.name}</Label>
                                {calendar.primary && (
                                  <Badge variant="outline" className="text-xs shrink-0">
                                    {t("primaryBadge")}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {/* Person assignment */}
                            {localCal && enabledCalendarIds.includes(calendar.id) && (
                              <>
                                <Select
                                  value={localCal.person_id || "none"}
                                  onValueChange={(value) => {
                                    updateCalendar.mutate({
                                      id: localCal.id,
                                      person_id: value === "none" ? null : value,
                                    });
                                  }}
                                >
                                  <SelectTrigger className="w-[120px] h-8 text-xs">
                                    <SelectValue placeholder={t("personLabel")} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">
                                      <span className="text-muted-foreground">{t("personFamily")}</span>
                                    </SelectItem>
                                    {(people || []).map((person) => (
                                      <SelectItem key={person.id} value={person.id}>
                                        <div className="flex items-center gap-2">
                                          <div
                                            className="size-2 rounded-full"
                                            style={{ backgroundColor: person.color }}
                                          />
                                          {person.name}
                                        </div>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {/* Holidays calendar toggle */}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      onClick={() => {
                                        updateCalendar.mutate({
                                          id: localCal.id,
                                          is_holidays: !localCal.is_holidays,
                                        });
                                      }}
                                      className={`p-1.5 rounded-md transition-colors ${
                                        localCal.is_holidays
                                          ? "bg-primary/10 text-primary"
                                          : "text-muted-foreground/40 hover:text-muted-foreground"
                                      }`}
                                    >
                                      <PartyPopper className="size-4" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{localCal.is_holidays ? t("holidaysTooltip") : t("markHolidaysTooltip")}</p>
                                  </TooltipContent>
                                </Tooltip>
                                {/* Waste collection calendar toggle */}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      onClick={() => {
                                        updateCalendar.mutate({
                                          id: localCal.id,
                                          is_waste_collection: !localCal.is_waste_collection,
                                        });
                                      }}
                                      className={`p-1.5 rounded-md transition-colors ${
                                        localCal.is_waste_collection
                                          ? "bg-primary/10 text-primary"
                                          : "text-muted-foreground/40 hover:text-muted-foreground"
                                      }`}
                                    >
                                      <Recycle className="size-4" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{localCal.is_waste_collection ? t("wasteTooltip") : t("markWasteTooltip")}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </>
                            )}
                            <Switch
                              checked={enabledCalendarIds.includes(calendar.id)}
                              onCheckedChange={() => handleToggleCalendar(calendar.id)}
                            />
                          </div>
                        </motion.div>
                      );
                    })
                  ) : (
                    <div className="p-8 text-center text-muted-foreground">
                      <Calendar className="size-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">{t("calendarsEmpty")}</p>
                    </div>
                  )}
                </Card>
              </motion.div>

              {/* Person Mapping Rules */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="mt-6"
              >
                <div className="flex items-center justify-between mb-3 px-1">
                  <div className="flex items-center gap-2">
                    <Users className="size-4 text-muted-foreground" />
                    <h2 className="text-sm font-medium text-muted-foreground">
                      {t("mappingHeading")}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowTestResults(!showTestResults)}
                    >
                      <TestTube2 className="size-4 mr-2" />
                      {t("testButton")}
                    </Button>
                    <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}>
                      <DialogTrigger asChild>
                        <Button size="sm">
                          <Plus className="size-4 mr-2" />
                          {t("addRuleButton")}
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{t("ruleDialogTitle")}</DialogTitle>
                        </DialogHeader>
                        <div className="flex flex-col gap-4 pt-4">
                          <div className="flex flex-col gap-2">
                            <Label className="text-sm font-medium">{t("rulePersonLabel")}</Label>
                            <Select value={newRulePerson} onValueChange={setNewRulePerson}>
                              <SelectTrigger>
                                <SelectValue placeholder={t("rulePersonPlaceholder")} />
                              </SelectTrigger>
                              <SelectContent>
                                {(people || []).map((person) => (
                                  <SelectItem key={person.id} value={person.id}>
                                    <div className="flex items-center gap-2">
                                      <div
                                        className="size-3 rounded-full"
                                        style={{ backgroundColor: person.color }}
                                      />
                                      {person.name}
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="flex flex-col gap-2">
                            <Label className="text-sm font-medium">{t("rulePatternLabel")}</Label>
                            <Input
                              placeholder={t("rulePatternPlaceholder")}
                              value={newRulePattern}
                              onChange={(e) => setNewRulePattern(e.target.value)}
                            />
                          </div>

                          <div className="flex flex-col gap-2">
                            <Label className="text-sm font-medium">{t("ruleMatchTypeLabel")}</Label>
                            <Select
                              value={newRuleMatchType}
                              onValueChange={(v) => setNewRuleMatchType(v as MatchType)}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="contains">{t("matchType_contains")}</SelectItem>
                                <SelectItem value="starts_with">{t("matchType_starts_with")}</SelectItem>
                                <SelectItem value="ends_with">{t("matchType_ends_with")}</SelectItem>
                                <SelectItem value="regex">{t("matchType_regex")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <Button
                            className="w-full"
                            onClick={handleAddRule}
                            disabled={!newRulePattern.trim() || !newRulePerson}
                          >
                            {t("ruleSubmit")}
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>

                <Card className="divide-y divide-border/50">
                  {mappingRules.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                      <Users className="size-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">{t("rulesEmpty")}</p>
                      <p className="text-xs mt-1">
                        {t("rulesEmptyHint")}
                      </p>
                    </div>
                  ) : (
                    mappingRules
                      .sort((a, b) => b.priority - a.priority)
                      .map((rule, index) => {
                        const person = getPersonById(rule.person_id);
                        return (
                          <motion.div
                            key={rule.id}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.5 + index * 0.05 }}
                            className="flex items-center justify-between p-4 group"
                          >
                            <div className="flex items-center gap-3">
                              <GripVertical className="size-4 text-muted-foreground opacity-50 sm:opacity-0 sm:group-hover:opacity-50 transition-opacity cursor-grab" />
                              <div>
                                <div className="flex items-center gap-2">
                                  <code className="text-sm bg-muted px-2 py-0.5 rounded">
                                    {rule.pattern}
                                  </code>
                                  <Badge variant="outline" className="text-xs">
                                    {matchTypeLabel(rule.match_type)}
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-xs text-muted-foreground">→</span>
                                  {person && (
                                    <Badge
                                      variant="outline"
                                      className="text-xs"
                                      style={{
                                        borderColor: person.color,
                                        color: person.color,
                                      }}
                                    >
                                      {person.name}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                              onClick={() => handleDeleteRule(rule.id)}
                              aria-label={t("deleteRuleAria", { pattern: rule.pattern })}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </motion.div>
                        );
                      })
                  )}
                </Card>

                {/* Test Results */}
                {showTestResults && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="mt-4"
                  >
                    <Card className="p-4">
                      <h3 className="text-sm font-medium mb-3">{t("testResultsHeading")}</h3>
                      <div className="flex flex-col gap-2">
                        {eventTitles.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-4">
                            {t("testResultsEmpty")}
                          </p>
                        ) : (
                          testRules(eventTitles, mappingRules).map((result, i) => {
                            const person = result.person_id ? getPersonById(result.person_id) : null;
                            return (
                              <div
                                key={i}
                                className="flex items-center justify-between text-sm p-2 rounded-lg bg-muted/30"
                              >
                                <span className="text-muted-foreground truncate mr-2">{result.title}</span>
                                {person ? (
                                  <Badge
                                    variant="outline"
                                    className="shrink-0"
                                    style={{
                                      borderColor: person.color,
                                      color: person.color,
                                    }}
                                  >
                                    {person.name}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-muted-foreground shrink-0">
                                    {t("testResultsFamily")}
                                  </Badge>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </Card>
                  </motion.div>
                )}
              </motion.div>
            </>
          )}

          {/* Info */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-6 p-4 rounded-xl bg-info/5 border border-info/10"
          >
            <div className="flex gap-3">
              <AlertCircle className="size-5 text-info shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-info mb-1">{t("infoHeading")}</p>
                <p className="text-muted-foreground">
                  {t("infoDescription")}
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </TooltipProvider>
  );
}
