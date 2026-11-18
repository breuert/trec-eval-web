/**
 * String ordering.
 *
 * trec_eval compares document ids with C `strcmp` on UTF-8 bytes, and repro_eval
 * (Python) sorts topic and document ids as `str`. Both orders are Unicode
 * code-point order. JavaScript's `<` compares UTF-16 code units instead, which
 * disagrees for characters outside the Basic Multilingual Plane, so every
 * comparison that influences a computed value goes through `compareCodePoints`.
 */

/** Map a UTF-16 code unit so that surrogates sort above U+E000..U+FFFF. */
function fixup(unit: number): number {
  if (unit < 0xd800) return unit;
  return unit >= 0xe000 ? unit - 0x800 : unit + 0x2000;
}

/** Compare by Unicode code point (identical to C `strcmp` on UTF-8 and Python `str` ordering). */
export function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    if (ca !== cb) return fixup(ca) < fixup(cb) ? -1 : 1;
  }
  return a.length < b.length ? -1 : 1;
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'variant' });

/**
 * Human-friendly order for display only ("2" before "10").
 * Never use it for anything that affects a computed value.
 */
export function compareNatural(a: string, b: string): number {
  return collator.compare(a, b) || compareCodePoints(a, b);
}
