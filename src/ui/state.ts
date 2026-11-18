import { DEFAULT_SETTINGS } from '../core/evaluate.ts';
import type { EvalSettings, RunEvaluation } from '../core/evaluate.ts';
import { GROUPS } from '../core/measures.ts';
import type { CutoffFamilyId, GroupId } from '../core/measures.ts';
import type { MeasureSelection } from '../core/output.ts';
import type { ParsedQrels, ParsedRun } from '../core/trec-format.ts';

export interface FileSlot<T> {
  readonly status: 'empty' | 'loading' | 'ready' | 'error';
  readonly fileName?: string;
  readonly size?: number;
  readonly data?: T;
  readonly error?: string;
}

export const EMPTY: FileSlot<never> = { status: 'empty' };

/** At most eight runs: one per categorical color, never a generated ninth hue. */
export const MAX_RUNS = 8;

export interface RunSlot {
  readonly id: number;
  /** Palette slot, fixed while the run is loaded (color follows the run, not its position). */
  readonly color: number;
  slot: FileSlot<ParsedRun>;
}

/** The evaluation of one run, or why it failed. */
export interface RunResult {
  readonly id: number;
  readonly color: number;
  readonly name: string;
  readonly fileName: string;
  readonly evaluation?: RunEvaluation;
  readonly error?: string;
}

export type TabId = 'summary' | 'cutoffs' | 'topics' | 'output';
export const TABS: readonly TabId[] = ['summary', 'cutoffs', 'topics', 'output'];

export interface ViewState {
  tab: TabId;
  groups: Set<GroupId>;
  /** Panels of the cutoff chart. */
  families: Set<CutoffFamilyId>;
  /** Measure shown per topic (trec_eval name). */
  focus: string;
  topicOrder: 'topic' | 'value';
  /** Run ids compared per topic: `compare` minus `baseline`. */
  baseline: number;
  compare: number;
  outputRun: number;
  selection: MeasureSelection;
  perTopic: boolean;
}

export interface AppState {
  qrels: FileSlot<ParsedQrels>;
  runs: RunSlot[];
  settings: EvalSettings;
  /** Text of the custom cutoff field (kept while it is invalid). */
  cutoffText: string;
  demo: boolean;
  busy: boolean;
  setupCollapsed: boolean;
  /** The options panel of the setup is expanded. */
  optionsOpen: boolean;
  results?: RunResult[] | undefined;
  error?: string | undefined;
  view: ViewState;
}

/** Suggested custom cutoffs: every rank of the first page, then trec_eval's deeper ones. */
export const DEFAULT_CUSTOM_CUTOFFS = '1-20, 30, 50, 100, 200, 500, 1000';

let nextId = 1;

export function newRun(slot: FileSlot<ParsedRun>, taken: readonly RunSlot[]): RunSlot {
  const used = new Set(taken.map((r) => r.color));
  let color = 0;
  while (used.has(color)) color++;
  return { id: nextId++, color, slot };
}

export function initialState(): AppState {
  return {
    qrels: EMPTY,
    runs: [],
    settings: { ...DEFAULT_SETTINGS },
    cutoffText: DEFAULT_CUSTOM_CUTOFFS,
    demo: false,
    busy: false,
    setupCollapsed: false,
    optionsOpen: false,
    view: {
      tab: 'summary',
      groups: new Set(GROUPS.map((g) => g.id)),
      families: new Set<CutoffFamilyId>(['P', 'recall', 'ndcg_cut', 'map_cut']),
      focus: 'map',
      topicOrder: 'topic',
      baseline: 0,
      compare: 0,
      outputRun: 0,
      selection: 'official',
      perTopic: false,
    },
  };
}

/** Display names: the run id, or the file name where run ids repeat. */
export function runNames(runs: readonly RunSlot[]): Map<number, string> {
  const ids = runs.map((r) => r.slot.data?.info.runId ?? r.slot.fileName ?? 'run');
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return new Map(
    runs.map((r, i) => {
      const id = ids[i] as string;
      const file = (r.slot.fileName ?? '').replace(/\.(gz|txt|run|trec|res)$/gi, '').replace(/\.(txt|run|trec|res)$/i, '');
      return [r.id, (counts.get(id) ?? 0) > 1 && file ? file : id];
    }),
  );
}
