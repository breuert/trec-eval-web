import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_SETTINGS, evaluateRun } from '../src/core/evaluate.ts';
import { formatFixed } from '../src/core/format.ts';
import { buildMeasureSet, parseCutoffList } from '../src/core/measures.ts';
import { commandLine, resultsJson, summaryCsv, topicsCsv } from '../src/core/output.ts';
import { parseQrels, parseRun } from '../src/core/trec-format.ts';

describe('formatFixed (printf %.4f)', () => {
  test('rounds exact ties to even', () => {
    assert.equal(formatFixed(1 / 32), '0.0312');
    assert.equal(formatFixed(3 / 32), '0.0938');
    assert.equal(formatFixed(0.00005), '0.0001'); // not a tie in binary
    assert.equal(formatFixed(-0), '-0.0000');
    assert.equal(formatFixed(NaN), 'nan');
  });
});

describe('cutoffs', () => {
  test('parse lists and ranges, sorted and unique', () => {
    assert.deepEqual(parseCutoffList('10, 5 1-3,3'), [1, 2, 3, 5, 10]);
    assert.equal(parseCutoffList('0,5'), undefined);
    assert.equal(parseCutoffList('5.5'), undefined);
    assert.equal(parseCutoffList(''), undefined);
  });

  test('custom cutoffs apply to every cutoff family; recall levels stay', () => {
    const set = buildMeasureSet({ mode: 'custom', values: [1, 3] });
    assert.deepEqual(set.ofFamily('success').map((m) => m.name), ['success_1', 'success_3']);
    assert.deepEqual(set.ofFamily('ndcg_cut').map((m) => m.name), ['ndcg_cut_1', 'ndcg_cut_3']);
    assert.equal(set.ofFamily('iprec_at_recall').length, 11);
    assert.equal(set.byName.get('iprec_at_recall_0.30')?.cutoff, 0.3);
  });
});

describe('commandLine', () => {
  test('lists the flags that reproduce the output', () => {
    assert.equal(commandLine(DEFAULT_SETTINGS, { selection: 'official', perTopic: false }, 'qrels.txt', 'run 1.txt'), "trec_eval -m official qrels.txt 'run 1.txt'");
    const settings = { ...DEFAULT_SETTINGS, averageComplete: true, relevanceLevel: 2, maxDocsPerTopic: 100, judgedDocsOnly: true, cutoffs: { mode: 'custom' as const, values: [1, 2] } };
    assert.equal(
      commandLine(settings, { selection: 'official', perTopic: true }, 'q', 'r'),
      'trec_eval -q -c -l2 -M100 -J -m official -m P.1,2 q r',
    );
    assert.match(commandLine(settings, { selection: 'all', perTopic: false }, 'q', 'r'), /-m all_trec -m P\.1,2 -m recall\.1,2 .* -m unj\.1,2 q r$/);
  });
});

describe('exports', () => {
  const qrels = parseQrels('1 0 a 1\n1 0 b 0\n2 0 c 1\n');
  const ev = evaluateRun(parseRun('1 Q0 a 1 2 r\n1 Q0 b 2 1 r\n2 Q0 x 1 1 r\n'), qrels);
  const runs = [{ name: 'my, run', fileName: 'run.txt', evaluation: ev }];

  test('CSV at full precision, quoted where needed', () => {
    const summary = summaryCsv(runs).split('\n');
    assert.equal(summary[0], 'run,runid,measure,value');
    assert.ok(summary.includes('"my, run",r,map,0.5'));
    const topics = topicsCsv(runs);
    assert.match(topics, /^"my, run",2,num_ret,1$/m);
    assert.doesNotMatch(topics, /gm_map/);
  });

  test('JSON with per-topic values', () => {
    const json = resultsJson(runs, 'qrels.txt', true) as { runs: Array<{ summary: Record<string, unknown>; topics: Record<string, Record<string, unknown>> }> };
    assert.equal(json.runs[0]?.summary['map'], 0.5);
    assert.equal(json.runs[0]?.topics['1']?.['relstring'], '10');
  });
});
