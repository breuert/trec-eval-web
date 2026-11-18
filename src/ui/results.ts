import { compareNatural } from '../core/compare.ts';
import { printedPerTopic } from '../core/evaluate.ts';
import type { RunEvaluation } from '../core/evaluate.ts';
import { CUTOFF_FAMILIES, FAMILY, GROUPS, RECALL_LEVELS } from '../core/measures.ts';
import type { CutoffFamilyId, FamilyDef, GroupId, MeasureDef, MeasureSet } from '../core/measures.ts';
import { UNSUPPORTED_ALL_TREC, commandLine, resultsJson, summaryCsv, topicsCsv, trecEvalText } from '../core/output.ts';
import type { MeasureSelection, NamedEvaluation } from '../core/output.ts';
import { SHAPES, columnChart, lineChart, rectKey, seriesKey } from './charts.ts';
import type { ChartTheme, Series } from './charts.ts';
import { card, chartCard, chips, dataTable, segmented, tableToCsv, tiles } from './components.ts';
import type { CellValue, TableData } from './components.ts';
import { copyText, download, h, icon } from './dom.ts';
import type { Child } from './dom.ts';
import { fmt, fmtInt, plural, slug } from './format.ts';
import { cutoffControl } from './setup.ts';
import type { SetupActions } from './setup.ts';
import type { AppState, RunResult, TabId } from './state.ts';

export interface ResultActions {
  setTab(tab: TabId): void;
  toggleGroup(group: GroupId): void;
  toggleFamily(family: CutoffFamilyId): void;
  setFocus(measure: string): void;
  setTopicOrder(order: 'topic' | 'value'): void;
  setBaseline(id: number): void;
  setCompare(id: number): void;
  setOutputRun(id: number): void;
  setSelection(selection: MeasureSelection): void;
  setPerTopic(perTopic: boolean): void;
}

type Evaluated = RunResult & { readonly evaluation: RunEvaluation };

interface Context {
  readonly state: AppState;
  readonly theme: ChartTheme;
  readonly actions: ResultActions;
  readonly setup: SetupActions;
  readonly runs: readonly Evaluated[];
  readonly set: MeasureSet;
  readonly qrelsFile: string;
}

const colorOf = (ctx: Context, run: Evaluated): string => ctx.theme.series[run.color % ctx.theme.series.length] as string;
const shapeOf = (run: Evaluated): (typeof SHAPES)[number] => SHAPES[run.color % SHAPES.length] as (typeof SHAPES)[number];
const seriesOf = (ctx: Context): Series[] => ctx.runs.map((r) => ({ key: String(r.id), label: r.name, color: colorOf(ctx, r), shape: shapeOf(r) }));
const runById = (ctx: Context, key: string): Evaluated | undefined => ctx.runs.find((r) => String(r.id) === key);

function value(run: Evaluated, m: MeasureDef): number {
  return run.evaluation.summary[m.index] as number;
}

function formatValue(m: MeasureDef, v: number | undefined): string {
  if (v === undefined) return '–';
  return m.family.aggregation === 'sum' || m.family.aggregation === 'num_q' ? fmtInt(v) : fmt(v);
}

function measureCell(m: MeasureDef | FamilyDef, name: string): CellValue {
  const family = 'family' in m ? m.family : m;
  return { text: name, title: `${family.label}: ${family.description}`, node: h('code', { class: 'measure' }, name) };
}

/** Indices of the best values (ties included), if the measure has a direction. */
function best(values: readonly number[], family: FamilyDef): Set<number> {
  if (family.better === 'none' || values.length < 2) return new Set();
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return new Set();
  const target = family.better === 'higher' ? Math.max(...finite) : Math.min(...finite);
  if (finite.every((v) => v === target)) return new Set();
  return new Set(values.map((v, i) => (v === target ? i : -1)).filter((i) => i >= 0));
}

// ---------------------------------------------------------------------------- summary

/** A cutoff family's measure at rank 10, or the nearest cutoff above (else the deepest). */
function atTen(set: MeasureSet, family: CutoffFamilyId): MeasureDef | undefined {
  const ms = set.ofFamily(family);
  return ms.find((m) => (m.cutoff ?? 0) >= 10) ?? ms[ms.length - 1];
}

function summary(ctx: Context): Child[] {
  const { set, runs, state } = ctx;
  const headline = [set.byName.get('map'), set.byName.get('ndcg'), atTen(set, 'P'), atTen(set, 'ndcg_cut'), set.byName.get('recip_rank'), set.byName.get('Rprec'), set.byName.get('bpref')].filter(
    (m): m is MeasureDef => m !== undefined,
  );
  const series = seriesOf(ctx);
  const out: Child[] = [];
  out.push(
    chartCard({
      title: 'Headline measures',
      description: runs.length > 1 ? 'Mean over topics for every run.' : `Mean over topics of ${runs[0]?.name ?? 'the run'}.`,
      legend: runs.length > 1 ? runs.map((r) => ({ label: r.name, key: rectKey(colorOf(ctx, r)) })) : [],
      fileName: 'headline-measures',
      draw: (width, theme) =>
        columnChart(
          {
            label: 'Headline measures per run',
            series: series.map((sr, i) => ({ ...sr, color: theme.series[(runs[i] as Evaluated).color % theme.series.length] as string })),
            panels: [{ groups: headline.map((m) => ({ key: m.name, label: m.name })), value: (g, key) => {
              const r = runById(ctx, key);
              const m = set.byName.get(g);
              return r && m ? value(r, m) : undefined;
            } }],
            yDomain: [0, 1],
            format: (v) => fmt(v),
            height: 220,
          },
          width,
          theme,
        ),
      table: () => ({ header: ['Measure', ...runs.map((r) => r.name)], rows: headline.map((m) => [m.name, ...runs.map((r) => fmt(value(r, m)))]) }),
    }),
  );

  const rows: CellValue[][] = [];
  const sections = new Map<number, string>();
  for (const group of GROUPS) {
    if (!state.view.groups.has(group.id)) continue;
    const measures = set.measures.filter((m) => m.family.group === group.id);
    if (group.id === 'counts') {
      sections.set(rows.length, group.label);
      rows.push([measureCell(FAMILY.get('runid') as FamilyDef, 'runid'), ...runs.map((r) => ({ text: r.evaluation.runId, className: 'text' }))]);
    } else if (measures.length > 0) sections.set(rows.length, group.label);
    for (const m of measures) {
      const values = runs.map((r) => value(r, m));
      const top = best(values, m.family);
      rows.push([
        measureCell(m, m.name),
        ...values.map((v, i) => ({ text: formatValue(m, v), className: `${top.has(i) ? 'best' : ''}${Number.isNaN(v) ? ' na' : ''}`, ...(top.has(i) ? { title: 'Best of the runs' } : {}) })),
      ]);
    }
  }
  const table: TableData = { header: ['Measure', ...runs.map((r) => r.name)], rows, sections };
  const csv = h('button', { class: 'btn ghost small', type: 'button', title: 'Download the table as CSV' }, icon('download', 14), 'CSV');
  csv.addEventListener('click', () => download('trec_eval-summary.csv', tableToCsv(table), 'text/csv;charset=utf-8'));
  const note = state.settings.averageComplete ? 'Averaged over every judged topic (-c).' : 'Averaged over the judged topics each run retrieves for.';
  out.push(
    card(
      'All measures',
      [`The summary ("all") values trec_eval prints, in its order. ${note} `, runs.length > 1 ? 'The best run per measure is in bold. ' : '', 'Hover a measure name for its definition.'],
      [h('div', { class: 'table-tools' }, chips(GROUPS.map((g) => ({ value: g.id, label: g.label })), state.view.groups, ctx.actions.toggleGroup, 'Measure groups shown in the table')), dataTable(table, { tall: true, caption: 'Summary measures per run' })],
      csv,
    ),
  );
  return out;
}

// ---------------------------------------------------------------------------- cutoffs

function cutoffs(ctx: Context): Child[] {
  const { set, runs, state } = ctx;
  const families = CUTOFF_FAMILIES.filter((f) => state.view.families.has(f));
  const series = seriesOf(ctx);
  const legendItems = runs.length > 1 ? runs.map((r) => ({ label: r.name, key: seriesKey(colorOf(ctx, r), shapeOf(r)) })) : [];
  const deepest = Math.max(...runs.map((r) => Math.max(...r.evaluation.topics.map((t) => t.values[set.offset.get('num_ret') as number] as number))));
  const maxCutoff = Math.max(...families.flatMap((f) => set.cutoffs[f]));
  const xFormat = (v: number): string => fmtInt(v);
  const familyLabel = (f: CutoffFamilyId): string => `${FAMILY.get(f)?.label ?? f}  ·  ${f}`;
  const valueAt = (f: CutoffFamilyId) => (key: string, xi: number): number | undefined => {
    const r = runById(ctx, key);
    const m = set.ofFamily(f)[xi];
    return r && m ? value(r, m) : undefined;
  };

  const controls = h(
    'div',
    { class: 'cutoff-tools' },
    h('label', { class: 'inline-field' }, h('span', null, 'Cutoffs'), cutoffControl(state, ctx.setup, 'tab')),
    chips(CUTOFF_FAMILIES.map((f) => ({ value: f, label: FAMILY.get(f)?.label ?? f })), state.view.families, ctx.actions.toggleFamily, 'Measures shown'),
  );

  const out: Child[] = [];
  out.push(
    chartCard({
      title: 'Measures by rank cutoff',
      description: [
        'Mean over topics at every cutoff k (log scale). ',
        state.settings.cutoffs.mode === 'default' ? 'These are trec_eval’s default cutoffs; choose a custom list (e.g. 1-20, 50, 100) for finer curves. ' : '',
        maxCutoff > deepest ? `Rankings end at ${fmtInt(deepest)} documents; like trec_eval, deeper cutoffs count the missing ranks as non-relevant.` : '',
      ],
      controls,
      legend: legendItems,
      fileName: 'measures-by-cutoff',
      draw: (width, theme) =>
        lineChart(
          {
            label: 'Measures by rank cutoff',
            x: set.cutoffs.P,
            xScale: 'log',
            xFormat,
            xTitle: 'Cutoff k',
            series: series.map((sr, i) => ({ ...sr, color: theme.series[(runs[i] as Evaluated).color % theme.series.length] as string })),
            panels: families.map((f) => ({ title: familyLabel(f), x: set.cutoffs[f], value: valueAt(f) })),
            yDomain: [0, 1],
            format: (v) => fmt(v),
            height: 190,
            minPanelWidth: 300,
            directLabels: true,
          },
          width,
          theme,
        ),
      table: () => ({
        header: ['Measure', 'Cutoff', ...runs.map((r) => r.name)],
        rows: families.flatMap((f) => set.ofFamily(f).map((m) => [m.name, String(m.cutoff ?? ''), ...runs.map((r) => fmt(value(r, m)))])),
      }),
    }),
  );

  const iprec = set.ofFamily('iprec_at_recall');
  const avg = set.byName.get('11pt_avg') as MeasureDef;
  out.push(
    chartCard({
      title: 'Interpolated precision–recall curve',
      description: [
        h('code', null, 'iprec_at_recall'),
        ': the highest precision at any recall at or above each level, averaged over topics. Its mean over the 11 levels is ',
        h('code', null, '11pt_avg'),
        state.settings.iprecRounding === 'v10' ? '.' : ' (recall levels rounded like trec_eval 9).',
      ],
      legend: runs.length > 1 ? runs.map((r) => ({ label: `${r.name} · 11pt_avg ${fmt(value(r, avg))}`, key: seriesKey(colorOf(ctx, r), shapeOf(r)) })) : [],
      fileName: 'precision-recall',
      draw: (width, theme) =>
        lineChart(
          {
            label: 'Interpolated precision at recall levels',
            x: RECALL_LEVELS,
            xScale: 'linear',
            xDomain: [0, 1],
            xFormat: (v) => v.toFixed(1),
            xTitle: 'Recall',
            yTitle: 'Interpolated precision',
            series: series.map((sr, i) => ({ ...sr, color: theme.series[(runs[i] as Evaluated).color % theme.series.length] as string })),
            panels: [{ value: (key, xi) => {
              const r = runById(ctx, key);
              const m = iprec[xi];
              return r && m ? value(r, m) : undefined;
            } }],
            yDomain: [0, 1],
            format: (v) => fmt(v),
            height: 280,
            directLabels: true,
          },
          width,
          theme,
        ),
      table: () => ({ header: ['Recall', ...runs.map((r) => r.name)], rows: iprec.map((m) => [(m.cutoff ?? 0).toFixed(2), ...runs.map((r) => fmt(value(r, m)))]) }),
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------- per topic

function measureSelect(ctx: Context): HTMLElement {
  const perTopic = ctx.set.measures.filter((m) => printedPerTopic(m.family));
  const el = h(
    'select',
    { 'data-key': 'topic-measure' },
    GROUPS.map((g) =>
      h(
        'optgroup',
        { label: g.label },
        perTopic.filter((m) => m.family.group === g.id).map((m) => h('option', { value: m.name, selected: m.name === ctx.state.view.focus }, m.name)),
      ),
    ),
  );
  el.addEventListener('change', () => ctx.actions.setFocus(el.value));
  return h('label', { class: 'field' }, h('span', null, 'Measure'), el);
}

function runSelect(ctx: Context, label: string, selected: number, onChange: (id: number) => void, key: string): HTMLElement {
  const el = h('select', { 'data-key': key }, ctx.runs.map((r) => h('option', { value: r.id, selected: r.id === selected }, r.name)));
  el.addEventListener('change', () => onChange(Number(el.value)));
  return h('label', { class: 'field' }, h('span', null, label), el);
}

function topics(ctx: Context): Child[] {
  const { set, runs, state } = ctx;
  const focus = set.byName.get(state.view.focus) ?? (set.byName.get('map') as MeasureDef);
  const perRun = new Map(runs.map((r) => [r.id, new Map(r.evaluation.topics.map((t) => [t.topic, t]))]));
  const at = (r: Evaluated, topic: string): number | undefined => perRun.get(r.id)?.get(topic)?.values[focus.index];
  let topicIds = [...new Set(runs.flatMap((r) => r.evaluation.topics.map((t) => t.topic)))].sort(compareNatural);
  if (state.view.topicOrder === 'value') {
    const first = runs[0] as Evaluated;
    topicIds = topicIds.slice().sort((a, b) => (at(first, b) ?? -Infinity) - (at(first, a) ?? -Infinity) || compareNatural(a, b));
  }
  const series = seriesOf(ctx);
  const fname = focus.name;

  const filters = h(
    'div',
    { class: 'filters' },
    measureSelect(ctx),
    h(
      'div',
      { class: 'field' },
      h('span', null, 'Order'),
      segmented(
        [
          { value: 'topic', label: 'Topic id' },
          { value: 'value', label: runs.length > 1 ? `Score of ${runs[0]?.name}` : 'Score' },
        ],
        state.view.topicOrder,
        ctx.actions.setTopicOrder,
        'Topic order',
      ),
    ),
  );

  const out: Child[] = [filters];
  out.push(
    chartCard({
      title: `${fname} per topic`,
      description: `${focus.family.label}. ${plural(topicIds.length, 'topic')}; hover a column for the values.`,
      legend: runs.length > 1 ? runs.map((r) => ({ label: r.name, key: rectKey(colorOf(ctx, r)) })) : [],
      fileName: `per-topic-${slug(fname)}`,
      draw: (width, theme) =>
        columnChart(
          {
            label: `${fname} per topic`,
            series: series.map((sr, i) => ({ ...sr, color: theme.series[(runs[i] as Evaluated).color % theme.series.length] as string })),
            panels: [{ groups: topicIds.map((t) => ({ key: t, label: t })), value: (t, key) => {
              const r = runById(ctx, key);
              return r ? at(r, t) : undefined;
            } }],
            format: (v) => formatValue(focus, v),
            groupTitle: 'Topic',
            height: 220,
          },
          width,
          theme,
        ),
      table: () => ({ header: ['Topic', ...runs.map((r) => r.name)], rows: topicIds.map((t) => [t, ...runs.map((r) => formatValue(focus, at(r, t)))]) }),
    }),
  );

  if (runs.length > 1) {
    const ids = new Set(runs.map((r) => r.id));
    const baseline = runs.find((r) => r.id === state.view.baseline && ids.has(r.id)) ?? (runs[0] as Evaluated);
    const compare = runs.find((r) => r.id === state.view.compare && r.id !== baseline.id) ?? (runs.find((r) => r.id !== baseline.id) as Evaluated);
    const common = topicIds.filter((t) => at(baseline, t) !== undefined && at(compare, t) !== undefined);
    const diffs = common.map((t) => ({ topic: t, d: (at(compare, t) as number) - (at(baseline, t) as number) })).sort((a, b) => b.d - a.d || compareNatural(a.topic, b.topic));
    const better = diffs.filter((x) => x.d > 0).length;
    const worse = diffs.filter((x) => x.d < 0).length;
    const mean = diffs.length > 0 ? diffs.reduce((acc, x) => acc + x.d, 0) / diffs.length : NaN;
    out.push(
      chartCard({
        title: `${fname}: ${compare.name} minus ${baseline.name}`,
        description: `Per-topic difference, sorted. Columns above zero are topics where ${compare.name} scores higher.`,
        controls: h(
          'div',
          { class: 'filters compact' },
          runSelect(ctx, 'Run', compare.id, ctx.actions.setCompare, 'cmp-run'),
          runSelect(ctx, 'minus', baseline.id, ctx.actions.setBaseline, 'base-run'),
          tiles([
            { label: 'Higher', value: String(better), unit: `of ${common.length}` },
            { label: 'Lower', value: String(worse), unit: `of ${common.length}` },
            { label: 'Equal', value: String(common.length - better - worse) },
            { label: 'Mean difference', value: fmt(mean) },
          ]),
        ),
        fileName: `difference-${slug(fname)}-${slug(compare.name)}-${slug(baseline.name)}`,
        draw: (width, theme) =>
          columnChart(
            {
              label: `Per-topic difference in ${fname}`,
              series: [{ key: 'd', label: `Δ ${fname}`, color: theme.pos }],
              panels: [{ groups: diffs.map((x) => ({ key: x.topic, label: x.topic })), value: (t) => diffs.find((x) => x.topic === t)?.d }],
              diverging: true,
              format: (v) => (focus.family.aggregation === 'sum' ? (v > 0 ? '+' : '') + fmtInt(v) : (v > 0 ? '+' : '') + fmt(v)),
              groupTitle: 'Topic',
              yTitle: `Δ ${fname}`,
              height: 200,
            },
            width,
            theme,
          ),
        table: () => ({ header: ['Topic', baseline.name, compare.name, 'Difference'], rows: diffs.map((x) => [x.topic, formatValue(focus, at(baseline, x.topic)), formatValue(focus, at(compare, x.topic)), fmt(x.d)]) }),
      }),
    );
  }

  const numRel = set.byName.get('num_rel') as MeasureDef;
  const withStrings = runs.length <= 3;
  const first = runs[0] as Evaluated;
  const table: TableData = {
    header: ['Topic', 'num_rel', ...runs.flatMap((r) => (withStrings ? [r.name, 'relstring'] : [r.name]))],
    rows: topicIds.map((t) => {
      const rel = perRun.get(first.id)?.get(t)?.values[numRel.index] ?? runs.map((r) => perRun.get(r.id)?.get(t)?.values[numRel.index]).find((v) => v !== undefined);
      const values = runs.map((r) => at(r, t) ?? NaN);
      const top = best(values, focus.family);
      return [
        t,
        rel === undefined ? '–' : fmtInt(rel),
        ...runs.flatMap((r, i) => {
          const topic = perRun.get(r.id)?.get(t);
          const cell: CellValue = { text: formatValue(focus, at(r, t)), className: top.has(i) ? 'best' : '', ...(topic?.filled ? { title: 'No results for this topic (filled in by -c)' } : {}) };
          return withStrings ? [cell, { text: topic ? `'${topic.relstring}'` : '–', className: 'mono' }] : [cell];
        }),
      ];
    }),
  };
  out.push(
    card(
      `Per-topic ${fname}`,
      withStrings
        ? [h('code', null, 'relstring'), ' shows the labels of the top 10 documents: 0–9, ">" above 9, "-" not judged, "." judged with a negative label.']
        : 'The values of every run.',
      dataTable(table, { tall: true, caption: `Per-topic ${fname}` }),
    ),
  );
  return out;
}

// ---------------------------------------------------------------------------- output

function output(ctx: Context): Child[] {
  const { runs, state } = ctx;
  const run = runs.find((r) => r.id === state.view.outputRun) ?? (runs[0] as Evaluated);
  const options = { selection: state.view.selection, perTopic: state.view.perTopic };
  const text = trecEvalText(run.evaluation, options);
  const command = commandLine(state.settings, options, ctx.qrelsFile, run.fileName);

  const copyButton = (getText: () => string, label = 'Copy'): HTMLButtonElement => {
    const b = h('button', { class: 'btn small', type: 'button' }, icon('copy', 14), label);
    b.addEventListener('click', () => {
      void copyText(getText()).then((ok) => {
        b.lastChild?.replaceWith(ok ? 'Copied' : 'Copy failed');
        setTimeout(() => b.lastChild?.replaceWith(label), 1500);
      });
    });
    return b;
  };
  const save = h('button', { class: 'btn small', type: 'button' }, icon('download', 14), 'Download');
  save.addEventListener('click', () => download(`trec_eval-${slug(run.name)}${state.view.perTopic ? '-q' : ''}.txt`, text));
  const perTopicBox = h('input', { type: 'checkbox', checked: state.view.perTopic, 'data-key': 'out-q' });
  perTopicBox.addEventListener('change', () => ctx.actions.setPerTopic(perTopicBox.checked));

  const notes: Child[] = [];
  if (state.view.selection === 'all') notes.push(h('li', null, `trec_eval -m all_trec also prints ${UNSUPPORTED_ALL_TREC.join(', ')}, which this tool does not compute; every other line is identical.`));
  if (run.evaluation.skippedTopics.length > 0) {
    notes.push(
      h('li', null, `trec_eval 10 stops with an error for this run, because ${plural(run.evaluation.skippedTopics.length, 'judged topic')} (${run.evaluation.skippedTopics.slice(0, 5).join(', ')}${run.evaluation.skippedTopics.length > 5 ? ', …' : ''}) ${run.evaluation.skippedTopics.length === 1 ? 'has' : 'have'} no results. The output is that of trec_eval 9, which leaves them out; add -c to count them as 0.`),
    );
  }
  if (state.settings.iprecRounding !== 'v10') notes.push(h('li', null, 'iprec_at_recall and 11pt_avg are computed like trec_eval 9 (see the options); the command line refers to trec_eval 9 for these lines.'));

  const named: NamedEvaluation[] = runs.map((r) => ({ name: r.name, fileName: r.fileName, evaluation: r.evaluation }));
  const item = (title: string, description: string, fileName: string, make: () => string, type: string): HTMLElement => {
    const b = h('button', { class: 'btn small', type: 'button' }, icon('download', 14), fileName.split('.').pop()?.toUpperCase() ?? 'File');
    b.addEventListener('click', () => download(fileName, make(), type));
    return h('div', { class: 'download' }, h('div', null, h('strong', null, title), h('span', null, description)), b);
  };

  return [
    h(
      'div',
      { class: 'filters' },
      runs.length > 1 ? runSelect(ctx, 'Run', run.id, ctx.actions.setOutputRun, 'out-run') : null,
      h(
        'div',
        { class: 'field' },
        h('span', null, 'Measures  -m'),
        segmented(
          [
            { value: 'official', label: 'official' },
            { value: 'set', label: 'set' },
            { value: 'all', label: 'all_trec' },
          ],
          state.view.selection,
          ctx.actions.setSelection,
          'Measures',
        ),
      ),
      h('label', { class: 'check inline' }, perTopicBox, h('span', null, h('strong', null, 'Per topic  -q'))),
    ),
    card(
      'trec_eval output',
      `What trec_eval prints for ${run.name}: ${plural(text.split('\n').length - 1, 'line')}.`,
      [
        h('div', { class: 'cmd' }, h('code', null, command), copyButton(() => command, 'Copy command')),
        notes.length > 0 ? h('ul', { class: 'out-notes' }, notes) : null,
        h('pre', { class: 'report' }, text),
      ],
      [copyButton(() => text), save],
    ),
    card(
      'Downloads',
      'All runs at full precision (17 significant digits instead of 4 decimals). Non-finite values are written as NaN.',
      h(
        'div',
        { class: 'downloads' },
        item('Summary (CSV)', 'run, runid, measure, value', 'trec_eval-summary.csv', () => summaryCsv(named), 'text/csv'),
        item('Per topic (CSV)', 'run, topic, measure, value', 'trec_eval-topics.csv', () => topicsCsv(named), 'text/csv'),
        item('Summary (JSON)', 'Settings and every summary value', 'trec_eval-results.json', () => JSON.stringify(resultsJson(named, ctx.qrelsFile, false), null, 2) + '\n', 'application/json'),
        item('With topics (JSON)', 'Adds per-topic values and relstrings', 'trec_eval-results-topics.json', () => JSON.stringify(resultsJson(named, ctx.qrelsFile, true), null, 2) + '\n', 'application/json'),
      ),
    ),
  ];
}

// ---------------------------------------------------------------------------- frame

const TAB_LABEL: Record<TabId, string> = { summary: 'Summary', cutoffs: 'Cutoffs', topics: 'Per topic', output: 'trec_eval output' };

function inputNotes(ctx: Context, failed: readonly RunResult[]): HTMLElement | null {
  const items: Array<{ level: 'warning' | 'info'; text: string }> = [];
  for (const r of failed) items.push({ level: 'warning', text: `${r.name} was not evaluated: ${r.error ?? 'unknown error'}` });
  for (const r of ctx.runs) {
    const ev = r.evaluation;
    const list = (topics: readonly string[]): string => `${topics.slice(0, 8).join(', ')}${topics.length > 8 ? ', …' : ''}`;
    if (ev.skippedTopics.length > 0) {
      items.push({ level: 'warning', text: `${r.name}: ${plural(ev.skippedTopics.length, 'judged topic')} without results left out of the averages (${list(ev.skippedTopics)}). trec_eval 10 stops with an error here; enable -c to count them as 0.` });
    }
    const filled = ev.topics.filter((t) => t.filled).map((t) => t.topic);
    if (filled.length > 0) items.push({ level: 'info', text: `${r.name}: ${plural(filled.length, 'judged topic')} without results count as 0 (-c): ${list(filled)}.` });
    if (ev.ignoredTopics.length > 0) items.push({ level: 'info', text: `${r.name}: ${plural(ev.ignoredTopics.length, 'topic')} without judgements ignored (${list(ev.ignoredTopics)}).` });
  }
  if (items.length === 0) return null;
  const warnings = items.filter((i) => i.level === 'warning').length;
  return h(
    'details',
    { class: 'notes', open: warnings > 0 ? true : null },
    h('summary', null, `${plural(items.length, 'note')} about the input`),
    h('ul', null, items.map((i) => h('li', { class: i.level }, i.text))),
  );
}

export function renderResults(state: AppState, results: readonly RunResult[], theme: ChartTheme, actions: ResultActions, setup: SetupActions): HTMLElement {
  const runs = results.filter((r): r is Evaluated => r.evaluation !== undefined);
  const failed = results.filter((r) => r.evaluation === undefined);
  const ctx: Context = { state, theme, actions, setup, runs, set: (runs[0] as Evaluated).evaluation.set, qrelsFile: state.qrels.fileName ?? 'qrels.txt' };
  const tab = state.view.tab;

  const tabBar = h(
    'div',
    { class: 'tabs', role: 'tablist', 'aria-label': 'Result views' },
    (['summary', 'cutoffs', 'topics', 'output'] as const).map((t) => {
      const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(t === tab), 'data-key': `tab-${t}` }, TAB_LABEL[t]);
      b.addEventListener('click', () => actions.setTab(t));
      return b;
    }),
  );
  const numTopics = (runs[0] as Evaluated).evaluation.topics.length;
  const head = h(
    'div',
    { class: 'results-head' },
    h('div', { class: 'head-row' }, tabBar, h('span', { class: 'explain' }, `${plural(numTopics, 'topic')} · ${plural(runs.length, 'run')}`)),
  );

  let body: Child[];
  switch (tab) {
    case 'cutoffs':
      body = cutoffs(ctx);
      break;
    case 'topics':
      body = topics(ctx);
      break;
    case 'output':
      body = output(ctx);
      break;
    default:
      body = summary(ctx);
  }
  return h('section', { class: 'results', 'aria-label': 'Results' }, head, inputNotes(ctx, failed), h('div', { class: 'stack', role: 'tabpanel' }, body));
}
