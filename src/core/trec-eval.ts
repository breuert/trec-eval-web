/*! Derived from trec_eval (https://github.com/usnistgov/trec_eval); NIST is the source of
 * the software. Changed on 2026-11-18: te_form_res_rels and the computation of the
 * supported measures were translated from C to TypeScript (see THIRD_PARTY_NOTICES.md).
 * License of trec_eval:
 *
 * The code for the original trec_eval, up to version 9, are Copyright (C) 2008 Chris Buckley.
 * Significant modifications have been done by Ian Soboroff as an employee of NIST. Other
 * modifications and ongoing support are by Ian Soboroff and other contributors on
 * https://github.com/usnistgov/trec_eval. trec_eval is now made available under the following
 * license.
 *
 * NIST-developed software is provided by NIST as a public service. You may use, copy, and
 * distribute copies of the software in any medium, provided that you keep intact this entire
 * notice. You may improve, modify, and create derivative works of the software or any portion
 * of the software, and you may copy and distribute such modifications or works. Modified works
 * should carry a notice stating that you changed the software and should note the date and
 * nature of any such change. Please explicitly acknowledge the National Institute of Standards
 * and Technology as the source of the software.
 *
 * NIST-developed software is expressly provided "AS IS." NIST MAKES NO WARRANTY OF ANY KIND,
 * EXPRESS, IMPLIED, IN FACT, OR ARISING BY OPERATION OF LAW, INCLUDING, WITHOUT LIMITATION, THE
 * IMPLIED WARRANTY OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND
 * DATA ACCURACY. NIST NEITHER REPRESENTS NOR WARRANTS THAT THE OPERATION OF THE SOFTWARE WILL BE
 * UNINTERRUPTED OR ERROR-FREE, OR THAT ANY DEFECTS WILL BE CORRECTED. NIST DOES NOT WARRANT OR
 * MAKE ANY REPRESENTATIONS REGARDING THE USE OF THE SOFTWARE OR THE RESULTS THEREOF, INCLUDING
 * BUT NOT LIMITED TO THE CORRECTNESS, ACCURACY, RELIABILITY, OR USEFULNESS OF THE SOFTWARE.
 *
 * You are solely responsible for determining the appropriateness of using and distributing the
 * software and you assume all risks associated with its use, including but not limited to the
 * risks and costs of program errors, compliance with applicable laws, damage to or loss of data,
 * programs or equipment, and the unavailability or interruption of operation. This software is
 * not intended to be used in any situation where a failure could cause risk of injury or damage
 * to property. The software developed by NIST employees is not subject to copyright protection
 * within the United States.
 */

/**
 * A port of trec_eval's per-topic computations.
 *
 * Each function is a transcription of the corresponding trec_eval source file
 * (`form_res_rels.c`, `m_P.c`, `m_ndcg.c`, ...) that keeps the order of floating-point
 * operations, so that values agree with trec_eval to the last bit (nDCG can differ in the
 * last bits because JavaScript's `Math.log2` is not the C library's `log2`). The tests in
 * `test/` compare every value with trec_eval 10 built from source.
 */
import { compareCodePoints } from './compare.ts';
import { RECALL_LEVELS, RELSTRING_LENGTH } from './measures.ts';
import type { Cutoffs, FamilyId, MeasureSet } from './measures.ts';
import type { Judgements, Ranking, ScoredDoc } from './trec-format.ts';

/** Relevance value of a retrieved document that is not in the qrels. */
export const RELVALUE_NONPOOL = -1;
/** Relevance value of a retrieved document judged with a negative label (pooled but unjudged). */
export const RELVALUE_UNJUDGED = -2;
/** `MIN_GEO_MEAN` and `INFAP_EPSILON` in trec_eval.h. */
export const MIN_GEO_MEAN = 0.00001;
const INFAP_EPSILON = 0.00001;

/**
 * How iprec_at_recall and 11pt_avg turn a recall level into a number of relevant documents.
 *
 * - `v10`: `lround(level * num_rel)`, trec_eval 10, the same on every CPU.
 * - `v9`: `(long) (level * num_rel + 0.9)` with two roundings, as trec_eval 9.x (and
 *   pytrec_eval) compute it on x86-64.
 * - `v9-fma`: the same expression with one rounding: compilers for ARM (Apple Silicon,
 *   aarch64 Linux) fuse the multiply-add, which changes the result for some numbers of
 *   relevant documents at the levels 0.3 and 0.7 (for example 3, 23 and 57).
 */
export type IprecRounding = 'v10' | 'v9' | 'v9-fma';

export interface TopicOptions {
  /** `-l`: minimum label of a relevant document (default 1). */
  readonly relevanceLevel: number;
  /** `-M`: evaluate only the top documents of each topic (default: all). */
  readonly maxDocsPerTopic: number;
  /** `-J`: remove unjudged documents from the ranking before evaluating. */
  readonly judgedDocsOnly: boolean;
  readonly iprecRounding: IprecRounding;
}

export const DEFAULT_TOPIC_OPTIONS: TopicOptions = { relevanceLevel: 1, maxDocsPerTopic: Infinity, judgedDocsOnly: false, iprecRounding: 'v10' };

/** trec_eval refuses the input (it prints the message and stops). */
export class TrecEvalError extends Error {
  override readonly name = 'TrecEvalError';
}

/** The intermediate representation trec_eval builds for every topic (`RES_RELS`). */
export interface ResRels {
  /** Relevance of the retrieved documents in rank order. */
  readonly relList: Int32Array;
  readonly numRet: number;
  readonly numRel: number;
  readonly numRelRet: number;
  readonly numNonpool: number;
  readonly numUnjudgedInPool: number;
  /** Number of judged documents per non-negative label (index = label). */
  readonly relLevels: readonly number[];
  readonly numRelLevels: number;
}

/** trec_eval's ranking order (`comp_sim_docno`): score descending, ties by docid descending. */
export function compareRanked(x: ScoredDoc, y: ScoredDoc): number {
  if (x.score > y.score) return -1;
  if (x.score < y.score) return 1;
  return compareCodePoints(y.docId, x.docId);
}

/** `te_form_res_rels`: rank one topic's documents and merge them with its judgements. */
export function formResRels(topic: string, ranking: Ranking, judgements: Judgements, options: TopicOptions = DEFAULT_TOPIC_OPTIONS): ResRels {
  const level = options.relevanceLevel;
  const docs = ranking.slice().sort(compareRanked);
  const numResults = Math.min(docs.length, options.maxDocsPerTopic);

  const seen = new Set<string>();
  for (let i = 0; i < numResults; i++) {
    const docId = (docs[i] as ScoredDoc).docId;
    if (seen.has(docId)) {
      throw new TrecEvalError(`Topic ${topic} retrieves document "${docId}" more than once. trec_eval stops with "duplicate docs" for such runs; remove the repeated lines.`);
    }
    seen.add(docId);
  }

  const rels = new Int32Array(numResults);
  for (let i = 0; i < numResults; i++) {
    const label = judgements.get((docs[i] as ScoredDoc).docId);
    rels[i] = label === undefined ? RELVALUE_NONPOOL : label < 0 ? RELVALUE_UNJUDGED : label;
  }

  let maxLabel = -1;
  for (const label of judgements.values()) if (label > maxLabel) maxLabel = label;
  const relLevels = new Array<number>(Math.max(maxLabel + 1, 0)).fill(0);
  for (const label of judgements.values()) if (label >= 0) relLevels[label] = (relLevels[label] as number) + 1;

  let relList: Int32Array;
  let numRelRet = 0;
  let numNonpool = 0;
  let numUnjudgedInPool = 0;
  if (options.judgedDocsOnly) {
    // Judged documents keep their relative order; unjudged ones are dropped.
    relList = rels.filter((rel) => rel >= 0);
    for (const rel of relList) if (rel >= level) numRelRet++;
  } else {
    relList = rels;
    for (const rel of rels) {
      if (rel === RELVALUE_NONPOOL) numNonpool++;
      else if (rel === RELVALUE_UNJUDGED) numUnjudgedInPool++;
      else if (rel >= level) numRelRet++;
    }
  }

  let numRel = 0;
  let numRelLevels = 0;
  for (let i = 0; i < relLevels.length; i++) {
    const count = relLevels[i] as number;
    if (count) {
      numRelLevels = i + 1;
      if (i >= level) numRel += count;
    }
  }

  return { relList, numRet: relList.length, numRel, numRelRet, numNonpool, numUnjudgedInPool, relLevels, numRelLevels };
}

type Out = Float64Array;

/** m_P.c */
function precision(rr: ResRels, level: number, cutoffs: readonly number[], out: Out, off: number): void {
  let ci = 0;
  let relSoFar = 0;
  for (let i = 0; i < rr.numRet; i++) {
    if (i === cutoffs[ci]) {
      out[off + ci] = relSoFar / i;
      if (++ci === cutoffs.length) break;
    }
    if ((rr.relList[i] as number) >= level) relSoFar++;
  }
  for (; ci < cutoffs.length; ci++) out[off + ci] = relSoFar / (cutoffs[ci] as number);
}

/** m_recall.c */
function recall(rr: ResRels, level: number, cutoffs: readonly number[], out: Out, off: number): void {
  if (rr.numRel === 0) return;
  let ci = 0;
  let relSoFar = 0;
  for (let i = 0; i < rr.numRet; i++) {
    if (i === cutoffs[ci]) {
      out[off + ci] = relSoFar / rr.numRel;
      if (++ci === cutoffs.length) break;
    }
    if ((rr.relList[i] as number) >= level) relSoFar++;
  }
  for (; ci < cutoffs.length; ci++) out[off + ci] = relSoFar / rr.numRel;
}

/** m_rel_P.c */
function relativePrecision(rr: ResRels, level: number, cutoffs: readonly number[], out: Out, off: number): void {
  if (rr.numRel === 0) return;
  let ci = 0;
  let relSoFar = 0;
  for (let i = 0; i < rr.numRet; i++) {
    if (i === cutoffs[ci]) {
      out[off + ci] = relSoFar / (i > rr.numRel ? rr.numRel : i);
      if (++ci === cutoffs.length) break;
    }
    if ((rr.relList[i] as number) >= level) relSoFar++;
  }
  for (; ci < cutoffs.length; ci++) {
    const k = cutoffs[ci] as number;
    out[off + ci] = relSoFar / (k > rr.numRel ? rr.numRel : k);
  }
}

/** m_success.c */
function success(rr: ResRels, level: number, cutoffs: readonly number[], out: Out, off: number): void {
  let ci = 0;
  let relSoFar = 0;
  for (let i = 0; i < rr.numRet; i++) {
    if (i === cutoffs[ci]) {
      out[off + ci] = relSoFar ? 1.0 : 0.0;
      if (++ci === cutoffs.length) break;
    }
    if ((rr.relList[i] as number) >= level) relSoFar++;
  }
  for (; ci < cutoffs.length; ci++) out[off + ci] = relSoFar ? 1.0 : 0.0;
}

/** m_unjudged.c */
function unjudged(rr: ResRels, cutoffs: readonly number[], out: Out, off: number): void {
  let ci = 0;
  let unjSoFar = 0;
  for (let i = 0; i < rr.numRet; i++) {
    if (i === cutoffs[ci]) {
      out[off + ci] = unjSoFar / i;
      if (++ci === cutoffs.length) break;
    }
    const rel = rr.relList[i] as number;
    if (rel === RELVALUE_NONPOOL || rel === RELVALUE_UNJUDGED) unjSoFar++;
  }
  for (; ci < cutoffs.length; ci++) out[off + ci] = unjSoFar / (cutoffs[ci] as number);
}

/**
 * m_ndcg.c with the default gains (gain of a document = its label).
 * `setup_gains` then lists the labels 0..numRelLevels-1 in increasing gain order.
 */
function ndcg(rr: ResRels): number | undefined {
  const numGains = rr.numRelLevels;
  const gainOf = (rel: number): number => (rel >= 0 && rel < numGains ? rel : 0);
  let resultsDcg = 0;
  let idealDcg = 0;
  let curLevel = numGains - 1;
  let idealGain = curLevel >= 0 ? curLevel : 0;
  let numAtLevel = 0;
  let i = 0;
  for (; i < rr.numRet && idealGain > 0; i++) {
    const resultsGain = gainOf(rr.relList[i] as number);
    if (resultsGain !== 0) resultsDcg += resultsGain / Math.log2(i + 2);
    numAtLevel++;
    while (curLevel >= 0 && numAtLevel > (rr.relLevels[curLevel] as number)) {
      numAtLevel = 1;
      curLevel--;
      idealGain = curLevel >= 0 ? curLevel : 0;
    }
    if (idealGain > 0) idealDcg += idealGain / Math.log2(i + 2);
  }
  for (; i < rr.numRet; i++) {
    const resultsGain = gainOf(rr.relList[i] as number);
    if (resultsGain !== 0) resultsDcg += resultsGain / Math.log2(i + 2);
  }
  while (idealGain > 0) {
    numAtLevel++;
    while (curLevel >= 0 && numAtLevel > (rr.relLevels[curLevel] as number)) {
      numAtLevel = 1;
      curLevel--;
      idealGain = curLevel >= 0 ? curLevel : 0;
    }
    if (idealGain > 0) idealDcg += idealGain / Math.log2(i + 2);
    i++;
  }
  return idealDcg > 0 ? resultsDcg / idealDcg : undefined;
}

/** m_ndcg_cut.c */
function ndcgCut(rr: ResRels, cutoffs: readonly number[], out: Out, off: number): void {
  let ci = 0;
  let sum = 0;
  for (let i = 0; i < rr.numRet; i++) {
    if (i === cutoffs[ci]) {
      out[off + ci] = sum;
      if (++ci === cutoffs.length) break;
    }
    const gain = rr.relList[i] as number;
    if (gain > 0) sum += gain / Math.log2(i + 2);
  }
  for (; ci < cutoffs.length; ci++) out[off + ci] = sum;

  // Ideal DCG, normalizing each cutoff as it is passed. A topic without judged
  // documents (numRelLevels = 0) has no ideal ranking; the C code then reads
  // stale memory, here the values simply stay unnormalized (they are 0).
  ci = 0;
  let curLvl = rr.numRelLevels - 1;
  let lvlCount = 0;
  let idealDcg = 0;
  if (curLvl > 0) {
    for (let i = 0; ; i++) {
      lvlCount++;
      while (curLvl > 0 && lvlCount > (rr.relLevels[curLvl] as number)) {
        curLvl--;
        lvlCount = 1;
      }
      if (curLvl === 0) break;
      if (i === cutoffs[ci]) {
        if (idealDcg > 0) out[off + ci] = (out[off + ci] as number) / idealDcg;
        if (++ci === cutoffs.length) break;
      }
      idealDcg += curLvl / Math.log2(i + 2);
    }
  }
  for (; ci < cutoffs.length; ci++) {
    if (idealDcg > 0) out[off + ci] = (out[off + ci] as number) / idealDcg;
  }
}

/** m_map_cut.c */
function mapCut(rr: ResRels, level: number, cutoffs: readonly number[], out: Out, off: number): void {
  if (rr.numRel === 0) return;
  let ci = 0;
  let relSoFar = 0;
  let sum = 0;
  for (let i = 0; i < rr.numRet; i++) {
    if (i === cutoffs[ci]) {
      out[off + ci] = sum / rr.numRel;
      if (++ci === cutoffs.length) break;
    }
    if ((rr.relList[i] as number) >= level) {
      relSoFar++;
      sum += relSoFar / (i + 1);
    }
  }
  for (; ci < cutoffs.length; ci++) out[off + ci] = sum / rr.numRel;
}

/** m_Rprec.c */
function rPrecision(rr: ResRels, level: number): number {
  const numToLookAt = Math.min(rr.numRet, rr.numRel);
  if (numToLookAt === 0) return 0;
  let relSoFar = 0;
  for (let i = 0; i < numToLookAt; i++) if ((rr.relList[i] as number) >= level) relSoFar++;
  return relSoFar / rr.numRel;
}

/** m_infap.c */
function infAP(rr: ResRels, level: number): number {
  let nonrelSoFar = 0;
  let relSoFar = 0;
  let poolUnjudgedSoFar = 0;
  let value = 0.0;
  for (let j = 0; j < rr.numRet; j++) {
    const rel = rr.relList[j] as number;
    if (rel === RELVALUE_NONPOOL) continue;
    if (rel === RELVALUE_UNJUDGED) {
      poolUnjudgedSoFar++;
      continue;
    }
    if (rel >= 0 && rel < level) {
      nonrelSoFar++;
    } else {
      relSoFar++;
      if (j === 0) {
        value += 1.0;
      } else {
        const fj = j;
        value +=
          1.0 / (fj + 1.0) +
          (fj / (fj + 1.0)) *
            ((relSoFar - 1 + nonrelSoFar + poolUnjudgedSoFar) / fj) *
            ((relSoFar - 1 + INFAP_EPSILON) / (relSoFar - 1 + nonrelSoFar + 2 * INFAP_EPSILON));
      }
    }
  }
  if (rr.numRel) value /= rr.numRel;
  return value;
}

/** m_bpref.c (and the per-topic part of m_gm_bpref.c, which computes the same value) */
function bpref(rr: ResRels, level: number): number {
  let numNonrel = 0;
  for (let j = 0; j < level; j++) numNonrel += rr.relLevels[j] ?? 0;
  let nonrelSoFar = 0;
  let value = 0.0;
  for (let j = 0; j < rr.numRet; j++) {
    const rel = rr.relList[j] as number;
    if (rel === RELVALUE_NONPOOL || rel === RELVALUE_UNJUDGED) continue;
    if (rel >= 0 && rel < level) {
      nonrelSoFar++;
    } else if (nonrelSoFar > 0) {
      value += 1.0 - Math.min(nonrelSoFar, rr.numRel) / Math.min(numNonrel, rr.numRel);
    } else {
      value += 1.0;
    }
  }
  if (rr.numRel) value /= rr.numRel;
  return value;
}

/** m_recip_rank.c */
function reciprocalRank(rr: ResRels, level: number): number {
  for (let i = 0; i < rr.numRet; i++) if ((rr.relList[i] as number) >= level) return 1.0 / (i + 1);
  return 0;
}

/** m_map.c (and the per-topic part of m_gm_map.c, which computes the same value) */
function averagePrecision(rr: ResRels, level: number): number {
  let relSoFar = 0;
  let sum = 0.0;
  for (let i = 0; i < rr.numRet; i++) {
    if ((rr.relList[i] as number) >= level) {
      relSoFar++;
      sum += relSoFar / (i + 1);
    }
  }
  return relSoFar ? sum / rr.numRel : 0;
}

/** C `lround` for non-negative arguments (round half away from zero). */
function lround(x: number): number {
  const f = Math.floor(x);
  return x - f >= 0.5 ? f + 1 : f;
}

/** A finite double as an exact integer mantissa and a binary exponent. */
function decompose(x: number): [mantissa: bigint, exponent: number] {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const biased = (hi >>> 20) & 0x7ff;
  const fraction = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  return biased === 0 ? [fraction, -1074] : [fraction | (1n << 52n), biased - 1075];
}

/** `trunc(fma(a, b, c))`: a·b + c rounded once to double, for non-negative finite operands. */
export function truncFusedMultiplyAdd(a: number, b: number, c: number): number {
  const [ma, ea] = decompose(a);
  const [mb, eb] = decompose(b);
  const [mc, ec] = decompose(c);
  const e = Math.min(ea + eb, ec);
  const exact = ((ma * mb) << BigInt(ea + eb - e)) + (mc << BigInt(ec - e)); // value = exact · 2^e
  const shift = Math.max(exact.toString(2).length - 53, 0);
  let rounded = exact >> BigInt(shift);
  if (shift > 0) {
    const rest = exact - (rounded << BigInt(shift));
    const half = 1n << BigInt(shift - 1);
    if (rest > half || (rest === half && (rounded & 1n) === 1n)) rounded += 1n;
  }
  return Math.trunc(Number(rounded) * 2 ** (e + shift));
}

function recallCutoff(level: number, numRel: number, rounding: IprecRounding): number {
  switch (rounding) {
    case 'v10':
      return lround(level * numRel);
    case 'v9':
      return Math.trunc(level * numRel + 0.9);
    case 'v9-fma':
      return truncFusedMultiplyAdd(level, numRel, 0.9);
  }
}

/**
 * m_iprec_at_recall.c and m_11pt_avg.c share this loop: interpolated precision at every
 * recall level, in level order.
 */
function interpolatedPrecision(rr: ResRels, level: number, rounding: IprecRounding): Float64Array {
  const n = RECALL_LEVELS.length;
  const out = new Float64Array(n);
  const cutoffs = RECALL_LEVELS.map((r) => recallCutoff(r, rr.numRel, rounding));
  let currentCut = n - 1;
  while (currentCut >= 0 && (cutoffs[currentCut] as number) > rr.numRelRet) currentCut--;

  let precis = rr.numRelRet / rr.numRet;
  let intPrecis = precis;
  let relSoFar = rr.numRelRet;
  for (let i = rr.numRet; i > 0 && relSoFar > 0; i--) {
    precis = relSoFar / i;
    if (intPrecis < precis) intPrecis = precis;
    if ((rr.relList[i - 1] as number) >= level) {
      while (currentCut >= 0 && relSoFar === cutoffs[currentCut]) {
        out[currentCut] = intPrecis;
        currentCut--;
      }
      relSoFar--;
    }
  }
  for (; currentCut >= 0; currentCut--) out[currentCut] = intPrecis;
  return out;
}

/** m_relstring.c */
export function relString(rr: ResRels, length = RELSTRING_LENGTH): string {
  let s = '';
  const len = Math.max(0, Math.min(length, rr.numRet));
  for (let i = 0; i < len; i++) {
    const rel = rr.relList[i] as number;
    if (rel > 9) s += '>';
    else if (rel >= 0) s += String(rel);
    else if (rel === RELVALUE_NONPOOL) s += '-';
    else if (rel === RELVALUE_UNJUDGED) s += '.';
    else s += '<';
  }
  return s;
}

/**
 * Every measure of `set` for one topic. Families that trec_eval prints only as a summary
 * hold their per-topic contribution: `gm_map`/`gm_bpref` the logarithm, `num_q` 1.
 */
export function evaluateResRels(rr: ResRels, set: MeasureSet, options: TopicOptions = DEFAULT_TOPIC_OPTIONS): Float64Array {
  const level = options.relevanceLevel;
  const c: Cutoffs = set.cutoffs;
  const out = new Float64Array(set.measures.length);
  const at = (id: FamilyId): number => set.offset.get(id) as number;

  out[at('num_q')] = 1;
  out[at('num_ret')] = rr.numRet;
  out[at('num_rel')] = rr.numRel;
  out[at('num_rel_ret')] = rr.numRelRet;
  const ap = averagePrecision(rr, level);
  out[at('map')] = ap;
  out[at('gm_map')] = Math.log(Math.max(ap, MIN_GEO_MEAN));
  out[at('Rprec')] = rPrecision(rr, level);
  const bp = bpref(rr, level);
  out[at('bpref')] = bp;
  out[at('recip_rank')] = reciprocalRank(rr, level);

  const iprec = interpolatedPrecision(rr, level, options.iprecRounding);
  out.set(iprec, at('iprec_at_recall'));
  precision(rr, level, c.P, out, at('P'));
  recall(rr, level, c.recall, out, at('recall'));
  out[at('infAP')] = infAP(rr, level);
  out[at('gm_bpref')] = Math.log(Math.max(bp, MIN_GEO_MEAN));

  // m_utility.c with the default coefficients 1, -1, 0, 0 and -N 0.
  const [p0, p1, p2, p3, numDocsInColl] = [1.0, -1.0, 0.0, 0.0, 0];
  out[at('utility')] =
    p0 * rr.numRelRet + p1 * (rr.numRet - rr.numRelRet) + p2 * (rr.numRel - rr.numRelRet) + p3 * (numDocsInColl + rr.numRelRet - rr.numRet - rr.numRel);

  // m_11pt_avg.c: the sum of the interpolated precisions in level order, over the number of levels.
  let sum = 0.0;
  for (let k = iprec.length - 1; k >= 0; k--) sum += iprec[k] as number;
  out[at('11pt_avg')] = sum / RECALL_LEVELS.length;

  const nd = ndcg(rr);
  if (nd !== undefined) out[at('ndcg')] = nd;
  ndcgCut(rr, c.ndcg_cut, out, at('ndcg_cut'));
  mapCut(rr, level, c.map_cut, out, at('map_cut'));
  relativePrecision(rr, level, c.relative_P, out, at('relative_P'));
  success(rr, level, c.success, out, at('success'));

  // m_set_P.c, m_set_rel_P.c, m_set_recall.c, m_set_map.c, m_set_F.c
  const { numRet, numRel, numRelRet } = rr;
  if (numRet) out[at('set_P')] = numRelRet / numRet;
  if (numRet && numRel) out[at('set_relative_P')] = numRelRet / Math.min(numRet, numRel);
  if (numRel) out[at('set_recall')] = numRelRet / numRel;
  if (numRet && numRel) out[at('set_map')] = (numRelRet * numRelRet) / (numRet * numRel);
  if (numRelRet) {
    const p = numRelRet / numRet;
    const r = numRelRet / numRel;
    const x = 1.0;
    out[at('set_F')] = ((x + 1.0) * p * r) / (x * p + r);
  }

  out[at('num_nonrel_judged_ret')] = rr.numRet - rr.numNonpool - rr.numUnjudgedInPool - rr.numRelRet;
  unjudged(rr, c.unj, out, at('unj'));
  return out;
}
