/**
 * Evaluation of a whole run, as `trec_eval.c` does it: the topic loop, `-c`, and the
 * summary line of every measure (`meas_acc.c`, `meas_avg.c`, `m_num_q.c`, `m_num_rel.c`).
 *
 * Topics are evaluated in the order of the qrels (sorted by topic id); topics of the run
 * without judgements are ignored. trec_eval 10 stops when a judged topic has no results
 * and -c is not given; like trec_eval 9 (and as trec_eval's documentation describes) this
 * tool then evaluates the topics both files contain and reports the skipped ones.
 */
import { buildMeasureSet } from './measures.ts';
import type { CutoffSetting, FamilyDef, MeasureSet } from './measures.ts';
import { MIN_GEO_MEAN, TrecEvalError, evaluateResRels, formResRels, relString } from './trec-eval.ts';
import type { TopicOptions } from './trec-eval.ts';
import type { ParsedQrels, ParsedRun, Ranking } from './trec-format.ts';

export interface EvalSettings extends TopicOptions {
  /** `-c`: average over every topic of the qrels; topics without results score 0. */
  readonly averageComplete: boolean;
  readonly cutoffs: CutoffSetting;
}

export const DEFAULT_SETTINGS: EvalSettings = {
  relevanceLevel: 1,
  maxDocsPerTopic: Infinity,
  judgedDocsOnly: false,
  iprecRounding: 'v10',
  averageComplete: false,
  cutoffs: { mode: 'default' },
};

export interface TopicResult {
  readonly topic: string;
  /** Per-topic values, indexed like `set.measures`. */
  readonly values: Float64Array;
  readonly relstring: string;
  /** Evaluated with -c although the run has no results for the topic. */
  readonly filled: boolean;
}

export interface RunEvaluation {
  readonly runId: string;
  readonly set: MeasureSet;
  readonly settings: EvalSettings;
  readonly topics: readonly TopicResult[];
  /** Summary ("all") values, indexed like `set.measures`. */
  readonly summary: Float64Array;
  /** Judged topics without results that were not evaluated (no -c). */
  readonly skippedTopics: readonly string[];
  /** Topics of the run that the qrels do not contain. */
  readonly ignoredTopics: readonly string[];
}

/** trec_eval's stand-in ranking for a judged topic without results under -c. */
const BOGUS_RANKING: Ranking = [{ docId: 'ceci_nest_pas_un_docno', score: 1.0 }];

export function evaluateRun(parsed: ParsedRun, qrels: ParsedQrels, settings: EvalSettings = DEFAULT_SETTINGS, set: MeasureSet = buildMeasureSet(settings.cutoffs)): RunEvaluation {
  const { run } = parsed;
  const n = set.measures.length;
  const topics: TopicResult[] = [];
  const skippedTopics: string[] = [];
  const accum = new Float64Array(n);
  const cleared = set.measures.filter((m) => m.family.id === 'num_ret' || m.family.id === 'utility' || m.family.id === 'unj').map((m) => m.index);

  for (const [topic, judgements] of qrels.qrels) {
    let ranking = run.get(topic);
    const filled = ranking === undefined;
    if (ranking === undefined) {
      if (!settings.averageComplete) {
        skippedTopics.push(topic);
        continue;
      }
      ranking = BOGUS_RANKING;
    }
    const rr = formResRels(topic, ranking, judgements, settings);
    const values = evaluateResRels(rr, set, settings);
    let relstring = relString(rr);
    if (filled) {
      // trec_eval.c "cleans up leftovers" of the stand-in ranking.
      for (const i of cleared) values[i] = 0;
      relstring = '';
    }
    for (let i = 0; i < n; i++) accum[i] = (accum[i] as number) + (values[i] as number);
    topics.push({ topic, values, relstring, filled });
  }

  if (topics.length === 0) {
    throw new TrecEvalError('No topics with both results and relevance judgements. Do the topic ids of the run match the qrels?');
  }

  const evaluated = topics.length;
  const numQueries = settings.averageComplete ? qrels.qrels.size : evaluated;
  const summary = new Float64Array(n);
  for (const m of set.measures) {
    const value = accum[m.index] as number;
    switch (m.family.aggregation) {
      case 'mean':
        summary[m.index] = value / numQueries;
        break;
      case 'sum':
        // m_num_rel.c: with -c, count the qrels' positive labels instead (sic: not -l).
        summary[m.index] = m.family.id === 'num_rel' && settings.averageComplete ? qrels.info.numRelevant : value;
        break;
      case 'gm':
        summary[m.index] = Math.exp((value + (settings.averageComplete ? (numQueries - evaluated) * Math.log(MIN_GEO_MEAN) : 0)) / numQueries);
        break;
      case 'num_q':
        summary[m.index] = numQueries;
        break;
      default:
        break;
    }
  }

  const ignoredTopics = [...run.keys()].filter((topic) => !qrels.qrels.has(topic));
  return { runId: parsed.info.runId, set, settings, topics, summary, skippedTopics, ignoredTopics };
}

/** Whether trec_eval prints a numeric measure for single topics (`-q`). */
export function printedPerTopic(family: FamilyDef): boolean {
  return family.aggregation === 'mean' || family.aggregation === 'sum';
}
