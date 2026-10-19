"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Baby,
  Battery,
  BatteryCharging,
  BedDouble,
  Camera,
  Cat,
  ChartLine,
  Cloud,
  CookingPot,
  Dog,
  DoorOpen,
  Flame,
  Flower2,
  Gauge,
  House,
  Lamp,
  LayoutDashboard,
  Leaf,
  Lightbulb,
  Lock,
  Music,
  Plug,
  Shield,
  Snowflake,
  Sofa,
  Sun,
  Thermometer,
  Trees,
  Tv,
  WashingMachine,
  Wifi,
  Wind,
  Droplets,
  Car,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { DASHBOARD_NAV_ICON_IDS, isDashboardNavIcon, type DashboardNavIconId } from "@/lib/dashboard-nav-icons";

const ICONS: Record<DashboardNavIconId, LucideIcon> = {
  dashboard: LayoutDashboard,
  zap: Zap,
  sun: Sun,
  battery: Battery,
  "battery-charging": BatteryCharging,
  plug: Plug,
  gauge: Gauge,
  chart: ChartLine,
  thermometer: Thermometer,
  flame: Flame,
  snowflake: Snowflake,
  droplets: Droplets,
  wind: Wind,
  cloud: Cloud,
  lightbulb: Lightbulb,
  lamp: Lamp,
  tv: Tv,
  music: Music,
  camera: Camera,
  shield: Shield,
  lock: Lock,
  door: DoorOpen,
  car: Car,
  leaf: Leaf,
  flower: Flower2,
  trees: Trees,
  house: House,
  sofa: Sofa,
  bed: BedDouble,
  kitchen: CookingPot,
  laundry: WashingMachine,
  baby: Baby,
  dog: Dog,
  cat: Cat,
  wifi: Wifi,
};

/** A dashboard entry's icon: the one picked, else the dashboard icon. */
export function dashboardNavIcon(id: string | null | undefined): LucideIcon {
  return isDashboardNavIcon(id) ? ICONS[id] : LayoutDashboard;
}

/**
 * Picking a dashboard entry's icon: the current one on a button, the set in a
 * grid. Each icon is named for screen readers in the app's language.
 */
export function DashboardNavIconField({
  value,
  onChange,
  label,
  id,
  disabled,
}: {
  value: string | null;
  onChange: (icon: DashboardNavIconId) => void;
  /** The field's accessible name, e.g. "Menu icon". */
  label: string;
  id?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("dashboardNavIcons");
  const [open, setOpen] = useState(false);
  const current: DashboardNavIconId = isDashboardNavIcon(value) ? value : "dashboard";
  const Current = ICONS[current];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled}
          className="size-10"
          aria-label={`${label}: ${t(current)}`}
          data-icon={current}
        >
          <Current className="size-5" strokeWidth={1.75} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-2" align="end">
        <div role="radiogroup" aria-label={label} className="grid grid-cols-6 gap-1">
          {DASHBOARD_NAV_ICON_IDS.map((icon) => {
            const Icon = ICONS[icon];
            const selected = icon === current;
            return (
              <button
                key={icon}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={t(icon)}
                title={t(icon)}
                data-icon={icon}
                onClick={() => {
                  onChange(icon);
                  setOpen(false);
                }}
                className={cn(
                  "flex size-11 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected && "bg-primary/15 text-primary",
                )}
              >
                <Icon className="size-5" strokeWidth={1.75} />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
