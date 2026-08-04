"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamilyStore } from "@/stores/family-store";
import { showUndoToast } from "@/lib/undo-toast";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  MapPin,
  User,
  Loader2,
  Trash2,
  Pencil,
  Search,
} from "lucide-react";
import {
  format,
  isSameDay,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfDay,
  endOfDay,
  setHours,
  setMinutes,
  isWithinInterval,
  differenceInMinutes,
  isBefore,
  isAfter,
  parseISO,
} from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MonthView, WeekView } from "@/components/calendar";
import { ErrorState } from "@/components/error-state";
import { LocationAutocomplete } from "@/components/location-autocomplete";
import { PageHeader } from "@/components/page-header";
import { EventPill } from "@/components/event-pill";
import { PersonChip } from "@/components/person-chip";
import { FAB } from "@/components/fab";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useEvents,
  useEventById,
  useCreateEvent,
  useUpdateEvent,
  useDeleteEvent,
  usePeople,
  useCalendars,
  useSetting,
  useUpdateSetting,
  useGoogleCalendarStatus,
  useKeyboardShortcuts,
  useSwipeNavigation,
  queryKeys,
  type EventWithCalendar,
} from "@/hooks";
import { matchPersonForEvent } from "@/lib/calendar-person-matcher";
import { getHolidays, type CountryCode } from "@/lib/holidays";
import { useTimeFormat } from "@/hooks/use-time-format";

// Types
interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  color: string;
  location?: string;
  description?: string;
  person_id?: string;
  calendar_name?: string;
  is_holiday?: boolean;
  is_waste_collection?: boolean;
}

function CalendarSkeleton({ view = "month" }: { view?: "month" | "week" }) {
  if (view === "week") {
    return (
      <div className="flex flex-col gap-2">
        {/* Day headers */}
        <div className="grid grid-cols-8 gap-2">
          <Skeleton className="h-6 rounded" />
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-6 rounded" />
          ))}
        </div>
        {/* Time slots */}
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="grid grid-cols-8 gap-2">
            <Skeleton className="h-10 w-12 rounded" />
            {Array.from({ length: 7 }).map((_, j) => (
              <Skeleton key={j} className="h-10 rounded" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-6 rounded" />
        ))}
      </div>
      {/* Month grid */}
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 35 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const { formatTime } = useTimeFormat();
  // Enable keyboard shortcuts and swipe navigation
  useKeyboardShortcuts();
  useSwipeNavigation();

  const t = useTranslations("calendar");
  const tCommon = useTranslations("common");
  const tHolidays = useTranslations("holidays");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);

  const searchParams = useSearchParams();
  const [currentDate, setCurrentDate] = useState(() => {
    const dateParam = searchParams.get("date");
    if (dateParam) {
      const parsed = parseISO(dateParam);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
  });
  // ?event= deep-link — read once, consumed by the effect below once the
  // byId fetch resolves (guarded so it can't re-fire / loop).
  const [eventParam] = useState(() => searchParams.get("event"));
  const eventParamConsumedRef = useRef(false);

  // Tracks whether the currently-open detail dialog owns a pushed history
  // entry (opened via click) vs. not (opened via ?event= deep-link on
  // initial load) — determines whether closing should go back or just
  // clean up the URL. See openEventDetail/closeEventDetail below.
  const eventHistoryPushedRef = useRef(false);
  // True while the currently-selected event is the one opened by the
  // ?event= deep-link (vs. a normal click-through). Used to scope the
  // late-color-resolution effect below to deep-link opens only.
  const isDeepLinkEventRef = useRef(false);
  // Guards the late-color-resolution effect so it applies at most once —
  // it must not clobber a color the user set afterwards via edit.
  const deepLinkColorFixedRef = useRef(false);

  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({ title: "", location: "", startDate: new Date(), endDate: new Date(), startTime: "", endTime: "", allDay: false, person_id: null as string | null });
  const [view, setView] = useState<"month" | "week">("month");

  // Person filter — default: all selected (null = "all", lazily initialized once people load)
  const [selectedPersonIds, setSelectedPersonIds] = useState<Set<string> | null>(null);

  const togglePerson = (id: string) => {
    setSelectedPersonIds((prev) => {
      const all = new Set((people || []).map((p) => p.id));
      const base = prev ?? all;
      const next = new Set(base);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) return null;
      return next;
    });
  };

  // Add Event Dialog State
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newEvent, setNewEvent] = useState({
    title: "",
    date: new Date(),
    endDate: new Date(),
    startTime: "09:00",
    endTime: "10:00",
    allDay: false,
    location: "",
    calendar_id: "",
    person_id: "" as string | null,
  });

  // Calculate date range based on view
  const dateRange = useMemo(() => {
    if (view === "month") {
      return {
        start: startOfMonth(currentDate).toISOString(),
        end: endOfMonth(currentDate).toISOString(),
      };
    } else {
      return {
        start: startOfWeek(currentDate, { weekStartsOn: 1 }).toISOString(),
        end: endOfWeek(currentDate, { weekStartsOn: 1 }).toISOString(),
      };
    }
  }, [currentDate, view]);

  // Fetch data from Supabase
  const { data: eventsData, isLoading: loadingEvents, error: eventsError, refetch: refetchEvents } = useEvents(dateRange.start, dateRange.end);
  // Deep-link resolve: the linked event may fall outside the current view's
  // date range, so it's fetched by id directly.
  const { data: deepLinkEventData, isFetched: deepLinkFetched } = useEventById(eventParam ?? undefined);
  // Unbounded search — only runs while actively searching (2+ chars) so it
  // doesn't fire a full-family query on every calendar visit.
  const searchActive = searchQuery.trim().length >= 2;
  const { data: searchEventsData } = useEvents(undefined, undefined, { enabled: searchActive });
  const { data: people, isLoading: loadingPeople, error: peopleError, refetch: refetchPeople } = usePeople();
  const { data: calendars, isLoading: loadingCalendars, error: calendarsError, refetch: refetchCalendars } = useCalendars();
  const { data: defaultCalendarId } = useSetting<string | null>("default_calendar_id", null);
  const { data: holidayCountry } = useSetting<CountryCode>("holiday_country", "de");
  const country: CountryCode = holidayCountry ?? "de";
  const { data: googleStatus } = useGoogleCalendarStatus();
  const updateSetting = useUpdateSetting<string>();
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  const isLoading = loadingEvents || loadingPeople || loadingCalendars;
  const error = eventsError || peopleError || calendarsError;

  const handleRetry = () => {
    if (eventsError) refetchEvents();
    if (peopleError) refetchPeople();
    if (calendarsError) refetchCalendars();
  };

  // Get mapping rules from Google Calendar settings
  const mappingRules = googleStatus?.mapping_rules || [];

  // Handle title change with auto-person selection based on mapping rules
  const handleTitleChange = (title: string) => {
    setNewEvent((prev) => {
      const newState = { ...prev, title };

      // Auto-select person based on mapping rules (only if not manually set)
      if (!prev.person_id || prev.person_id === "") {
        const matchedPersonId = matchPersonForEvent(title, mappingRules);
        if (matchedPersonId) {
          newState.person_id = matchedPersonId;
        }
      }

      return newState;
    });
  };

  // Set default calendar when dialog opens
  const openAddDialog = () => {
    const calendarId = defaultCalendarId || calendars?.[0]?.id || "";
    setNewEvent((prev) => ({ ...prev, calendar_id: calendarId, title: "", person_id: null }));
    setAddDialogOpen(true);
  };

  // Maps a raw events-table row (+ joined calendar) to the display shape.
  // Shared by the events memo, the ?event= deep-link resolver, and search
  // results so they all agree on color/person fallbacks.
  const toCalendarEvent = useCallback((event: EventWithCalendar): CalendarEvent => {
    // Use event's person_id first, then fall back to calendar's person_id
    const personId = event.person_id || event.calendar?.person_id;
    const person = personId ? people?.find((p) => p.id === personId) : undefined;
    const calendarColor = event.calendar?.color;
    return {
      id: event.id,
      title: event.title,
      start: new Date(event.start_at),
      end: new Date(event.end_at),
      allDay: event.all_day,
      color: person?.color || calendarColor || "#3b82f6",
      location: event.location || undefined,
      description: event.description || undefined,
      person_id: personId ?? undefined,
      calendar_name: event.calendar?.name,
      is_holiday: event.calendar?.is_holidays ?? false,
      is_waste_collection: event.calendar?.is_waste_collection ?? false,
    };
  }, [people]);

  // Transform events to display format
  const events: CalendarEvent[] = useMemo(() => {
    if (!eventsData) return [];
    return eventsData.map(toCalendarEvent);
  }, [eventsData, toCalendarEvent]);

  // Search: matches title/location/description, case-insensitive.
  const searchResults: EventWithCalendar[] = useMemo(() => {
    if (!searchActive || !searchEventsData) return [];
    const q = searchQuery.trim().toLowerCase();
    return searchEventsData
      .filter((e) =>
        e.title?.toLowerCase().includes(q) ||
        e.location?.toLowerCase().includes(q) ||
        e.description?.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [searchActive, searchEventsData, searchQuery]);

  // Apply the person filter, then the search filter. null personIds = no
  // filter yet (show all). Person-less events are always visible.
  const visibleEvents = useMemo(() => {
    let filtered = selectedPersonIds
      ? events.filter((e) => !e.person_id || selectedPersonIds.has(e.person_id))
      : events;
    const q = searchQuery.trim().toLowerCase();
    if (q.length >= 2) {
      filtered = filtered.filter((e) =>
        e.title.toLowerCase().includes(q) ||
        e.location?.toLowerCase().includes(q) ||
        e.description?.toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [events, selectedPersonIds, searchQuery]);

  // Opens the event detail dialog and records a history entry so the
  // back button/gesture closes the dialog instead of leaving /calendar.
  const openEventDetail = useCallback((event: CalendarEvent) => {
    eventHistoryPushedRef.current = true;
    window.history.pushState({}, "", `/calendar?event=${event.id}`);
    setSelectedEvent(event);
  }, []);

  // Closes the event detail dialog. If we pushed a history entry to open
  // it, go back (consumes that entry — no stacking on rapid open/close);
  // otherwise (opened via ?event= deep-link) just strip the query param.
  const closeEventDetail = useCallback(() => {
    setSelectedEvent(null);
    if (eventHistoryPushedRef.current) {
      eventHistoryPushedRef.current = false;
      window.history.back();
    } else {
      window.history.replaceState({}, "", "/calendar");
    }
  }, []);

  // Back button/gesture closes the dialog rather than navigating away.
  useEffect(() => {
    const handlePopState = () => {
      eventHistoryPushedRef.current = false;
      setSelectedEvent(null);
      // The edit dialog is driven by editMode independently of
      // selectedEvent — without this, back-during-edit leaves an
      // orphaned form whose save silently no-ops.
      setEditMode(false);
      // After this, nothing is open. If the entry we landed on (e.g. the
      // original deep-link entry, one hop back past a click-opened dialog)
      // still carries ?event=, the address bar would lie about a closed
      // dialog — strip just that param, keeping any others (like ?date=)
      // intact. Guarded to /calendar since popstate also fires when
      // navigating away from the page entirely.
      if (window.location.pathname === "/calendar") {
        const url = new URL(window.location.href);
        if (url.searchParams.has("event")) {
          url.searchParams.delete("event");
          window.history.replaceState({}, "", `${url.pathname}${url.search}`);
        }
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Deep-link resolve: jump to the event's month/week and open it once the
  // byId fetch settles. Runs at most once (guarded by the consumed ref) —
  // no pushState here, since the URL already reflects ?event=.
  useEffect(() => {
    if (!eventParam || eventParamConsumedRef.current || !deepLinkFetched) return;
    eventParamConsumedRef.current = true;
    if (deepLinkEventData) {
      isDeepLinkEventRef.current = true;
      setCurrentDate(new Date(deepLinkEventData.start_at));
      setSelectedEvent(toCalendarEvent(deepLinkEventData));
    } else {
      toast.error(t("eventNotFound"));
      // The param references nothing openable — nothing will ever open to
      // clean it up via closeEventDetail, so strip it here.
      if (window.location.pathname === "/calendar") {
        const url = new URL(window.location.href);
        url.searchParams.delete("event");
        window.history.replaceState({}, "", `${url.pathname}${url.search}`);
      }
    }
  }, [eventParam, deepLinkFetched, deepLinkEventData, toCalendarEvent, t]);

  // Late-color resolution: if the deep-link dialog opened before `people`
  // finished loading, its color used the fallback. Once people settle,
  // re-map the same event once (ref-guarded — never fires twice, so it
  // can't clobber a color change the user makes afterwards via edit).
  useEffect(() => {
    if (deepLinkColorFixedRef.current || !isDeepLinkEventRef.current) return;
    if (!people?.length || !deepLinkEventData) return;
    deepLinkColorFixedRef.current = true;
    setSelectedEvent((prev) =>
      prev && prev.id === deepLinkEventData.id ? toCalendarEvent(deepLinkEventData) : prev
    );
  }, [people, deepLinkEventData, toCalendarEvent]);

  const handleAddEvent = async () => {
    if (!newEvent.title.trim() || !newEvent.calendar_id) return;

    const [startHour, startMinute] = newEvent.startTime.split(":").map(Number);
    const [endHour, endMinute] = newEvent.endTime.split(":").map(Number);

    const start = newEvent.allDay
      ? startOfDay(newEvent.date)
      : setMinutes(setHours(newEvent.date, startHour), startMinute);
    const end = newEvent.allDay
      ? endOfDay(newEvent.endDate)
      : setMinutes(setHours(newEvent.date, endHour), endMinute);

    // Validate end is after start
    if (end < start) {
      toast.error(t("toastDateOrder"));
      return;
    }

    try {
      await createEvent.mutateAsync({
        calendar_id: newEvent.calendar_id,
        title: newEvent.title,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        all_day: newEvent.allDay,
        location: newEvent.location || undefined,
        person_id: newEvent.person_id || null,
      });

      setAddDialogOpen(false);
      setNewEvent({
        title: "",
        date: new Date(),
        endDate: new Date(),
        startTime: "09:00",
        endTime: "10:00",
        allDay: false,
        location: "",
        calendar_id: "",
        person_id: null,
      });
    } catch {
      toast.error(t("toastCreateFailed"));
    }
  };

  // Check if an event occurs on a specific day (handles multi-day events)
  const eventOccursOnDay = (event: CalendarEvent, day: Date) => {
    const dayStart = startOfDay(day);
    const dayEnd = endOfDay(day);
    const eventStart = startOfDay(event.start);
    const eventEnd = endOfDay(event.end);

    return (
      (dayStart >= eventStart && dayStart <= eventEnd) ||
      (dayEnd >= eventStart && dayEnd <= eventEnd) ||
      (eventStart <= dayStart && eventEnd >= dayEnd)
    );
  };

  // Get events for a specific day (including multi-day events)
  const getEventsForDay = (day: Date) => {
    return visibleEvents.filter((event) => eventOccursOnDay(event, day));
  };

  // Get events for selected date (default to today when nothing selected)
  const displayDate = selectedDate || new Date();
  const selectedDateEvents = getEventsForDay(displayDate);

  // Navigation - depends on view
  const goToPrevious = () => {
    if (view === "month") {
      setCurrentDate(subMonths(currentDate, 1));
    } else {
      setCurrentDate(subWeeks(currentDate, 1));
    }
  };

  const goToNext = () => {
    if (view === "month") {
      setCurrentDate(addMonths(currentDate, 1));
    } else {
      setCurrentDate(addWeeks(currentDate, 1));
    }
  };

  const goToToday = () => {
    setCurrentDate(new Date());
    setSelectedDate(new Date());
  };

  const getPersonById = (id?: string) =>
    people?.find((p) => p.id === id);

  // Format subtitle based on view
  const getSubtitle = () => {
    if (view === "month") {
      return format(currentDate, "MMMM yyyy", { locale: dateLocale });
    } else {
      const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
      return `${format(weekStart, "d. MMM", { locale: dateLocale })} - ${format(weekEnd, "d. MMM yyyy", { locale: dateLocale })}`;
    }
  };

  return (
    <TooltipProvider>
      <main id="main-content" className="min-h-screen relative overflow-hidden">
        {/* Background */}
        <div className="page-gradient" />

        <div className="relative z-10 p-4 md:p-8 max-w-7xl mx-auto safe-area-inset">
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <PageHeader
              icon={CalendarIcon}
              title={t("title")}
              subtitle={getSubtitle()}
              backHref="/"
              className="mb-3"
              actions={
                <DialogTrigger asChild>
                  <Button size="sm" className="hidden sm:inline-flex gap-1 sm:gap-2" onClick={openAddDialog}>
                    <Plus className="size-4" />
                    <span className="hidden sm:inline">{t("newEventButton")}</span>
                  </Button>
                </DialogTrigger>
              }
            />
            {/* No calendars yet — guide the user to add one instead of
                leaving the grid empty with no explanation. */}
            {!loadingCalendars && !calendarsError && calendars && calendars.length === 0 && (
              <Card className="mb-4 border-primary/30">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{t("noCalendarsBannerTitle")}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("noCalendarsBannerDescription")}
                    </p>
                  </div>
                  <Button size="sm" asChild className="shrink-0">
                    <Link href="/settings/calendar">{t("noCalendarsBannerAction")}</Link>
                  </Button>
                </CardContent>
              </Card>
            )}
                <DialogContent className="sm:max-w-[500px]">
                  <DialogHeader>
                    <DialogTitle>{t("addDialogTitle")}</DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-col gap-4 pt-4">
                    {/* Title */}
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="title">{t("fieldTitle")}</Label>
                      <Input
                        id="title"
                        placeholder={t("fieldTitlePlaceholder")}
                        value={newEvent.title}
                        onChange={(e) => handleTitleChange(e.target.value)}
                        autoFocus
                      />
                    </div>

                    {/* All Day Toggle */}
                    <div className="flex items-center justify-between">
                      <Label htmlFor="allDay">{t("fieldAllDay")}</Label>
                      <Switch
                        id="allDay"
                        checked={newEvent.allDay}
                        onCheckedChange={(checked) =>
                          setNewEvent({ ...newEvent, allDay: checked })
                        }
                      />
                    </div>

                    {/* Date(s) */}
                    {newEvent.allDay ? (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-2">
                          <Label>{t("fieldStartDate")}</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className="w-full justify-start text-left font-normal"
                              >
                                <CalendarIcon className="mr-2 size-4" />
                                {format(newEvent.date, "P", { locale: dateLocale })}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={newEvent.date}
                                onSelect={(date) => {
                                  if (!date) return;
                                  const updates: Partial<typeof newEvent> = { date };
                                  if (date > newEvent.endDate) updates.endDate = date;
                                  setNewEvent((prev) => ({ ...prev, ...updates }));
                                }}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label>{t("fieldEndDate")}</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className="w-full justify-start text-left font-normal"
                              >
                                <CalendarIcon className="mr-2 size-4" />
                                {format(newEvent.endDate, "P", { locale: dateLocale })}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={newEvent.endDate}
                                onSelect={(date) =>
                                  date && date >= newEvent.date && setNewEvent({ ...newEvent, endDate: date })
                                }
                                disabled={(date) => date < newEvent.date}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-col gap-2">
                          <Label>{t("fieldDate")}</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className="w-full justify-start text-left font-normal"
                              >
                                <CalendarIcon className="mr-2 size-4" />
                                {format(newEvent.date, "PPP", { locale: dateLocale })}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={newEvent.date}
                                onSelect={(date) =>
                                  date && setNewEvent({ ...newEvent, date })
                                }
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                        </div>

                        {/* Time */}
                        <div className="grid grid-cols-2 gap-4">
                          <div className="flex flex-col gap-2">
                            <Label htmlFor="startTime">{t("fieldFrom")}</Label>
                            <Input
                              id="startTime"
                              type="time"
                              value={newEvent.startTime}
                              onChange={(e) =>
                                setNewEvent({ ...newEvent, startTime: e.target.value })
                              }
                            />
                          </div>
                          <div className="flex flex-col gap-2">
                            <Label htmlFor="endTime">{t("fieldTo")}</Label>
                            <Input
                              id="endTime"
                              type="time"
                              value={newEvent.endTime}
                              onChange={(e) =>
                                setNewEvent({ ...newEvent, endTime: e.target.value })
                              }
                            />
                          </div>
                        </div>
                      </>
                    )}

                    {/* Location */}
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="location">{t("fieldLocation")}</Label>
                      <LocationAutocomplete
                        id="location"
                        value={newEvent.location}
                        onChange={(value) =>
                          setNewEvent({ ...newEvent, location: value })
                        }
                        placeholder={t("fieldLocationPlaceholder")}
                      />
                    </div>

                    {/* Person */}
                    <div className="flex flex-col gap-2">
                      <Label>{t("fieldPerson")}</Label>
                      <Select
                        value={newEvent.person_id || "none"}
                        onValueChange={(value) =>
                          setNewEvent({ ...newEvent, person_id: value === "none" ? null : value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t("fieldPersonPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">
                            <span className="text-muted-foreground">{t("fieldPersonNone")}</span>
                          </SelectItem>
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
                      {/* Show hint when person was auto-selected by mapping rule */}
                      {newEvent.person_id && matchPersonForEvent(newEvent.title, mappingRules) === newEvent.person_id && (
                        <p className="text-xs text-success">
                          ✓ {t("autoAssignedHint")}
                        </p>
                      )}
                    </div>

                    {/* Calendar */}
                    <div className="flex flex-col gap-2">
                      <Label>{t("fieldCalendar")}</Label>
                      <Select
                        value={newEvent.calendar_id}
                        onValueChange={(value) =>
                          setNewEvent({ ...newEvent, calendar_id: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t("fieldCalendarPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {(calendars || []).map((calendar) => {
                            const calendarPerson = calendar.person_id
                              ? people?.find((p) => p.id === calendar.person_id)
                              : null;
                            return (
                              <SelectItem key={calendar.id} value={calendar.id}>
                                <div className="flex items-center gap-2">
                                  <div
                                    className="size-3 rounded-full"
                                    style={{ backgroundColor: calendar.color || "#3b82f6" }}
                                  />
                                  {calendar.name}
                                  {calendarPerson && (
                                    <span className="text-xs text-muted-foreground">
                                      ({calendarPerson.name})
                                    </span>
                                  )}
                                  {calendar.id === defaultCalendarId && (
                                    <Badge variant="outline" className="text-xs ml-1">{t("defaultBadge")}</Badge>
                                  )}
                                </div>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      {calendars?.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          {t("noCalendarsHint")}
                        </p>
                      )}
                      {newEvent.calendar_id && newEvent.calendar_id !== defaultCalendarId && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-xs text-muted-foreground"
                          onClick={() => updateSetting.mutate({ key: "default_calendar_id", value: newEvent.calendar_id })}
                        >
                          {t("setAsDefault")}
                        </Button>
                      )}
                    </div>

                    {/* Submit */}
                    <Button
                      className="w-full"
                      onClick={handleAddEvent}
                      disabled={!newEvent.title.trim() || !newEvent.calendar_id || createEvent.isPending}
                    >
                      {createEvent.isPending ? (
                        <>
                          <Loader2 className="size-4 mr-2 animate-spin" />
                          {t("creating")}
                        </>
                      ) : (
                        t("createButton")
                      )}
                    </Button>
                  </div>
                </DialogContent>
          </Dialog>

          {/* View tabs + person filter + navigation — kept below PageHeader */}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-3 mb-6 sm:mb-8">
            <Tabs value={view} onValueChange={(v) => setView(v as "month" | "week")}>
              <TabsList aria-label={t("viewSwitcherAria")}>
                <TabsTrigger value="month" className="text-xs sm:text-sm px-2 sm:px-3">{t("viewMonth")}</TabsTrigger>
                <TabsTrigger value="week" className="text-xs sm:text-sm px-2 sm:px-3">{t("viewWeek")}</TabsTrigger>
              </TabsList>
            </Tabs>
            {people && people.length > 0 && (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("personFilterAria")}>
                {people.map((person) => (
                  <PersonChip
                    key={person.id}
                    name={person.name}
                    color={person.color}
                    selected={!selectedPersonIds || selectedPersonIds.has(person.id)}
                    onClick={() => togglePerson(person.id)}
                  />
                ))}
              </div>
            )}
            <div className="relative w-full sm:w-56 order-last sm:order-none">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
              <Input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchPlaceholder")}
                className="h-8 pl-8 text-xs sm:text-sm"
              />
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="size-8" onClick={goToPrevious} aria-label={t("previousAria")}>
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs sm:text-sm px-2 sm:px-3" onClick={goToToday}>
                {t("todayButton")}
              </Button>
              <Button variant="outline" size="icon" className="size-8" onClick={goToNext} aria-label={t("nextAria")}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>

          {/* Search results panel — shown once the query is specific enough
              to search across all dates (not just the current view) */}
          {searchActive && (
            <div
              role="region"
              aria-label={t("searchResultsAria")}
              className="mb-4 rounded-xl border bg-card p-2 max-h-72 overflow-y-auto"
            >
              {searchResults.length === 0 ? (
                <p className="text-sm text-muted-foreground p-3">{t("searchNoResults")}</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {searchResults.map((row) => {
                    const person = getPersonById(row.person_id || row.calendar?.person_id || undefined);
                    return (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => {
                          const ev = toCalendarEvent(row);
                          setCurrentDate(ev.start);
                          openEventDetail(ev);
                          setSearchQuery("");
                        }}
                        className="flex items-center gap-3 w-full text-left px-3 py-2 rounded-lg hover:bg-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="text-xs text-muted-foreground tabular-nums w-16 shrink-0">
                          {format(new Date(row.start_at), "d MMM", { locale: dateLocale })}
                        </span>
                        {person && (
                          <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: person.color }} />
                        )}
                        <span className="text-sm truncate">{row.title}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Monthly Stats Bar */}
          {!isLoading && !error && events.length > 0 && view === "month" && (() => {
            const regularEvents = events.filter((e) => !e.is_holiday);
            const holidays = events.filter((e) => e.is_holiday);
            const uniqueDaysWithEvents = new Set(regularEvents.map((e) => format(e.start, "yyyy-MM-dd"))).size;
            const allDayEvents = events.filter((e) => e.allDay && !e.is_holiday);
            return (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 }}
                className="flex flex-wrap items-center gap-2 sm:gap-3 mb-4"
              >
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-lg">
                  <CalendarIcon className="size-3" />
                  <span className="font-medium text-foreground tabular-nums">{regularEvents.length}</span> {t("statsEvents")}
                </div>
                {holidays.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-lg">
                    <span className="font-medium text-foreground tabular-nums">{holidays.length}</span> {t("statsHolidays")}
                  </div>
                )}
                {allDayEvents.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-lg">
                    <span className="font-medium text-foreground tabular-nums">{allDayEvents.length}</span> {t("statsAllDay")}
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-lg">
                  <span className="font-medium text-foreground tabular-nums">{uniqueDaysWithEvents}</span> {t("statsActiveDays")}
                </div>
              </motion.div>
            );
          })()}

          <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
            {/* Calendar Grid - Month or Week View */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="xl:col-span-3"
            >
              {error ? (
                <Card className="p-4">
                  <ErrorState
                    icon={CalendarIcon}
                    title={t("errorTitle")}
                    message={t("errorMessage")}
                    onRetry={handleRetry}
                  />
                </Card>
              ) : isLoading ? (
                <Card className="p-4">
                  <CalendarSkeleton view={view} />
                </Card>
              ) : view === "month" ? (
                <MonthView
                  currentDate={currentDate}
                  selectedDate={selectedDate}
                  events={visibleEvents}
                  onSelectDate={setSelectedDate}
                  onSelectEvent={openEventDetail}
                />
              ) : (
                <WeekView
                  currentDate={currentDate}
                  selectedDate={selectedDate}
                  events={visibleEvents}
                  onSelectDate={setSelectedDate}
                  onSelectEvent={openEventDetail}
                />
              )}
            </motion.div>

            {/* Sidebar - Selected Day Events */}
            {/* Hidden on mobile when no day selected, always visible on desktop */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="xl:col-span-1"
            >
              <Card className="p-4 h-full">
                <div className="mb-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium">
                      {format(displayDate, "EEEE, d. MMMM", { locale: dateLocale })}
                    </h3>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!selectedDate && (
                        <Badge variant="secondary" className="text-xs">{t("todayBadge")}</Badge>
                      )}
                      {selectedDateEvents.length > 0 && (
                        <Badge variant="outline" className="text-xs tabular-nums">
                          {selectedDateEvents.length}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {(() => {
                    const holidays = getHolidays(country, displayDate.getFullYear());
                    const holiday = holidays.find((h) => isSameDay(h.date, displayDate));
                    if (holiday) {
                      return (
                        <Badge variant="outline" className="mt-1.5 text-xs border-amber-500/40 text-amber-400">
                          {holiday.emoji} {tHolidays(holiday.nameKey)}
                        </Badge>
                      );
                    }
                    return null;
                  })()}
                </div>

                <ScrollArea className="h-auto max-h-[250px] md:max-h-[60vh] xl:h-[calc(100vh-400px)] xl:max-h-none">
                  {/* Mini Day Timeline */}
                  {(() => {
                    const timedEvents = selectedDateEvents.filter((e) => !e.allDay);
                    const allDayEvents = selectedDateEvents.filter((e) => e.allDay);
                    const TIMELINE_START = 6; // 6:00
                    const TIMELINE_END = 22; // 22:00
                    const TOTAL_HOURS = TIMELINE_END - TIMELINE_START;

                    if (timedEvents.length > 0) {
                      return (
                        <div className="mb-4">
                          {/* All-day events banner */}
                          {allDayEvents.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              {allDayEvents.map((ev) => (
                                <button
                                  key={ev.id}
                                  onClick={() => openEventDetail(ev)}
                                  className="text-xs px-2.5 py-1 rounded-full truncate max-w-full hover:brightness-125 transition-all focus-visible:ring-2 focus-visible:ring-ring"
                                  style={{ backgroundColor: `${ev.color}30`, color: ev.color, borderLeft: `2px solid ${ev.color}` }}
                                >
                                  {ev.title}
                                </button>
                              ))}
                            </div>
                          )}
                          {/* Timeline bar */}
                          <div className="relative h-[180px] ml-8">
                            {/* Hour labels and grid lines */}
                            {[6, 8, 10, 12, 14, 16, 18, 20].map((hour) => {
                              const top = ((hour - TIMELINE_START) / TOTAL_HOURS) * 100;
                              return (
                                <div key={hour} className="absolute left-0 right-0" style={{ top: `${top}%` }}>
                                  <span className="absolute -left-8 -translate-y-1/2 text-[10px] text-muted-foreground/50 tabular-nums w-6 text-right">
                                    {hour}:00
                                  </span>
                                  <div className="h-px bg-border/20 w-full" />
                                </div>
                              );
                            })}
                            {/* Current time indicator */}
                            {isSameDay(displayDate, new Date()) && (() => {
                              const now = new Date();
                              const nowHour = now.getHours() + now.getMinutes() / 60;
                              if (nowHour >= TIMELINE_START && nowHour <= TIMELINE_END) {
                                const top = ((nowHour - TIMELINE_START) / TOTAL_HOURS) * 100;
                                return (
                                  <div className="absolute left-0 right-0 z-10" style={{ top: `${top}%` }}>
                                    <div className="flex items-center">
                                      <div className="size-2 rounded-full bg-primary -ml-1 shrink-0" />
                                      <div className="h-px bg-primary flex-1" />
                                    </div>
                                  </div>
                                );
                              }
                              return null;
                            })()}
                            {/* Event blocks */}
                            {timedEvents.map((event) => {
                              const startHour = event.start.getHours() + event.start.getMinutes() / 60;
                              const endHour = event.end.getHours() + event.end.getMinutes() / 60;
                              const clampedStart = Math.max(startHour, TIMELINE_START);
                              const clampedEnd = Math.min(endHour || TIMELINE_END, TIMELINE_END);
                              const top = ((clampedStart - TIMELINE_START) / TOTAL_HOURS) * 100;
                              const height = Math.max(((clampedEnd - clampedStart) / TOTAL_HOURS) * 100, 3);
                              const now = new Date();
                              const isOngoing = isWithinInterval(now, { start: event.start, end: event.end });
                              return (
                                <button
                                  key={event.id}
                                  onClick={() => openEventDetail(event)}
                                  className={`absolute left-1 right-0 rounded-md px-2 py-0.5 overflow-hidden text-left transition-all hover:brightness-125 focus-visible:ring-2 focus-visible:ring-ring ${isOngoing ? "ring-1 ring-primary/60" : ""}`}
                                  style={{
                                    top: `${top}%`,
                                    height: `${height}%`,
                                    minHeight: "18px",
                                    backgroundColor: `${event.color}25`,
                                    borderLeft: `3px solid ${event.color}`,
                                  }}
                                >
                                  <span className="text-[11px] font-medium truncate block leading-tight">{event.title}</span>
                                  <span className="text-[9px] text-muted-foreground truncate block">
                                    {formatTime(event.start)} – {formatTime(event.end)}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  <AnimatePresence mode="popLayout">
                    {selectedDateEvents.length === 0 ? (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-muted-foreground"
                      >
                        {/* Holiday indicator for selected date */}
                        {(() => {
                          const holidays = getHolidays(country, displayDate.getFullYear());
                          const holiday = holidays.find((h) => isSameDay(h.date, displayDate));
                          if (holiday) {
                            return (
                              <div className="text-center py-4 px-3 mb-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                                <span className="text-2xl">{holiday.emoji}</span>
                                <p className="text-sm font-medium text-amber-400 mt-1">{tHolidays(holiday.nameKey)}</p>
                                <p className="text-xs text-amber-400/60 mt-0.5">{t("holidayLabel")}</p>
                              </div>
                            );
                          }
                          return null;
                        })()}
                        <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                          <CalendarIcon className="size-8 mb-2 text-primary/20" />
                          <p className="text-sm">{t("noEventsToday")}</p>
                        </div>
                        {/* Coming up preview - show next events from future days */}
                        {(() => {
                          const upcomingEvents: { event: CalendarEvent; date: Date }[] = [];
                          for (let i = 1; i <= 7 && upcomingEvents.length < 3; i++) {
                            const futureDate = addDays(displayDate, i);
                            const dayEvents = getEventsForDay(futureDate);
                            for (const ev of dayEvents) {
                              if (upcomingEvents.length >= 3) break;
                              upcomingEvents.push({ event: ev, date: futureDate });
                            }
                          }
                          if (upcomingEvents.length === 0) return null;
                          return (
                            <div className="mt-4 pt-4 border-t border-border/50">
                              <p className="text-xs font-medium uppercase tracking-wider mb-3 text-muted-foreground/70">
                                {t("upcomingHeading")}
                              </p>
                              <div className="flex flex-col gap-2">
                                {upcomingEvents.map(({ event, date }, idx) => {
                                  return (
                                    <div
                                      key={`${event.id}-${idx}`}
                                      role="button"
                                      tabIndex={0}
                                      aria-label={`${event.title}, ${format(date, "EEE, d. MMM", { locale: dateLocale })}`}
                                      className="p-2.5 rounded-lg cursor-pointer hover:bg-accent/50 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                                      style={{
                                        backgroundColor: `${event.color}10`,
                                        borderLeft: `2px solid ${event.color}`,
                                      }}
                                      onClick={() => {
                                        setSelectedDate(date);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                          e.preventDefault();
                                          setSelectedDate(date);
                                        }
                                      }}
                                    >
                                      <p className="text-sm font-medium text-foreground truncate">{event.title}</p>
                                      <div className="flex items-center gap-2 mt-0.5 text-xs">
                                        <span>{format(date, "EEE, d. MMM", { locale: dateLocale })}</span>
                                        {!event.allDay && (
                                          <span className="flex items-center gap-0.5">
                                            <Clock className="size-2.5" />
                                            {formatTime(event.start)}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}
                      </motion.div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {/* All-day events list (when no timeline shown) */}
                        {selectedDateEvents.filter(e => e.allDay).length > 0 && selectedDateEvents.filter(e => !e.allDay).length === 0 && (
                          <div className="flex flex-col gap-2">
                            {selectedDateEvents.filter(e => e.allDay).map((event, index) => {
                              const person = getPersonById(event.person_id);
                              return (
                                <motion.div
                                  key={event.id}
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: index * 0.05 }}
                                  role="button"
                                  tabIndex={0}
                                  aria-label={`${event.title}, ${t("allDayBadge")}${event.location ? `, ${event.location}` : ""}`}
                                  onClick={() => openEventDetail(event)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      openEventDetail(event);
                                    }
                                  }}
                                  className="p-3 rounded-xl cursor-pointer hover:bg-accent/50 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                                  style={{
                                    backgroundColor: `${event.color}15`,
                                    borderLeft: `3px solid ${event.color}`,
                                  }}
                                >
                                  <p className="font-medium truncate">{event.title}</p>
                                  <div className="flex items-center gap-2 mt-1">
                                    <Badge variant="outline" className="text-xs">{t("allDayBadge")}</Badge>
                                    {person && (
                                      <Badge variant="outline" className="text-xs" style={{ borderColor: person.color, color: person.color }}>
                                        {person.name}
                                      </Badge>
                                    )}
                                  </div>
                                  {event.location && (
                                    <p className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                                      <MapPin className="size-3" />
                                      {event.location}
                                    </p>
                                  )}
                                </motion.div>
                              );
                            })}
                          </div>
                        )}
                        {/* Timed event details (shown below timeline) */}
                        {selectedDateEvents.filter(e => !e.allDay).length > 0 && (
                          <div className="flex flex-col gap-2">
                            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">{t("detailsHeading")}</p>
                            {selectedDateEvents.filter(e => !e.allDay).map((event, index) => {
                              const person = getPersonById(event.person_id);
                              const now = new Date();
                              const isOngoing = isWithinInterval(now, { start: event.start, end: event.end });
                              const isUpcomingSoon = !isOngoing && isBefore(now, event.start) && isSameDay(now, displayDate) && differenceInMinutes(event.start, now) <= 60;
                              const minutesUntil = isBefore(now, event.start) ? differenceInMinutes(event.start, now) : 0;
                              const isPast = isAfter(now, event.end) && isSameDay(now, displayDate);
                              return (
                                <motion.div
                                  key={event.id}
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: index * 0.05 }}
                                  role="button"
                                  tabIndex={0}
                                  aria-label={`${event.title}, ${formatTime(event.start)} - ${formatTime(event.end)}${event.location ? `, ${event.location}` : ""}${isOngoing ? `, ${t("ongoingAria")}` : ""}`}
                                  onClick={() => openEventDetail(event)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      openEventDetail(event);
                                    }
                                  }}
                                  className={`cursor-pointer transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-xl ${
                                    isOngoing ? "ring-1 ring-primary/40" : ""
                                  } ${isPast ? "opacity-50" : ""}`}
                                >
                                  <EventPill
                                    variant="agenda"
                                    title={event.title}
                                    color={event.color}
                                    time={formatTime(event.start)}
                                    icon={event.is_waste_collection ? Trash2 : undefined}
                                  />
                                  <div className="flex flex-wrap items-center gap-2 px-4 pt-1.5">
                                    {isOngoing && (
                                      <span className="flex items-center gap-1 text-xs text-primary shrink-0">
                                        <span className="relative flex size-2">
                                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                                          <span className="relative inline-flex rounded-full size-2 bg-primary" />
                                        </span>
                                        {t("nowBadge")}
                                      </span>
                                    )}
                                    {isUpcomingSoon && minutesUntil > 0 && (
                                      <span className="text-xs text-primary shrink-0">
                                        {t("inMinutes", { minutes: minutesUntil })}
                                      </span>
                                    )}
                                    {event.location && (
                                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                        <MapPin className="size-3" />
                                        {event.location}
                                      </span>
                                    )}
                                    {person && (
                                      <Badge variant="outline" className="text-xs" style={{ borderColor: person.color, color: person.color }}>
                                        {person.name}
                                      </Badge>
                                    )}
                                  </div>
                                </motion.div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </AnimatePresence>
                </ScrollArea>
              </Card>
            </motion.div>
          </div>

          {/* Edit Event Dialog */}
          <Dialog
            open={editMode}
            onOpenChange={(open) => {
              if (!open) {
                setEditMode(false);
              }
            }}
          >
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>{t("editDialogTitle")}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4 pt-4">
                {/* Title */}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="edit-title">{t("fieldTitle")}</Label>
                  <Input
                    id="edit-title"
                    value={editForm.title}
                    onChange={(e) =>
                      setEditForm({ ...editForm, title: e.target.value })
                    }
                  />
                </div>

                {/* All Day Toggle */}
                <div className="flex items-center justify-between">
                  <Label htmlFor="edit-allDay">{t("fieldAllDay")}</Label>
                  <Switch
                    id="edit-allDay"
                    checked={editForm.allDay}
                    onCheckedChange={(checked) =>
                      setEditForm({ ...editForm, allDay: checked })
                    }
                  />
                </div>

                {/* Date(s) and Time */}
                {editForm.allDay ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-2">
                      <Label>{t("fieldStartDate")}</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className="w-full justify-start text-left font-normal"
                          >
                            <CalendarIcon className="mr-2 size-4" />
                            {format(editForm.startDate, "P", { locale: dateLocale })}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={editForm.startDate}
                            onSelect={(date) => {
                              if (!date) return;
                              const updates: Partial<typeof editForm> = { startDate: date };
                              if (date > editForm.endDate) updates.endDate = date;
                              setEditForm((prev) => ({ ...prev, ...updates }));
                            }}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label>{t("fieldEndDate")}</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className="w-full justify-start text-left font-normal"
                          >
                            <CalendarIcon className="mr-2 size-4" />
                            {format(editForm.endDate, "P", { locale: dateLocale })}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={editForm.endDate}
                            onSelect={(date) =>
                              date && date >= editForm.startDate && setEditForm({ ...editForm, endDate: date })
                            }
                            disabled={(date) => date < editForm.startDate}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-2">
                      <Label>{t("fieldDate")}</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className="w-full justify-start text-left font-normal"
                          >
                            <CalendarIcon className="mr-2 size-4" />
                            {format(editForm.startDate, "PPP", { locale: dateLocale })}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={editForm.startDate}
                            onSelect={(date) =>
                              date && setEditForm({ ...editForm, startDate: date, endDate: date })
                            }
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="edit-startTime">{t("fieldFrom")}</Label>
                        <Input
                          id="edit-startTime"
                          type="time"
                          value={editForm.startTime}
                          onChange={(e) =>
                            setEditForm({ ...editForm, startTime: e.target.value })
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="edit-endTime">{t("fieldTo")}</Label>
                        <Input
                          id="edit-endTime"
                          type="time"
                          value={editForm.endTime}
                          onChange={(e) =>
                            setEditForm({ ...editForm, endTime: e.target.value })
                          }
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Location */}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="edit-location">{t("fieldLocation")}</Label>
                  <LocationAutocomplete
                    id="edit-location"
                    value={editForm.location}
                    onChange={(value) =>
                      setEditForm({ ...editForm, location: value })
                    }
                    placeholder={t("fieldLocationPlaceholder")}
                  />
                </div>

                {/* Person */}
                <div className="flex flex-col gap-2">
                  <Label>{t("fieldPerson")}</Label>
                  <Select
                    value={editForm.person_id || "none"}
                    onValueChange={(value) =>
                      setEditForm({ ...editForm, person_id: value === "none" ? null : value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("fieldPersonPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        <span className="text-muted-foreground">{t("fieldPersonNone")}</span>
                      </SelectItem>
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

                {/* Submit */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setEditMode(false)}
                  >
                    {tCommon("cancel")}
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={!editForm.title.trim() || updateEvent.isPending}
                    onClick={async () => {
                      if (!selectedEvent) return;

                      const [startHour, startMinute] = editForm.startTime.split(":").map(Number);
                      const [endHour, endMinute] = editForm.endTime.split(":").map(Number);

                      const start = editForm.allDay
                        ? startOfDay(editForm.startDate)
                        : setMinutes(setHours(editForm.startDate, startHour), startMinute);
                      const end = editForm.allDay
                        ? endOfDay(editForm.endDate)
                        : setMinutes(setHours(editForm.startDate, endHour), endMinute);

                      if (end < start) {
                        toast.error(t("toastDateOrder"));
                        return;
                      }

                      try {
                        await updateEvent.mutateAsync({
                          id: selectedEvent.id,
                          title: editForm.title,
                          location: editForm.location || undefined,
                          start_at: start.toISOString(),
                          end_at: end.toISOString(),
                          all_day: editForm.allDay,
                          person_id: editForm.person_id,
                        });

                        setEditMode(false);
                        closeEventDetail();
                      } catch {
                        toast.error(t("toastUpdateFailed"));
                      }
                    }}
                  >
                    {updateEvent.isPending ? (
                      <>
                        <Loader2 className="size-4 mr-2 animate-spin" />
                        {t("saving")}
                      </>
                    ) : (
                      tCommon("save")
                    )}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Event Detail Dialog */}
          <Dialog
            open={!!selectedEvent && !editMode}
            onOpenChange={(open) => !open && closeEventDetail()}
          >
            <DialogContent className="sm:max-w-[500px]">
              {selectedEvent && (
                <>
                  <DialogHeader>
                    <div
                      className="w-full h-2 rounded-full mb-4"
                      style={{ backgroundColor: selectedEvent.color }}
                    />
                    <DialogTitle className="text-xl">
                      {selectedEvent.title}
                    </DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <Clock className="size-5" />
                      <div>
                        {selectedEvent.allDay && !isSameDay(selectedEvent.start, selectedEvent.end) ? (
                          <>
                            <p className="font-medium text-foreground">
                              {format(selectedEvent.start, "EEEE, d. MMMM", { locale: dateLocale })} &ndash; {format(selectedEvent.end, "EEEE, d. MMMM yyyy", { locale: dateLocale })}
                            </p>
                            <p className="text-sm">{t("allDayBadge")}</p>
                          </>
                        ) : (
                          <>
                            <p className="font-medium text-foreground">
                              {format(selectedEvent.start, "EEEE, d. MMMM yyyy", { locale: dateLocale })}
                            </p>
                            {selectedEvent.allDay ? (
                              <p className="text-sm">{t("allDayBadge")}</p>
                            ) : (
                              <p className="text-sm">
                                {formatTime(selectedEvent.start)} &ndash; {formatTime(selectedEvent.end)}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {selectedEvent.location && (
                      <div className="flex items-center gap-3 text-muted-foreground">
                        <MapPin className="size-5" />
                        <p>{selectedEvent.location}</p>
                      </div>
                    )}

                    {selectedEvent.person_id && (
                      <div className="flex items-center gap-3 text-muted-foreground">
                        <User className="size-5" />
                        <Badge
                          variant="outline"
                          style={{
                            borderColor: getPersonById(selectedEvent.person_id)?.color,
                            color: getPersonById(selectedEvent.person_id)?.color,
                          }}
                        >
                          {getPersonById(selectedEvent.person_id)?.name}
                        </Badge>
                      </div>
                    )}

                    {selectedEvent.description && (
                      <p className="text-muted-foreground pt-4 border-t">
                        {selectedEvent.description}
                      </p>
                    )}

                    {/* Edit/Delete Buttons */}
                    <div className="flex gap-2 pt-4 border-t">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          setEditForm({
                            title: selectedEvent.title,
                            location: selectedEvent.location || "",
                            startDate: selectedEvent.start,
                            endDate: selectedEvent.end,
                            startTime: formatTime(selectedEvent.start),
                            endTime: formatTime(selectedEvent.end),
                            allDay: selectedEvent.allDay,
                            person_id: selectedEvent.person_id || null,
                          });
                          setEditMode(true);
                        }}
                      >
                        <Pencil className="size-4 mr-2" />
                        {tCommon("edit")}
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" className="flex-1" disabled={deleteEvent.isPending}>
                            {deleteEvent.isPending ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <>
                                <Trash2 className="size-4 mr-2" />
                                {tCommon("delete")}
                              </>
                            )}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("deleteDialogTitle")}</AlertDialogTitle>
                            <AlertDialogDescription>{t("deleteConfirm")}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={async () => {
                                // The loaded-range query misses events opened via
                                // ?event= deep-link whose date falls outside the
                                // current view — fall back to the byId row so the
                                // undo snapshot isn't empty. Both queries select
                                // the same shape (raw row + joined calendar).
                                const rawEvent =
                                  eventsData?.find((e) => e.id === selectedEvent.id) ??
                                  (deepLinkEventData?.id === selectedEvent.id ? deepLinkEventData : undefined);
                                try {
                                  await deleteEvent.mutateAsync(selectedEvent.id);
                                  closeEventDetail();
                                  if (rawEvent) {
                                    const { calendar: _calendar, ...eventSnapshot } = rawEvent;
                                    showUndoToast({
                                      message: t("eventDeleted"),
                                      undoLabel: tCommon("undo"),
                                      errorMessage: tCommon("undoFailed"),
                                      onUndo: async () => {
                                        const supabase = createClient();
                                        // useDeleteEvent already deleted the Google-side copy before the
                                        // local delete — undo can only restore the local row, so the
                                        // Google link is nulled to avoid pointing at a deleted event.
                                        const { error } = await (supabase as any)
                                          .from("events")
                                          .insert({ ...eventSnapshot, google_event_id: null });
                                        if (error) throw error;
                                        if (family?.id) {
                                          queryClient.invalidateQueries({ queryKey: queryKeys.events(family.id) });
                                        }
                                      },
                                    });
                                  }
                                } catch {
                                  toast.error(t("toastDeleteFailed"));
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
                </>
              )}
            </DialogContent>
          </Dialog>

          {/* Mobile add FAB — desktop uses the header button */}
          <FAB
            icon={Plus}
            onClick={openAddDialog}
            ariaLabel={t("newEventButton")}
            className="sm:hidden"
          />

        </div>
      </main>
    </TooltipProvider>
  );
}
