import { chartTheme, legend, serializeSvg, svgToPng } from './charts.ts';
import type { ChartTheme, LegendItem } from './charts.ts';
import { download, h, icon, rafThrottle } from './dom.ts';
import type { Child } from './dom.ts';

// ---------------------------------------------------------------------------- tables

export interface Cell {
  readonly text: string;
  readonly title?: string;
  readonly className?: string;
  readonly node?: Node;
}

export type CellValue = string | Cell;

export interface TableData {
  readonly header: readonly string[];
  readonly rows: ReadonlyArray<ReadonlyArray<CellValue>>;
  /** Optional row of hints under the header (e.g. the ideal value of each column). */
  readonly ideal?: readonly string[];
  /** Section titles inserted before the row with the given index. */
  readonly sections?: ReadonlyMap<number, string>;
}

function cell(tag: 'td' | 'th', value: CellValue): HTMLTableCellElement {
  if (typeof value === 'string') return h(tag, null, value);
  return h(tag, { class: value.className, title: value.title }, value.node ?? value.text);
}

export function dataTable(data: TableData, options: { tall?: boolean; caption?: string } = {}): HTMLElement {
  const head = h('thead', null, h('tr', null, data.header.map((label, i) => h('th', { scope: 'col', class: i === 0 ? 'first' : null }, label))));
  if (data.ideal) head.appendChild(h('tr', { class: 'ideal' }, data.ideal.map((label) => h('th', null, label))));
  const body = h('tbody');
  data.rows.forEach((row, i) => {
    const section = data.sections?.get(i);
    if (section) body.appendChild(h('tr', null, h('td', { class: 'group', colspan: data.header.length }, section)));
    body.appendChild(h('tr', null, row.map((value) => cell('td', value))));
  });
  return h(
    'div',
    { class: `table-wrap${options.tall ? ' tall' : ''}` },
    h('table', { class: 'data' }, options.caption ? h('caption', { class: 'visually-hidden' }, options.caption) : null, head, body),
  );
}

/** Undo display typography so that spreadsheets read the numbers. */
function plain(text: string): string {
  if (text === 'n/a') return 'NaN';
  if (text === '–') return '';
  return text.replace(/−/g, '-').replace(/^∞$/, 'Infinity').replace(/^-∞$/, '-Infinity');
}

export function tableToCsv(data: TableData): string {
  const text = (v: CellValue): string => plain(typeof v === 'string' ? v : v.text);
  const quote = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [data.header, ...data.rows.map((row) => row.map(text))].map((row) => row.map(quote).join(',')).join('\n') + '\n';
}

// ---------------------------------------------------------------------------- cards

export function card(title: string, description: Child, body: Child, actions?: Child): HTMLElement {
  return h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'card-head' },
      h('div', null, h('h3', null, title), description ? h('p', { class: 'sub' }, description) : null),
      actions ? h('div', { class: 'card-actions' }, actions) : null,
    ),
    h('div', { class: 'card-body' }, body),
  );
}

const observers = new Set<ResizeObserver>();

/** Stop resize tracking of charts that are about to be replaced. */
export function disposeCharts(): void {
  for (const o of observers) o.disconnect();
  observers.clear();
}

export interface ChartCardOptions {
  readonly title: string;
  readonly description?: Child;
  readonly legend?: readonly LegendItem[];
  readonly controls?: Child;
  readonly draw: (width: number, theme: ChartTheme) => SVGSVGElement;
  readonly table: () => TableData;
  readonly fileName: string;
}

export function chartCard(options: ChartCardOptions): HTMLElement {
  const container = h('div', { class: 'chart' });
  const tableSlot = h('div', { class: 'chart-table', hidden: true });
  let current: SVGSVGElement | undefined;
  let lastWidth = 0;

  const draw = (): void => {
    const width = Math.floor(container.clientWidth);
    if (width <= 0 || width === lastWidth) return;
    lastWidth = width;
    current = options.draw(width, chartTheme());
    container.replaceChildren(current);
  };
  const observer = new ResizeObserver(rafThrottle(draw));
  observer.observe(container);
  observers.add(observer);

  const tableButton = h('button', { class: 'btn ghost small', type: 'button', 'aria-pressed': 'false', title: 'Show the data as a table' }, icon('table', 14), 'Table');
  tableButton.addEventListener('click', () => {
    const show = tableSlot.hidden;
    tableSlot.hidden = !show;
    tableButton.setAttribute('aria-pressed', String(show));
    if (show && tableSlot.childElementCount === 0) tableSlot.appendChild(dataTable(options.table(), { tall: true, caption: options.title }));
  });
  const exportSvg = (): string | undefined => (current ? serializeSvg(current, chartTheme()) : undefined);
  const svgButton = h('button', { class: 'btn ghost small', type: 'button', title: 'Download the chart as SVG' }, icon('download', 14), 'SVG');
  svgButton.addEventListener('click', () => {
    const text = exportSvg();
    if (text) download(`${options.fileName}.svg`, text, 'image/svg+xml');
  });
  const pngButton = h('button', { class: 'btn ghost small', type: 'button', title: 'Download the chart as PNG' }, 'PNG');
  pngButton.addEventListener('click', () => {
    const text = exportSvg();
    if (!text || !current) return;
    const width = Number(current.getAttribute('width'));
    const height = Number(current.getAttribute('height'));
    svgToPng(text, width, height)
      .then((blob) => download(`${options.fileName}.png`, blob, 'image/png'))
      .catch(() => undefined);
  });
  const csvButton = h('button', { class: 'btn ghost small', type: 'button', title: 'Download the data as CSV' }, 'CSV');
  csvButton.addEventListener('click', () => download(`${options.fileName}.csv`, tableToCsv(options.table()), 'text/csv;charset=utf-8'));

  return card(
    options.title,
    options.description,
    [options.controls ? h('div', { class: 'table-tools' }, options.controls) : null, options.legend && options.legend.length > 0 ? legend(options.legend) : null, container, tableSlot],
    [tableButton, svgButton, pngButton, csvButton],
  );
}

// ---------------------------------------------------------------------------- tiles & controls

export interface Tile {
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  readonly hint?: string;
  readonly title?: string;
}

export function tiles(items: readonly Tile[]): HTMLElement {
  return h(
    'div',
    { class: 'tiles' },
    items.map((t) =>
      h(
        'div',
        { class: 'tile', title: t.title },
        h('span', { class: 'label' }, t.label),
        h('span', { class: 'value' }, t.value, t.unit ? h('small', null, t.unit) : null),
        t.hint ? h('span', { class: 'hint' }, t.hint) : null,
      ),
    ),
  );
}

export function segmented<T extends string>(options: ReadonlyArray<{ value: T; label: string }>, value: T, onChange: (value: T) => void, label: string): HTMLElement {
  return h(
    'div',
    { class: 'segmented', role: 'group', 'aria-label': label },
    options.map((o) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(o.value === value) }, o.label);
      b.addEventListener('click', () => onChange(o.value));
      return b;
    }),
  );
}

export function chips<T extends string>(options: ReadonlyArray<{ value: T; label: string }>, selected: ReadonlySet<T>, onToggle: (value: T) => void, label: string): HTMLElement {
  return h(
    'div',
    { class: 'chips', role: 'group', 'aria-label': label },
    options.map((o) => {
      const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(selected.has(o.value)) }, o.label);
      b.addEventListener('click', () => onToggle(o.value));
      return b;
    }),
  );
}

export function select<T extends string>(label: string, options: ReadonlyArray<{ value: T; label: string }>, value: T, onChange: (value: T) => void, key?: string): HTMLElement {
  const el = h('select', { 'data-key': key }, options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  el.addEventListener('change', () => onChange(el.value as T));
  return h('label', { class: 'field' }, h('span', null, label), el);
}

export function emptyState(title: string, text: Child): HTMLElement {
  return h('div', { class: 'card empty' }, h('h3', null, title), h('p', { class: 'explain' }, text));
}
