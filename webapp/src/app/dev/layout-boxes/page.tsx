"use client";

import { notFound } from "next/navigation";
import { useRef } from "react";
import { ListBox } from "@/components/layouts/list-box";
import { useFitToBox } from "@/hooks/use-fit-to-box";

/** Fixtures for the box primitives, looked at by e2e/layouts-boxes-ui.spec.ts. Not served in production. */

const ROWS = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, label: `Entry number ${i + 1}` }));

function Fitted({ testId, width, height }: { testId: string; width: number; height: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const size = useFitToBox(ref, { width, height }, []);
  return (
    <div data-testid={testId} style={{ width, height, overflow: "hidden", outline: "1px solid gray" }}>
      <span ref={ref} data-testid="fit-text" style={{ display: "block", width: "fit-content", whiteSpace: "nowrap", lineHeight: 1, fontSize: size ?? 20 }}>
        12.5 kWh
      </span>
    </div>
  );
}

export default function LayoutBoxesPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div style={{ padding: 16, display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
      <div data-testid="list-full" style={{ width: 300, height: 300, outline: "1px solid gray" }}>
        <ListBox
          items={ROWS}
          keyOf={(r) => r.id}
          renderItem={(r) => <div data-testid="list-row" style={{ lineHeight: "36px" }}>{r.label}</div>}
          empty={<div>Nothing</div>}
          moreLabel={(n) => `+${n}`}
        />
      </div>
      <div data-testid="list-empty" style={{ width: 300, height: 300, outline: "1px solid gray" }}>
        <ListBox
          items={[] as typeof ROWS}
          keyOf={(r) => r.id}
          renderItem={(r) => <div>{r.label}</div>}
          empty={<div data-testid="list-empty-node">Nothing to show</div>}
          moreLabel={(n) => `+${n}`}
        />
      </div>
      <Fitted testId="fit-wide" width={400} height={120} />
      <Fitted testId="fit-tall" width={120} height={400} />
    </div>
  );
}
