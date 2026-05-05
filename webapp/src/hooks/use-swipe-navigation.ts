"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";

interface SwipeConfig {
  threshold?: number; // Minimum swipe distance in pixels
  allowedTime?: number; // Maximum time for swipe in ms
  disableVertical?: boolean; // Disable vertical swipe detection
}

// Navigation order for swipe between pages
const PAGE_ORDER = [
  "/",
  "/calendar",
  "/todos",
  "/shopping",
  "/birthdays",
  "/settings",
];

/**
 * Hook for swipe gesture navigation on touch devices
 * Swipe left/right to navigate between main pages
 */
export function useSwipeNavigation(config: SwipeConfig = {}) {
  const { threshold = 100, allowedTime = 300, disableVertical = true } = config;

  const router = useRouter();
  const pathname = usePathname();

  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const getCurrentPageIndex = useCallback(() => {
    // Handle settings sub-pages
    if (pathname.startsWith("/settings")) {
      return PAGE_ORDER.indexOf("/settings");
    }
    return PAGE_ORDER.indexOf(pathname);
  }, [pathname]);

  const navigateToPage = useCallback(
    (direction: "left" | "right") => {
      const currentIndex = getCurrentPageIndex();
      if (currentIndex === -1) return;

      let newIndex: number;
      if (direction === "left") {
        // Swipe left = go to next page
        newIndex = (currentIndex + 1) % PAGE_ORDER.length;
      } else {
        // Swipe right = go to previous page
        newIndex = (currentIndex - 1 + PAGE_ORDER.length) % PAGE_ORDER.length;
      }

      router.push(PAGE_ORDER[newIndex]);
    },
    [getCurrentPageIndex, router]
  );

  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!touchStartRef.current) return;

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaY = touch.clientY - touchStartRef.current.y;
      const deltaTime = Date.now() - touchStartRef.current.time;

      // Check if swipe was fast enough
      if (deltaTime > allowedTime) {
        touchStartRef.current = null;
        return;
      }

      // Check if horizontal swipe is significant enough
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      // Ignore if vertical movement is larger (scrolling)
      if (disableVertical && absY > absX) {
        touchStartRef.current = null;
        return;
      }

      // Check threshold
      if (absX < threshold) {
        touchStartRef.current = null;
        return;
      }

      // Determine swipe direction
      if (deltaX < 0) {
        navigateToPage("left");
      } else {
        navigateToPage("right");
      }

      touchStartRef.current = null;
    };

    // Only add listeners on touch devices
    if ("ontouchstart" in window) {
      document.addEventListener("touchstart", handleTouchStart, { passive: true });
      document.addEventListener("touchend", handleTouchEnd, { passive: true });

      return () => {
        document.removeEventListener("touchstart", handleTouchStart);
        document.removeEventListener("touchend", handleTouchEnd);
      };
    }
  }, [threshold, allowedTime, disableVertical, navigateToPage]);

  return { currentPage: pathname };
}

