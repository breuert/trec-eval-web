#!/usr/bin/env python3
"""Generate the golden outputs in test/fixtures/ with trec_eval built from source.

    git clone https://github.com/usnistgov/trec_eval
    python3 scripts/make_fixtures.py --trec-eval ./trec_eval

Needs a C compiler and make; nothing else. For every case in CASES the script runs
trec_eval twice: the normal build (its stdout is compared with the tool's text output
line by line) and a build that prints every value with 17 significant digits (compared
with the port's values). Floating-point contraction is switched off, so the binaries
compute like trec_eval on x86-64 and like the port (two roundings per multiply-add).

trec_eval 9.0.8 (from the same checkout's history) provides the iprec_at_recall and
11pt_avg values of the older rounding; on ARM machines also of the fused variant.

Inputs:
  test/fixtures/corner/   synthetic corner cases (ties, graded and negative labels,
                          unjudged and unretrieved documents, 1 to 60 relevant documents,
                          short and long rankings, non-ASCII document ids)
  test/fixtures/nist/     trec_eval's own test files and expected outputs (copied)
  test/fixtures/dup/      a run that retrieves a document twice
"""
import argparse
import gzip
import json
import platform
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "test" / "fixtures"
OUTPUTS = FIXTURES / "outputs"

CUTOFF_FAMILIES = ["P", "recall", "ndcg_cut", "map_cut", "relative_P", "success", "unj"]
CUSTOM = "1,2,3,7,50,2000"

# name, trec_eval arguments, qrels, run (relative to test/fixtures)
CASES = [
    ("corner-official", [], "corner/qrels_in_run.txt", "corner/run.txt"),
    ("corner-q", ["-q", "-m", "all_trec"], "corner/qrels_in_run.txt", "corner/run.txt"),
    ("corner-qc", ["-q", "-c", "-m", "all_trec"], "corner/qrels.txt", "corner/run.txt"),
    ("corner-qc-l2", ["-q", "-c", "-l2", "-m", "all_trec"], "corner/qrels.txt", "corner/run.txt"),
    ("corner-qc-M7", ["-q", "-c", "-M7", "-m", "all_trec"], "corner/qrels.txt", "corner/run.txt"),
    ("corner-qc-J", ["-q", "-c", "-J", "-m", "all_trec"], "corner/qrels.txt", "corner/run.txt"),
    ("corner-qc-cutoffs", ["-q", "-c", "-m", "all_trec"] + [a for f in CUTOFF_FAMILIES for a in ("-m", f"{f}.{CUSTOM}")],
     "corner/qrels.txt", "corner/run.txt"),
    ("corner-official-cutoffs", ["-m", "official", "-m", f"P.{CUSTOM}"], "corner/qrels_in_run.txt", "corner/run.txt"),
    ("corner-set", ["-c", "-m", "set"], "corner/qrels.txt", "corner/run.txt"),
    ("nist-official", [], "nist/qrels.test", "nist/results.test"),
    ("nist-a", ["-m", "all_trec"], "nist/qrels.test", "nist/results.test"),
    ("nist-aq", ["-m", "all_trec", "-q"], "nist/qrels.test", "nist/results.test"),
    ("nist-aqc", ["-m", "all_trec", "-q", "-c"], "nist/qrels.test", "nist/results.trunc"),
    ("nist-aqcM", ["-m", "all_trec", "-q", "-c", "-M100"], "nist/qrels.test", "nist/results.trunc"),
    ("nist-aql", ["-m", "all_trec", "-q", "-l2"], "nist/qrels.rel_level", "nist/results.test"),
    ("dup", ["-q", "-m", "all_trec"], "dup/qrels.txt", "dup/run.txt"),
    ("dup-M3", ["-q", "-M3", "-m", "all_trec"], "dup/qrels.txt", "dup/run.txt"),
]

# trec_eval 9.0.8: only the measures whose rounding changed in trec_eval 10.
V9_CASE = (["-q", "-m", "iprec_at_recall", "-m", "11pt_avg"], "corner/qrels_in_run.txt", "corner/run.txt")

# trec_eval's test suite (Makefile, quicktest): expected output, arguments, qrels, run.
NIST_FILES = ["qrels.test", "results.test", "results.trunc", "qrels.rel_level",
              "out.test", "out.test.a", "out.test.aq", "out.test.aqc", "out.test.aqcM"]


def build(src, contraction, full_precision):
    """Build trec_eval from `src` in a temporary directory."""
    work = Path(tempfile.mkdtemp(prefix="trec_eval_"))
    shutil.copytree(src, work, dirs_exist_ok=True, ignore=shutil.ignore_patterns(".git"))
    makefile = work / "Makefile"
    makefile.write_text(re.sub(r"^CFLAGS\s*=", f"CFLAGS = -ffp-contract={contraction} -w", makefile.read_text(), count=1, flags=re.M))
    if full_precision:
        for name in ("meas_print_single.c", "meas_print_final.c"):
            path = work / name
            path.write_text(path.read_text().replace("%6.4f", "%.17g"))
    subprocess.run(["make", "-s", "trec_eval"], cwd=work, check=True, capture_output=True)
    return work / "trec_eval"


def export(checkout, tag):
    """The sources of `tag` from the checkout's history."""
    out = Path(tempfile.mkdtemp(prefix=f"trec_eval_{tag}_"))
    archive = subprocess.run(["git", "-C", str(checkout), "archive", tag], check=True, capture_output=True).stdout
    subprocess.run(["tar", "-x", "-C", str(out)], input=archive, check=True)
    return out


def run(binary, args, qrels, results):
    proc = subprocess.run([str(binary), *args, str(FIXTURES / qrels), str(FIXTURES / results)], capture_output=True, text=True)
    return proc.returncode, proc.stdout, proc.stderr


def write_gz(path, text):
    """gzip without a timestamp, so regenerated fixtures are byte-identical."""
    with open(path, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, filename="") as gz:
        gz.write(text.encode())


def version(binary):
    proc = subprocess.run([str(binary), "-v"], capture_output=True, text=True)
    return (proc.stdout + proc.stderr).strip()


def write_inputs(checkout):
    corner = FIXTURES / "corner"
    run_topics = {line.split()[0] for line in (corner / "run.txt").read_text().splitlines() if line.strip()}
    qrels = [line for line in (corner / "qrels.txt").read_text().splitlines() if line.split() and line.split()[0] in run_topics]
    (corner / "qrels_in_run.txt").write_text("\n".join(qrels) + "\n")

    nist = FIXTURES / "nist"
    nist.mkdir(parents=True, exist_ok=True)
    for name in NIST_FILES:
        shutil.copyfile(checkout / "test" / name, nist / name)

    dup = FIXTURES / "dup"
    dup.mkdir(parents=True, exist_ok=True)
    (dup / "qrels.txt").write_text("1 0 a 1\n1 0 b 0\n1 0 c 2\n1 0 d 1\n2 0 x 1\n")
    # Document "d" of topic 1 is retrieved twice, at ranks 4 and 5.
    (dup / "run.txt").write_text(
        "1 Q0 a 1 9.0 dup\n1 Q0 b 2 8.0 dup\n1 Q0 c 3 7.0 dup\n1 Q0 d 4 6.0 dup\n1 Q0 d 5 5.0 dup\n2 Q0 x 1 1.0 dup\n"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--trec-eval", type=Path, required=True, help="a git checkout of https://github.com/usnistgov/trec_eval")
    parser.add_argument("--v9-tag", default="v9.0.8")
    args = parser.parse_args()
    checkout = args.trec_eval.resolve()

    write_inputs(checkout)
    shutil.rmtree(OUTPUTS, ignore_errors=True)
    OUTPUTS.mkdir(parents=True)

    stock = build(checkout, "off", False)
    full = build(checkout, "off", True)
    manifest = {
        "generator": "scripts/make_fixtures.py",
        "trec_eval": version(stock),
        "machine": platform.machine(),
        "cases": [],
    }
    for name, case_args, qrels, results in CASES:
        code, out, err = run(stock, case_args, qrels, results)
        full_code, full_out, _ = run(full, case_args, qrels, results)
        assert code == full_code, name
        entry = {"name": name, "version": 10, "args": case_args, "qrels": qrels, "run": results, "exit": code}
        if code == 0:
            write_gz(OUTPUTS / f"{name}.txt.gz", out)
            write_gz(OUTPUTS / f"{name}.full.txt.gz", full_out)
            entry["stdout"] = f"outputs/{name}.txt.gz"
            entry["full"] = f"outputs/{name}.full.txt.gz"
        else:
            entry["stderr"] = err.strip()
        manifest["cases"].append(entry)

    # The stock build must pass trec_eval's own tests.
    for name, expected in [("nist-official", "out.test"), ("nist-a", "out.test.a"), ("nist-aq", "out.test.aq"),
                           ("nist-aqc", "out.test.aqc"), ("nist-aqcM", "out.test.aqcM")]:
        assert gzip.decompress((OUTPUTS / f"{name}.txt.gz").read_bytes()).decode() == (FIXTURES / "nist" / expected).read_text(), \
            f"{name} differs from {expected}"

    v9_src = export(checkout, args.v9_tag)
    variants = [("v9", "off")]
    if platform.machine().lower() in ("arm64", "aarch64"):
        variants.append(("v9-fma", "on"))  # what an ARM build of trec_eval 9 (and pytrec_eval) computes
    for rounding, contraction in variants:
        binary = build(v9_src, contraction, True)
        case_args, qrels, results = V9_CASE
        code, out, err = run(binary, case_args, qrels, results)
        assert code == 0, err
        name = f"corner-{rounding}"
        write_gz(OUTPUTS / f"{name}.full.txt.gz", out)
        manifest["cases"].append({"name": name, "version": 9, "rounding": rounding, "trec_eval": version(binary),
                                  "args": case_args, "qrels": qrels, "run": results, "exit": 0, "full": f"outputs/{name}.full.txt.gz"})

    (FIXTURES / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"{len(manifest['cases'])} cases written to {FIXTURES.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
