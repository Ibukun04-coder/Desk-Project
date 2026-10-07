"use client";

// Candlestick chart (lightweight-charts v5) + deterministic SMC overlays:
// FVG / order-block zone rectangles (series primitive), BOS/CHOCH markers,
// premium/discount midpoint price line.

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { SmcSnapshot } from "@/lib/smc/types";
import { ZoneOverlayPrimitive, type ZoneRect } from "./ZoneOverlay";

export type ChartCandle = {
  openTime: string;
  open: string;
  high: string;
  low: string;
  close: string;
};

type PairChartProps = {
  candles: ChartCandle[];
  smc: SmcSnapshot | null;
};

export const BULL_FVG_FILL = "rgba(16,185,129,0.14)";
export const BULL_FVG_BORDER = "rgba(16,185,129,0.55)";
export const BEAR_FVG_FILL = "rgba(244,63,94,0.14)";
export const BEAR_FVG_BORDER = "rgba(244,63,94,0.55)";
export const DEMAND_FILL = "rgba(56,189,248,0.16)";
export const DEMAND_BORDER = "rgba(56,189,248,0.65)";
export const SUPPLY_FILL = "rgba(168,85,247,0.16)";
export const SUPPLY_BORDER = "rgba(168,85,247,0.65)";

function toTime(epoch: number): UTCTimestamp {
  return epoch as UTCTimestamp;
}

export function PairChart({ candles, smc }: PairChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const overlayRef = useRef<ZoneOverlayPrimitive | null>(null);
  const midpointLineRef = useRef<{ remove: () => void } | null>(null);

  // Create chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: "#020617" }, textColor: "#94a3b8" },
      grid: { vertLines: { color: "rgba(148,163,184,0.08)" }, horzLines: { color: "rgba(148,163,184,0.08)" } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#1e293b" },
      rightPriceScale: { borderColor: "#1e293b" },
      width: el.clientWidth,
      height: 460,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e", downColor: "#f43f5e",
      borderVisible: false, wickUpColor: "#22c55e", wickDownColor: "#f43f5e",
    });
    const overlay = new ZoneOverlayPrimitive();
    series.attachPrimitive(overlay);
    chartRef.current = chart;
    seriesRef.current = series;
    overlayRef.current = overlay;

    const onResize = (): void => {
      chart.applyOptions({ width: el.clientWidth });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      overlayRef.current = null;
      seriesRef.current = null;
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // Push candles + overlays on data change.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    if (candles.length === 0) return;

    series.setData(
      candles.map((c) => ({
        time: toTime(Math.floor(new Date(c.openTime).getTime() / 1000)),
        open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close),
      })),
    );

    // Zone rectangles (order blocks pushed after FVGs so they paint on top).
    const zones: ZoneRect[] = [];
    if (smc) {
      for (const f of smc.fvgs) {
        const bullish = f.direction === "bullish";
        zones.push({
          startTime: toTime(f.epoch),
          low: f.low, high: f.high,
          fill: bullish ? BULL_FVG_FILL : BEAR_FVG_FILL,
          border: bullish ? BULL_FVG_BORDER : BEAR_FVG_BORDER,
        });
      }
      for (const o of smc.orderBlocks) {
        const demand = o.kind === "demand";
        zones.push({
          startTime: toTime(o.epoch),
          low: o.low, high: o.high,
          fill: demand ? DEMAND_FILL : SUPPLY_FILL,
          border: demand ? DEMAND_BORDER : SUPPLY_BORDER,
        });
      }
    }
    overlayRef.current?.setState({
      zones,
      midpoint: smc?.range ? smc.range.midpoint : null,
      midpointColor: "rgba(148,163,184,0.7)",
    });

    // Midpoint price line — recreate each update.
    if (midpointLineRef.current) {
      try { series.removePriceLine(midpointLineRef.current as never); } catch { /* already removed */ }
      midpointLineRef.current = null;
    }
    if (smc?.range) {
      midpointLineRef.current = series.createPriceLine({
        price: smc.range.midpoint,
        color: "rgba(148,163,184,0.7)",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "mid (premium/discount)",
      }) as unknown as { remove: () => void };
    }

    // BOS (last 3) + CHOCH (last 3) markers.
    const markers: SeriesMarker<Time>[] = [];
    if (smc) {
      for (const b of smc.bos.slice(-3)) {
        markers.push({
          time: toTime(b.epoch),
          position: b.direction === "bullish" ? "belowBar" : "aboveBar",
          color: b.direction === "bullish" ? "#22c55e" : "#f43f5e",
          shape: b.direction === "bullish" ? "arrowUp" : "arrowDown",
          text: `BOS ${b.direction === "bullish" ? "▲" : "▼"}`,
        });
      }
      for (const c of smc.choch.slice(-3)) {
        markers.push({
          time: toTime(c.epoch),
          position: c.direction === "bullish" ? "belowBar" : "aboveBar",
          color: "#f59e0b",
          shape: "circle",
          text: `CHOCH ${c.direction === "bullish" ? "+" : "-"}`,
        });
      }
      markers.sort((a, b) => (a.time as number) - (b.time as number));
    }
    createSeriesMarkers(series, markers);

    chart.timeScale().fitContent();
  }, [candles, smc]);

  return (
    <div>
      <div ref={containerRef} className="w-full overflow-hidden rounded-md border border-slate-800" />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm" style={{ background: BULL_FVG_FILL, border: `1px solid ${BULL_FVG_BORDER}` }} />bullish FVG</span>
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm" style={{ background: BEAR_FVG_FILL, border: `1px solid ${BEAR_FVG_BORDER}` }} />bearish FVG</span>
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm" style={{ background: DEMAND_FILL, border: `1px solid ${DEMAND_BORDER}` }} />demand OB</span>
        <span><span className="mr-1 inline-block h-2 w-3 rounded-sm" style={{ background: SUPPLY_FILL, border: `1px solid ${SUPPLY_BORDER}` }} />supply OB</span>
        <span className="text-slate-500">▲/▼ BOS · ○ CHOCH · dashed = premium/discount mid</span>
      </div>
    </div>
  );
}
