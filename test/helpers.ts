import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { DEFAULT_SETTINGS } from '../src/core/evaluate.ts';
import type { EvalSettings } from '../src/core/evaluate.ts';
import { parseCutoffList } from '../src/core/measures.ts';
import type { MeasureSelection } from '../src/core/output.ts';
import type { IprecRounding } from '../src/core/trec-eval.ts';

const FIXTURES = new URL('./fixtures/', import.meta.url);

export function fixtureText(path: string): string {
  const bytes = readFileSync(new URL(path, FIXTURES));
  return (path.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8');
}

export interface Case {
  readonly name: string;
  readonly version: 9 | 10;
  readonly rounding?: IprecRounding;
  readonly args: readonly string[];
  readonly qrels: string;
  readonly run: string;
  readonly exit: number;
  readonly stdout?: string;
  readonly full?: string;
  readonly stderr?: string;
}

export interface Manifest {
  readonly trec_eval: string;
  readonly machine: string;
  readonly cases: readonly Case[];
}

export const manifest = JSON.parse(fixtureText('manifest.json')) as Manifest;

export interface Invocation {
  readonly settings: EvalSettings;
  readonly selection: MeasureSelection;
  readonly perTopic: boolean;
}

/** The settings a trec_eval command line asks for (the subset of flags the fixtures use). */
export function parseArgs(args: readonly string[], rounding: IprecRounding = 'v10'): Invocation {
  let settings: EvalSettings = { ...DEFAULT_SETTINGS, iprecRounding: rounding };
  let selection: MeasureSelection = 'official';
  let perTopic = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    let m: RegExpExecArray | null;
    if (a === '-q') perTopic = true;
    else if (a === '-c') settings = { ...settings, averageComplete: true };
    else if (a === '-J') settings = { ...settings, judgedDocsOnly: true };
    else if ((m = /^-l(\d+)$/.exec(a))) settings = { ...settings, relevanceLevel: Number(m[1]) };
    else if ((m = /^-M(\d+)$/.exec(a))) settings = { ...settings, maxDocsPerTopic: Number(m[1]) };
    else if (a === '-m') {
      const value = args[++i] as string;
      const param = /^\w+\.(.+)$/.exec(value);
      if (param) {
        const values = parseCutoffList(param[1] as string);
        if (!values) throw new Error(`bad cutoffs ${value}`);
        settings = { ...settings, cutoffs: { mode: 'custom', values } };
      } else if (value === 'all_trec') selection = 'all';
      else if (value === 'official' || value === 'set') selection = value;
    } else throw new Error(`unsupported argument ${a}`);
  }
  return { settings, selection, perTopic };
}

/** `measure → topic → value` from trec_eval output (numbers, or the quoted relstring). */
export function parseOutput(text: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const line of text.split('\n')) {
    if (!line) continue;
    const [name, topic, value] = line.split('\t') as [string, string, string];
    const key = name.trimEnd();
    let byTopic = out.get(key);
    if (!byTopic) {
      byTopic = new Map();
      out.set(key, byTopic);
    }
    byTopic.set(topic, value);
  }
  return out;
}

/** |actual − expected| ≤ abs + rel·|expected|, with NaN equal to NaN. */
export function isClose(actual: number, expected: number, abs = 1e-13, rel = 1e-13): boolean {
  if (Number.isNaN(expected)) return Number.isNaN(actual);
  if (!Number.isFinite(expected)) return actual === expected;
  return Math.abs(actual - expected) <= abs + rel * Math.abs(expected);
}
