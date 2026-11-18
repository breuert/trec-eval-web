/**
 * Number formatting that matches C `printf("%.4f")`, which trec_eval uses for every
 * value: exact ties round to even, while JavaScript's `toFixed` rounds them away from
 * zero (1/32 → "0.0312" vs "0.0313").
 */
export function formatFixed(x: number, digits = 4): string {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  const sign = x < 0 || Object.is(x, -0) ? '-' : '';
  const abs = Math.abs(x);
  let text = abs.toFixed(digits);
  if (abs < 1e15) {
    const long = abs.toFixed(Math.min(100, digits + 30));
    const dot = long.indexOf('.');
    const tail = long.slice(dot + 1 + digits);
    if (/^50*$/.test(tail)) {
      // An exact tie: keep the truncated value if its last digit is even, else round up.
      const truncated = long.slice(0, digits > 0 ? dot + 1 + digits : dot);
      const lastDigit = Number(truncated[truncated.length - 1] ?? '0');
      if (lastDigit % 2 === 0) {
        text = truncated;
      } else {
        const units = BigInt(truncated.replace('.', '')) + 1n;
        const s = units.toString().padStart(digits + 1, '0');
        text = digits > 0 ? `${s.slice(0, s.length - digits)}.${s.slice(s.length - digits)}` : s;
      }
    }
  }
  return sign + text;
}

/** C `printf("%-22s")`: pad on the right, never truncate. */
export function padRight(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}
