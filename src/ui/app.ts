import { evaluateRun } from '../core/evaluate.ts';
import { buildMeasureSet, parseCutoffList } from '../core/measures.ts';
import { parseQrels, parseRun } from '../core/trec-format.ts';
import type { ParsedQrels, ParsedRun } from '../core/trec-format.ts';
import { chartTheme, hideTooltip } from './charts.ts';
import { disposeCharts } from './components.ts';
import { generateDemo } from './demo.ts';
import { h, icon, replaceChildren } from './dom.ts';
import { readText } from './files.ts';
import { renderResults } from './results.ts';
import type { ResultActions } from './results.ts';
import { renderSetup } from './setup.ts';
import type { SetupActions } from './setup.ts';
import { DEFAULT_CUSTOM_CUTOFFS, EMPTY, MAX_RUNS, TABS, initialState, newRun, runNames } from './state.ts';
import type { AppState, FileSlot, RunResult, TabId } from './state.ts';

const THEME_KEY = 'trec-eval-web:theme';
type ThemeChoice = 'auto' | 'light' | 'dark';

function storedTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function applyTheme(choice: ThemeChoice): void {
  if (choice === 'auto') delete document.documentElement.dataset['theme'];
  else document.documentElement.dataset['theme'] = choice;
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // storage unavailable (private mode); the choice lasts for this page view
  }
}

/** Keep keyboard focus (and the caret) on an element that is re-created by a render. */
function preservingFocus(render: () => void): void {
  const active = document.activeElement as HTMLElement | null;
  const key = active?.getAttribute('data-key');
  const caret = active instanceof HTMLInputElement && active.type === 'text' ? [active.selectionStart, active.selectionEnd] : undefined;
  render();
  if (!key) return;
  const next = document.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
  if (!next) return;
  next.focus({ preventScroll: true });
  if (caret && next instanceof HTMLInputElement) next.setSelectionRange(caret[0] ?? null, caret[1] ?? null);
}

function masthead(onTheme: () => void, themeChoice: ThemeChoice): HTMLElement {
  const themeLabel: Record<ThemeChoice, string> = { auto: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' };
  const themeIcon: Record<ThemeChoice, string> = { auto: 'auto', light: 'sun', dark: 'moon' };
  const toggle = h('button', { class: 'btn ghost icon', type: 'button', title: themeLabel[themeChoice], 'aria-label': themeLabel[themeChoice], 'data-key': 'theme' }, icon(themeIcon[themeChoice], 18));
  toggle.addEventListener('click', onTheme);
  return h(
    'header',
    { class: 'masthead' },
    h(
      'div',
      { class: 'brand' },
      h('h1', null, 'trec_eval', h('span', { class: 'tag' }, 'web')),
      h('p', null, 'Evaluate TREC runs against relevance judgements with the measures of trec_eval 10, and compare runs in tables and plots by rank cutoff.'),
      h('span', { class: 'privacy' }, icon('lock', 14), 'Files are evaluated in this browser tab. Nothing is uploaded.'),
    ),
    h('div', { class: 'masthead-actions' }, h('a', { class: 'btn ghost', href: 'https://github.com/usnistgov/trec_eval', target: '_blank', rel: 'noopener' }, icon('github', 16), 'trec_eval'), toggle),
  );
}

function footer(): HTMLElement {
  return h(
    'footer',
    { class: 'foot' },
    h(
      'p',
      null,
      'A TypeScript port of ',
      h('a', { href: 'https://github.com/usnistgov/trec_eval', target: '_blank', rel: 'noopener' }, 'trec_eval'),
      ' by Chris Buckley and the National Institute of Standards and Technology, checked value by value against trec_eval 10 and 9 built from source.',
    ),
    h('p', null, 'This page cannot make network requests (Content-Security-Policy).'),
  );
}

function introCard(): HTMLElement {
  return h(
    'section',
    { class: 'card empty intro' },
    h('h3', null, 'Add qrels and runs to see the results'),
    h(
      'p',
      { class: 'explain' },
      'Runs use the TREC format ',
      h('code', null, 'topic Q0 docid rank score tag'),
      ', qrels ',
      h('code', null, 'topic iteration docid relevance'),
      '. Gzip-compressed files work too. Or load the synthetic example data to explore the dashboard.',
    ),
  );
}

export function startApp(root: HTMLElement): void {
  const state: AppState = initialState();
  let themeChoice = storedTheme();
  applyTheme(themeChoice);

  const headerHost = h('div');
  const bannerHost = h('div');
  const setupHost = h('div');
  const resultsHost = h('div');
  root.replaceChildren(h('div', { class: 'app' }, headerHost, bannerHost, setupHost, resultsHost, footer()));

  // Dropping a file outside a slot must not navigate away from the page.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  const seriesColor = (i: number): string => chartTheme().series[i % 8] as string;

  const renderHeader = (): void => {
    replaceChildren(
      headerHost,
      masthead(() => {
        themeChoice = themeChoice === 'auto' ? 'light' : themeChoice === 'light' ? 'dark' : 'auto';
        applyTheme(themeChoice);
        preservingFocus(() => {
          renderHeader();
          renderSetupPanel();
          renderResultsPanel();
        });
      }, themeChoice),
    );
  };

  const renderBanner = (): void => {
    replaceChildren(
      bannerHost,
      state.demo
        ? h(
            'div',
            { class: 'banner' },
            icon('info', 16),
            h('span', null, h('strong', null, 'Synthetic example data. '), 'The qrels and the four runs were generated in your browser to demonstrate the dashboard; they do not come from a real test collection.'),
          )
        : null,
    );
  };

  const renderSetupPanel = (): void => {
    preservingFocus(() => replaceChildren(setupHost, renderSetup(state, state.results, setupActions, seriesColor)));
  };

  const renderResultsPanel = (): void => {
    disposeCharts();
    hideTooltip();
    const ready = state.results?.some((r) => r.evaluation);
    preservingFocus(() => replaceChildren(resultsHost, ready && state.results ? renderResults(state, state.results, chartTheme(), resultActions, setupActions) : introCard()));
  };

  const renderAll = (): void => {
    renderSetupPanel();
    renderResultsPanel();
  };

  // ------------------------------------------------------------------ evaluation

  let timer: ReturnType<typeof setTimeout> | undefined;
  const evaluateSoon = (delay = 120): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(evaluate, delay);
  };

  function evaluate(): void {
    timer = undefined;
    const qrels = state.qrels.status === 'ready' ? state.qrels.data : undefined;
    const runs = state.runs.filter((r) => r.slot.status === 'ready' && r.slot.data);
    if (!qrels || runs.length === 0) {
      state.results = undefined;
      state.error = undefined;
      renderAll();
      return;
    }
    state.busy = true;
    renderSetupPanel();
    // Let the browser paint the busy state before the synchronous computation.
    setTimeout(() => {
      try {
        const set = buildMeasureSet(state.settings.cutoffs);
        const names = runNames(state.runs);
        state.results = runs.map((r): RunResult => {
          const base = { id: r.id, color: r.color, name: names.get(r.id) ?? 'run', fileName: r.slot.fileName ?? 'run.txt' };
          try {
            return { ...base, evaluation: evaluateRun(r.slot.data as ParsedRun, qrels as ParsedQrels, state.settings, set) };
          } catch (error) {
            return { ...base, error: error instanceof Error ? error.message : String(error) };
          }
        });
        state.error = undefined;
      } catch (error) {
        state.results = undefined;
        state.error = error instanceof Error ? error.message : String(error);
      }
      state.busy = false;
      renderAll();
    }, 30);
  }

  // ------------------------------------------------------------------ inputs

  async function read<T>(file: File, parse: (text: string) => T): Promise<FileSlot<T>> {
    try {
      const text = await readText(file);
      return { status: 'ready', fileName: file.name, size: file.size, data: parse(text) };
    } catch (error) {
      return { status: 'error', fileName: file.name, size: file.size, error: error instanceof Error ? error.message : String(error) };
    }
  }

  const userInput = (): void => {
    state.demo = false;
    renderBanner();
  };

  const setupActions: SetupActions = {
    loadQrels(file) {
      state.qrels = { status: 'loading', fileName: file.name, size: file.size };
      renderSetupPanel();
      void read(file, parseQrels).then((slot) => {
        state.qrels = slot;
        userInput();
        renderSetupPanel();
        evaluateSoon();
      });
    },
    clearQrels() {
      state.qrels = EMPTY;
      evaluateSoon(0);
    },
    addRuns(files) {
      const accepted = files.slice(0, MAX_RUNS - state.runs.length);
      for (const file of accepted) {
        const run = newRun({ status: 'loading', fileName: file.name, size: file.size }, state.runs);
        state.runs.push(run);
        void read(file, parseRun).then((slot) => {
          const target = state.runs.find((r) => r.id === run.id);
          if (!target) return;
          target.slot = slot;
          userInput();
          renderSetupPanel();
          evaluateSoon();
        });
      }
      renderSetupPanel();
    },
    replaceRun(id, file) {
      const run = state.runs.find((r) => r.id === id);
      if (!run) return;
      run.slot = { status: 'loading', fileName: file.name, size: file.size };
      renderSetupPanel();
      void read(file, parseRun).then((slot) => {
        if (!state.runs.includes(run)) return;
        run.slot = slot;
        userInput();
        renderSetupPanel();
        evaluateSoon();
      });
    },
    removeRun(id) {
      state.runs = state.runs.filter((r) => r.id !== id);
      evaluateSoon(0);
    },
    updateSettings(patch) {
      state.settings = { ...state.settings, ...patch };
      renderSetupPanel();
      evaluateSoon(0);
    },
    setCutoffMode(mode) {
      if (mode === 'custom') {
        // An invalid list left in the field falls back to a useful default.
        if (!parseCutoffList(state.cutoffText)) state.cutoffText = DEFAULT_CUSTOM_CUTOFFS;
        state.settings = { ...state.settings, cutoffs: { mode: 'custom', values: parseCutoffList(state.cutoffText) as number[] } };
      } else {
        state.settings = { ...state.settings, cutoffs: { mode: 'default' } };
      }
      renderSetupPanel();
      evaluateSoon(0);
    },
    setCutoffText(text) {
      state.cutoffText = text;
      const values = parseCutoffList(text);
      if (values) state.settings = { ...state.settings, cutoffs: { mode: 'custom', values } };
      renderSetupPanel();
      if (values) evaluateSoon(0);
      else renderResultsPanel();
    },
    loadDemo() {
      state.busy = true;
      renderSetupPanel();
      setTimeout(() => {
        const data = generateDemo();
        const slot = <T>(fileName: string, text: string, parse: (t: string) => T): FileSlot<T> => ({ status: 'ready', fileName, size: text.length, data: parse(text) });
        state.qrels = slot('example-qrels.txt', data.qrels, parseQrels);
        state.runs = [];
        for (const run of data.runs) state.runs.push(newRun(slot(run.fileName, run.text, parseRun), state.runs));
        state.demo = true;
        state.busy = false;
        state.setupCollapsed = true;
        renderBanner();
        evaluate();
      }, 30);
    },
    setCollapsed(collapsed) {
      state.setupCollapsed = collapsed;
      renderSetupPanel();
    },
    clearAll() {
      const fresh = initialState();
      Object.assign(state, { ...fresh, settings: state.settings, cutoffText: state.cutoffText, view: { ...state.view, tab: 'summary' } });
      renderBanner();
      renderAll();
    },
  };

  const view = state.view;
  const resultActions: ResultActions = {
    setTab(tab) {
      view.tab = tab;
      renderResultsPanel();
      try {
        history.replaceState(null, '', location.hash.startsWith('#example') ? `#example/${tab}` : location.pathname + location.search);
      } catch {
        // not allowed in some embedded contexts
      }
    },
    toggleGroup(group) {
      if (view.groups.has(group) && view.groups.size > 1) view.groups.delete(group);
      else view.groups.add(group);
      renderResultsPanel();
    },
    toggleFamily(family) {
      if (view.families.has(family) && view.families.size > 1) view.families.delete(family);
      else view.families.add(family);
      renderResultsPanel();
    },
    setFocus(measure) {
      view.focus = measure;
      renderResultsPanel();
    },
    setTopicOrder(order) {
      view.topicOrder = order;
      renderResultsPanel();
    },
    setBaseline(id) {
      if (id === view.compare) view.compare = view.baseline;
      view.baseline = id;
      renderResultsPanel();
    },
    setCompare(id) {
      if (id === view.baseline) view.baseline = view.compare;
      view.compare = id;
      renderResultsPanel();
    },
    setOutputRun(id) {
      view.outputRun = id;
      renderResultsPanel();
    },
    setSelection(selection) {
      view.selection = selection;
      renderResultsPanel();
    },
    setPerTopic(perTopic) {
      view.perTopic = perTopic;
      renderResultsPanel();
    },
  };

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (themeChoice === 'auto') renderResultsPanel();
  });

  renderHeader();
  renderBanner();
  renderAll();

  // Deep link to the example data: #example, optionally followed by /<tab>.
  const [command, tab] = location.hash.replace(/^#/, '').split('/');
  if (command === 'example') {
    if (TABS.includes(tab as TabId)) view.tab = tab as TabId;
    setupActions.loadDemo();
  }
}
