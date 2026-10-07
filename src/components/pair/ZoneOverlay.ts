"use client";

// Zone overlay primitive for lightweight-charts v5: draws semi-transparent
// FVG / order-block rectangles + the premium/discount midpoint line in pane
// coordinate space. Attached to the candle series; zones extend from their
// start time to the right edge of the chart.

import type {
  Coordinate,
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ITimeScaleApi,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";

export type ZoneRect = {
  startTime: Time;
  low: number;
  high: number;
  fill: string;
  border: string;
};

type ZonePrimitiveState = {
  zones: ZoneRect[];
  midpoint: number | null;
  midpointColor: string;
};

type SeriesLike = Pick<ISeriesApi<"Candlestick">, "priceToCoordinate">;
type ChartLike = Pick<IChartApi, "timeScale">;
type TimeScaleLike = Pick<ITimeScaleApi<Time>, "timeToCoordinate" | "width">;

class ZonePaneRenderer implements IPrimitivePaneRenderer {
  private readonly view: ZonePaneView;

  constructor(view: ZonePaneView) {
    this.view = view;
  }

  draw(target: {
    useBitmapCoordinateSpace: <T>(f: (scope: {
      context: CanvasRenderingContext2D;
      horizontalPixelRatio: number;
      verticalPixelRatio: number;
    }) => T) => T;
  }): void {
    const { chart, series, zones, midpoint, midpointColor } = this.view.snapshot();
    if (!chart || !series) return;
    // Resolve the time scale defensively: the attached chart reference is the
    // supported path (never series.chart() — not part of this version's API).
    let timeScale: TimeScaleLike | null = null;
    try {
      timeScale = chart.timeScale() as unknown as TimeScaleLike;
    } catch {
      timeScale = null;
    }
    if (!timeScale || typeof timeScale.timeToCoordinate !== "function" || typeof timeScale.width !== "function") return;
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      let right = 0;
      try {
        right = timeScale.width() * scope.horizontalPixelRatio;
      } catch {
        return;
      }
      if (!Number.isFinite(right) || right <= 0) return;
      ctx.save();
      try {
        for (const z of zones) {
          let xRaw: Coordinate | null = null;
          try {
            xRaw = timeScale.timeToCoordinate(z.startTime);
          } catch {
            xRaw = null;
          }
          if (xRaw === null) continue; // off-screen or unknown time: skip silently
          const x = xRaw * scope.horizontalPixelRatio;
          let yTopRaw: Coordinate | null = null;
          let yBotRaw: Coordinate | null = null;
          try {
            yTopRaw = series.priceToCoordinate(z.high);
            yBotRaw = series.priceToCoordinate(z.low);
          } catch {
            yTopRaw = null;
            yBotRaw = null;
          }
          if (yTopRaw === null || yBotRaw === null) continue; // off-screen: skip silently
          const yTop = yTopRaw * scope.verticalPixelRatio;
          const yBot = yBotRaw * scope.verticalPixelRatio;
          const w = Math.max(1, right - x);
          ctx.fillStyle = z.fill;
          ctx.fillRect(x, Math.min(yTop, yBot), w, Math.abs(yBot - yTop));
          ctx.strokeStyle = z.border;
          ctx.lineWidth = Math.max(1, scope.verticalPixelRatio);
          ctx.strokeRect(x + 0.5, Math.min(yTop, yBot) + 0.5, w - 1, Math.abs(yBot - yTop) - 1);
        }
        if (midpoint !== null) {
          let yRaw: Coordinate | null = null;
          try {
            yRaw = series.priceToCoordinate(midpoint);
          } catch {
            yRaw = null;
          }
          if (yRaw !== null) {
            const y = yRaw * scope.verticalPixelRatio;
            ctx.strokeStyle = midpointColor;
            ctx.lineWidth = Math.max(1, scope.verticalPixelRatio);
            ctx.setLineDash([6 * scope.horizontalPixelRatio, 4 * scope.horizontalPixelRatio]);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(right, y);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      } finally {
        ctx.restore();
      }
    });
  }
}

class ZonePaneView implements IPrimitivePaneView {
  private chart: ChartLike | null = null;
  private series: SeriesLike | null = null;
  private zones: ZoneRect[] = [];
  private midpoint: number | null = null;
  private midpointColor = "rgba(148,163,184,0.7)";
  private readonly rendererInstance = new ZonePaneRenderer(this);

  setRefs(chart: ChartLike | null, series: SeriesLike | null): void {
    this.chart = chart;
    this.series = series;
  }

  update(state: ZonePrimitiveState): void {
    this.zones = state.zones;
    this.midpoint = state.midpoint;
    this.midpointColor = state.midpointColor;
  }

  snapshot(): ZonePrimitiveState & { chart: ChartLike | null; series: SeriesLike | null } {
    return { zones: this.zones, midpoint: this.midpoint, midpointColor: this.midpointColor, chart: this.chart, series: this.series };
  }

  renderer(): IPrimitivePaneRenderer {
    return this.rendererInstance;
  }
}

/** Attachable series primitive rendering SMC zone rectangles. */
export class ZoneOverlayPrimitive implements ISeriesPrimitive<Time> {
  private readonly view = new ZonePaneView();
  private state: ZonePrimitiveState = { zones: [], midpoint: null, midpointColor: "rgba(148,163,184,0.7)" };

  setState(state: ZonePrimitiveState): void {
    this.state = state;
    this.view.update(state);
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    // v5 passes both chart and series here — capture both, never series.chart().
    try {
      this.view.setRefs(
        (param.chart ?? null) as unknown as ChartLike | null,
        (param.series ?? null) as unknown as SeriesLike | null,
      );
    } catch {
      this.view.setRefs(null, null);
    }
    this.view.update(this.state);
  }

  detached(): void {
    this.view.setRefs(null, null);
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }
}
