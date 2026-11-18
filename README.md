# trec_eval web

[trec_eval](https://github.com/usnistgov/trec_eval) in the browser: load a qrels file and up to
eight TREC runs, and get trec_eval's measures as tables, plots by rank cutoff, per-topic views and
trec_eval's own text output.

- **One HTML file.** `dist/index.html` contains all code and styles. Host it on GitHub Pages, put it
  next to a paper's artifacts, or open it from disk; it works offline.
- **Private by construction.** Files are evaluated in the browser tab. The page's
  Content-Security-Policy forbids network requests, so evaluated data cannot leave the machine.
- **Same numbers as trec_eval.** Every per-topic and summary value is checked against trec_eval 10
  (and the changed measures against trec_eval 9) built from source, and the text output line by
  line (see [Verification](#verification)).

Open the page with `#example` (for example `index.html#example` or `#example/cutoffs`) to load
synthetic example data.

## What the page shows

| Tab | Content |
| --- | --- |
| Summary | Headline measures of all runs as a bar chart; every summary value in trec_eval's order, best run in bold |
| Cutoffs | P@k, recall@k, nDCG@k, AP@k, relative P@k, success@k and unjudged@k over the rank cutoffs (log scale); the interpolated precision–recall curve with 11pt_avg |
| Per topic | Any per-topic measure for every run; the per-topic difference of two runs (wins, losses, mean); a table with `relstring` |
| trec_eval output | What `trec_eval [-q] -m official\|set\|all_trec` prints for a run, the matching command line; CSV and JSON downloads of all runs at full precision |

Every chart can be shown as a table and downloaded as SVG, PNG or CSV. The cutoffs are trec_eval's
defaults or one custom list such as `1-20, 50, 100, 1000` for all cutoff measures (trec_eval's
`-m P.1,2,3`), which gives smooth curves.

### Options and trec_eval flags

| Option | trec_eval |
| --- | --- |
| Relevance level | `-l` |
| Documents per topic | `-M` |
| Average over all judged topics | `-c` |
| Judged documents only | `-J` |
| Rank cutoffs | `-m P.…`, `-m recall.…`, `-m ndcg_cut.…`, `-m map_cut.…`, `-m relative_P.…`, `-m success.…`, `-m unj.…` |
| Recall-level rounding | trec_eval 10, or trec_eval 9 on x86-64 / ARM (see below) |

### Measures

The `official` set (trec_eval's default output) and the `set` set are complete. Of `all_trec`, the
tool computes `runid`, `num_q`, `num_ret`, `num_rel`, `num_rel_ret`, `map`, `gm_map`, `Rprec`,
`bpref`, `recip_rank`, `iprec_at_recall`, `P`, `relstring`, `recall`, `infAP`, `gm_bpref`,
`utility`, `11pt_avg`, `ndcg`, `ndcg_cut`, `map_cut`, `relative_P`, `success`, `set_P`,
`set_relative_P`, `set_recall`, `set_map`, `set_F`, `num_nonrel_judged_ret` and `unj`, with
trec_eval's default parameters (gains = relevance labels). Not computed:

- `Rprec_mult`: its cutoffs use `(long)(x * R + 0.9)` even in trec_eval 10, which depends on the CPU,
- `rbp`: trec_eval 10 reads uninitialized variables when normalizing gains; `rbp_resid` goes with it,
- `G`, `binG`, `Rndcg`, `ndcg_rel`: rarely used gain-based variants.

Preference measures, `qrels_jg` measures and z-scores need other input formats and are out of scope.

### Input formats

- Runs: `topic Q0 docid rank score tag`, at least six whitespace-separated columns (more are
  ignored). As in trec_eval, the rank column is ignored, documents are ranked by score with ties
  broken by descending document id, scores are read with C `atof`, and the run id is the tag of the
  last line.
- Qrels: `topic iteration docid relevance`, four columns, integer labels (`strtol`: `2.0` is 2).
  Negative labels mark pooled but unjudged documents (infAP, bpref).
- Lines starting with `#` (for example [ir_metadata](https://www.ir-metadata.org/)) and blank lines
  are skipped. Files may be gzip-compressed.

## How results relate to the trec_eval command line

Each run is evaluated as `trec_eval <options> qrels run` would evaluate it, measure by measure and
topic by topic, including trec_eval's quirks: with `-c`, judged topics without results are evaluated
against trec_eval's stand-in ranking and `num_rel` counts the qrels' positive labels regardless of
`-l`; topics that `-J` leaves without documents give `nan` for interpolated precision;
`gm_map`/`gm_bpref` use a floor of 0.00001. Where trec_eval stops, the tool reports why instead:

- A document retrieved twice for an evaluated topic (within `-M`), or judged twice in the qrels:
  trec_eval stops with "duplicate docs"; the tool refuses that run or qrels file and names the line.
- A judged topic without results and no `-c`: trec_eval 10 stops ("result qid … not found"),
  trec_eval 9 leaves the topic out. The tool does what trec_eval 9 and trec_eval's documentation
  describe, and says which topics were left out.

**Recall-level rounding.** `iprec_at_recall` and `11pt_avg` turn a recall level into a number of
relevant documents. trec_eval 10 uses `lround(level * R)`; trec_eval 9 (and pytrec_eval, ir_measures,
repro_eval) used `(long)(level * R + 0.9)`, which compilers for ARM CPUs fuse into one multiply-add,
so trec_eval 9 gives different `iprec_at_recall_0.30`/`0.70` on x86-64 and ARM for some topics (for
example with 3, 23 or 57 relevant documents). The options offer all three; the default is
trec_eval 10. Other measures are the same in trec_eval 9 and 10.

## Design

**A TypeScript port of trec_eval, not WebAssembly.** Each measure in `src/core/trec-eval.ts` is a
transcription of the corresponding C file that keeps the order of floating-point operations, so
values agree to the last bit (nDCG and the geometric means can differ in the last bits, because
JavaScript's `Math.log2`/`exp` are not the C library's). A port needs no C toolchain to build the
page, keeps the bundle small (about 95 KB) and readable, and gives full-precision values for the
downloads. Tests generated with the real trec_eval pin it to the reference.

**No runtime dependencies.** Charts are plain SVG (`src/ui/charts.ts`) and the UI uses the DOM
directly. The build needs TypeScript for type checking and esbuild for bundling; tests use Node's
built-in test runner. The UI, charts and styles are derived from the repro_eval web dashboard.

## Development

Requirements: Node.js 22.18 or newer (runs the TypeScript tests natively).

```sh
npm install
npm run check      # type check, tests, build
npm run build      # → dist/index.html
npm run watch      # rebuild on changes; open dist/index.html in a browser
```

```
src/core/          computation, no DOM
  trec-format.ts     run and qrels readers (get_trec_results.c, get_qrels.c)
  measures.ts        supported measures, names, output order, cutoffs
  trec-eval.ts       port of te_form_res_rels and the measures
  evaluate.ts        topic loop, -c, summary values (trec_eval.c, meas_avg.c)
  output.ts          trec_eval text output, command line, CSV, JSON
src/ui/            the page (setup, results, charts, example data)
test/              tests and golden fixtures
scripts/           build and fixture generation
```

### Verification

`test/fixtures/` holds the output of trec_eval built from source by `scripts/make_fixtures.py`:
trec_eval 10 with `-q`, `-c`, `-l2`, `-M`, `-J`, custom cutoffs and the `official`, `set` and
`all_trec` sets, on synthetic corner cases (ties, graded and negative labels, unjudged and
unretrieved documents, 1 to 60 relevant documents, short and long rankings, non-ASCII document ids)
and on trec_eval's own test files; trec_eval 9.0.8 for both rounding variants. The tests compare

- the text output with trec_eval's, byte for byte (without the lines of unsupported measures),
- every per-topic and summary value with a build that prints 17 significant digits,
- the refusal of duplicate documents, and the handling of topics missing from the run or qrels.

The fixture builds switch off floating-point contraction, so they compute like trec_eval on x86-64.
To regenerate them (needs a C compiler and make):

```sh
git clone https://github.com/usnistgov/trec_eval
python3 scripts/make_fixtures.py --trec-eval ./trec_eval
```

## Deployment

`.github/workflows/pages.yml` type checks, tests and builds every push and pull request, and deploys
`dist/` to GitHub Pages from `main`. Enable it once under *Settings → Pages → Build and deployment →
Source: GitHub Actions*. Commit `package-lock.json` so CI installs the same versions.

## Credits

The measures are derived from trec_eval by Chris Buckley and the National Institute of Standards and
Technology; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
