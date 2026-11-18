/**
 * Readers for TREC run and qrels files that accept what trec_eval 10 accepts
 * (`get_trec_results.c`, `get_qrels.c`) and read it the same way:
 *
 * - runs: at least six whitespace-separated columns `topic Q0 docid rank score tag`;
 *   further columns are ignored, the rank column is ignored, the score is read with
 *   C `atof` (a non-numeric score is 0), and the run id is the tag of the last line,
 * - qrels: exactly four columns `topic iteration docid relevance`; the label is read
 *   with C `strtol` (`2.0` is 2, `0.5` is 0, which trec_eval accepts with a warning),
 * - lines starting with `#` are comments (trec_eval 10); blank lines are skipped,
 * - whitespace is ASCII whitespace (C `isspace`), not Unicode spaces,
 * - topics are ordered like C `strcmp` on UTF-8 (code-point order).
 *
 * trec_eval refuses a document that occurs twice in the ranking of an evaluated
 * topic, or that is judged twice for a topic ("duplicate docs"). Qrels with a repeated
 * judgement are rejected here; repeated run documents are kept and reported when the
 * topic is evaluated, because trec_eval only checks the documents it evaluates (`-M`).
 */
import { compareCodePoints } from './compare.ts';

export interface ScoredDoc {
  readonly docId: string;
  readonly score: number;
}

/** Retrieved documents of one topic, in file order (repeated documents included). */
export type Ranking = readonly ScoredDoc[];

/** Topic id → ranking. Iteration order is code-point order of the topic ids. */
export type Run = ReadonlyMap<string, Ranking>;

/** Judgements of one topic: document id → relevance label. */
export type Judgements = ReadonlyMap<string, number>;

/** Topic id → judgements. Iteration order is code-point order of the topic ids. */
export type Qrels = ReadonlyMap<string, Judgements>;

export class TrecFormatError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(`Line ${line}: ${message}`);
    this.name = 'TrecFormatError';
    this.line = line;
  }
}

export interface RunInfo {
  /** What trec_eval reports as `runid`: the tag of the last line of the file. */
  readonly runId: string;
  /** Distinct tags (sixth column) in order of first appearance. */
  readonly tags: readonly string[];
  readonly numLines: number;
  readonly numTopics: number;
  readonly minDepth: number;
  readonly maxDepth: number;
  /** Lines that repeat an earlier (topic, docid) pair. */
  readonly duplicates: number;
  /** First repeated (topic, docid) pair, for messages. */
  readonly firstDuplicate?: { readonly topic: string; readonly docId: string; readonly line: number };
  /** Scores that are not entirely a number; `atof` reads their numeric prefix (or 0). */
  readonly nonNumericScores: number;
  /** Lines with more than six columns; trec_eval ignores the rest of the line. */
  readonly extraColumns: number;
  /** Comment lines (for example ir_metadata), without the leading `#`. */
  readonly comments: readonly string[];
}

export interface ParsedRun {
  readonly run: Run;
  readonly info: RunInfo;
}

export interface QrelsInfo {
  readonly numLines: number;
  readonly numTopics: number;
  /** Judgements with a label of at least 1 (relevant at trec_eval's default level). */
  readonly numRelevant: number;
  /** Label → number of judgements, ascending by label. */
  readonly labels: ReadonlyMap<number, number>;
  /** Labels that are not plain integers (for example `1.5`); `strtol` keeps the integer part. */
  readonly truncatedLabels: number;
  readonly comments: readonly string[];
}

export interface ParsedQrels {
  readonly qrels: Qrels;
  readonly info: QrelsInfo;
}

/** trec_eval keeps a label array per topic; refuse labels that would make it absurdly large. */
const MAX_ABS_LABEL = 1_000_000;

/** C `isspace` in the C locale. */
const SPACE = /[ \t\n\v\f\r]+/;

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const HEX = /^([+-]?)0[xX]((?:[0-9a-fA-F]+\.?[0-9a-fA-F]*|\.[0-9a-fA-F]+))(?:[pP]([+-]?\d+))?/;
const SPECIAL = /^([+-]?)(inf(?:inity)?|nan(?:\([0-9A-Za-z_]*\))?)/i;

/** C `atof`/`strtod`: the longest numeric prefix of `token`, 0 if there is none. */
export function atof(token: string): { readonly value: number; readonly complete: boolean } {
  const hex = HEX.exec(token);
  if (hex) {
    const [all, sign, digits, exponent] = hex as unknown as [string, string, string, string | undefined];
    const [intPart, fracPart = ''] = digits.split('.');
    let value = 0;
    for (const d of intPart ?? '') value = value * 16 + Number.parseInt(d, 16);
    let scale = 1 / 16;
    for (const d of fracPart) {
      value += Number.parseInt(d, 16) * scale;
      scale /= 16;
    }
    value *= 2 ** Number(exponent ?? 0);
    return { value: sign === '-' ? -value : value, complete: all.length === token.length };
  }
  const special = SPECIAL.exec(token);
  if (special) {
    const [all, sign, word] = special as unknown as [string, string, string];
    const value = word.toLowerCase().startsWith('inf') ? Infinity : NaN;
    return { value: sign === '-' ? -value : value, complete: all.length === token.length };
  }
  const decimal = DECIMAL.exec(token);
  if (decimal) return { value: Number(decimal[0]), complete: decimal[0].length === token.length };
  return { value: 0, complete: false };
}

/** C `strtol(token, &end, 10)`: undefined when no digits can be read. */
export function strtol(token: string): { readonly value: number; readonly complete: boolean } | undefined {
  const m = /^[+-]?\d+/.exec(token);
  if (!m) return undefined;
  return { value: Number.parseInt(m[0], 10), complete: m[0].length === token.length };
}

function* lines(text: string): Generator<[lineNo: number, content: string]> {
  let start = 0;
  let lineNo = 0;
  const n = text.length;
  while (start < n) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = n;
    lineNo++;
    yield [lineNo, text.slice(start, end)];
    start = end + 1;
  }
}

/** Columns of a line, or undefined for blank lines; comments go to `comments`. */
function columns(raw: string, comments: string[]): string[] | undefined {
  const line = raw.replace(/^[ \t\v\f\r]+|[ \t\v\f\r]+$/g, '');
  if (line === '') return undefined;
  if (line.startsWith('#')) {
    comments.push(line.slice(1));
    return undefined;
  }
  return line.split(SPACE);
}

function sortedByTopic<V>(map: Map<string, V>): Map<string, V> {
  const out = new Map<string, V>();
  for (const key of [...map.keys()].sort(compareCodePoints)) out.set(key, map.get(key) as V);
  return out;
}

export function parseRun(text: string): ParsedRun {
  const docs = new Map<string, ScoredDoc[]>();
  const seen = new Map<string, Set<string>>();
  const tags: string[] = [];
  const tagSet = new Set<string>();
  const comments: string[] = [];
  let runId = '';
  let numLines = 0;
  let duplicates = 0;
  let firstDuplicate: RunInfo['firstDuplicate'];
  let nonNumericScores = 0;
  let extraColumns = 0;

  for (const [lineNo, raw] of lines(text)) {
    const cols = columns(raw, comments);
    if (cols === undefined) continue;
    if (cols.length < 6) {
      const hint = cols.length === 4 ? ' This looks like a qrels file.' : '';
      throw new TrecFormatError(`expected 6 columns (topic, Q0, docid, rank, score, tag) but found ${cols.length}.${hint}`, lineNo);
    }
    if (cols.length > 6) extraColumns++;
    const [topic, , docId, , scoreToken, tag] = cols as [string, string, string, string, string, string];
    const score = atof(scoreToken);
    if (!score.complete) nonNumericScores++;
    numLines++;
    runId = tag;
    if (!tagSet.has(tag)) {
      tagSet.add(tag);
      tags.push(tag);
    }
    let ranking = docs.get(topic);
    let ids = seen.get(topic);
    if (ranking === undefined || ids === undefined) {
      ranking = [];
      ids = new Set();
      docs.set(topic, ranking);
      seen.set(topic, ids);
    }
    if (ids.has(docId)) {
      duplicates++;
      firstDuplicate ??= { topic, docId, line: lineNo };
    } else {
      ids.add(docId);
    }
    ranking.push({ docId, score: score.value });
  }

  if (numLines === 0) throw new TrecFormatError('the file contains no run lines.', 1);

  let minDepth = Infinity;
  let maxDepth = 0;
  for (const ranking of docs.values()) {
    minDepth = Math.min(minDepth, ranking.length);
    maxDepth = Math.max(maxDepth, ranking.length);
  }

  return {
    run: sortedByTopic(docs),
    info: {
      runId,
      tags,
      numLines,
      numTopics: docs.size,
      minDepth,
      maxDepth,
      duplicates,
      ...(firstDuplicate ? { firstDuplicate } : {}),
      nonNumericScores,
      extraColumns,
      comments,
    },
  };
}

export function parseQrels(text: string): ParsedQrels {
  const qrels = new Map<string, Map<string, number>>();
  const firstLine = new Map<string, number>();
  const comments: string[] = [];
  let numLines = 0;
  let truncatedLabels = 0;

  for (const [lineNo, raw] of lines(text)) {
    const cols = columns(raw, comments);
    if (cols === undefined) continue;
    if (cols.length !== 4) {
      const hint = cols.length >= 6 ? ' This looks like a run file.' : '';
      throw new TrecFormatError(`expected 4 columns (topic, iteration, docid, relevance) but found ${cols.length}.${hint}`, lineNo);
    }
    const [topic, , docId, labelToken] = cols as [string, string, string, string];
    const parsed = strtol(labelToken);
    if (parsed === undefined) throw new TrecFormatError(`relevance label "${labelToken}" is not a number.`, lineNo);
    if (Math.abs(parsed.value) > MAX_ABS_LABEL) throw new TrecFormatError(`relevance label ${parsed.value} is out of range.`, lineNo);
    if (!parsed.complete) truncatedLabels++;
    numLines++;
    let judgements = qrels.get(topic);
    if (judgements === undefined) {
      judgements = new Map();
      qrels.set(topic, judgements);
    }
    if (judgements.has(docId)) {
      const earlier = firstLine.get(`${topic}\u0000${docId}`);
      throw new TrecFormatError(
        `document "${docId}" is judged twice for topic ${topic} (also on line ${earlier}). trec_eval stops with "duplicate docs" for such qrels; remove one of the lines.`,
        lineNo,
      );
    }
    judgements.set(docId, parsed.value);
    firstLine.set(`${topic}\u0000${docId}`, lineNo);
  }

  if (numLines === 0) throw new TrecFormatError('the file contains no judgements.', 1);

  const labelCounts = new Map<number, number>();
  let numRelevant = 0;
  for (const judgements of qrels.values()) {
    for (const label of judgements.values()) {
      if (label > 0) numRelevant++;
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    }
  }
  const labels = new Map([...labelCounts.entries()].sort((a, b) => a[0] - b[0]));

  return {
    qrels: sortedByTopic(qrels),
    info: { numLines, numTopics: qrels.size, numRelevant, labels, truncatedLabels, comments },
  };
}
