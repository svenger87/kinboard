"use client";

import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, type IChartApi, type ISeriesApi } from "lightweight-charts";
import type { Candle } from "@/lib/stonks/types";

interface Props {
  candles: Candle[];
  height?: number;
}

/**
 * Wrapper around TradingView's lightweight-charts. Imperative API —
 * the chart instance lives in a ref and gets updated when `candles`
 * changes (rather than re-creating every render). React can't render
 * canvas directly so this is the conventional shape.
 */
export function CandleChart({ candles, height = 400 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      height,
      layout: { background: { color: "transparent" }, textColor: "#a1a1aa" },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.06)" },
        horzLines: { color: "rgba(255,255,255,0.06)" },
      },
      timeScale: { timeVisible: true, secondsVisible: false },
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(
      candles.map((c) => ({
        time: c.time as never, // lightweight-charts UTCTimestamp brand
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  return <div ref={containerRef} className="w-full" style={{ height }} />;
}
