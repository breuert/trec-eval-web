import type { EvalSettings } from '../core/evaluate.ts';
import { parseCutoffList } from '../core/measures.ts';
import type { IprecRounding } from '../core/trec-eval.ts';
import type { ParsedQrels, ParsedRun } from '../core/trec-format.ts';
import { SHAPES, seriesKey } from './charts.ts';
import { h, icon } from './dom.ts';
import { fileSize } from './files.ts';
import { fmtInt, plural } from './format.ts';
import { MAX_RUNS, runNames } from './state.ts';
import type { AppState, FileSlot, RunResult } from './state.ts';

export interface SetupActions {
  loadQrels(file: File): void;
  clearQrels(): void;
  addRuns(files: readonly File[]): void;
  replaceRun(id: number, file: File): void;
  removeRun(id: number): void;
  updateSettings(patch: Partial<EvalSettings>): void;
  setCutoffMode(mode: 'default' | 'custom'): void;
  setCutoffText(text: string): void;
  loadDemo(): void;
  clearAll(): void;
  setCollapsed(collapsed: boolean): void;
}

interface SlotOptions<T> {
  readonly title: string;
  readonly slot: FileSlot<T>;
  readonly describe: (data: T) => string;
  readonly warning?: (data: T) => string | undefined;
  /** An evaluation error of this file. */
  readonly error?: string | undefined;
  readonly onFiles: (files: File[]) => void;
  readonly onClear?: () => void;
  readonly key: string;
  readonly multiple?: boolean;
  readonly marker?: SVGSVGElement;
  readonly emptyText?: string;
}

function fileSlot<T>(o: SlotOptions<T>): HTMLElement {
  const { slot } = o;
  const input = h('input', { type: 'file', multiple: o.multiple === true, 'aria-label': o.multiple ? 'Choose run files' : `Choose the ${o.title.toLowerCase()} file`, 'data-key': o.key });
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    if (files.length > 0) o.onFiles(files);
    input.value = '';
  });

  let detail: string;
  let title: string | undefined;
  const meta: HTMLElement[] = [];
  const failed = slot.status === 'error' || o.error !== undefined;
  if (slot.status === 'loading') detail = `Reading ${slot.fileName ?? 'file'} …`;
  else if (slot.status === 'error') detail = `${slot.fileName ?? 'File'}: ${slot.error ?? 'could not be read'}`;
  else if (slot.status === 'ready' && slot.data !== undefined) {
    detail = slot.fileName ?? '';
    title = `${slot.fileName ?? ''} (${fileSize(slot.size ?? 0)})`;
    meta.push(h('span', { class: 'slot-meta' }, o.describe(slot.data)));
    const warning = o.warning?.(slot.data);
    if (warning) meta.push(h('span', { class: 'slot-meta warn' }, warning));
    if (o.error) meta.push(h('span', { class: 'slot-meta err' }, o.error));
  } else detail = o.emptyText ?? 'Drop a file here or click to browse';

  const filled = slot.status === 'ready';
  const actions = h('div', { class: 'slot-actions' });
  if (filled || slot.status === 'error') {
    const replace = h('button', { class: 'btn ghost small', type: 'button' }, 'Replace');
    replace.addEventListener('click', () => input.click());
    actions.append(replace);
  }
  if (o.onClear && slot.status !== 'empty') {
    const remove = h('button', { class: 'btn ghost small icon', type: 'button', title: 'Remove', 'aria-label': `Remove ${o.title}` }, icon('x', 14));
    remove.addEventListener('click', o.onClear);
    actions.append(remove);
  }

  const root = h(
    'div',
    { class: `slot${filled ? ' filled' : ''}${failed ? ' error' : ''}` },
    h('div', { class: 'slot-icon' }, o.marker ?? icon(failed ? 'alert' : filled ? 'check' : o.multiple ? 'plus' : 'file', 18)),
    h('div', { class: 'slot-text' }, h('span', { class: 'slot-title' }, o.title), h('span', { class: 'slot-detail', title }, detail), meta),
    actions,
    input,
  );
  root.addEventListener('dragover', (e) => {
    e.preventDefault();
    root.classList.add('dragover');
  });
  root.addEventListener('dragleave', () => root.classList.remove('dragover'));
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    root.classList.remove('dragover');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length > 0) o.onFiles(o.multiple ? files : files.slice(0, 1));
  });
  return root;
}

const describeRun = (r: ParsedRun): string => `${plural(r.info.numTopics, 'topic')} · ${fmtInt(r.info.numLines)} lines · up to ${fmtInt(r.info.maxDepth)} per topic`;

function runWarning(r: ParsedRun): string | undefined {
  const parts: string[] = [];
  if (r.info.duplicates > 0 && r.info.firstDuplicate) parts.push(`${plural(r.info.duplicates, 'repeated document')} (first: "${r.info.firstDuplicate.docId}" in topic ${r.info.firstDuplicate.topic}, line ${r.info.firstDuplicate.line})`);
  if (r.info.nonNumericScores > 0) parts.push(`${plural(r.info.nonNumericScores, 'score')} not a number (read like C atof)`);
  if (r.info.extraColumns > 0) parts.push(`${plural(r.info.extraColumns, 'line')} with more than six columns (rest ignored)`);
  if (r.info.tags.length > 1) parts.push(`${r.info.tags.length} different tags; trec_eval reports the last one`);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

const describeQrels = (q: ParsedQrels): string =>
  `${plural(q.info.numTopics, 'topic')} · ${fmtInt(q.info.numLines)} judgements · labels ${[...q.info.labels.keys()].join(', ')}`;

const qrelsWarning = (q: ParsedQrels): string | undefined =>
  q.info.truncatedLabels > 0 ? `${plural(q.info.truncatedLabels, 'label')} not an integer (integer part used, as trec_eval does)` : undefined;

function field(label: string, control: HTMLElement, hint: string, wide = false): HTMLElement {
  return h('label', { class: `field${wide ? ' wide' : ''}` }, h('span', null, label), control, h('small', null, hint));
}

function checkbox(label: string, checked: boolean, hint: string, onChange: (v: boolean) => void, key: string): HTMLElement {
  const input = h('input', { type: 'checkbox', checked, 'data-key': key });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'check' }, input, h('span', null, h('strong', null, label), h('small', null, hint)));
}

export function cutoffControl(state: AppState, actions: SetupActions, keyPrefix: string): HTMLElement {
  const custom = state.settings.cutoffs.mode === 'custom';
  const mode = h(
    'select',
    { 'data-key': `${keyPrefix}-cutoff-mode`, 'aria-label': 'Rank cutoffs' },
    h('option', { value: 'default', selected: !custom }, 'trec_eval defaults'),
    h('option', { value: 'custom', selected: custom }, 'Custom list'),
  );
  mode.addEventListener('change', () => actions.setCutoffMode(mode.value as 'default' | 'custom'));
  const valid = parseCutoffList(state.cutoffText) !== undefined;
  const text = h('input', {
    type: 'text',
    value: state.cutoffText,
    'data-key': `${keyPrefix}-cutoff-text`,
    'aria-label': 'Custom rank cutoffs',
    'aria-invalid': custom && !valid ? 'true' : null,
    placeholder: '1-20, 50, 100, 1000',
    spellcheck: 'false',
  });
  text.addEventListener('change', () => actions.setCutoffText(text.value));
  return h('div', { class: 'cutoff-control' }, mode, custom ? text : null);
}

export function renderSetup(state: AppState, results: readonly RunResult[] | undefined, actions: SetupActions, seriesColor: (i: number) => string): HTMLElement {
  const names = runNames(state.runs);
  const errors = new Map((results ?? []).filter((r) => r.error).map((r) => [r.id, r.error]));
  const runSlots = state.runs.map((run) =>
    fileSlot({
      title: names.get(run.id) ?? 'Run',
      slot: run.slot,
      describe: describeRun,
      warning: runWarning,
      error: errors.get(run.id),
      onFiles: (files) => actions.replaceRun(run.id, files[0] as File),
      onClear: () => actions.removeRun(run.id),
      key: `run-${run.id}`,
      marker: seriesKey(seriesColor(run.color), SHAPES[run.color % SHAPES.length]),
    }),
  );
  const free = MAX_RUNS - state.runs.length;
  const addSlot =
    free > 0
      ? fileSlot({
          title: state.runs.length === 0 ? 'Runs' : 'Add runs',
          slot: { status: 'empty' },
          describe: () => '',
          onFiles: (files) => actions.addRuns(files),
          key: 'add-runs',
          multiple: true,
          emptyText: `Drop one or more run files here or click to browse (up to ${free} more)`,
        })
      : null;

  const { settings } = state;
  const level = h('input', { type: 'number', value: settings.relevanceLevel, min: 0, step: 1, 'data-key': 'level' });
  level.addEventListener('change', () => {
    const v = Number(level.value);
    if (Number.isInteger(v) && v >= 0) actions.updateSettings({ relevanceLevel: v });
  });
  const maxDocs = h('input', { type: 'number', value: Number.isFinite(settings.maxDocsPerTopic) ? settings.maxDocsPerTopic : '', min: 1, step: 1, placeholder: 'all', 'data-key': 'maxdocs' });
  maxDocs.addEventListener('change', () => {
    const v = maxDocs.value.trim() === '' ? Infinity : Number(maxDocs.value);
    if (v === Infinity || (Number.isInteger(v) && v >= 1)) actions.updateSettings({ maxDocsPerTopic: v });
  });
  const rounding = h(
    'select',
    { 'data-key': 'rounding' },
    (
      [
        ['v10', 'trec_eval 10 (lround)'],
        ['v9', 'trec_eval 9 / pytrec_eval, x86-64'],
        ['v9-fma', 'trec_eval 9 / pytrec_eval, ARM'],
      ] as ReadonlyArray<[IprecRounding, string]>
    ).map(([value, label]) => h('option', { value, selected: value === settings.iprecRounding }, label)),
  );
  rounding.addEventListener('change', () => actions.updateSettings({ iprecRounding: rounding.value as IprecRounding }));

  const customInvalid = settings.cutoffs.mode === 'custom' && parseCutoffList(state.cutoffText) === undefined;
  const settingsPanel = h(
    'details',
    { class: 'settings', open: state.optionsOpen },
    h('summary', null, 'Options'),
    h(
      'div',
      { class: 'settings-grid' },
      field('Relevance level  -l', level, 'Minimum label of a relevant document'),
      field('Documents per topic  -M', maxDocs, 'Evaluate only the top documents (empty: all)'),
      field('Rank cutoffs  -m P.k,…', cutoffControl(state, actions, 'setup'), customInvalid ? 'Positive integers, e.g. 1-20, 50, 100' : 'For P, recall, ndcg_cut, map_cut, relative_P, success, unj', true),
      field('Recall-level rounding', rounding, 'Changes iprec_at_recall and 11pt_avg for a few topics', true),
      h(
        'div',
        { class: 'checks wide' },
        checkbox('Average over all judged topics  -c', settings.averageComplete, 'Judged topics without results score 0 instead of being left out', (v) => actions.updateSettings({ averageComplete: v }), 'complete'),
        checkbox('Judged documents only  -J', settings.judgedDocsOnly, 'Remove unjudged documents before evaluating (trec_eval: "do not use unless you know what you are doing")', (v) => actions.updateSettings({ judgedDocsOnly: v }), 'judged'),
      ),
    ),
  );

  settingsPanel.addEventListener('toggle', () => {
    state.optionsOpen = settingsPanel.open;
  });

  const ready = (results ?? []).filter((r) => r.evaluation);
  let status: HTMLElement;
  if (state.busy) status = h('span', { class: 'status busy' }, h('span', { class: 'dot' }), 'Evaluating …');
  else if (state.error) status = h('span', { class: 'status error' }, h('span', { class: 'dot' }), state.error);
  else if (state.qrels.status !== 'ready') status = h('span', { class: 'status' }, h('span', { class: 'dot' }), 'Missing: qrels');
  else if (!state.runs.some((r) => r.slot.status === 'ready')) status = h('span', { class: 'status' }, h('span', { class: 'dot' }), 'Missing: a run');
  else if (ready.length === 0) status = h('span', { class: 'status error' }, h('span', { class: 'dot' }), 'No run could be evaluated');
  else status = h('span', { class: 'status ready' }, h('span', { class: 'dot' }), `Evaluated ${plural(ready.length, 'run')}`);

  const demo = h('button', { class: 'btn', type: 'button' }, icon('sparkles', 14), 'Load example data');
  demo.addEventListener('click', actions.loadDemo);
  const clear = h('button', { class: 'btn ghost', type: 'button' }, 'Clear all');
  clear.addEventListener('click', actions.clearAll);

  if (state.setupCollapsed && ready.length > 0) {
    const edit = h('button', { class: 'btn', type: 'button', 'data-key': 'setup-toggle' }, 'Edit inputs');
    edit.addEventListener('click', () => actions.setCollapsed(false));
    const flags = [
      settings.averageComplete ? '-c' : '',
      settings.relevanceLevel !== 1 ? `-l${settings.relevanceLevel}` : '',
      Number.isFinite(settings.maxDocsPerTopic) ? `-M${settings.maxDocsPerTopic}` : '',
      settings.judgedDocsOnly ? '-J' : '',
      settings.cutoffs.mode === 'custom' ? 'custom cutoffs' : '',
    ].filter(Boolean);
    return h(
      'section',
      { class: 'card setup-card collapsed', 'aria-label': 'Inputs' },
      h(
        'div',
        { class: 'setup-foot' },
        h(
          'div',
          { class: 'setup-summary' },
          h('strong', null, state.qrels.fileName ?? 'qrels'),
          h('span', null, `${plural(state.qrels.data?.info.numTopics ?? 0, 'judged topic')}`),
          h('span', { title: ready.map((r) => r.name).join(', ') }, `${plural(ready.length, 'run')}: ${ready.map((r) => r.name).join(', ')}`),
          flags.length > 0 ? h('span', null, flags.join(' ')) : null,
        ),
        h('div', { class: 'card-actions' }, edit, demo, clear),
      ),
    );
  }

  const hide = ready.length > 0 ? h('button', { class: 'btn ghost', type: 'button', 'data-key': 'setup-toggle' }, 'Hide inputs') : null;
  hide?.addEventListener('click', () => actions.setCollapsed(true));

  return h(
    'section',
    { class: 'card setup-card', 'aria-label': 'Inputs' },
    h(
      'div',
      { class: 'card-body' },
      h(
        'div',
        { class: 'setup-grid' },
        h('div', { class: 'label' }, h('h3', null, 'Relevance judgements'), h('p', null, 'One qrels file: topic, iteration, docid, relevance')),
        h(
          'div',
          { class: 'slots one' },
          fileSlot({
            title: 'Qrels',
            slot: state.qrels,
            describe: describeQrels,
            warning: qrelsWarning,
            onFiles: (files) => actions.loadQrels(files[0] as File),
            onClear: actions.clearQrels,
            key: 'qrels',
          }),
        ),
        h('hr'),
        h('div', { class: 'label' }, h('h3', null, 'Runs'), h('p', null, `Up to ${MAX_RUNS} TREC runs: topic, Q0, docid, rank, score, tag. Each is evaluated like a separate trec_eval call.`)),
        h('div', { class: 'slots' }, runSlots, addSlot),
      ),
    ),
    settingsPanel,
    h('div', { class: 'setup-foot' }, status, h('div', { class: 'card-actions' }, hide, demo, clear)),
  );
}
