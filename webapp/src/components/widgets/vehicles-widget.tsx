"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useVehicles } from "@/hooks/use-vehicles";
import { getDriver } from "@/plugins/vehicles/drivers/registry";

const ROTATE_INTERVAL_MS = 8000;

export function VehiclesWidget() {
  const { data: vehicles = [] } = useVehicles();
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (vehicles.length <= 1) return;
    const id = setInterval(() => {
      setActiveIdx((i) => (i + 1) % vehicles.length);
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [vehicles.length]);

  if (vehicles.length === 0) return null;

  // Clamp activeIdx if vehicles list shrank
  const safeIdx = activeIdx >= vehicles.length ? 0 : activeIdx;
  const v = vehicles[safeIdx];
  const driver = getDriver(v.vendor);
  if (!driver) return null;

  const Card = driver.Card;

  return (
    <Link href="/vehicles" className="block">
      <AnimatePresence mode="wait">
        <motion.div
          key={v.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3 }}
        >
          <Card vehicle={v} />
        </motion.div>
      </AnimatePresence>
    </Link>
  );
}
