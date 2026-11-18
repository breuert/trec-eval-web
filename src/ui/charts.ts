/**
 * Dependency-free SVG charts: grouped columns and lines, each drawn as one or more
 * panels (small multiples) inside a single SVG. Colors are resolved from the CSS custom
 * properties at render time and written as attributes, so an exported SVG looks like the
 * chart on screen.
 *
 * Mark specs: columns ≤ 24 px with a 4 px rounded data end and a 2 px surface gap,
 * 2 px lines, 8 px markers with a 2 px surface ring (each run has its own marker shape,
 * so identity never rests on color alone), hairline solid gridlines, hover targets of
 * at least 24 px, a crosshair with a tooltip on line charts.
 */
import { h, s } from './dom.ts';
import { ellipsize, fmtTick } from './format.ts';

export type Shape = 'circle' | 'square' | 'triangle' | 'diamond';
export const SHAPES: readonly Shape[] = ['circle', 'square', 'triangle', 'diamond'];

export interface Series {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly shape?: Shape;
}

export interface ChartTheme {
  readonly surface: string;
  readonly ink: string;
  readonly ink2: string;
  readonly muted: string;
  readonly grid: string;
  readonly axis: string;
  readonly neutral: string;
  readonly pos: string;
  readonly neg: string;
  readonly series: readonly string[];
}

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export function chartTheme(): ChartTheme {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string): string => style.getPropertyValue(name).trim();
  return {
    surface: v('--surface'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    muted: v('--chart-muted'),
    grid: v('--grid'),
    axis: v('--axis'),
    neutral: v('--neutral'),
    pos: v('--pos'),
    neg: v('--neg'),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--s${i}`)),
  };
}

let measureContext: CanvasRenderingContext2D | null | undefined;

export function textWidth(text: string, size = 12, weight = 400): number {
  if (measureContext === undefined) measureContext = document.createElement('canvas').getContext('2d');
  if (!measureContext) return text.length * size * 0.58;
  measureContext.font = `${weight} ${size}px ${FONT}`;
  return measureContext.measureText(text).width;
}

// ---------------------------------------------------------------------------- scales

export function tickStep(min: number, max: number, count: number): number {
  const span = max - min;
  if (!(span > 0)) return 1;
  const raw = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const error = raw / power;
  return (error >= 7.5 ? 10 : error >= 3.5 ? 5 : error >= 1.5 ? 2 : 1) * power;
}

export function niceDomain(min: number, max: number, count = 5): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    if (min === 0) return [0, 1];
    const pad = Math.abs(min) * 0.1;
    min -= pad;
    max += pad;
  }
  const step = tickStep(min, max, count);
  return [Math.floor(min / step + 1e-9) * step, Math.ceil(max / step - 1e-9) * step];
}

export function ticks(min: number, max: number, count = 5): number[] {
  const step = tickStep(min, max, count);
  const out: number[] = [];
  for (let i = Math.ceil(min / step - 1e-9); i <= Math.floor(max / step + 1e-9); i++) out.push(i * step);
  return out;
}

type Scale = (v: number) => number;

function linear(domain: readonly [number, number], range: readonly [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------- tooltip

let tooltipEl: HTMLDivElement | undefined;

export interface TooltipRow {
  readonly label: string;
  readonly value: string;
  readonly color?: string;
  readonly shape?: Shape;
}

function tooltip(): HTMLDivElement {
  if (!tooltipEl) {
    tooltipEl = h('div', { class: 'tooltip', role: 'presentation' });
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

export function showTooltip(clientX: number, clientY: number, title: string, rows: readonly TooltipRow[]): void {
  const el = tooltip();
  el.replaceChildren(
    h('div', { class: 'tt-title' }, title),
    ...rows.map((row) =>
      h('div', { class: 'tt-row' }, h('span', { class: 'tt-key' }, row.color ? seriesKey(row.color, row.shape) : null, row.label), h('strong', null, row.value)),
    ),
  );
  el.classList.add('show');
  const { width, height } = el.getBoundingClientRect();
  let x = clientX + 14;
  let y = clientY + 14;
  if (x + width > window.innerWidth - 8) x = clientX - width - 14;
  if (y + height > window.innerHeight - 8) y = clientY - height - 14;
  el.style.left = `${Math.max(8, x)}px`;
  el.style.top = `${Math.max(8, y)}px`;
}

export function hideTooltip(): void {
  tooltipEl?.classList.remove('show');
}

// ---------------------------------------------------------------------------- legend keys

function shapePath(shape: Shape, cx: number, cy: number, r: number): string {
  switch (shape) {
    case 'square':
      return `M${cx - r * 0.9},${cy - r * 0.9}h${1.8 * r}v${1.8 * r}h${-1.8 * r}z`;
    case 'triangle':
      return `M${cx},${cy - r * 1.15}L${cx + r * 1.1},${cy + r * 0.8}L${cx - r * 1.1},${cy + r * 0.8}z`;
    case 'diamond':
      return `M${cx},${cy - r * 1.25}L${cx + r * 1.15},${cy}L${cx},${cy + r * 1.25}L${cx - r * 1.15},${cy}z`;
    case 'circle':
      return `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
  }
}

/** A line with the series' marker: the key of a line chart series. */
export function seriesKey(color: string, shape: Shape = 'circle'): SVGSVGElement {
  return s(
    'svg',
    { class: 'key', width: 22, height: 12, 'aria-hidden': 'true' },
    s('line', { x1: 1, y1: 6, x2: 21, y2: 6, stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round' }),
    s('path', { d: shapePath(shape, 11, 6, 3.6), fill: color }),
  );
}

export function rectKey(color: string): SVGSVGElement {
  return s('svg', { class: 'key', width: 10, height: 10, 'aria-hidden': 'true' }, s('rect', { x: 0, y: 0, width: 10, height: 10, rx: 2.5, fill: color }));
}

export interface LegendItem {
  readonly label: string;
  readonly key: SVGSVGElement;
}

export function legend(items: readonly LegendItem[]): HTMLUListElement {
  return h('ul', { class: 'legend' }, items.map((item) => h('li', null, item.key, item.label)));
}

// ---------------------------------------------------------------------------- frame

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface PanelLayout {
  readonly boxes: Box[];
  readonly width: number;
  readonly height: number;
}

const PANEL_GAP = 28;
const TITLE_HEIGHT = 22;

function layoutPanels(count: number, width: number, panelHeight: number, minPanelWidth: number, titled: boolean): PanelLayout {
  let perRow = 1;
  for (let k = count; k >= 1; k--) {
    if ((width - PANEL_GAP * (k - 1)) / k >= minPanelWidth) {
      perRow = k;
      break;
    }
  }
  // Balance the rows: 4 panels as 2 + 2 rather than 3 + 1.
  const rows = Math.ceil(count / perRow);
  perRow = Math.ceil(count / rows);
  const panelWidth = (width - PANEL_GAP * (perRow - 1)) / perRow;
  const h0 = panelHeight + (titled ? TITLE_HEIGHT : 0);
  const boxes: Box[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    boxes.push({ x: col * (panelWidth + PANEL_GAP), y: row * (h0 + PANEL_GAP), width: panelWidth, height: h0 });
  }
  return { boxes, width, height: rows * h0 + (rows - 1) * PANEL_GAP };
}

function svgRoot(width: number, height: number, label: string, theme: ChartTheme): SVGSVGElement {
  return s('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': label, 'font-family': FONT, 'font-size': 12, fill: theme.ink2 });
}

function panelTitle(g: SVGGElement, box: Box, title: string | undefined, theme: ChartTheme): number {
  if (!title) return 0;
  g.appendChild(s('text', { x: box.x, y: box.y + 13, 'font-size': 12.5, 'font-weight': 600, fill: theme.ink }, title));
  return TITLE_HEIGHT;
}

interface YAxis {
  readonly scale: Scale;
  readonly domain: [number, number];
  readonly ticks: number[];
  readonly step: number;
}

function yAxis(domain: [number, number], top: number, bottom: number): YAxis {
  const count = Math.max(2, Math.min(6, Math.floor((bottom - top) / 44)));
  return { scale: linear(domain, [bottom, top]), domain, ticks: ticks(domain[0], domain[1], count), step: tickStep(domain[0], domain[1], count) };
}

function yAxisWidth(axis: YAxis, title: string | undefined): number {
  const w = Math.max(...axis.ticks.map((t) => textWidth(fmtTick(t, axis.step), 11)), 10);
  return Math.ceil(w) + 10 + (title ? 18 : 0);
}

function drawYGrid(g: SVGGElement, axis: YAxis, left: number, right: number, theme: ChartTheme, title: string | undefined, plotTop: number, plotBottom: number, outerLeft: number): void {
  for (const t of axis.ticks) {
    const y = Math.round(axis.scale(t)) + 0.5;
    g.appendChild(s('line', { x1: left, x2: right, y1: y, y2: y, stroke: t === 0 ? theme.axis : theme.grid, 'stroke-width': 1 }));
    g.appendChild(s('text', { x: left - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: theme.muted }, fmtTick(t, axis.step)));
  }
  if (title) {
    const cy = (plotTop + plotBottom) / 2;
    g.appendChild(s('text', { x: outerLeft + 9, y: cy, transform: `rotate(-90 ${outerLeft + 9} ${cy})`, 'text-anchor': 'middle', 'font-size': 11.5, fill: theme.ink2 }, title));
  }
}

/** Category labels under evenly spaced positions, thinned so they never collide. */
function drawCategoryLabels(g: SVGGElement, labels: readonly string[], centers: readonly number[], y: number, step: number, theme: ChartTheme): void {
  const widest = Math.max(...labels.map((l) => textWidth(l, 11)), 1);
  const every = Math.max(1, Math.ceil((widest + 8) / Math.max(step, 1)));
  labels.forEach((label, i) => {
    if (i % every !== 0) return;
    g.appendChild(s('text', { x: centers[i], y, 'text-anchor': 'middle', 'font-size': 11, fill: theme.muted }, label));
  });
}

function domainOf(values: Iterable<number>, include: readonly number[] = []): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of [...values, ...include]) {
    if (!Number.isFinite(v)) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return lo === Infinity ? [0, 1] : [lo, hi];
}

function clipDomain(domain: [number, number], clip: readonly [number, number] | undefined): [number, number] {
  return clip ? [Math.max(domain[0], clip[0]), Math.min(domain[1], clip[1])] : domain;
}

// ---------------------------------------------------------------------------- columns

export interface ColumnPanel {
  readonly title?: string;
  readonly groups: ReadonlyArray<{ readonly key: string; readonly label: string }>;
  readonly value: (group: string, series: string) => number | undefined;
}

export interface ColumnChartSpec {
  readonly label: string;
  readonly series: readonly Series[];
  readonly panels: readonly ColumnPanel[];
  readonly yTitle?: string;
  readonly yDomain?: [number, number];
  /** Values outside are drawn to the edge of the plot (the tooltip keeps the true value). */
  readonly yClip?: readonly [number, number];
  /** Color each column by its sign (diverging), ignoring the series color. */
  readonly diverging?: boolean;
  readonly format: (v: number) => string;
  readonly groupTitle?: string;
  readonly height?: number;
  readonly minPanelWidth?: number;
}

function columnPath(x: number, w: number, y0: number, y1: number): string {
  const top = Math.min(y0, y1);
  const height = Math.abs(y1 - y0);
  const r = Math.min(4, w / 2, height);
  if (height < 0.5) return `M${x},${y0}h${w}v0.5h${-w}z`;
  if (y1 <= y0) {
    // grows upwards: rounded top
    return `M${x},${y0}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${y0}Z`;
  }
  const bottom = top + height;
  return `M${x},${y0}V${bottom - r}Q${x},${bottom} ${x + r},${bottom}H${x + w - r}Q${x + w},${bottom} ${x + w},${bottom - r}V${y0}Z`;
}

export function columnChart(spec: ColumnChartSpec, width: number, theme: ChartTheme): SVGSVGElement {
  const plotHeight = spec.height ?? 240;
  const titled = spec.panels.some((p) => p.title);
  const layout = layoutPanels(spec.panels.length, width, plotHeight + 26, spec.minPanelWidth ?? 300, titled);
  const svg = svgRoot(width, layout.height, spec.label, theme);
  const all: number[] = [];
  for (const panel of spec.panels) {
    for (const group of panel.groups) {
      for (const series of spec.series) {
        const v = panel.value(group.key, series.key);
        if (v !== undefined) all.push(v);
      }
    }
  }
  const domain = spec.yDomain ?? niceDomain(...clipDomain(domainOf(all, [0]), spec.yClip));

  spec.panels.forEach((panel, p) => {
    const box = layout.boxes[p] as Box;
    const g = s('g');
    svg.appendChild(g);
    const top = box.y + panelTitle(g, box, panel.title, theme) + 6;
    const bottom = box.y + box.height - 22;
    const axis = yAxis(domain, top, bottom);
    const left = box.x + yAxisWidth(axis, spec.yTitle);
    const right = box.x + box.width;
    drawYGrid(g, axis, left, right, theme, spec.yTitle, top, bottom, box.x);

    const n = panel.groups.length;
    const step = (right - left) / Math.max(n, 1);
    const k = spec.series.length;
    const inner = Math.max(1, step * 0.78);
    const gap = inner / k > 4 ? 2 : 0;
    const barWidth = Math.max(1, Math.min(24, (inner - gap * (k - 1)) / k));
    const groupWidth = barWidth * k + gap * (k - 1);
    const zero = Math.round(axis.scale(clamp(0, domain[0], domain[1])));
    const centers: number[] = [];

    panel.groups.forEach((group, gi) => {
      const cx = left + step * gi + step / 2;
      centers.push(cx);
      const x0 = cx - groupWidth / 2;
      const rows: TooltipRow[] = [];
      spec.series.forEach((series, si) => {
        const v = panel.value(group.key, series.key);
        if (v === undefined) return;
        rows.push({ label: series.label, value: spec.format(v), color: series.color, ...(series.shape ? { shape: series.shape } : {}) });
        if (!Number.isFinite(v)) return;
        const x = x0 + si * (barWidth + gap);
        const y = axis.scale(clamp(v, domain[0], domain[1]));
        const color = spec.diverging ? (v < 0 ? theme.neg : theme.pos) : series.color;
        g.appendChild(s('path', { d: columnPath(x, barWidth, zero, y), fill: color }));
      });
      const hit = s('rect', { class: 'hit', x: cx - step / 2, y: top, width: step, height: bottom - top, fill: 'transparent' });
      const title = spec.groupTitle ? `${spec.groupTitle} ${group.label}` : group.label;
      hit.addEventListener('pointermove', (e) => showTooltip(e.clientX, e.clientY, title, rows));
      hit.addEventListener('pointerleave', hideTooltip);
      g.appendChild(hit);
    });
    g.appendChild(s('line', { x1: left, x2: right, y1: zero + 0.5, y2: zero + 0.5, stroke: theme.axis, 'stroke-width': 1 }));
    drawCategoryLabels(g, panel.groups.map((gr) => gr.label), centers, bottom + 16, step, theme);
  });
  return svg;
}

// ---------------------------------------------------------------------------- lines

export interface LinePanel {
  readonly title?: string;
  /** x values of this panel (default: the chart's). */
  readonly x?: readonly number[];
  readonly value: (series: string, xIndex: number) => number | undefined;
}

export interface LineChartSpec {
  readonly label: string;
  /** x values of the points, ascending. */
  readonly x: readonly number[];
  readonly xScale: 'log' | 'linear';
  readonly xDomain?: [number, number];
  /** Candidate tick values (default: the x values); labels are thinned so they never collide. */
  readonly xTicks?: readonly number[];
  readonly xFormat: (v: number) => string;
  readonly xTitle: string;
  readonly yTitle?: string;
  readonly series: readonly Series[];
  readonly panels: readonly LinePanel[];
  readonly yDomain?: [number, number];
  readonly format: (v: number) => string;
  readonly height?: number;
  readonly minPanelWidth?: number;
  /** Name each line at its end (single-panel charts with up to four series). */
  readonly directLabels?: boolean;
}

/** Round numbers first: 1·10^k, then 2 and 5·10^k, then the rest. */
function tickPriority(v: number): number {
  if (v === 0) return 0;
  const mantissa = Math.round((Math.abs(v) / 10 ** Math.floor(Math.log10(Math.abs(v)) + 1e-12)) * 1000) / 1000;
  if (mantissa === 1) return 1;
  if (mantissa === 2 || mantissa === 5) return 2;
  if (Number.isInteger(mantissa)) return 3;
  return 4;
}

/** Indices of the tick labels to draw: endpoints, then round values, never overlapping. */
function placeTicks(positions: readonly number[], widths: readonly number[], values: readonly number[]): number[] {
  const n = positions.length;
  const order = positions.map((_, i) => i).sort((a, b) => {
    const pa = a === 0 || a === n - 1 ? -1 : tickPriority(values[a] as number);
    const pb = b === 0 || b === n - 1 ? -1 : tickPriority(values[b] as number);
    return pa - pb || a - b;
  });
  const placed: Array<[number, number, number]> = [];
  for (const i of order) {
    const l = (positions[i] as number) - (widths[i] as number) / 2;
    const r = (positions[i] as number) + (widths[i] as number) / 2;
    if (placed.every(([pl, pr]) => r + 8 <= pl || l >= pr + 8)) placed.push([l, r, i]);
  }
  return placed.map((p) => p[2]).sort((a, b) => a - b);
}

export function lineChart(spec: LineChartSpec, width: number, theme: ChartTheme): SVGSVGElement {
  const plotHeight = spec.height ?? 220;
  const titled = spec.panels.some((p) => p.title);
  const layout = layoutPanels(spec.panels.length, width, plotHeight + 42, spec.minPanelWidth ?? 300, titled);
  const svg = svgRoot(width, layout.height, spec.label, theme);
  const all: number[] = [];
  const allX: number[] = [];
  for (const panel of spec.panels) {
    const xs = panel.x ?? spec.x;
    allX.push(...xs);
    for (const series of spec.series) {
      for (let i = 0; i < xs.length; i++) {
        const v = panel.value(series.key, i);
        if (v !== undefined) all.push(v);
      }
    }
  }
  const domain = spec.yDomain ?? niceDomain(...domainOf(all));
  const transform = spec.xScale === 'log' ? Math.log : (v: number): number => v;
  const [x0, x1] = spec.xDomain ?? [Math.min(...allX), Math.max(...allX)];
  const t0 = transform(x0);
  const t1 = transform(x1);
  const directLabels = spec.directLabels === true && spec.panels.length === 1 && spec.series.length <= 4 && width >= 480;
  const labelText = (sr: Series): string => ellipsize(sr.label, 18);
  const gutter = directLabels ? Math.ceil(Math.max(...spec.series.map((sr) => textWidth(labelText(sr), 11.5)), 0)) + 26 : 0;

  spec.panels.forEach((panel, p) => {
    const box = layout.boxes[p] as Box;
    const g = s('g');
    svg.appendChild(g);
    const top = box.y + panelTitle(g, box, panel.title, theme) + 6;
    const bottom = box.y + box.height - 40;
    const axis = yAxis(domain, top, bottom);
    const left = box.x + yAxisWidth(axis, spec.yTitle) + 8;
    const right = box.x + box.width - 10 - gutter;
    drawYGrid(g, axis, left - 8, right + 8, theme, spec.yTitle, top, bottom, box.x);
    const xAt = (v: number): number => (t1 === t0 ? (left + right) / 2 : left + ((transform(v) - t0) / (t1 - t0)) * (right - left));
    const xs = panel.x ?? spec.x;
    const n = xs.length;

    const tickValues = spec.xTicks ?? xs;
    const tickPos = tickValues.map(xAt);
    const tickLabels = tickValues.map(spec.xFormat);
    const placed = placeTicks(tickPos, tickLabels.map((l) => textWidth(l, 11)), tickValues);
    for (const i of placed) {
      const x = Math.round(tickPos[i] as number) + 0.5;
      g.appendChild(s('line', { x1: x, x2: x, y1: top, y2: bottom, stroke: theme.grid, 'stroke-width': 1 }));
      g.appendChild(s('text', { x, y: bottom + 18, 'text-anchor': 'middle', 'font-size': 11, fill: theme.muted }, tickLabels[i] as string));
    }
    g.appendChild(s('text', { x: (left + right) / 2, y: bottom + 36, 'text-anchor': 'middle', 'font-size': 11.5, fill: theme.ink2 }, spec.xTitle));

    const positions = xs.map(xAt);
    let minGap = Infinity;
    for (let i = 1; i < n; i++) minGap = Math.min(minGap, (positions[i] as number) - (positions[i - 1] as number));
    // Too dense for a marker on every point: keep them at the labelled ticks, so each run
    // stays identifiable by its shape.
    const labelled = new Set(placed.map((i) => tickValues[i]));
    const marked = (i: number): boolean => minGap >= 10 || labelled.has(xs[i] as number);
    const ends: Array<{ series: Series; y: number }> = [];

    for (const series of spec.series) {
      let d = '';
      let pen = false;
      let last: number | undefined;
      for (let i = 0; i < n; i++) {
        const v = panel.value(series.key, i);
        if (v === undefined || !Number.isFinite(v)) {
          pen = false;
          continue;
        }
        d += `${pen ? 'L' : 'M'}${(positions[i] as number).toFixed(2)},${axis.scale(clamp(v, domain[0], domain[1])).toFixed(2)}`;
        pen = true;
        last = v;
      }
      g.appendChild(s('path', { d, fill: 'none', stroke: series.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      for (let i = 0; i < n; i++) {
        const v = panel.value(series.key, i);
        if (v === undefined || !Number.isFinite(v) || !marked(i)) continue;
        g.appendChild(s('path', { d: shapePath(series.shape ?? 'circle', positions[i] as number, axis.scale(clamp(v, domain[0], domain[1])), 4), fill: series.color, stroke: theme.surface, 'stroke-width': 2 }));
      }
      if (last !== undefined) ends.push({ series, y: axis.scale(clamp(last, domain[0], domain[1])) });
    }

    if (directLabels) {
      // Spread the labels at least 15 px apart, keeping them inside the plot.
      ends.sort((a, b) => a.y - b.y);
      const ys = ends.map((e) => e.y);
      for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i] as number, (ys[i - 1] as number) + 15);
      const overflow = (ys[ys.length - 1] ?? 0) - bottom;
      if (overflow > 0) for (let i = ys.length - 1; i >= 0; i--) ys[i] = Math.min(ys[i] as number, bottom - (ys.length - 1 - i) * 15);
      ends.forEach((e, i) => {
        const y = ys[i] as number;
        g.appendChild(s('path', { d: shapePath(e.series.shape ?? 'circle', right + 18, y, 3.6), fill: e.series.color }));
        g.appendChild(s('text', { x: right + 26, y: y + 4, 'font-size': 11.5, fill: theme.ink2 }, labelText(e.series)));
      });
    }

    // Crosshair snapping to the nearest x; the tooltip lists every series.
    const cross = s('line', { x1: 0, x2: 0, y1: top, y2: bottom, stroke: theme.ink2, 'stroke-width': 1, visibility: 'hidden' });
    g.appendChild(cross);
    const dots = spec.series.map((sr) => {
      const dot = s('path', { d: '', fill: sr.color, stroke: theme.surface, 'stroke-width': 2, visibility: 'hidden' });
      g.appendChild(dot);
      return dot;
    });
    const hit = s('rect', { class: 'hit', x: left - 12, y: top, width: right - left + 24, height: bottom - top, fill: 'transparent' });
    hit.addEventListener('pointermove', (e) => {
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) * width) / rect.width;
      let best = 0;
      for (let i = 1; i < n; i++) if (Math.abs((positions[i] as number) - px) < Math.abs((positions[best] as number) - px)) best = i;
      const x = positions[best] as number;
      cross.setAttribute('x1', String(x));
      cross.setAttribute('x2', String(x));
      cross.setAttribute('visibility', 'visible');
      const rows: TooltipRow[] = [];
      spec.series.forEach((sr, si) => {
        const v = panel.value(sr.key, best);
        const dot = dots[si] as SVGPathElement;
        if (v === undefined) {
          dot.setAttribute('visibility', 'hidden');
          return;
        }
        rows.push({ label: sr.label, value: spec.format(v), color: sr.color, ...(sr.shape ? { shape: sr.shape } : {}) });
        if (Number.isFinite(v)) {
          dot.setAttribute('d', shapePath(sr.shape ?? 'circle', x, axis.scale(clamp(v, domain[0], domain[1])), 4.5));
          dot.setAttribute('visibility', 'visible');
        }
      });
      showTooltip(e.clientX, e.clientY, `${panel.title ? `${panel.title} · ` : ''}${spec.xTitle} ${spec.xFormat(xs[best] as number)}`, rows);
    });
    hit.addEventListener('pointerleave', () => {
      cross.setAttribute('visibility', 'hidden');
      for (const dot of dots) dot.setAttribute('visibility', 'hidden');
      hideTooltip();
    });
    g.appendChild(hit);
  });
  return svg;
}

// ---------------------------------------------------------------------------- export

/** A standalone SVG document of a rendered chart (with background). */
export function serializeSvg(svg: SVGSVGElement, theme: ChartTheme): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.querySelectorAll('.hit, [visibility="hidden"]').forEach((el) => el.remove());
  const bg = s('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: theme.surface });
  clone.insertBefore(bg, clone.firstChild);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

export async function svgToPng(svgText: string, width: number, height: number, scale = 2): Promise<Blob> {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available.');
  ctx.scale(scale, scale);
  ctx.drawImage(image, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed.'))), 'image/png'));
}
