/**
 * Synthetic example data, generated in the browser from a fixed seed.
 *
 * Every topic has a pool of judged documents (labels 0, 1, 2; a few -1 for pooled but
 * unjudged) and many unjudged ones, some of which are relevant. A "system" scores a
 * document as `weight · relevance + shared noise + own noise`; documents outside its
 * candidate set are pushed down the ranking. The systems trade early precision against
 * recall, so their curves over rank cutoffs cross.
 */
export interface DemoRun {
  readonly fileName: string;
  readonly text: string;
}

export interface DemoData {
  readonly qrels: string;
  readonly runs: readonly DemoRun[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): () => number {
  return () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

interface Doc {
  readonly id: string;
  readonly relevance: number;
  readonly shared: number;
}

const DEPTH = 1000;

interface System {
  readonly tag: string;
  /** How strongly relevance drives the score. */
  readonly weight: number;
  readonly noise: number;
  /** Share of the relevant documents the system can find at all. */
  readonly coverage: number;
  readonly seed: number;
}

const SYSTEMS: readonly System[] = [
  { tag: 'lexical', weight: 1.0, noise: 0.9, coverage: 0.9, seed: 11 },
  { tag: 'lexical-prf', weight: 1.15, noise: 0.95, coverage: 0.97, seed: 12 },
  { tag: 'dense', weight: 1.7, noise: 0.8, coverage: 0.72, seed: 13 },
  { tag: 'hybrid', weight: 1.65, noise: 0.75, coverage: 0.94, seed: 14 },
];

export function generateDemo(): DemoData {
  const random = mulberry32(2026);
  const normal = gaussian(random);
  const topics: Array<{ id: string; docs: Doc[] }> = [];
  const qrels: string[] = [];
  for (let t = 0; t < 50; t++) {
    const id = String(401 + t);
    const judged = 120 + Math.floor(random() * 280);
    const relevantShare = 0.04 + random() * 0.2;
    const docs: Doc[] = [];
    for (let k = 0; k < judged + 1500; k++) {
      const docId = `D${id}-${String(k * 7919 % 100000).padStart(5, '0')}`;
      let relevance = 0;
      if (k < judged) {
        const r = random();
        relevance = r < relevantShare * 0.3 ? 2 : r < relevantShare ? 1 : 0;
        const label = random() < 0.03 ? -1 : relevance;
        qrels.push(`${id} 0 ${docId} ${label}`);
      } else if (random() < 0.012) {
        relevance = 1; // relevant but never judged
      }
      docs.push({ id: docId, relevance, shared: normal() });
    }
    topics.push({ id, docs });
  }

  const runs = SYSTEMS.map((system) => {
    const rnd = mulberry32(system.seed);
    const noise = gaussian(rnd);
    const lines: string[] = [];
    for (const topic of topics) {
      const scores = topic.docs.map((d) => {
        const found = d.relevance === 0 || rnd() < system.coverage;
        return system.weight * d.relevance + d.shared + system.noise * noise() - (found ? 0 : 4);
      });
      const order = topic.docs.map((_, i) => i).sort((a, b) => (scores[b] as number) - (scores[a] as number)).slice(0, DEPTH);
      order.forEach((i, rank) => lines.push(`${topic.id} Q0 ${(topic.docs[i] as Doc).id} ${rank + 1} ${(scores[i] as number).toFixed(4)} ${system.tag}`));
    }
    return { fileName: `example-${system.tag}.txt`, text: lines.join('\n') + '\n' };
  });

  return { qrels: qrels.join('\n') + '\n', runs };
}
