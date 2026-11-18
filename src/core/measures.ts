/**
 * The trec_eval measures this tool computes, in trec_eval's output order
 * (`te_trec_measures` in measures.c).
 *
 * Supported: the `all_trec` set of trec_eval 10 except `Rprec_mult` (its cutoff rounding
 * depends on the CPU), `rbp` (reads uninitialized memory in trec_eval 10), `rbp_resid`,
 * and the gain-based `G`, `binG`, `Rndcg` and `ndcg_rel`. The `official` set (trec_eval's
 * default output) and the `set` set are complete.
 *
 * Measures with rank cutoffs (P, recall, ndcg_cut, map_cut, relative_P, success, unj)
 * use trec_eval's default cutoffs or one custom list for all of them (`-m P.1,2,3`).
 */

export type FamilyId =
  | 'runid'
  | 'num_q'
  | 'num_ret'
  | 'num_rel'
  | 'num_rel_ret'
  | 'map'
  | 'gm_map'
  | 'Rprec'
  | 'bpref'
  | 'recip_rank'
  | 'iprec_at_recall'
  | 'P'
  | 'relstring'
  | 'recall'
  | 'infAP'
  | 'gm_bpref'
  | 'utility'
  | '11pt_avg'
  | 'ndcg'
  | 'ndcg_cut'
  | 'map_cut'
  | 'relative_P'
  | 'success'
  | 'set_P'
  | 'set_relative_P'
  | 'set_recall'
  | 'set_map'
  | 'set_F'
  | 'num_nonrel_judged_ret'
  | 'unj';

/** Families whose cutoffs are ranks. */
export type CutoffFamilyId = 'P' | 'recall' | 'ndcg_cut' | 'map_cut' | 'relative_P' | 'success' | 'unj';

export type GroupId = 'counts' | 'ranked' | 'cutoff' | 'iprec' | 'set';

/**
 * How trec_eval prints a family and combines topics:
 * - `mean`: printed per topic and as the arithmetic mean (`te_calc_avg_meas_s`),
 * - `sum`: printed per topic as an integer and summed (`num_ret`, ...),
 * - `gm`: geometric mean of max(value, 0.00001), printed only as a summary,
 * - `num_q`: number of topics, summary only; `runid`: summary only; `relstring`: per topic only.
 */
export type Aggregation = 'mean' | 'sum' | 'gm' | 'num_q' | 'runid' | 'relstring';

export interface FamilyDef {
  readonly id: FamilyId;
  readonly aggregation: Aggregation;
  readonly group: GroupId;
  /** Short name for charts and tables. */
  readonly label: string;
  /** One-line explanation, after trec_eval's help text. */
  readonly description: string;
  /** Which values are better (marks the best run in tables); counts have no direction. */
  readonly better: 'higher' | 'lower' | 'none';
  readonly cutoffs?: 'rank' | 'recall';
}

const fam = (
  id: FamilyId,
  aggregation: Aggregation,
  group: GroupId,
  label: string,
  description: string,
  better: FamilyDef['better'] = 'higher',
  cutoffs?: 'rank' | 'recall',
): FamilyDef => ({ id, aggregation, group, label, description, better, ...(cutoffs ? { cutoffs } : {}) });

export const FAMILIES: readonly FamilyDef[] = [
  fam('runid', 'runid', 'counts', 'Run id', 'Run id given by the results file (tag of its last line).', 'none'),
  fam('num_q', 'num_q', 'counts', 'Topics', 'Number of topics averaged over (with -c, all topics of the qrels).', 'none'),
  fam('num_ret', 'sum', 'counts', 'Retrieved', 'Number of documents retrieved. Summary: sum over topics.', 'none'),
  fam('num_rel', 'sum', 'counts', 'Relevant', 'Number of relevant documents. Summary: sum over topics.', 'none'),
  fam('num_rel_ret', 'sum', 'counts', 'Relevant retrieved', 'Number of relevant documents retrieved. Summary: sum over topics.'),
  fam('map', 'mean', 'ranked', 'AP', 'Mean average precision: mean of the precision after each relevant document is retrieved; unretrieved relevant documents count as 0.'),
  fam('gm_map', 'gm', 'ranked', 'GM-AP', 'Geometric mean of average precision over topics (values below 0.00001 count as 0.00001). Summary only.'),
  fam('Rprec', 'mean', 'ranked', 'R-precision', 'Precision after R documents have been retrieved, R being the number of relevant documents.'),
  fam('bpref', 'mean', 'ranked', 'bpref', 'Binary preference: fraction of judged non-relevant documents ranked above each relevant one. Only judged documents count.'),
  fam('recip_rank', 'mean', 'ranked', 'RR', 'Reciprocal rank of the first relevant document (mean: MRR).'),
  fam('iprec_at_recall', 'mean', 'iprec', 'Interpolated precision', 'Interpolated precision at recall levels: the highest precision at any recall at or above the level.', 'higher', 'recall'),
  fam('P', 'mean', 'cutoff', 'P@k', 'Precision at rank cutoffs. Missing ranks below the cutoff count as non-relevant.', 'higher', 'rank'),
  fam('relstring', 'relstring', 'counts', 'Relevance string', 'Labels of the first 10 retrieved documents: 0–9, ">" above 9, "-" not judged, "." judged with a negative label. Per topic only.', 'none'),
  fam('recall', 'mean', 'cutoff', 'Recall@k', 'Recall at rank cutoffs: fraction of the relevant documents retrieved in the top k.', 'higher', 'rank'),
  fam('infAP', 'mean', 'ranked', 'infAP', 'Inferred AP (Yilmaz and Aslam): estimates AP from incomplete judgements; documents labelled -1 were pooled but not judged.'),
  fam('gm_bpref', 'gm', 'ranked', 'GM-bpref', 'Geometric mean of bpref over topics. Summary only.'),
  fam('utility', 'mean', 'set', 'Utility', 'Set utility with the default coefficients: relevant retrieved minus non-relevant retrieved.'),
  fam('11pt_avg', 'mean', 'iprec', '11-point average', 'Interpolated precision averaged over the recall levels 0.0, 0.1, …, 1.0.'),
  fam('ndcg', 'mean', 'ranked', 'nDCG', 'Normalized discounted cumulative gain over the whole ranking, gain = relevance label (Järvelin and Kekäläinen).'),
  fam('ndcg_cut', 'mean', 'cutoff', 'nDCG@k', 'nDCG at rank cutoffs; the ideal ranking is cut at the same rank.', 'higher', 'rank'),
  fam('map_cut', 'mean', 'cutoff', 'AP@k', 'Average precision at rank cutoffs, normalized by the number of relevant documents.', 'higher', 'rank'),
  fam('relative_P', 'mean', 'cutoff', 'Relative P@k', 'Precision at cutoffs relative to the best possible precision: precision up to R, recall after it.', 'higher', 'rank'),
  fam('success', 'mean', 'cutoff', 'Success@k', 'Whether a relevant document was retrieved in the top k (1 or 0).', 'higher', 'rank'),
  fam('set_P', 'mean', 'set', 'Set P', 'Precision of the whole retrieved set.'),
  fam('set_relative_P', 'mean', 'set', 'Set relative P', 'Relevant retrieved divided by the smaller of retrieved and relevant.'),
  fam('set_recall', 'mean', 'set', 'Set recall', 'Recall of the whole retrieved set.'),
  fam('set_map', 'mean', 'set', 'Set AP', 'Set precision times set recall.'),
  fam('set_F', 'mean', 'set', 'Set F1', 'Harmonic mean of set precision and set recall (beta = 1).'),
  fam('num_nonrel_judged_ret', 'sum', 'counts', 'Non-relevant judged retrieved', 'Number of judged non-relevant documents retrieved. Summary: sum over topics.', 'none'),
  fam('unj', 'mean', 'cutoff', 'Unjudged@k', 'Fraction of the top k documents that are not judged ("red flag": high values mean the run is poorly covered by the qrels).', 'lower', 'rank'),
];

export const FAMILY = new Map(FAMILIES.map((f) => [f.id, f]));

export const CUTOFF_FAMILIES: readonly CutoffFamilyId[] = ['P', 'recall', 'ndcg_cut', 'map_cut', 'relative_P', 'success', 'unj'];

/** trec_eval's default cutoffs per family. */
export const DEFAULT_CUTOFFS: Readonly<Record<CutoffFamilyId, readonly number[]>> = {
  P: [5, 10, 15, 20, 30, 100, 200, 500, 1000],
  recall: [5, 10, 15, 20, 30, 100, 200, 500, 1000],
  ndcg_cut: [5, 10, 15, 20, 30, 100, 200, 500, 1000],
  map_cut: [5, 10, 15, 20, 30, 100, 200, 500, 1000],
  relative_P: [5, 10, 15, 20, 30, 100, 200, 500, 1000],
  success: [1, 5, 10],
  unj: [5, 10, 20],
};

/** Recall levels of iprec_at_recall and 11pt_avg (trec_eval defaults). */
export const RECALL_LEVELS: readonly number[] = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

/** Length of relstring (trec_eval default). */
export const RELSTRING_LENGTH = 10;

/** `official`: what trec_eval prints without -m. */
export const OFFICIAL: ReadonlySet<FamilyId> = new Set<FamilyId>(['runid', 'num_q', 'num_ret', 'num_rel', 'num_rel_ret', 'map', 'gm_map', 'Rprec', 'bpref', 'recip_rank', 'iprec_at_recall', 'P']);

/** `set`: the unranked measures. */
export const SET_MEASURES: ReadonlySet<FamilyId> = new Set<FamilyId>(['runid', 'num_q', 'num_ret', 'num_rel', 'num_rel_ret', 'utility', 'set_P', 'set_recall', 'set_relative_P', 'set_map', 'set_F']);

/** Every supported family (the supported part of `all_trec`). */
export const ALL: ReadonlySet<FamilyId> = new Set(FAMILIES.map((f) => f.id));

export const GROUPS: ReadonlyArray<{ readonly id: GroupId; readonly label: string }> = [
  { id: 'counts', label: 'Counts' },
  { id: 'ranked', label: 'Ranking measures' },
  { id: 'cutoff', label: 'At rank cutoffs' },
  { id: 'iprec', label: 'Interpolated precision' },
  { id: 'set', label: 'Set-based' },
];

/** Cutoffs to use: trec_eval's defaults, or one list for every cutoff family. */
export type CutoffSetting = { readonly mode: 'default' } | { readonly mode: 'custom'; readonly values: readonly number[] };

export type Cutoffs = Readonly<Record<CutoffFamilyId, readonly number[]>>;

export function resolveCutoffs(setting: CutoffSetting): Cutoffs {
  if (setting.mode === 'default') return DEFAULT_CUTOFFS;
  const values = normalizeCutoffs(setting.values);
  return Object.fromEntries(CUTOFF_FAMILIES.map((f) => [f, values])) as unknown as Cutoffs;
}

/** Sorted, de-duplicated positive integers (trec_eval sorts cutoffs and rejects duplicates). */
export function normalizeCutoffs(values: readonly number[]): number[] {
  return [...new Set(values.filter((v) => Number.isInteger(v) && v > 0))].sort((a, b) => a - b);
}

/** Parse "1, 2, 5-10" into cutoffs; undefined if anything is not a positive integer. */
export function parseCutoffList(text: string): number[] | undefined {
  const out: number[] = [];
  for (const part of text.split(/[\s,;]+/).filter(Boolean)) {
    const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(part);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (!(a > 0 && b >= a && b - a <= 10_000)) return undefined;
      for (let k = a; k <= b; k++) out.push(k);
    } else if (/^\d+$/.test(part) && Number(part) > 0) {
      out.push(Number(part));
    } else {
      return undefined;
    }
  }
  const values = normalizeCutoffs(out);
  return values.length > 0 && values.length <= 2000 ? values : undefined;
}

/** One numeric value per topic and in the summary (runid and relstring are strings). */
export interface MeasureDef {
  /** Index into value arrays. */
  readonly index: number;
  /** trec_eval name, e.g. `P_10`, `iprec_at_recall_0.30`, `ndcg`. */
  readonly name: string;
  readonly family: FamilyDef;
  /** Rank cutoff or recall level. */
  readonly cutoff?: number;
}

export interface MeasureSet {
  readonly measures: readonly MeasureDef[];
  readonly cutoffs: Cutoffs;
  /** First index and number of values of each numeric family. */
  readonly offset: ReadonlyMap<FamilyId, number>;
  readonly byName: ReadonlyMap<string, MeasureDef>;
  /** Measures of a family, in cutoff order. */
  readonly ofFamily: (id: FamilyId) => readonly MeasureDef[];
}

/** C `%3.2f` of a recall level. */
export const recallName = (level: number): string => level.toFixed(2);

export function buildMeasureSet(setting: CutoffSetting): MeasureSet {
  const cutoffs = resolveCutoffs(setting);
  const measures: MeasureDef[] = [];
  const offset = new Map<FamilyId, number>();
  const groups = new Map<FamilyId, MeasureDef[]>();
  const add = (family: FamilyDef, name: string, cutoff?: number): void => {
    const m: MeasureDef = { index: measures.length, name, family, ...(cutoff !== undefined ? { cutoff } : {}) };
    measures.push(m);
    const list = groups.get(family.id) ?? [];
    list.push(m);
    groups.set(family.id, list);
  };
  for (const family of FAMILIES) {
    if (family.aggregation === 'runid' || family.aggregation === 'relstring') continue;
    offset.set(family.id, measures.length);
    if (family.cutoffs === 'rank') {
      for (const k of cutoffs[family.id as CutoffFamilyId]) add(family, `${family.id}_${k}`, k);
    } else if (family.cutoffs === 'recall') {
      for (const r of RECALL_LEVELS) add(family, `${family.id}_${recallName(r)}`, r);
    } else {
      add(family, family.id);
    }
  }
  return {
    measures,
    cutoffs,
    offset,
    byName: new Map(measures.map((m) => [m.name, m])),
    ofFamily: (id) => groups.get(id) ?? [],
  };
}
