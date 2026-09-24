"use client";

import { useCallback, useEffect, useState } from "react";
import type { WidgetVisibility } from "@/types/widgets";

export type WidgetKey = keyof WidgetVisibility;

const KEY = "kinboard.widget-order";
const EVENT = "kinboard:widget-order-change";

function readOrder(): WidgetKey[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((key): key is WidgetKey => typeof key === "string") : [];
  } catch {
    return [];
  }
}

export function mergeWidgetOrder(defaults: readonly WidgetKey[], saved: readonly WidgetKey[]): WidgetKey[] {
  const valid = new Set(defaults);
  const ordered = saved.filter((key, index) => valid.has(key) && saved.indexOf(key) === index);
  return [...ordered, ...defaults.filter((key) => !ordered.includes(key))];
}

export function useWidgetOrder(): [WidgetKey[], (keys: WidgetKey[]) => void] {
  const [order, setOrder] = useState<WidgetKey[]>([]);
  useEffect(() => {
    const update = () => setOrder(readOrder());
    update();
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  const save = useCallback((keys: WidgetKey[]) => {
    window.localStorage.setItem(KEY, JSON.stringify(keys));
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [order, save];
}
