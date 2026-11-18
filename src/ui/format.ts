import { formatFixed } from '../core/format.ts';

/** A value as trec_eval prints it (4 decimals), with typographic NaN, infinity and minus. */
export function fmt(x: number | undefined, digits = 4): string {
  if (x === undefined) return '–';
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞';
  return formatFixed(x, digits).replace(/^-/, '−');
}

const integer = new Intl.NumberFormat('en');

export function fmtInt(n: number): string {
  return integer.format(n);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

/** Short tick labels for chart axes. */
export function fmtTick(value: number, step: number): string {
  if (value === 0) return '0';
  const decimals = Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
  return value.toFixed(decimals).replace(/^-/, '−');
}

/** A safe file-name fragment. */
export function slug(text: string): string {
  return text.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'export';
}

/** Shorten a label for chart annotations. */
export function ellipsize(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
