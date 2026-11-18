/**
 * trec_eval's text output (`meas_print_single.c`, `meas_print_final.c`, `m_runid.c`,
 * `m_relstring.c`), the equivalent command line, and CSV/JSON exports.
 */
import { printedPerTopic } from './evaluate.ts';
import type { EvalSettings, RunEvaluation } from './evaluate.ts';
import { formatFixed, padRight } from './format.ts';
import { ALL, CUTOFF_FAMILIES, DEFAULT_CUTOFFS, FAMILIES, OFFICIAL, SET_MEASURES } from './measures.ts';
import type { FamilyId } from './measures.ts';

/** trec_eval's measure nicknames that this tool can print completely, plus all it supports. */
export type MeasureSelection = 'official' | 'set' | 'all';

export const SELECTIONS: Readonly<Record<MeasureSelection, ReadonlySet<FamilyId>>> = { official: OFFICIAL, set: SET_MEASURES, all: ALL };

/** The all_trec measures this tool does not compute. */
export const UNSUPPORTED_ALL_TREC = ['Rprec_mult', 'binG', 'G', 'Rndcg', 'ndcg_rel', 'rbp', 'rbp_resid'] as const;

export interface TextOptions {
  readonly selection: MeasureSelection;
  /** `-q`: also print every topic. */
  readonly perTopic: boolean;
}

const line = (name: string, topic: string, value: string): string => `${padRight(name, 22)}\t${topic}\t${value}\n`;
const long = (v: number): string => String(Math.trunc(v));
/** C `%6.4f` (the width only matters for nan and inf; x86 Linux would print -nan for 0/0). */
const double = (v: number): string => formatFixed(v).padStart(6);

/** What `trec_eval [-q] -m <selection> qrels run` prints. */
export function trecEvalText(ev: RunEvaluation, options: TextOptions): string {
  const families = FAMILIES.filter((f) => SELECTIONS[options.selection].has(f.id));
  let out = '';
  if (options.perTopic) {
    for (const t of ev.topics) {
      for (const f of families) {
        if (f.aggregation === 'relstring') {
          out += line(f.id, t.topic, `'${t.relstring}'`);
        } else if (printedPerTopic(f)) {
          for (const m of ev.set.ofFamily(f.id)) out += line(m.name, t.topic, f.aggregation === 'sum' ? long(t.values[m.index] as number) : double(t.values[m.index] as number));
        }
      }
    }
  }
  for (const f of families) {
    switch (f.aggregation) {
      case 'runid':
        out += line('runid', 'all', ev.runId);
        break;
      case 'relstring':
        break;
      case 'sum':
      case 'num_q':
        for (const m of ev.set.ofFamily(f.id)) out += line(m.name, 'all', long(ev.summary[m.index] as number));
        break;
      default:
        for (const m of ev.set.ofFamily(f.id)) out += line(m.name, 'all', double(ev.summary[m.index] as number));
    }
  }
  return out;
}

const shellQuote = (s: string): string => (/^[\w./:@%+=,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** The trec_eval 10 command that prints the same output (for the supported measures). */
export function commandLine(settings: EvalSettings, options: TextOptions, qrelsFile: string, runFile: string): string {
  const args = ['trec_eval'];
  if (options.perTopic) args.push('-q');
  if (settings.averageComplete) args.push('-c');
  if (settings.relevanceLevel !== 1) args.push(`-l${settings.relevanceLevel}`);
  if (Number.isFinite(settings.maxDocsPerTopic)) args.push(`-M${settings.maxDocsPerTopic}`);
  if (settings.judgedDocsOnly) args.push('-J');
  args.push('-m', options.selection === 'all' ? 'all_trec' : options.selection);
  if (settings.cutoffs.mode === 'custom') {
    const values = settings.cutoffs.values.join(',');
    for (const f of CUTOFF_FAMILIES) {
      if (SELECTIONS[options.selection].has(f) && values !== DEFAULT_CUTOFFS[f].join(',')) args.push('-m', `${f}.${values}`);
    }
  }
  args.push(shellQuote(qrelsFile || 'qrels.txt'), shellQuote(runFile || 'run.txt'));
  return args.join(' ');
}

const csvQuote = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const num = (v: number): string => (Number.isNaN(v) ? 'NaN' : String(v));

export interface NamedEvaluation {
  readonly name: string;
  readonly fileName: string;
  readonly evaluation: RunEvaluation;
}

/** One row per run and summary measure, at full precision. */
export function summaryCsv(runs: readonly NamedEvaluation[]): string {
  const rows = ['run,runid,measure,value'];
  for (const r of runs) {
    for (const m of r.evaluation.set.measures) rows.push([r.name, r.evaluation.runId, m.name, num(r.evaluation.summary[m.index] as number)].map(csvQuote).join(','));
  }
  return rows.join('\n') + '\n';
}

/** One row per run, topic and measure that trec_eval prints per topic, at full precision. */
export function topicsCsv(runs: readonly NamedEvaluation[]): string {
  const rows = ['run,topic,measure,value'];
  for (const r of runs) {
    const measures = r.evaluation.set.measures.filter((m) => printedPerTopic(m.family));
    for (const t of r.evaluation.topics) {
      for (const m of measures) rows.push([r.name, t.topic, m.name, num(t.values[m.index] as number)].map(csvQuote).join(','));
    }
  }
  return rows.join('\n') + '\n';
}

const jsonNumber = (v: number): number | string => (Number.isFinite(v) ? v : String(v));

export function resultsJson(runs: readonly NamedEvaluation[], qrelsFile: string, perTopic: boolean): unknown {
  const first = runs[0]?.evaluation;
  const settings = first?.settings;
  return {
    generator: 'trec_eval web (a port of trec_eval 10)',
    qrels: qrelsFile,
    settings: settings && {
      relevance_level: settings.relevanceLevel,
      max_docs_per_topic: Number.isFinite(settings.maxDocsPerTopic) ? settings.maxDocsPerTopic : null,
      judged_docs_only: settings.judgedDocsOnly,
      average_complete: settings.averageComplete,
      iprec_rounding: settings.iprecRounding,
      cutoffs: first?.set.cutoffs,
    },
    runs: runs.map((r) => {
      const ev = r.evaluation;
      const perTopicMeasures = ev.set.measures.filter((m) => printedPerTopic(m.family));
      return {
        name: r.name,
        file: r.fileName,
        runid: ev.runId,
        summary: Object.fromEntries(ev.set.measures.map((m) => [m.name, jsonNumber(ev.summary[m.index] as number)])),
        skipped_topics: ev.skippedTopics,
        ignored_topics: ev.ignoredTopics,
        ...(perTopic
          ? {
              topics: Object.fromEntries(
                ev.topics.map((t) => [t.topic, { ...Object.fromEntries(perTopicMeasures.map((m) => [m.name, jsonNumber(t.values[m.index] as number)])), relstring: t.relstring }]),
              ),
            }
          : {}),
      };
    }),
  };
}
