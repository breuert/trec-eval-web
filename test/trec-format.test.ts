import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { compareCodePoints } from '../src/core/compare.ts';
import { TrecFormatError, atof, parseQrels, parseRun, strtol } from '../src/core/trec-format.ts';

describe('parseRun (get_trec_results.c)', () => {
  test('keeps file order, sorts topics by code point, takes the run id from the last line', () => {
    const { run, info } = parseRun(['2 Q0 b 1 3.0 first', '10 Q0 x 1 1 first', '2 Q0 a 2 5 last'].join('\n'));
    assert.deepEqual([...run.keys()], ['10', '2']);
    assert.deepEqual(run.get('2')?.map((d) => d.docId), ['b', 'a']);
    assert.equal(info.runId, 'last');
    assert.deepEqual(info.tags, ['first', 'last']);
    assert.equal(info.numTopics, 2);
    assert.equal(info.maxDepth, 2);
  });

  test('ignores columns after the sixth, comments, blank lines and CRLF', () => {
    const { run, info } = parseRun('# ir_metadata.start\r\n\r\n  # indented comment\n1\tQ0\td1\t1\t0.5\trun\textra stuff\r\n');
    assert.equal(run.get('1')?.[0]?.docId, 'd1');
    assert.equal(info.extraColumns, 1);
    assert.deepEqual(info.comments, [' ir_metadata.start', ' indented comment']);
  });

  test('splits on ASCII whitespace only, like C isspace', () => {
    const { run } = parseRun('1 Q0 doc one 1 2 tag');
    assert.equal(run.get('1')?.[0]?.docId, 'doc one');
  });

  test('reads scores like C atof: numeric prefix, else 0', () => {
    const { run, info } = parseRun(['1 Q0 a 1 1.5x t', '1 Q0 b 2 high t', '1 Q0 c 3 -inf t'].join('\n'));
    assert.deepEqual(run.get('1')?.map((d) => d.score), [1.5, 0, -Infinity]);
    assert.equal(info.nonNumericScores, 2);
  });

  test('keeps repeated documents for trec_eval to refuse at evaluation', () => {
    const { run, info } = parseRun(['1 Q0 a 1 3 t', '1 Q0 a 2 2 t'].join('\n'));
    assert.equal(run.get('1')?.length, 2);
    assert.equal(info.duplicates, 1);
    assert.deepEqual(info.firstDuplicate, { topic: '1', docId: 'a', line: 2 });
  });

  test('reports malformed lines with their line number', () => {
    assert.throws(() => parseRun('1 Q0 d1 1 0.5 tag\n1 0 d2 1'), (e: unknown) => {
      assert.ok(e instanceof TrecFormatError);
      assert.equal(e.line, 2);
      assert.match(e.message, /qrels file/);
      return true;
    });
    assert.throws(() => parseRun('\n# only a comment\n'), /no run lines/);
  });
});

describe('parseQrels (get_qrels.c)', () => {
  test('reads labels with strtol, counts positive labels', () => {
    const { qrels, info } = parseQrels(['2 0 a 1', '1 0 b 0', '2 0 c 2.0', '2 0 d 1.5', '1 0 e -1'].join('\n'));
    assert.deepEqual([...qrels.keys()], ['1', '2']);
    assert.equal(qrels.get('2')?.get('c'), 2);
    assert.equal(qrels.get('2')?.get('d'), 1);
    assert.equal(info.truncatedLabels, 2);
    assert.equal(info.numRelevant, 3);
    assert.deepEqual([...info.labels], [
      [-1, 1],
      [0, 1],
      [1, 2],
      [2, 1],
    ]);
  });

  test('refuses a document judged twice, like trec_eval', () => {
    assert.throws(() => parseQrels('1 0 a 1\n1 0 b 0\n1 0 a 0'), (e: unknown) => {
      assert.ok(e instanceof TrecFormatError);
      assert.equal(e.line, 3);
      assert.match(e.message, /judged twice.*line 1/);
      return true;
    });
  });

  test('rejects other column counts and unreadable labels', () => {
    assert.throws(() => parseQrels('1 Q0 a 1 1.5 run'), /run file/);
    assert.throws(() => parseQrels('1 0 a relevant'), /not a number/);
  });
});

describe('C number parsing', () => {
  test('atof', () => {
    assert.deepEqual(atof('1e3'), { value: 1000, complete: true });
    assert.deepEqual(atof('-.5'), { value: -0.5, complete: true });
    assert.deepEqual(atof('1e'), { value: 1, complete: false });
    assert.deepEqual(atof('0x10'), { value: 16, complete: true });
    assert.deepEqual(atof('Infinity'), { value: Infinity, complete: true });
    assert.ok(Number.isNaN(atof('nan').value));
    assert.deepEqual(atof('abc'), { value: 0, complete: false });
  });

  test('strtol', () => {
    assert.deepEqual(strtol('-3'), { value: -3, complete: true });
    assert.deepEqual(strtol('2.9'), { value: 2, complete: false });
    assert.equal(strtol('x1'), undefined);
  });
});

describe('compareCodePoints', () => {
  test('orders like C strcmp on UTF-8, unlike UTF-16 comparison', () => {
    const emoji = '\u{1F600}';
    const fullwidthA = 'Ａ';
    assert.ok(emoji < fullwidthA, 'UTF-16 order puts the surrogate pair first');
    assert.equal(compareCodePoints(emoji, fullwidthA), 1);
    assert.deepEqual(['b', emoji, 'é', fullwidthA, 'B', '10', '9'].sort(compareCodePoints), ['10', '9', 'B', 'b', 'é', fullwidthA, emoji]);
  });
});
