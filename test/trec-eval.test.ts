/**
 * The port against trec_eval built from source (scripts/make_fixtures.py): every value of
 * every topic and of the summary at full precision, and the text output byte for byte.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { evaluateRun } from '../src/core/evaluate.ts';
import { UNSUPPORTED_ALL_TREC, trecEvalText } from '../src/core/output.ts';
import { TrecEvalError, truncFusedMultiplyAdd } from '../src/core/trec-eval.ts';
import { parseQrels, parseRun } from '../src/core/trec-format.ts';
import { fixtureText, isClose, manifest, parseArgs, parseOutput } from './helpers.ts';

const unsupported = new RegExp(`^(${UNSUPPORTED_ALL_TREC.join('|')})(_|\\s)`);

/** Output lines of measures this tool does not compute are not expected from it. */
const supportedLines = (text: string): string => text.split('\n').filter((l) => !unsupported.test(l)).join('\n');

function evaluateCase(c: (typeof manifest.cases)[number]) {
  const inv = parseArgs(c.args, c.rounding);
  const ev = evaluateRun(parseRun(fixtureText(c.run)), parseQrels(fixtureText(c.qrels)), inv.settings);
  return { inv, ev };
}

describe(`trec_eval 10 (${manifest.trec_eval}, built on ${manifest.machine})`, () => {
  for (const c of manifest.cases.filter((x) => x.version === 10 && x.exit === 0)) {
    test(`${c.name}: trec_eval ${c.args.join(' ')} ${c.qrels} ${c.run}`, () => {
      const { inv, ev } = evaluateCase(c);

      // 1. The text output, line for line.
      const expectedText = supportedLines(fixtureText(c.stdout as string));
      assert.equal(trecEvalText(ev, inv), expectedText);

      // 2. Every value at full precision.
      const expected = parseOutput(fixtureText(c.full as string));
      const topics = new Map(ev.topics.map((t) => [t.topic, t]));
      let compared = 0;
      let exact = 0;
      const errors: string[] = [];
      for (const [name, byTopic] of expected) {
        if (unsupported.test(`${name} `) || name === 'runid') continue;
        for (const [topic, raw] of byTopic) {
          if (name === 'relstring') {
            assert.equal(`'${topics.get(topic)?.relstring}'`, raw, `relstring of ${topic}`);
            continue;
          }
          const m = ev.set.byName.get(name);
          assert.ok(m, `the port lacks ${name}`);
          const got = topic === 'all' ? (ev.summary[m.index] as number) : (topics.get(topic)?.values[m.index] as number);
          const want = Number(raw === 'nan' || raw === '-nan' ? NaN : raw);
          compared++;
          if (Object.is(got, want) || got === want) exact++;
          else if (!isClose(got, want)) errors.push(`${name} ${topic}: trec_eval ${raw}, port ${got}`);
        }
      }
      assert.deepEqual(errors.slice(0, 20), [], `${errors.length} of ${compared} values differ`);
      assert.ok(compared > 0);
      // Everything but nDCG (C log2 vs Math.log2) and the geometric means (exp/log) agrees to the bit.
      assert.ok(exact / compared > 0.97, `only ${exact} of ${compared} values are bit-identical`);
    });
  }

  test('a document retrieved twice stops trec_eval, unless -M cuts it off', () => {
    const dup = manifest.cases.find((x) => x.name === 'dup');
    assert.ok(dup && dup.exit !== 0 && /duplicate docs/.test(dup.stderr ?? ''));
    assert.throws(() => evaluateCase(dup), (e: unknown) => e instanceof TrecEvalError && /duplicate docs/.test(e.message));
  });

  test('without -c, judged topics without results are skipped (trec_eval 10 stops, trec_eval 9 skips)', () => {
    const run = parseRun(fixtureText('corner/run.txt'));
    const all = evaluateRun(run, parseQrels(fixtureText('corner/qrels.txt')));
    const intersection = evaluateRun(run, parseQrels(fixtureText('corner/qrels_in_run.txt')));
    assert.deepEqual(all.skippedTopics, ['161']);
    assert.deepEqual(all.ignoredTopics, ['160']);
    assert.deepEqual([...all.summary], [...intersection.summary]);
  });
});

describe('trec_eval 9 rounding of recall levels', () => {
  for (const c of manifest.cases.filter((x) => x.version === 9)) {
    test(`${c.name} (${c.rounding}): iprec_at_recall and 11pt_avg per topic`, () => {
      const { ev } = evaluateCase(c);
      const topics = new Map(ev.topics.map((t) => [t.topic, t]));
      const errors: string[] = [];
      let compared = 0;
      for (const [name, byTopic] of parseOutput(fixtureText(c.full as string))) {
        const m = ev.set.byName.get(name);
        if (!m) continue;
        for (const [topic, raw] of byTopic) {
          if (topic === 'all') continue;
          compared++;
          const got = topics.get(topic)?.values[m.index];
          if (got !== Number(raw)) errors.push(`${name} ${topic}: trec_eval ${raw}, port ${got}`);
        }
      }
      assert.ok(compared > 1000);
      assert.deepEqual(errors, []);
    });
  }

  test('the roundings differ where they should', () => {
    const v9 = manifest.cases.find((x) => x.rounding === 'v9');
    const v10 = manifest.cases.find((x) => x.name === 'corner-q');
    assert.ok(v9 && v10);
    const a = parseOutput(fixtureText(v9.full as string));
    const b = parseOutput(fixtureText(v10.full as string));
    const differs = [...(a.get('iprec_at_recall_0.20') ?? [])].some(([topic, v]) => b.get('iprec_at_recall_0.20')?.get(topic) !== v);
    assert.ok(differs, 'the fixture exercises the rounding change of trec_eval 10');
  });

  test('a fused multiply-add rounds once', () => {
    // 0.7 · 3 + 0.9 is 2.9999999999999996 with two roundings but 3 with one.
    assert.equal(Math.trunc(0.7 * 3 + 0.9), 2);
    assert.equal(truncFusedMultiplyAdd(0.7, 3, 0.9), 3);
    assert.equal(truncFusedMultiplyAdd(0.3, 57, 0.9), 18);
    for (let n = 0; n <= 2000; n += 7) {
      for (const r of [0.0, 0.1, 0.5, 0.9, 1.0]) assert.equal(truncFusedMultiplyAdd(r, n, 0.9), Math.trunc(r * n + 0.9), `${r} · ${n}`);
    }
  });
});
