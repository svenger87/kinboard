"use client";

import { useMemo } from "react";
import { Sun, Battery, Home, Zap, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { ENERGY_COLORS } from "@/types/home-assistant";

interface EnergyFlowProps {
  solarPower?: number;
  batteryPower?: number;
  batterySoc?: number;
  gridPower?: number;
  homePower?: number;
  gridToBatteryPower?: number;
  className?: string;
}

// ── SVG coordinate system ────────────────────────────────────────────
const R = 20; // Node circle radius

const NODES = {
  solar:   { x: 100, y: 30 },
  battery: { x: 32,  y: 105 },
  grid:    { x: 168, y: 105 },
  home:    { x: 100, y: 180 },
} as const;

// Flow paths with curvature (positive = left of travel direction, negative = right)
const FLOW_PATHS = [
  { id: "solar-battery", from: "solar",   to: "battery", curve: 18 },
  { id: "solar-home",    from: "solar",   to: "home",    curve: 0 },
  { id: "solar-grid",    from: "solar",   to: "grid",    curve: -18 },
  { id: "battery-home",  from: "battery", to: "home",    curve: 18 },
  { id: "grid-home",     from: "grid",    to: "home",    curve: -18 },
  { id: "grid-battery",  from: "grid",    to: "battery", curve: -12 },
] as const;

type NodeKey = "solar" | "battery" | "grid" | "home";

const NODE_META: Record<NodeKey, { icon: LucideIcon; labelKey: "nodeSolar" | "nodeBattery" | "nodeGrid" | "nodeHome" }> = {
  solar:   { icon: Sun,     labelKey: "nodeSolar" },
  battery: { icon: Battery, labelKey: "nodeBattery" },
  grid:    { icon: Zap,     labelKey: "nodeGrid" },
  home:    { icon: Home,    labelKey: "nodeHome" },
};

// ── Path calculation (edge-to-edge using trigonometry) ───────────────
function edgePath(fromKey: string, toKey: string, curvature: number): string {
  const f = NODES[fromKey as keyof typeof NODES];
  const t = NODES[toKey as keyof typeof NODES];
  const dx = t.x - f.x;
  const dy = t.y - f.y;
  const angle = Math.atan2(dy, dx);

  // Start/end exactly at circle circumference
  const sx = f.x + Math.cos(angle) * R;
  const sy = f.y + Math.sin(angle) * R;
  const ex = t.x - Math.cos(angle) * R;
  const ey = t.y - Math.sin(angle) * R;

  if (curvature === 0) {
    return `M ${sx} ${sy} L ${ex} ${ey}`;
  }

  // Quadratic Bézier with perpendicular control-point offset
  const mx = (sx + ex) / 2;
  const my = (sy + ey) / 2;
  const px = -Math.sin(angle);
  const py = Math.cos(angle);
  return `M ${sx} ${sy} Q ${mx + px * curvature} ${my + py * curvature} ${ex} ${ey}`;
}

// ── Helpers (unchanged logic) ────────────────────────────────────────
function formatPower(power: number): string {
  if (Math.abs(power) >= 1000) return `${(power / 1000).toFixed(1)} kW`;
  return `${Math.round(power)} W`;
}

function getAnimationDuration(power: number): number {
  const clamped = Math.min(Math.max(power, 0), 3000);
  return 12 - (clamped / 3000) * 8; // 12s at 0W → 4s at 3000W
}

// ── Component ────────────────────────────────────────────────────────
export function EnergyFlow({
  solarPower = 0,
  batteryPower = 0,
  batterySoc = 0,
  gridPower = 0,
  homePower = 0,
  gridToBatteryPower,
  className,
}: EnergyFlowProps) {
  const t = useTranslations("homeAutomation.charts");

  // Calculate active flows and their power levels
  const activeFlows = useMemo(() => {
    const flows: Record<string, { active: boolean; power: number; color: string }> = {};
    const minPower = 30;

    flows["solar-battery"] = {
      active: solarPower > minPower && batteryPower > minPower,
      power: Math.min(solarPower, Math.max(batteryPower, 0)),
      color: ENERGY_COLORS.solar,
    };

    const solarToHome = solarPower - Math.max(batteryPower, 0);
    flows["solar-home"] = {
      active: solarPower > minPower && solarToHome > minPower,
      power: Math.max(solarToHome, 0),
      color: ENERGY_COLORS.solar,
    };

    flows["solar-grid"] = {
      active: solarPower > minPower && gridPower < -minPower,
      power: Math.abs(Math.min(gridPower, 0)),
      color: ENERGY_COLORS.gridExport,
    };

    flows["battery-home"] = {
      active: batteryPower < -minPower,
      power: Math.abs(Math.min(batteryPower, 0)),
      color: ENERGY_COLORS.batteryDischarge,
    };

    flows["grid-home"] = {
      active: gridPower > minPower,
      power: Math.max(gridPower, 0),
      color: ENERGY_COLORS.gridImport,
    };

    let g2b = 0;
    if (gridToBatteryPower !== undefined) {
      g2b = gridToBatteryPower;
    } else if (gridPower > minPower && batteryPower > minPower) {
      const charge = Math.max(batteryPower, 0);
      g2b = Math.max(0, charge - Math.min(solarPower, charge));
    }
    flows["grid-battery"] = {
      active: g2b > minPower,
      power: g2b,
      color: ENERGY_COLORS.gridImport,
    };

    return flows;
  }, [solarPower, batteryPower, gridPower, gridToBatteryPower]);

  // Pre-compute all SVG paths once
  const paths = useMemo(() => {
    const p: Record<string, string> = {};
    for (const { id, from, to, curve } of FLOW_PATHS) {
      p[id] = edgePath(from, to, curve);
    }
    return p;
  }, []);

  // Node highlight colors based on power state
  const nodeColors = useMemo(
    () => ({
      solar: solarPower > 0 ? ENERGY_COLORS.solar : null,
      battery:
        batteryPower > 0
          ? ENERGY_COLORS.batteryCharge
          : batteryPower < 0
            ? ENERGY_COLORS.batteryDischarge
            : null,
      grid:
        gridPower > 0
          ? ENERGY_COLORS.gridImport
          : gridPower < 0
            ? ENERGY_COLORS.gridExport
            : null,
      home: homePower > 0 ? ENERGY_COLORS.home : null,
    }),
    [solarPower, batteryPower, gridPower, homePower],
  );

  return (
    <div className={cn("w-full max-w-md mx-auto", className)}>
      {/* Animation keyframes for flow dots */}
      <style jsx>{`
        @keyframes flowDot {
          0% {
            offset-distance: 0%;
          }
          100% {
            offset-distance: 100%;
          }
        }
        .flow-dot {
          offset-rotate: 0deg;
          animation-name: flowDot;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
      `}</style>

      <svg
        viewBox="0 0 200 228"
        className="w-full"
        role="img"
        aria-label={t("energyFlowAria")}
      >
        {/* ── Dim background paths ─────────────────────────────── */}
        {FLOW_PATHS.map(({ id }) => (
          <path
            key={`bg-${id}`}
            d={paths[id]}
            fill="none"
            stroke="currentColor"
            strokeWidth={0.5}
            strokeOpacity={0.08}
          />
        ))}

        {/* ── Active flows: glow layer ─────────────────────────── */}
        {FLOW_PATHS.map(({ id }) => {
          const f = activeFlows[id];
          if (!f?.active) return null;
          const sw = Math.min(2.5, 0.8 + f.power / 1500);
          return (
            <path
              key={`glow-${id}`}
              d={paths[id]}
              fill="none"
              stroke={f.color}
              strokeWidth={sw + 4}
              strokeLinecap="round"
              strokeOpacity={0.15}
            />
          );
        })}

        {/* ── Active flows: main lines ─────────────────────────── */}
        {FLOW_PATHS.map(({ id }) => {
          const f = activeFlows[id];
          if (!f?.active) return null;
          const sw = Math.min(2.5, 0.8 + f.power / 1500);
          return (
            <path
              key={`line-${id}`}
              d={paths[id]}
              fill="none"
              stroke={f.color}
              strokeWidth={sw}
              strokeLinecap="round"
              strokeOpacity={0.7}
            />
          );
        })}

        {/* ── Animated flow dots ───────────────────────────────── */}
        {FLOW_PATHS.map(({ id }) => {
          const f = activeFlows[id];
          if (!f?.active) return null;
          const sw = Math.min(2.5, 0.8 + f.power / 1500);
          const dur = getAnimationDuration(f.power);
          return [0, 1, 2].map((i) => (
            <circle
              key={`dot-${id}-${i}`}
              r={1.2 + sw * 0.3}
              fill={f.color}
              className="flow-dot"
              style={{
                offsetPath: `path('${paths[id]}')`,
                animationDuration: `${dur}s`,
                animationDelay: `${(i / 3) * dur}s`,
              }}
            />
          ));
        })}

        {/* ── Node circles with icons and labels ───────────────── */}
        {(Object.keys(NODES) as Array<keyof typeof NODES>).map((key) => {
          const { x, y } = NODES[key];
          const color = nodeColors[key];
          const { icon: Icon, labelKey } = NODE_META[key];
          const label = t(labelKey);

          return (
            <g key={key}>
              {/* Outer glow ring (active only) */}
              {color && (
                <circle
                  cx={x}
                  cy={y}
                  r={R + 3}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeOpacity={0.2}
                />
              )}

              {/* Main circle */}
              <circle
                cx={x}
                cy={y}
                r={R}
                fill={color ? `${color}20` : "hsl(var(--muted))"}
                stroke={color || "hsl(var(--muted-foreground))"}
                strokeWidth={color ? 2 : 1}
                strokeOpacity={color ? 0.6 : 0.3}
              />

              {/* Icon (embedded HTML via foreignObject) */}
              <foreignObject x={x - 10} y={y - 10} width={20} height={20}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "100%",
                    height: "100%",
                  }}
                >
                  <Icon
                    style={{
                      width: "100%",
                      height: "100%",
                      color: color || "hsl(var(--muted-foreground))",
                    }}
                  />
                </div>
              </foreignObject>

              {/* Label */}
              <text
                x={x}
                y={y + R + 13}
                textAnchor="middle"
                fontSize={7}
                fontWeight={500}
                fill="hsl(var(--muted-foreground))"
              >
                {label}
              </text>

              {/* Power value */}
              <text
                x={x}
                y={y + R + 24}
                textAnchor="middle"
                fontSize={8}
                fontWeight={700}
                fill={color || "hsl(var(--muted-foreground))"}
              >
                {key === "solar" && formatPower(solarPower)}
                {key === "battery" &&
                  `${formatPower(Math.abs(batteryPower))}${batteryPower > 0 ? " ↓" : batteryPower < 0 ? " ↑" : ""}`}
                {key === "grid" &&
                  `${formatPower(Math.abs(gridPower))}${gridPower > 0 ? " ←" : gridPower < 0 ? " →" : ""}`}
                {key === "home" && formatPower(homePower)}
              </text>

              {/* Battery SoC */}
              {key === "battery" && (
                <text
                  x={x}
                  y={y + R + 34}
                  textAnchor="middle"
                  fontSize={6}
                  fill="hsl(var(--muted-foreground))"
                >
                  {Math.round(batterySoc)}%
                </text>
              )}

              {/* Grid status label */}
              {key === "grid" && (gridPower > 0 || gridPower < 0) && (
                <text
                  x={x}
                  y={y + R + 34}
                  textAnchor="middle"
                  fontSize={6}
                  fill="hsl(var(--muted-foreground))"
                >
                  {gridPower > 0 ? t("gridImporting") : t("gridExporting")}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
