"use client";

import { useCallback, useEffect, useState } from "react";

export type HomeLayout = "classic" | "compact";

const KEY = "kinboard.home-layout";
const EVENT = "kinboard:home-layout-change";

function readLayout(): HomeLayout {
  if (typeof window === "undefined") return "classic";
  return window.localStorage.getItem(KEY) === "compact" ? "compact" : "classic";
}

export function useHomeLayout(): [HomeLayout, (value: HomeLayout) => void] {
  const [layout, setLayout] = useState<HomeLayout>("classic");

  useEffect(() => {
    setLayout(readLayout());
    const update = () => setLayout(readLayout());
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);

  const save = useCallback((value: HomeLayout) => {
    window.localStorage.setItem(KEY, value);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [layout, save];
}
