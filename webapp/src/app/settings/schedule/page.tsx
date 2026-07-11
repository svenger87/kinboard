"use client";

import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { useTranslations, useLocale } from "next-intl";
import { format } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import {
  GraduationCap,
  Plus,
  X,
  Calculator,
  BookOpen,
  Globe,
  Dumbbell,
  Music,
  Palette,
  Atom,
  FlaskConical,
  Leaf,
  Clock,
  MapPin,
  Church,
  Languages,
  Computer,
  Microscope,
  Scale,
  Drama,
  Utensils,
  Hammer,
  Pen,
  PenTool,
  Ruler,
  Compass,
  Triangle,
  Binary,
  Cpu,
  Database,
  Code,
  Terminal,
  Gamepad2,
  Heart,
  Brain,
  Eye,
  Ear,
  Hand,
  Footprints,
  Users,
  Home,
  Building,
  Castle,
  Landmark,
  Mountain,
  Trees,
  Flower2,
  Sun,
  Moon,
  Star,
  Cloud,
  Droplets,
  Waves,
  Wind,
  Flame,
  Zap,
  Sparkles,
  Rainbow,
  Rocket,
  Plane,
  Car,
  Bus,
  Train,
  Ship,
  Bike,
  Camera,
  Film,
  Headphones,
  Mic,
  Guitar,
  Piano,
  Drum,
  Scissors,
  Brush,
  Paintbrush,
  FileText,
  Newspaper,
  BookMarked,
  Library,
  Scroll,
  Award,
  Trophy,
  Medal,
  Target,
  Flag,
  Megaphone,
  MessageCircle,
  Quote,
  HelpCircle,
  Info,
  Lightbulb,
  Puzzle,
  Blocks,
  Box,
  Gift,
  Shirt,
  Key,
  Shield,
  Swords,
  Wrench,
  Cog,
  Loader2,
  Settings,
  Trash2,
  AlertCircle,
  RefreshCw,
  Backpack,
  Pencil,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  usePeople,
  useSubjects,
  useCreateSubject,
  useUpdateSubject,
  useDeleteSubject,
  useSchedules,
  useUpsertSchedule,
  useSetting,
  useUpdateSetting,
} from "@/hooks";
import type { Subject, Json } from "@/types/database";

// Pack items configuration type
interface PackItemConfig {
  subject: string;
  items: string[];
}

const DEFAULT_PACK_ITEMS: PackItemConfig[] = [
  { subject: "Sport", items: ["Sportkleidung", "Turnschuhe", "Trinkflasche"] },
  { subject: "Schwimmen", items: ["Badeanzug/Badehose", "Handtuch", "Schwimmbrille", "Badekappe"] },
  { subject: "Kunst", items: ["Malkittel", "Pinsel & Farben"] },
  { subject: "Musik", items: ["Instrument", "Notenheft"] },
  { subject: "Religion", items: ["Religionsheft"] },
  { subject: "Werken", items: ["Arbeitskittel"] },
  { subject: "Textilgestaltung", items: ["Nähzeug", "Stoffe"] },
];

// Period configuration type
interface PeriodConfig {
  num: number;
  start: string;
  end: string;
}

// Time slot structure
interface TimeSlot {
  period: number;
  start: string;
  end: string;
  subject: string;
  room?: string;
}

// Available icons for subjects - organized by category
const SUBJECT_ICONS: { name: string; icon: LucideIcon }[] = [
  // Math & Science
  { name: "Calculator", icon: Calculator },
  { name: "Ruler", icon: Ruler },
  { name: "Compass", icon: Compass },
  { name: "Triangle", icon: Triangle },
  { name: "Atom", icon: Atom },
  { name: "FlaskConical", icon: FlaskConical },
  { name: "Microscope", icon: Microscope },
  { name: "Brain", icon: Brain },
  { name: "Lightbulb", icon: Lightbulb },
  // Language & Literature
  { name: "BookOpen", icon: BookOpen },
  { name: "BookMarked", icon: BookMarked },
  { name: "Pen", icon: Pen },
  { name: "PenTool", icon: PenTool },
  { name: "Languages", icon: Languages },
  { name: "FileText", icon: FileText },
  { name: "Newspaper", icon: Newspaper },
  { name: "Library", icon: Library },
  { name: "Scroll", icon: Scroll },
  { name: "Quote", icon: Quote },
  { name: "MessageCircle", icon: MessageCircle },
  // Geography & History
  { name: "Globe", icon: Globe },
  { name: "MapPin", icon: MapPin },
  { name: "Mountain", icon: Mountain },
  { name: "Trees", icon: Trees },
  { name: "Clock", icon: Clock },
  { name: "Landmark", icon: Landmark },
  { name: "Castle", icon: Castle },
  { name: "Building", icon: Building },
  { name: "Flag", icon: Flag },
  // Nature & Biology
  { name: "Leaf", icon: Leaf },
  { name: "Flower2", icon: Flower2 },
  { name: "Heart", icon: Heart },
  { name: "Eye", icon: Eye },
  { name: "Ear", icon: Ear },
  { name: "Hand", icon: Hand },
  { name: "Droplets", icon: Droplets },
  { name: "Waves", icon: Waves },
  // Sports & PE
  { name: "Dumbbell", icon: Dumbbell },
  { name: "Footprints", icon: Footprints },
  { name: "Bike", icon: Bike },
  { name: "Target", icon: Target },
  { name: "Trophy", icon: Trophy },
  { name: "Medal", icon: Medal },
  { name: "Award", icon: Award },
  // Arts & Music
  { name: "Music", icon: Music },
  { name: "Guitar", icon: Guitar },
  { name: "Piano", icon: Piano },
  { name: "Drum", icon: Drum },
  { name: "Headphones", icon: Headphones },
  { name: "Mic", icon: Mic },
  { name: "Palette", icon: Palette },
  { name: "Paintbrush", icon: Paintbrush },
  { name: "Brush", icon: Brush },
  { name: "Scissors", icon: Scissors },
  { name: "Drama", icon: Drama },
  { name: "Camera", icon: Camera },
  { name: "Film", icon: Film },
  // Technology & Computing
  { name: "Computer", icon: Computer },
  { name: "Cpu", icon: Cpu },
  { name: "Code", icon: Code },
  { name: "Terminal", icon: Terminal },
  { name: "Binary", icon: Binary },
  { name: "Database", icon: Database },
  { name: "Gamepad2", icon: Gamepad2 },
  // Religion & Ethics
  { name: "Church", icon: Church },
  { name: "Scale", icon: Scale },
  { name: "Users", icon: Users },
  { name: "HelpCircle", icon: HelpCircle },
  { name: "Sparkles", icon: Sparkles },
  // Home Economics & Crafts
  { name: "Utensils", icon: Utensils },
  { name: "Home", icon: Home },
  { name: "Shirt", icon: Shirt },
  { name: "Hammer", icon: Hammer },
  { name: "Wrench", icon: Wrench },
  { name: "Cog", icon: Cog },
  { name: "Box", icon: Box },
  // Weather & Nature
  { name: "Sun", icon: Sun },
  { name: "Moon", icon: Moon },
  { name: "Star", icon: Star },
  { name: "Cloud", icon: Cloud },
  { name: "Wind", icon: Wind },
  { name: "Flame", icon: Flame },
  { name: "Zap", icon: Zap },
  { name: "Rainbow", icon: Rainbow },
  // Transportation
  { name: "Rocket", icon: Rocket },
  { name: "Plane", icon: Plane },
  { name: "Car", icon: Car },
  { name: "Bus", icon: Bus },
  { name: "Train", icon: Train },
  { name: "Ship", icon: Ship },
  // Misc
  { name: "Puzzle", icon: Puzzle },
  { name: "Blocks", icon: Blocks },
  { name: "Gift", icon: Gift },
  { name: "Key", icon: Key },
  { name: "Shield", icon: Shield },
  { name: "Swords", icon: Swords },
  { name: "Megaphone", icon: Megaphone },
  { name: "Info", icon: Info },
  { name: "GraduationCap", icon: GraduationCap },
];

type ColorKey =
  | "color_blue"
  | "color_red"
  | "color_orange"
  | "color_green"
  | "color_purple"
  | "color_pink"
  | "color_cyan"
  | "color_lime"
  | "color_teal"
  | "color_yellow"
  | "color_indigo"
  | "color_rose";

const SUBJECT_COLORS: { labelKey: ColorKey; value: string }[] = [
  { labelKey: "color_blue", value: "#3b82f6" },
  { labelKey: "color_red", value: "#ef4444" },
  { labelKey: "color_orange", value: "#f97316" },
  { labelKey: "color_green", value: "#22c55e" },
  { labelKey: "color_purple", value: "#a855f7" },
  { labelKey: "color_pink", value: "#ec4899" },
  { labelKey: "color_cyan", value: "#06b6d4" },
  { labelKey: "color_lime", value: "#84cc16" },
  { labelKey: "color_teal", value: "#14b8a6" },
  { labelKey: "color_yellow", value: "#f59e0b" },
  { labelKey: "color_indigo", value: "#6366f1" },
  { labelKey: "color_rose", value: "#f43f5e" },
];

// Helper to add minutes to a time string
function addMinutes(time: string, minutes: number): string {
  const [hours, mins] = time.split(":").map(Number);
  const totalMinutes = hours * 60 + mins + minutes;
  const newHours = Math.floor(totalMinutes / 60) % 24;
  const newMins = totalMinutes % 60;
  return `${newHours.toString().padStart(2, "0")}:${newMins.toString().padStart(2, "0")}`;
}

const DEFAULT_PERIODS: PeriodConfig[] = [
  { num: 1, start: "08:00", end: "08:45" },
  { num: 2, start: "08:50", end: "09:35" },
  { num: 3, start: "09:50", end: "10:35" },
  { num: 4, start: "10:40", end: "11:25" },
  { num: 5, start: "11:40", end: "12:25" },
  { num: 6, start: "12:30", end: "13:15" },
  { num: 7, start: "14:00", end: "14:45" },
  { num: 8, start: "14:50", end: "15:35" },
];

export default function ScheduleSettingsPage() {
  const t = useTranslations("settings.schedule");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);

  // Localized day names — Monday through Friday (1..5 in date-fns where Mon = day index)
  const dayName = (dayIndex: number): string => {
    // dayIndex is 0..4 for Mon..Fri. Use a known Monday (2024-01-01 is Monday) and add dayIndex days.
    const monday = new Date(2024, 0, 1);
    const day = new Date(monday.getTime() + dayIndex * 86400000);
    return format(day, "EEEE", { locale: dateLocale });
  };

  // Fetch people (only children) and subjects from Supabase
  const { data: allPeople = [], isLoading: peopleLoading, error: peopleError, refetch: refetchPeople } = usePeople();
  const { data: subjects = [], isLoading: subjectsLoading, error: subjectsError, refetch: refetchSubjects } = useSubjects();
  const createSubject = useCreateSubject();
  const updateSubject = useUpdateSubject();
  const deleteSubject = useDeleteSubject();

  // Fetch period configuration from settings
  const { data: savedPeriods, isLoading: periodsLoading } = useSetting<PeriodConfig[]>(
    "schedule_periods",
    DEFAULT_PERIODS
  );
  const updateSetting = useUpdateSetting<PeriodConfig[]>();
  const periods = savedPeriods || DEFAULT_PERIODS;

  // Filter to only children
  const children = useMemo(
    () => allPeople.filter((p) => p.is_child),
    [allPeople]
  );

  const [selectedPerson, setSelectedPerson] = useState<string>("");

  // Set initial selected person when children are loaded
  useEffect(() => {
    if (children.length > 0 && !selectedPerson) {
      setSelectedPerson(children[0].id);
    }
  }, [children, selectedPerson]);

  // Fetch schedules for selected person
  const { data: schedules = [], isLoading: schedulesLoading } = useSchedules(selectedPerson);
  const upsertSchedule = useUpsertSchedule();

  // Subject dialog state
  const [subjectDialogOpen, setSubjectDialogOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [newSubject, setNewSubject] = useState({
    name: "",
    color: "#3b82f6",
    icon: "BookOpen",
  });

  // Slot edit dialog state
  const [slotDialogOpen, setSlotDialogOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<{
    day: number;
    period: number;
    slot?: TimeSlot;
  } | null>(null);
  const [slotForm, setSlotForm] = useState({ subject: "", room: "", start: "", end: "" });

  // Periods configuration dialog state
  const [periodsDialogOpen, setPeriodsDialogOpen] = useState(false);
  const [editingPeriods, setEditingPeriods] = useState<PeriodConfig[]>([]);

  // Pack items setting
  const { data: savedPackItems } = useSetting<PackItemConfig[]>("schedule_pack_items", DEFAULT_PACK_ITEMS);
  const updatePackItemsSetting = useUpdateSetting<PackItemConfig[]>();
  const currentPackItems = savedPackItems || DEFAULT_PACK_ITEMS;

  // Pack items dialog state
  const [packDialogOpen, setPackDialogOpen] = useState(false);
  const [editingPackItem, setEditingPackItem] = useState<PackItemConfig | null>(null);
  const [packForm, setPackForm] = useState({ subject: "", items: "" });

  // Convert schedules array to a map: dayOfWeek -> TimeSlot[]
  const schedulesMap = useMemo(() => {
    const map: Record<number, TimeSlot[]> = {};
    schedules.forEach((schedule) => {
      const slots = schedule.time_slots as unknown as TimeSlot[];
      if (Array.isArray(slots)) {
        map[schedule.day_of_week] = slots;
      }
    });
    return map;
  }, [schedules]);

  // Helper functions
  const getSlotForPeriod = (dayIndex: number, periodNum: number): TimeSlot | undefined => {
    return schedulesMap[dayIndex]?.find((s) => s.period === periodNum);
  };

  const getSubject = (name: string): Subject | undefined => {
    return subjects.find((s) => s.name === name);
  };

  const getSubjectIcon = (iconName: string | null): LucideIcon => {
    return SUBJECT_ICONS.find((i) => i.name === iconName)?.icon || BookOpen;
  };

  // Subject handlers
  const openAddSubjectDialog = () => {
    setEditingSubject(null);
    setNewSubject({ name: "", color: "#3b82f6", icon: "BookOpen" });
    setSubjectDialogOpen(true);
  };

  const openEditSubjectDialog = (subject: Subject) => {
    setEditingSubject(subject);
    setNewSubject({
      name: subject.name,
      color: subject.color,
      icon: subject.icon || "BookOpen",
    });
    setSubjectDialogOpen(true);
  };

  const handleSaveSubject = async () => {
    if (!newSubject.name.trim()) return;

    try {
      if (editingSubject) {
        await updateSubject.mutateAsync({
          id: editingSubject.id,
          name: newSubject.name.trim(),
          color: newSubject.color,
          icon: newSubject.icon,
        });
      } else {
        await createSubject.mutateAsync({
          name: newSubject.name.trim(),
          color: newSubject.color,
          icon: newSubject.icon,
        });
      }
      setSubjectDialogOpen(false);
    } catch {
      toast.error(t("toastSubjectSaveFailed"));
    }
  };

  const handleDeleteSubject = async (id: string) => {
    try {
      await deleteSubject.mutateAsync(id);
    } catch {
      toast.error(t("toastSubjectDeleteFailed"));
    }
  };

  // Pack items handlers
  const openAddPackDialog = () => {
    setEditingPackItem(null);
    setPackForm({ subject: "", items: "" });
    setPackDialogOpen(true);
  };

  const openEditPackDialog = (item: PackItemConfig) => {
    setEditingPackItem(item);
    setPackForm({ subject: item.subject, items: item.items.join(", ") });
    setPackDialogOpen(true);
  };

  const handleSavePackItem = async () => {
    if (!packForm.subject.trim() || !packForm.items.trim()) return;
    const newItem: PackItemConfig = {
      subject: packForm.subject.trim(),
      items: packForm.items.split(",").map((s) => s.trim()).filter(Boolean),
    };
    let updated: PackItemConfig[];
    if (editingPackItem) {
      updated = currentPackItems.map((pi) =>
        pi.subject === editingPackItem.subject ? newItem : pi
      );
    } else {
      updated = [...currentPackItems, newItem];
    }
    try {
      await updatePackItemsSetting.mutateAsync({ key: "schedule_pack_items", value: updated });
      setPackDialogOpen(false);
    } catch {
      toast.error(t("toastPackSaveFailed"));
    }
  };

  const handleDeletePackItem = async (subject: string) => {
    const updated = currentPackItems.filter((pi) => pi.subject !== subject);
    try {
      await updatePackItemsSetting.mutateAsync({ key: "schedule_pack_items", value: updated });
    } catch {
      toast.error(t("toastPackDeleteFailed"));
    }
  };

  // Periods dialog handlers
  const openPeriodsDialog = () => {
    setEditingPeriods([...periods]);
    setPeriodsDialogOpen(true);
  };

  const handleAddPeriod = () => {
    const lastPeriod = editingPeriods[editingPeriods.length - 1];
    const newNum = lastPeriod ? lastPeriod.num + 1 : 1;
    const newStart = lastPeriod ? addMinutes(lastPeriod.end, 5) : "08:00";
    const newEnd = addMinutes(newStart, 45);
    setEditingPeriods([...editingPeriods, { num: newNum, start: newStart, end: newEnd }]);
  };

  const handleUpdatePeriod = (index: number, field: "start" | "end", value: string) => {
    const updated = [...editingPeriods];
    updated[index] = { ...updated[index], [field]: value };
    setEditingPeriods(updated);
  };

  const handleRemovePeriod = (index: number) => {
    const updated = editingPeriods.filter((_, i) => i !== index);
    const renumbered = updated.map((p, i) => ({ ...p, num: i + 1 }));
    setEditingPeriods(renumbered);
  };

  const handleSavePeriods = async () => {
    try {
      await updateSetting.mutateAsync({
        key: "schedule_periods",
        value: editingPeriods,
      });
      setPeriodsDialogOpen(false);
    } catch {
      toast.error(t("toastPeriodSaveFailed"));
    }
  };

  // Slot handlers
  const openSlotDialog = (day: number, period: number, slot?: TimeSlot) => {
    const periodInfo = periods.find((p) => p.num === period)!;
    setEditingSlot({ day, period, slot });
    setSlotForm({
      subject: slot?.subject || "",
      room: slot?.room || "",
      start: slot?.start || periodInfo.start,
      end: slot?.end || periodInfo.end,
    });
    setSlotDialogOpen(true);
  };

  const handleSaveSlot = async () => {
    if (!editingSlot || !slotForm.subject || !selectedPerson) {
      setSlotDialogOpen(false);
      return;
    }

    const { day, period } = editingSlot;
    const existingSlots = schedulesMap[day] || [];
    const filteredSlots = existingSlots.filter((s) => s.period !== period);

    const newSlot: TimeSlot = {
      period,
      start: slotForm.start,
      end: slotForm.end,
      subject: slotForm.subject,
      room: slotForm.room.trim() || undefined,
    };

    const updatedSlots = [...filteredSlots, newSlot].sort(
      (a, b) => a.period - b.period
    );

    try {
      await upsertSchedule.mutateAsync({
        person_id: selectedPerson,
        day_of_week: day,
        time_slots: updatedSlots as unknown as Json[],
      });
      setSlotDialogOpen(false);
    } catch {
      toast.error(t("toastSlotSaveFailed"));
    }
  };

  const handleDeleteSlot = async (dayIndex: number, periodNum: number) => {
    if (!selectedPerson) return;

    const existingSlots = schedulesMap[dayIndex] || [];
    const updatedSlots = existingSlots.filter((s) => s.period !== periodNum);

    try {
      await upsertSchedule.mutateAsync({
        person_id: selectedPerson,
        day_of_week: dayIndex,
        time_slots: updatedSlots as unknown as Json[],
      });
    } catch {
      toast.error(t("toastSlotDeleteFailed"));
    }
  };

  const isLoading = peopleLoading || subjectsLoading || periodsLoading;
  const error = peopleError || subjectsError;

  const handleRetry = () => {
    if (peopleError) refetchPeople();
    if (subjectsError) refetchSubjects();
  };

  const isSaving =
    createSubject.isPending ||
    updateSubject.isPending ||
    deleteSubject.isPending ||
    upsertSchedule.isPending ||
    updateSetting.isPending ||
    updatePackItemsSetting.isPending;

  // Loading state
  if (isLoading) {
    return (
      <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="relative z-10 max-w-6xl mx-auto">
          <PageHeader
            icon={GraduationCap}
            title={t("title")}
            subtitle={<Skeleton className="h-4 w-32" />}
            backHref="/settings"
            className="mb-8"
          />
          <Card className="p-4 mb-6">
            <Skeleton className="h-10 w-full" />
          </Card>
          <Card className="p-4">
            <Skeleton className="h-96 w-full" />
          </Card>
        </div>
      </main>
    );
  }

  // Error state
  if (error) {
    return (
      <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="relative z-10 max-w-6xl mx-auto">
          <PageHeader
            icon={GraduationCap}
            title={t("title")}
            subtitle={t("subtitle")}
            backHref="/settings"
            className="mb-8"
          />
          <Card className="p-8 text-center">
            <AlertCircle className="size-12 mx-auto mb-3 text-destructive opacity-50" />
            <p className="text-destructive font-medium">{t("loadErrorTitle")}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {t("loadErrorDescription")}
            </p>
            <Button
              variant="outline"
              onClick={handleRetry}
              className="mt-4"
            >
              <RefreshCw className="size-4 mr-2" />
              {t("retryButton")}
            </Button>
          </Card>
        </div>
      </main>
    );
  }

  // No children state
  if (children.length === 0) {
    return (
      <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="relative z-10 max-w-6xl mx-auto">
          <PageHeader
            icon={GraduationCap}
            title={t("title")}
            subtitle={t("subtitle")}
            backHref="/settings"
            className="mb-8"
          />

          <Card className="p-8 text-center">
            <GraduationCap className="size-16 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h2 className="text-lg font-semibold mb-2">{t("noChildrenTitle")}</h2>
            <p className="text-muted-foreground mb-4">
              {t("noChildrenDescription")}
            </p>
            <Button asChild>
              <a href="/settings/people">{t("noChildrenButton")}</a>
            </Button>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-6xl mx-auto">
        <PageHeader
          icon={GraduationCap}
          title={t("title")}
          subtitle={t("subtitle")}
          backHref="/settings"
          className="mb-8"
          actions={
            <>
              <Select value={selectedPerson} onValueChange={setSelectedPerson}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder={t("selectChildPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {children.map((person) => (
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
              <Button variant="outline" size="icon" onClick={openPeriodsDialog} title={t("editPeriodsTooltip")} aria-label={t("editPeriodsTooltip")}>
                <Settings className="size-4" />
              </Button>
            </>
          }
        />

        {/* Subjects Management */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="mb-6"
        >
          <Card className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">{t("subjectsHeading")}</h2>
              <Button variant="outline" size="sm" onClick={openAddSubjectDialog}>
                <Plus className="size-4 mr-1" />
                {t("addSubjectButton")}
              </Button>
            </div>
            {subjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("subjectsEmpty")}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {subjects.map((subject) => {
                  const IconComponent = getSubjectIcon(subject.icon);
                  return (
                    <div
                      key={subject.id}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-full border cursor-pointer hover:bg-muted/50 transition-colors"
                      style={{ borderColor: subject.color }}
                      onClick={() => openEditSubjectDialog(subject)}
                    >
                      <IconComponent
                        className="size-4"
                        style={{ color: subject.color }}
                      />
                      <span
                        className="text-sm font-medium"
                        style={{ color: subject.color }}
                      >
                        {subject.name}
                      </span>
                      <button
                        className="ml-1 p-0.5 rounded-full hover:bg-destructive/20"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSubject(subject.id);
                        }}
                      >
                        <X className="size-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </motion.div>

        {/* Pack list */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.075 }}
          className="mb-6"
        >
          <Card className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Backpack className="size-4 text-muted-foreground" />
                <h2 className="font-semibold">{t("packHeading")}</h2>
              </div>
              <Button variant="outline" size="sm" onClick={openAddPackDialog}>
                <Plus className="size-4 mr-1" />
                {t("addPackButton")}
              </Button>
            </div>
            {currentPackItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("packEmpty")}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {currentPackItems.map((item) => (
                  <div
                    key={item.subject}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/30 group"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{item.subject}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {item.items.join(", ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-foreground"
                        onClick={() => openEditPackDialog(item)}
                        aria-label={t("editPackItemAria", { subject: item.subject })}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive hover:text-destructive"
                        onClick={() => handleDeletePackItem(item.subject)}
                        aria-label={t("deletePackItemAria", { subject: item.subject })}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </motion.div>

        {/* Timetable Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="p-4 overflow-x-auto">
            {schedulesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="size-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="p-2 text-left text-sm font-medium text-muted-foreground w-20">
                      {t("timeColumn")}
                    </th>
                    {Array.from({ length: 5 }, (_, idx) => (
                      <th
                        key={idx}
                        className="p-2 text-center text-sm font-medium min-w-[140px]"
                      >
                        {dayName(idx)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {periods.map((period) => (
                    <tr key={period.num} className="border-t border-border/30">
                      <td className="p-2 text-xs text-muted-foreground">
                        <div className="font-medium">{period.num}.</div>
                        <div>{period.start}</div>
                        <div>{period.end}</div>
                      </td>
                      {Array.from({ length: 5 }, (_, dayIndex) => {
                        const slot = getSlotForPeriod(dayIndex + 1, period.num);
                        const subject = slot ? getSubject(slot.subject) : undefined;
                        const IconComponent = subject
                          ? getSubjectIcon(subject.icon)
                          : BookOpen;
                        const color = subject?.color || "#6b7280";

                        return (
                          <td key={dayIndex} className="p-1">
                            {slot ? (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button
                                    className="w-full p-2 rounded-lg text-left transition-all hover:scale-[1.02] hover:shadow-md"
                                    style={{
                                      backgroundColor: `${color}20`,
                                      borderLeft: `3px solid ${color}`,
                                    }}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <IconComponent
                                        className="size-4 shrink-0"
                                        style={{ color }}
                                      />
                                      <span className="font-medium text-sm">
                                        {slot.subject}
                                      </span>
                                    </div>
                                    {slot.room && (
                                      <div className="text-xs text-muted-foreground mt-0.5">
                                        {slot.room}
                                      </div>
                                    )}
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-56">
                                  <div className="flex flex-col gap-3">
                                    <div className="flex items-center gap-2">
                                      <IconComponent
                                        className="size-5"
                                        style={{ color }}
                                      />
                                      <Badge style={{ backgroundColor: color }}>
                                        {slot.subject}
                                      </Badge>
                                    </div>
                                    <div className="text-sm">
                                      <p>
                                        <span className="text-muted-foreground">
                                          {t("popoverTimeLabel")}
                                        </span>{" "}
                                        {slot.start} - {slot.end}
                                      </p>
                                      {slot.room && (
                                        <p>
                                          <span className="text-muted-foreground">
                                            {t("popoverRoomLabel")}
                                          </span>{" "}
                                          {slot.room}
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex gap-2">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="flex-1"
                                        onClick={() =>
                                          openSlotDialog(dayIndex + 1, period.num, slot)
                                        }
                                      >
                                        {t("popoverEdit")}
                                      </Button>
                                      <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={() =>
                                          handleDeleteSlot(dayIndex + 1, period.num)
                                        }
                                        disabled={isSaving}
                                      >
                                        <X className="size-4" />
                                      </Button>
                                    </div>
                                  </div>
                                </PopoverContent>
                              </Popover>
                            ) : (
                              <button
                                className="w-full h-16 rounded-lg border border-dashed border-border/50 hover:border-primary/50 hover:bg-primary/5 transition-colors flex items-center justify-center"
                                onClick={() => openSlotDialog(dayIndex + 1, period.num)}
                              >
                                <Plus className="size-4 text-muted-foreground" />
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </motion.div>
      </div>

      {/* Subject Dialog */}
      <Dialog open={subjectDialogOpen} onOpenChange={setSubjectDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>
              {editingSubject ? t("subjectDialogTitleEdit") : t("subjectDialogTitleNew")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-4">
            {/* Name */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="subject-name">{t("subjectNameLabel")}</Label>
              <Input
                id="subject-name"
                placeholder={t("subjectNamePlaceholder")}
                value={newSubject.name}
                onChange={(e) =>
                  setNewSubject({ ...newSubject, name: e.target.value })
                }
                autoFocus
              />
            </div>

            {/* Color */}
            <div className="flex flex-col gap-2">
              <Label>{t("subjectColorLabel")}</Label>
              <div className="flex flex-wrap gap-2">
                {SUBJECT_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    onClick={() =>
                      setNewSubject({ ...newSubject, color: color.value })
                    }
                    className={`size-8 rounded-full transition-all ${
                      newSubject.color === color.value
                        ? "ring-2 ring-offset-2 ring-offset-background"
                        : "hover:scale-110"
                    }`}
                    style={{
                      backgroundColor: color.value,
                      // @ts-expect-error - CSS custom property for ring color
                      "--tw-ring-color": color.value,
                    }}
                    title={t(color.labelKey)}
                  />
                ))}
              </div>
            </div>

            {/* Icon */}
            <div className="flex flex-col gap-2">
              <Label>{t("subjectIconLabel", { count: SUBJECT_ICONS.length })}</Label>
              <ScrollArea className="h-48 rounded-lg border p-2">
                <div className="grid grid-cols-5 sm:grid-cols-8 gap-1.5">
                  {SUBJECT_ICONS.map(({ name, icon: IconComp }) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setNewSubject({ ...newSubject, icon: name })}
                      className={`size-9 rounded-lg flex items-center justify-center transition-all ${
                        newSubject.icon === name
                          ? "ring-2 ring-offset-1 ring-offset-background bg-muted"
                          : "hover:bg-muted/50"
                      }`}
                      style={{
                        // @ts-expect-error - CSS custom property for ring color
                        "--tw-ring-color": newSubject.color,
                      }}
                      title={name}
                    >
                      <IconComp
                        className="size-4"
                        style={{ color: newSubject.color }}
                      />
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Preview */}
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="text-xs text-muted-foreground mb-2">{t("subjectPreviewLabel")}</p>
              <div
                className="flex items-center gap-2 px-3 py-1.5 rounded-full border w-fit"
                style={{ borderColor: newSubject.color }}
              >
                {(() => {
                  const PreviewIcon = getSubjectIcon(newSubject.icon);
                  return (
                    <PreviewIcon
                      className="size-4"
                      style={{ color: newSubject.color }}
                    />
                  );
                })()}
                <span
                  className="text-sm font-medium"
                  style={{ color: newSubject.color }}
                >
                  {newSubject.name || t("subjectPreviewName")}
                </span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubjectDialogOpen(false)}>
              {t("cancelButton")}
            </Button>
            <Button
              onClick={handleSaveSubject}
              disabled={!newSubject.name.trim() || isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  {t("savingLabel")}
                </>
              ) : editingSubject ? (
                t("saveSubmitButton")
              ) : (
                t("addSubmitButton")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Slot Edit Dialog */}
      <Dialog open={slotDialogOpen} onOpenChange={setSlotDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>
              {editingSlot?.slot ? t("slotEditTitleEdit") : t("slotEditTitleNew")}
              {editingSlot && (
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  {t("slotDayPeriodLabel", {
                    day: dayName(editingSlot.day - 1),
                    period: editingSlot.period,
                  })}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-4">
            {/* Subject Selection */}
            <div className="flex flex-col gap-2">
              <Label>{t("slotSubjectLabel")}</Label>
              {subjects.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("slotNoSubjects")}
                </p>
              ) : (
                <Select
                  value={slotForm.subject}
                  onValueChange={(v) => setSlotForm({ ...slotForm, subject: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("slotSubjectPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((subject) => {
                      const IconComp = getSubjectIcon(subject.icon);
                      return (
                        <SelectItem key={subject.id} value={subject.name}>
                          <div className="flex items-center gap-2">
                            <IconComp
                              className="size-4"
                              style={{ color: subject.color }}
                            />
                            <span>{subject.name}</span>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Room */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="room">{t("slotRoomLabel")}</Label>
              <Input
                id="room"
                placeholder={t("slotRoomPlaceholder")}
                value={slotForm.room}
                onChange={(e) => setSlotForm({ ...slotForm, room: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSlotDialogOpen(false)}>
              {t("cancelButton")}
            </Button>
            <Button
              onClick={handleSaveSlot}
              disabled={!slotForm.subject || isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  {t("savingLabel")}
                </>
              ) : (
                t("saveSubmitButton")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pack Item Dialog */}
      <Dialog open={packDialogOpen} onOpenChange={setPackDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>
              {editingPackItem ? t("packDialogTitleEdit") : t("packDialogTitleNew")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="pack-subject">{t("packSubjectLabel")}</Label>
              <Input
                id="pack-subject"
                placeholder={t("packSubjectPlaceholder")}
                value={packForm.subject}
                onChange={(e) => setPackForm({ ...packForm, subject: e.target.value })}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pack-items">{t("packItemsLabel")}</Label>
              <Input
                id="pack-items"
                placeholder={t("packItemsPlaceholder")}
                value={packForm.items}
                onChange={(e) => setPackForm({ ...packForm, items: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPackDialogOpen(false)}>
              {t("cancelButton")}
            </Button>
            <Button
              onClick={handleSavePackItem}
              disabled={!packForm.subject.trim() || !packForm.items.trim() || isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  {t("savingLabel")}
                </>
              ) : editingPackItem ? (
                t("saveSubmitButton")
              ) : (
                t("addSubmitButton")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Periods Configuration Dialog */}
      <Dialog open={periodsDialogOpen} onOpenChange={setPeriodsDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t("periodsDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-4">
            <p className="text-sm text-muted-foreground">
              {t("periodsIntro")}
            </p>

            <ScrollArea className="h-[300px] pr-4">
              <div className="flex flex-col gap-3">
                {editingPeriods.map((period, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <span className="w-8 text-sm font-medium text-muted-foreground">
                      {period.num}.
                    </span>
                    <Input
                      type="time"
                      value={period.start}
                      onChange={(e) => handleUpdatePeriod(index, "start", e.target.value)}
                      className="flex-1"
                    />
                    <span className="text-muted-foreground">-</span>
                    <Input
                      type="time"
                      value={period.end}
                      onChange={(e) => handleUpdatePeriod(index, "end", e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-destructive hover:text-destructive"
                      onClick={() => handleRemovePeriod(index)}
                      disabled={editingPeriods.length <= 1}
                      aria-label={t("removePeriodAria", { num: period.num })}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <Button variant="outline" onClick={handleAddPeriod} className="w-full">
              <Plus className="size-4 mr-2" />
              {t("addPeriodButton")}
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPeriodsDialogOpen(false)}>
              {t("cancelButton")}
            </Button>
            <Button onClick={handleSavePeriods} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  {t("savingLabel")}
                </>
              ) : (
                t("saveSubmitButton")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
