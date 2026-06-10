import { useState, useEffect, useRef } from 'react';
import * as am5 from '@amcharts/amcharts5';
import * as am5radar from '@amcharts/amcharts5/radar';
import * as am5xy from '@amcharts/amcharts5/xy';
import am5themes_Animated from '@amcharts/amcharts5/themes/Animated';

const API = import.meta.env.PROD ? '/api/trpc' : 'http://localhost:4000/trpc';

interface Facility {
  id: string;
  name: string;
  city: string;
  patientExperienceScore: number | null;
  clinicalQualityScore: number | null;
  billingStabilityScore: number | null;
  trustScore: number | null;
  operationalScore: number | null;
  fraudRiskScore: number | null;
  piiScore: number | null;
}

interface Props {
  facilities: Facility[];
}

const DIMENSIONS = [
  { key: 'patientExperienceScore', label: 'Patient Experience', short: 'Patient (30%)', weight: 30, isFraud: false, timelineKey: 'patient' },
  { key: 'clinicalQualityScore', label: 'Clinical Quality', short: 'Clinical (25%)', weight: 25, isFraud: false, timelineKey: 'clinical' },
  { key: 'billingStabilityScore', label: 'Billing Transparency', short: 'Billing (20%)', weight: 20, isFraud: false, timelineKey: 'billing' },
  { key: 'trustScore', label: 'Trust & Credibility', short: 'Trust (15%)', weight: 15, isFraud: false, timelineKey: 'trust' },
  { key: 'operationalScore', label: 'Operational Readiness', short: 'Operational (10%)', weight: 10, isFraud: false, timelineKey: 'operational' },
  { key: 'fraudRiskScore', label: 'Fraud Risk', short: 'Fraud Risk \u2193', weight: 0, isFraud: true, timelineKey: 'fraud' },
];

// ──────────────────────────────────────────
// Spider Chart — selected vs cohort average
// ──────────────────────────────────────────
function SpiderChart({ selected, avg }: { selected: Facility; avg: Record<string, number> }) {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!divRef.current) return;
    const root = am5.Root.new(divRef.current);
    root.setThemes([am5themes_Animated.new(root)]);

    const chart = root.container.children.push(
      am5radar.RadarChart.new(root, {
        panX: false,
        panY: false,
        wheelX: 'none',
        wheelY: 'none',
        innerRadius: am5.percent(15),
        radius: am5.percent(78),
      })
    );

    const xRenderer = am5radar.AxisRendererCircular.new(root, {});
    xRenderer.labels.template.setAll({
      fontSize: 11,
      fontWeight: '600',
      fill: am5.color('#706E6B'),
      fontFamily: 'Plus Jakarta Sans',
      paddingTop: 4,
      paddingBottom: 4,
    });
    xRenderer.grid.template.setAll({ stroke: am5.color('#E8E7E3'), strokeOpacity: 0.8 });

    const xAxis = chart.xAxes.push(
      am5xy.CategoryAxis.new(root, {
        maxDeviation: 0,
        categoryField: 'dimension',
        renderer: xRenderer,
      })
    );

    const yRenderer = am5radar.AxisRendererRadial.new(root, {});
    yRenderer.labels.template.setAll({ fontSize: 9, fill: am5.color('#A3A19E'), fontFamily: 'Plus Jakarta Sans' });
    yRenderer.grid.template.setAll({ stroke: am5.color('#E8E7E3'), strokeOpacity: 0.5 });

    const yAxis = chart.yAxes.push(
      am5xy.ValueAxis.new(root, { min: 0, max: 100, renderer: yRenderer, strictMinMax: true })
    );

    const series1 = chart.series.push(
      am5radar.RadarLineSeries.new(root, {
        name: 'Hospital',
        xAxis, yAxis,
        valueYField: 'score',
        categoryXField: 'dimension',
        stroke: am5.color('#1D4ED8'),
        fill: am5.color('#1D4ED8'),
        tooltip: am5.Tooltip.new(root, { labelText: '{categoryX}: {valueY}' }),
      })
    );
    series1.strokes.template.setAll({ strokeWidth: 2 });
    series1.fills.template.setAll({ visible: true, fillOpacity: 0.18 });
    series1.bullets.push(() =>
      am5.Bullet.new(root, {
        sprite: am5.Circle.new(root, { radius: 4, fill: am5.color('#1D4ED8'), strokeWidth: 2, stroke: am5.color('#FFFFFF') }),
      })
    );

    const series2 = chart.series.push(
      am5radar.RadarLineSeries.new(root, {
        name: 'Cohort Average',
        xAxis, yAxis,
        valueYField: 'avg',
        categoryXField: 'dimension',
        stroke: am5.color('#A3A19E'),
        fill: am5.color('#A3A19E'),
        tooltip: am5.Tooltip.new(root, { labelText: 'Avg: {valueY}' }),
      })
    );
    series2.strokes.template.setAll({ strokeWidth: 1.5, strokeDasharray: [4, 3] });
    series2.fills.template.setAll({ visible: true, fillOpacity: 0.04 });

    const chartData = DIMENSIONS.map(d => ({
      dimension: d.short,
      score: Math.round((selected as any)[d.key] ?? 0),
      avg: Math.round(avg[d.key] ?? 0),
    }));

    xAxis.data.setAll(chartData);
    series1.data.setAll(chartData);
    series2.data.setAll(chartData);

    chart.appear(600, 0);

    // Grow-from-center: animate each dataItem's working value from 0 → real value.
    // Tuned to land around the ~1s mark so it syncs with the heatmap flicker settling.
    const spiderTimers: number[] = [];
    series1.events.once('datavalidated', () => {
      series1.dataItems.forEach((di, i) => {
        di.animate({
          key: 'valueYWorking' as any,
          from: 0,
          to: di.get('valueY') ?? 0,
          duration: 850,
          delay: 60 + i * 35,
          easing: am5.ease.out(am5.ease.cubic),
        });
      });
    });
    series2.events.once('datavalidated', () => {
      series2.dataItems.forEach((di, i) => {
        di.animate({
          key: 'valueYWorking' as any,
          from: 0,
          to: di.get('valueY') ?? 0,
          duration: 850,
          delay: 180 + i * 35,
          easing: am5.ease.out(am5.ease.cubic),
        });
      });
    });

    const legend = chart.children.push(
      am5.Legend.new(root, {
        centerX: am5.percent(50), x: am5.percent(50), y: am5.percent(99),
        layout: root.horizontalLayout,
      })
    );
    legend.labels.template.setAll({ fontSize: 10, fill: am5.color('#706E6B'), fontFamily: 'Plus Jakarta Sans' });
    legend.markers.template.setAll({ width: 10, height: 10 });
    legend.data.setAll(chart.series.values);

    return () => {
      spiderTimers.forEach(window.clearTimeout);
      root.dispose();
    };
  }, [selected.id]);

  return <div ref={divRef} style={{ width: '100%', height: '100%' }} />;
}

// ──────────────────────────────────────────
// Divergent Bar Chart — raw scores centered at 70 (the "good" threshold).
// Replaces Fraud Risk with Positivity Index (% of 4+ star reviews).
// ──────────────────────────────────────────
const DIVERGENT_BASELINE = 70;

function DivergentChart({ selected, avg, positivityIndex }: { selected: Facility; avg: Record<string, number>; positivityIndex: number }) {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!divRef.current) return;
    const root = am5.Root.new(divRef.current);
    root.setThemes([am5themes_Animated.new(root)]);

    const chart = root.container.children.push(
      am5xy.XYChart.new(root, {
        panX: false,
        panY: false,
        wheelX: 'none',
        wheelY: 'none',
        layout: root.verticalLayout,
        paddingLeft: 0,
        paddingRight: 56,
        paddingTop: 8,
        paddingBottom: 8,
      })
    );

    const yRenderer = am5xy.AxisRendererY.new(root, { minGridDistance: 28 });
    yRenderer.labels.template.setAll({
      fontSize: 11,
      fontWeight: '700',
      fill: am5.color('#1C1A17'),
      fontFamily: 'Plus Jakarta Sans',
    });
    yRenderer.grid.template.set('visible', false);

    const yAxis = chart.yAxes.push(
      am5xy.CategoryAxis.new(root, { categoryField: 'dimension', renderer: yRenderer })
    );

    const xRenderer = am5xy.AxisRendererX.new(root, {});
    xRenderer.labels.template.setAll({
      fontSize: 10,
      fontWeight: '600',
      fill: am5.color('#706E6B'),
      fontFamily: 'Plus Jakarta Sans',
    });
    xRenderer.grid.template.setAll({ stroke: am5.color('#E8E7E3'), strokeOpacity: 0.5, strokeDasharray: [2, 3] });

    const xAxis = chart.xAxes.push(
      am5xy.ValueAxis.new(root, {
        renderer: xRenderer,
        min: 0,
        max: 100,
        strictMinMax: true,
      })
    );

    // Baseline at 70 ("good" threshold)
    const midRange = xAxis.createAxisRange(xAxis.makeDataItem({ value: DIVERGENT_BASELINE }));
    midRange.get('grid')?.setAll({ stroke: am5.color('#1C1A17'), strokeOpacity: 0.5, strokeWidth: 1.5, strokeDasharray: [] });
    midRange.get('label')?.setAll({
      text: `${DIVERGENT_BASELINE}`,
      fontSize: 10,
      fontWeight: '700',
      fill: am5.color('#1C1A17'),
      fontFamily: 'Plus Jakarta Sans',
    });

    const series = chart.series.push(
      am5xy.ColumnSeries.new(root, {
        name: 'Score',
        xAxis, yAxis,
        openValueXField: 'baseline',
        valueXField: 'score',
        categoryYField: 'dimension',
        maskBullets: false,
        clustered: false,
        tooltip: am5.Tooltip.new(root, {
          labelText: '[bold]{label}[/]\nScore: [bold]{score}[/]/100\nBenchmark: {cohort}/100\n{verdict}',
        }),
      })
    );

    series.columns.template.setAll({
      height: am5.percent(68),
      cornerRadiusTR: 4, cornerRadiusBR: 4, cornerRadiusTL: 4, cornerRadiusBL: 4,
      strokeOpacity: 0,
    });

    // Color by distance from baseline (70). Higher = greener.
    series.columns.template.adapters.add('fill', (_fill, target) => {
      const d = target.dataItem?.dataContext as any;
      if (!d) return am5.color('#A3A19E');
      const s = d.score as number;
      if (s >= 85) return am5.color('#2B7A4C');
      if (s >= 70) return am5.color('#6EAD79');
      if (s >= 55) return am5.color('#D97706');
      if (s >= 40) return am5.color('#E87A3B');
      return am5.color('#C2410C');
    });

    // Score label at end of bar (positioned outward from baseline direction)
    series.bullets.push(() => {
      const label = am5.Label.new(root, {
        text: '{score}',
        fontSize: 11,
        fontWeight: '800',
        fontFamily: 'Plus Jakarta Sans',
        fill: am5.color('#1C1A17'),
        centerY: am5.percent(50),
        populateText: true,
      });
      label.adapters.add('centerX', (_v, target) => {
        const d = (target as any).dataItem?.dataContext;
        if (!d) return am5.percent(0);
        return d.score >= DIVERGENT_BASELINE ? am5.percent(0) : am5.percent(100);
      });
      label.adapters.add('paddingLeft', (_v, target) => {
        const d = (target as any).dataItem?.dataContext;
        return d && d.score >= DIVERGENT_BASELINE ? 6 : 0;
      });
      label.adapters.add('paddingRight', (_v, target) => {
        const d = (target as any).dataItem?.dataContext;
        return d && d.score < DIVERGENT_BASELINE ? 6 : 0;
      });
      return am5.Bullet.new(root, { locationX: 1, sprite: label });
    });

    // Build data: 5 weighted dims + positivity (replacing fraud risk)
    const weighted = DIMENSIONS.filter(d => !d.isFraud);
    const chartData: any[] = weighted.map(d => {
      const score = Math.round((selected as any)[d.key] ?? 0);
      const cohort = Math.round(avg[d.key] ?? 0);
      const delta = score - DIVERGENT_BASELINE;
      const verdict = delta >= 10 ? `Well above the ${DIVERGENT_BASELINE} threshold`
        : delta >= 0 ? `Above the ${DIVERGENT_BASELINE} threshold`
        : delta >= -15 ? `Below threshold by ${Math.abs(delta)}`
        : `Significantly below threshold (${delta})`;
      return {
        dimension: d.short,
        label: d.label,
        score,
        cohort,
        baseline: DIVERGENT_BASELINE,
        verdict,
      };
    });

    // Positivity index row
    const posScore = Math.round(positivityIndex);
    const posDelta = posScore - DIVERGENT_BASELINE;
    chartData.push({
      dimension: 'Positivity Index',
      label: 'Positivity Index (% reviews ≥ 4★)',
      score: posScore,
      cohort: DIVERGENT_BASELINE,
      baseline: DIVERGENT_BASELINE,
      verdict: posDelta >= 10 ? 'Excellent patient satisfaction'
        : posDelta >= 0 ? 'Above the satisfaction threshold'
        : posDelta >= -15 ? `Below threshold by ${Math.abs(posDelta)} points`
        : 'Significantly below — investigate',
    });

    // Random-direction wobble: each bar starts at the baseline, then snaps to 3 random
    // points on either side of its target (diminishing amplitude), then settles on the true
    // score. Feels like a needle searching for the right value. Synced to land around the
    // same ~1s mark as the heatmap flicker.
    yAxis.data.setAll(chartData);
    series.data.setAll(chartData);

    chart.appear(600, 0);

    const divergentTimers: number[] = [];
    series.events.once('datavalidated', () => {
      series.dataItems.forEach((di, i) => {
        const target = di.get('valueX') ?? DIVERGENT_BASELINE;
        // Seed the displayed value at the baseline (bar has zero width on first paint)
        di.set('valueXWorking' as any, DIVERGENT_BASELINE);

        const startDelay = 80 + i * 55;
        // Diminishing wobble amplitudes — each in a random direction
        const amplitudes = [22, 12, 6];
        const stepDur = 130;
        let cursor = startDelay;

        amplitudes.forEach((amp) => {
          const dir = Math.random() < 0.5 ? -1 : 1;
          const wobbleVal = Math.max(2, Math.min(98, target + dir * amp));
          const t = window.setTimeout(() => {
            di.animate({
              key: 'valueXWorking' as any,
              to: wobbleVal,
              duration: stepDur,
              easing: am5.ease.inOut(am5.ease.quad),
            });
          }, cursor);
          divergentTimers.push(t);
          cursor += stepDur;
        });

        // Final settle on true score
        const tSettle = window.setTimeout(() => {
          di.animate({
            key: 'valueXWorking' as any,
            to: target,
            duration: 320,
            easing: am5.ease.out(am5.ease.cubic),
          });
        }, cursor);
        divergentTimers.push(tSettle);
      });
    });

    return () => {
      divergentTimers.forEach(window.clearTimeout);
      root.dispose();
    };
  }, [selected.id, positivityIndex]);

  return <div ref={divRef} style={{ width: '100%', height: '100%' }} />;
}

// ──────────────────────────────────────────
// Timeline Heatmap — dimension × month (single hospital)
// ──────────────────────────────────────────
interface TimelineCell { month: string; score: number | null; count: number; }
interface TimelineDim { dimension: string; months: TimelineCell[]; }

function TimelineHeatmap({ timeline, loading }: { timeline: TimelineDim[]; loading: boolean }) {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!divRef.current || loading || timeline.length === 0) return;
    const root = am5.Root.new(divRef.current);
    root.setThemes([am5themes_Animated.new(root)]);

    const chart = root.container.children.push(
      am5xy.XYChart.new(root, {
        panX: false, panY: false, wheelX: 'none', wheelY: 'none',
        paddingTop: 8, paddingRight: 24, paddingBottom: 40, paddingLeft: 0,
        layout: root.verticalLayout,
      })
    );

    const labelMap: Record<string, string> = {
      patient: 'Patient (30%)',
      clinical: 'Clinical (25%)',
      billing: 'Billing (20%)',
      trust: 'Trust (15%)',
      operational: 'Operational (10%)',
    };

    const yRenderer = am5xy.AxisRendererY.new(root, { minGridDistance: 30, inversed: true });
    yRenderer.labels.template.setAll({
      fontSize: 11, fontWeight: '700', fill: am5.color('#1C1A17'), fontFamily: 'Plus Jakarta Sans',
    });
    yRenderer.grid.template.set('visible', false);

    const yAxis = chart.yAxes.push(
      am5xy.CategoryAxis.new(root, { categoryField: 'dimension', renderer: yRenderer })
    );

    const xRenderer = am5xy.AxisRendererX.new(root, { opposite: false, minGridDistance: 30 });
    xRenderer.labels.template.setAll({
      fontSize: 10, fontWeight: '600', fill: am5.color('#706E6B'), fontFamily: 'Plus Jakarta Sans',
    });
    xRenderer.grid.template.set('visible', false);

    const xAxis = chart.xAxes.push(
      am5xy.CategoryAxis.new(root, { categoryField: 'month', renderer: xRenderer })
    );

    const series = chart.series.push(
      am5xy.ColumnSeries.new(root, {
        xAxis, yAxis,
        categoryXField: 'month',
        categoryYField: 'dimension',
        valueField: 'value',
        tooltip: am5.Tooltip.new(root, {
          labelText: '[bold]{dimension}[/]\n{monthLabel}\nRating: {valueDisplay}\nReviews: {count}',
        }),
      })
    );

    series.columns.template.setAll({
      width: am5.percent(95),
      height: am5.percent(95),
      strokeOpacity: 0,
      cornerRadiusTL: 2, cornerRadiusTR: 2, cornerRadiusBL: 2, cornerRadiusBR: 2,
      // Default fill = coolest end of the palette. Each cell starts here, then is explicitly
      // animated to its true color via the flicker sequence below. NOTE: do NOT attach a fill
      // adapter — it would override every animation frame and the cycle would never be visible.
      fill: am5.color('#2B7A4C'),
    });

    // Final "settled" color for a 0–5 rating.
    const heatColor = (v: number | null | undefined): am5.Color => {
      if (v === null || v === undefined) return am5.color('#F2F1ED');
      if (v >= 4.3) return am5.color('#2B7A4C');
      if (v >= 3.8) return am5.color('#6EAD79');
      if (v >= 3.3) return am5.color('#C9D26B');
      if (v >= 2.8) return am5.color('#E8A93E');
      if (v >= 2.0) return am5.color('#E87A3B');
      return am5.color('#C2410C');
    };

    // Convert YYYY-MM to short labels
    const monthLabel = (m: string) => {
      const [y, mo] = m.split('-');
      const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${names[parseInt(mo, 10) - 1]} ${y!.slice(2)}`;
    };

    // Flatten data
    const monthsList = timeline[0]?.months.map(m => m.month) ?? [];
    const heatData: any[] = [];
    timeline.forEach(dim => {
      dim.months.forEach(cell => {
        heatData.push({
          dimension: labelMap[dim.dimension] ?? dim.dimension,
          month: monthLabel(cell.month),
          monthLabel: monthLabel(cell.month),
          value: cell.score,
          valueDisplay: cell.score !== null ? `${cell.score.toFixed(1)} / 5.0` : 'No data',
          count: cell.count,
        });
      });
    });

    const yData = timeline.map(d => ({ dimension: labelMap[d.dimension] ?? d.dimension }));
    const xData = monthsList.map(m => ({ month: monthLabel(m) }));

    yAxis.data.setAll(yData);
    xAxis.data.setAll(xData);
    series.data.setAll(heatData);

    // Cycle-through-heat animation. We defer with rAF so the columns actually exist in the
    // canvas before we try to seed/animate their fills. Each tile starts cool, then flickers
    // through a RANDOMIZED sequence of palette colors (cool → hot, with jitter) — as if each
    // cell is "trying out" different scores — before settling on its real color.
    const heatPalette = [
      am5.color('#2B7A4C'), // dark green   (idx 0 — coolest)
      am5.color('#6EAD79'), // light green
      am5.color('#C9D26B'), // lime
      am5.color('#E8A93E'), // amber
      am5.color('#D97706'), // orange
      am5.color('#E87A3B'), // light red
      am5.color('#C2410C'), // dark red    (hottest)
    ];
    const cellTimers: number[] = [];
    let rafId = 0;
    rafId = requestAnimationFrame(() => {
      rafId = requestAnimationFrame(() => {
        series.columns.each((col) => {
          const di = col.dataItem;
          const ctx = di?.dataContext as any;
          if (!ctx) return;

          const isEmpty = ctx.value === null || ctx.value === undefined;
          const target = heatColor(ctx.value);

          // Empty cells: fade in to neutral, no flicker.
          if (isEmpty) {
            col.set('fill', am5.color('#F2F1ED'));
            col.set('fillOpacity', 0);
            const tEmpty = window.setTimeout(() => {
              col.animate({ key: 'fillOpacity', to: 1, duration: 600, easing: am5.ease.out(am5.ease.cubic) });
            }, Math.random() * 400);
            cellTimers.push(tEmpty);
            return;
          }

          // Seed at the coolest end so every tile starts "cool".
          col.set('fill', heatPalette[0]);
          col.set('fillOpacity', 1);

          // Randomize the flicker sequence per tile, tuned to fit roughly a 1s budget:
          //  - random start delay (0–180 ms) staggers tiles chaotically
          //  - 5–7 random palette stops, biased to walk cool → hot over time
          //  - each stop lasts 70–110 ms
          const startDelay = Math.random() * 180;
          const stops = 5 + Math.floor(Math.random() * 3); // 5–7
          const stepDur = () => 70 + Math.floor(Math.random() * 40);

          let cursor = startDelay;
          for (let s = 0; s < stops; s++) {
            // Bias: as s grows, pick from a window that shifts toward the hot end of the palette.
            const progress = s / Math.max(1, stops - 1); // 0…1
            const center = Math.round(progress * (heatPalette.length - 1));
            const jitter = Math.floor((Math.random() - 0.5) * 4); // ±2
            const pickIdx = Math.max(0, Math.min(heatPalette.length - 1, center + jitter));
            const dur = stepDur();
            const colorPick = heatPalette[pickIdx]!;
            const t = window.setTimeout(() => {
              col.animate({
                key: 'fill',
                to: colorPick,
                duration: dur,
                easing: am5.ease.inOut(am5.ease.quad),
              });
            }, cursor);
            cellTimers.push(t);
            cursor += dur;
          }

          // Settle on the true color.
          const tSettle = window.setTimeout(() => {
            col.animate({
              key: 'fill',
              to: target,
              duration: 320,
              easing: am5.ease.out(am5.ease.cubic),
            });
          }, cursor + 30);
          cellTimers.push(tSettle);
        });
      });
    });

    // Heat legend at bottom
    const heatLegend = chart.children.push(am5.HeatLegend.new(root, {
      orientation: 'horizontal',
      startColor: am5.color('#C2410C'),
      endColor: am5.color('#2B7A4C'),
      startText: '1.0 — Critical',
      endText: '5.0 — Excellent',
      stepCount: 6,
      width: am5.percent(45),
      x: am5.percent(28),
      y: am5.percent(100),
      centerY: am5.percent(100),
    }));
    heatLegend.startLabel.setAll({ fontSize: 10, fill: am5.color('#706E6B'), fontFamily: 'Plus Jakarta Sans', fontWeight: '600' });
    heatLegend.endLabel.setAll({ fontSize: 10, fill: am5.color('#706E6B'), fontFamily: 'Plus Jakarta Sans', fontWeight: '600' });

    series.appear(600, 0);
    chart.appear(600, 0);

    return () => {
      cancelAnimationFrame(rafId);
      cellTimers.forEach(window.clearTimeout);
      root.dispose();
    };
  }, [timeline, loading]);

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#A3A19E', fontSize: '0.85rem' }}>Loading timeline…</div>;
  }
  if (timeline.length === 0) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#A3A19E', fontSize: '0.85rem' }}>No dated review data available for this hospital.</div>;
  }
  return <div ref={divRef} style={{ width: '100%', height: '100%' }} />;
}

// ──────────────────────────────────────────
// Main Dashboards Component
// ──────────────────────────────────────────
export default function HeatmapSection({ facilities }: Props) {
  const scored = facilities
    .filter(f => f.piiScore && f.piiScore > 0 && f.patientExperienceScore !== null)
    .sort((a, b) => (b.piiScore ?? 0) - (a.piiScore ?? 0));

  const [selectedId, setSelectedId] = useState<string>(scored[0]?.id ?? '');
  const [timeline, setTimeline] = useState<TimelineDim[]>([]);
  const [totalReviews, setTotalReviews] = useState<number>(0);
  const [positivityIndex, setPositivityIndex] = useState<number>(0);
  const [loadingTimeline, setLoadingTimeline] = useState<boolean>(false);

  const selected = scored.find(f => f.id === selectedId) ?? scored[0];

  // Fetch timeline whenever selected hospital changes
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoadingTimeline(true);
    fetch(`${API}/getHospitalTimeline?input=${encodeURIComponent(JSON.stringify({ id: selected.id, months: 12 }))}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const res = data?.result?.data ?? data;
        setTimeline(res?.timeline ?? []);
        setTotalReviews(res?.totalReviews ?? 0);
        setPositivityIndex(res?.positivityIndex ?? 0);
      })
      .catch(() => { if (!cancelled) { setTimeline([]); setTotalReviews(0); setPositivityIndex(0); } })
      .finally(() => { if (!cancelled) setLoadingTimeline(false); });
    return () => { cancelled = true; };
  }, [selected?.id]);

  if (!selected) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#706E6B' }}>No scored facilities available.</div>;
  }

  // Cohort averages
  const avg: Record<string, number> = {};
  DIMENSIONS.forEach(d => {
    avg[d.key] = scored.reduce((sum, f) => sum + ((f as any)[d.key] ?? 0), 0) / scored.length;
  });

  const piiTier = (selected.piiScore ?? 0) >= 75 ? 'high' : (selected.piiScore ?? 0) >= 55 ? 'mid' : 'low';
  const piiColors = {
    high: { bg: '#EAF6EE', fg: '#2B7A4C', label: 'Strong' },
    mid: { bg: '#FEF3C7', fg: '#D97706', label: 'Moderate' },
    low: { bg: '#FDF2E9', fg: '#C2410C', label: 'At Risk' },
  }[piiTier];

  return (
    <div style={{
      padding: '32px 48px 60px',
      maxWidth: 1680,
      margin: '0 auto',
      overflowY: 'auto',
      height: 'calc(100vh - 56px)',
      boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 4px', color: '#1C1A17' }}>
            Scoring Dashboards
          </h2>
          <p style={{ fontSize: '0.82rem', color: '#706E6B', margin: 0 }}>
            Multi-dimensional intelligence on provider quality, sentiment trends, and review-derived risk signals.
          </p>
        </div>

        {/* Hospital selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ fontSize: '0.65rem', fontWeight: 700, color: '#706E6B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Hospital
          </label>
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            style={{
              padding: '9px 16px',
              borderRadius: 8,
              border: '1px solid #E8E7E3',
              fontSize: '0.82rem',
              fontWeight: 600,
              color: '#1C1A17',
              background: '#FFFFFF',
              cursor: 'pointer',
              minWidth: 320,
              fontFamily: 'inherit',
              outline: 'none',
            }}
          >
            {scored.map(f => (
              <option key={f.id} value={f.id}>
                {f.name} — {f.city} (PII {f.piiScore?.toFixed(1)})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 20 }}>
        <div style={{ background: '#FFFFFF', border: '1px solid #E8E7E3', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: '0.62rem', fontWeight: 700, color: '#A3A19E', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            PII Score
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1C1A17', letterSpacing: '-0.02em' }}>
              {selected.piiScore?.toFixed(1) ?? '—'}
            </span>
            <span style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 4,
              background: piiColors.bg,
              color: piiColors.fg,
            }}>{piiColors.label}</span>
          </div>
        </div>
        {DIMENSIONS.filter(d => !d.isFraud).map(d => {
          const val = (selected as any)[d.key] ?? 0;
          const color = val >= 70 ? '#2B7A4C' : val >= 50 ? '#D97706' : '#C2410C';
          return (
            <div key={d.key} style={{ background: '#FFFFFF', border: '1px solid #E8E7E3', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: '0.62rem', fontWeight: 700, color: '#A3A19E', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                {d.short}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1C1A17', letterSpacing: '-0.02em' }}>
                  {val.toFixed(1)}
                </span>
                <span style={{ fontSize: '0.65rem', color, fontWeight: 700 }}>/100</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Spider + Divergent row */}
      <div style={{ display: 'grid', gridTemplateColumns: '5fr 7fr', gap: 16, marginBottom: 16 }}>
        {/* Spider */}
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #E8E7E3',
          borderRadius: 12,
          padding: '18px 20px 14px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#1C1A17', letterSpacing: '-0.01em' }}>
                Performance Profile
              </div>
              <div style={{ fontSize: '0.7rem', color: '#A3A19E', marginTop: 2 }}>
                All 6 dimensions vs cohort average. Higher is better — except Fraud Risk (↓ lower is better).
              </div>
            </div>
          </div>
          <div style={{ height: 400 }}>
            <SpiderChart selected={selected} avg={avg} />
          </div>
        </div>

        {/* Divergent */}
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #E8E7E3',
          borderRadius: 12,
          padding: '18px 20px 14px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#1C1A17', letterSpacing: '-0.01em' }}>
                Dimension Scores
              </div>
              <div style={{ fontSize: '0.7rem', color: '#A3A19E', marginTop: 2 }}>
                Bars start at the 70-point excellence threshold. Right of 70 = above bar, left = below. Includes Positivity Index (% reviews ≥ 4★).
              </div>
            </div>
            <div style={{ display: 'flex', gap: 14, fontSize: '0.65rem', fontWeight: 700, color: '#706E6B' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: '#2B7A4C' }} /> Strong
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: '#D97706' }} /> Moderate
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: '#C2410C' }} /> Weak
              </span>
            </div>
          </div>
          <div style={{ height: 400 }}>
            <DivergentChart selected={selected} avg={avg} positivityIndex={positivityIndex} />
          </div>
        </div>
      </div>

      {/* Timeline Heatmap */}
      <div style={{
        background: '#FFFFFF',
        border: '1px solid #E8E7E3',
        borderRadius: 12,
        padding: '18px 20px 14px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#1C1A17', letterSpacing: '-0.01em' }}>
              Review Sentiment Timeline — {selected.name}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#A3A19E', marginTop: 2 }}>
              Monthly average review rating per dimension (0–5 stars) over the last 12 months. {totalReviews > 0 && `Based on ${totalReviews.toLocaleString()} dated reviews.`}
            </div>
          </div>
        </div>
        <div style={{ height: 360 }}>
          <TimelineHeatmap timeline={timeline} loading={loadingTimeline} />
        </div>
      </div>
    </div>
  );
}
