"use client";

import { useEffect, useState } from "react";
import {
  NAV_ORDER_CHANGE_EVENT,
  getNavOrder,
} from "@/lib/nav-order";

/**
 * Subscribe a component to the per-device nav order. Re-renders when
 * the order changes — both same-tab (settings page saves) and
 * cross-tab (the `storage` event).
 *
 * Initial state reads localStorage synchronously so the first paint
 * already reflects the saved order.
 */
export function useNavOrder(): readonly string[] | null {
  const [order, setOrder] = useState<readonly string[] | null>(() =>
    getNavOrder(),
  );

  useEffect(() => {
    const handler = () => setOrder(getNavOrder());
    window.addEventListener(NAV_ORDER_CHANGE_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(NAV_ORDER_CHANGE_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  return order;
}
