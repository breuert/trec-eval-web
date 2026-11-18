# Third-party notices

## trec_eval

`src/core/trec-eval.ts`, and in part `src/core/trec-format.ts`, `src/core/evaluate.ts` and
`src/core/output.ts`, are a derivative work of trec_eval (<https://github.com/usnistgov/trec_eval>),
developed by Chris Buckley and the National Institute of Standards and Technology (NIST).

Changes: on 2026-11-18, the reading of run and qrels files, `te_form_res_rels`, the topic loop and
averaging of `trec_eval.c`, the printing of values, and the computation of the measures `runid`,
`num_q`, `num_ret`, `num_rel`, `num_rel_ret`, `map`, `gm_map`, `Rprec`, `bpref`, `recip_rank`,
`iprec_at_recall`, `P`, `relstring`, `recall`, `infAP`, `gm_bpref`, `utility`, `11pt_avg`, `ndcg`,
`ndcg_cut`, `map_cut`, `relative_P`, `success`, `set_P`, `set_relative_P`, `set_recall`, `set_map`,
`set_F`, `num_nonrel_judged_ret` and `unj` were translated from C to TypeScript. All other measures,
input formats and command-line handling were not translated. Measure parameters are trec_eval's
defaults, except that one list of rank cutoffs can replace the defaults of all cutoff measures;
`iprec_at_recall` and `11pt_avg` can follow trec_eval 9 or 10.

`test/fixtures/nist/` contains test files and expected outputs from trec_eval's `test/` directory,
unchanged. `test/fixtures/outputs/` contains output of trec_eval 10.0-rc3 and 9.0.8.

The license of trec_eval:

> The code for the original trec_eval, up to version 9, are Copyright (C) 2008 Chris Buckley. Significant modifications have been done by Ian Soboroff as an employee of NIST. Other modifications and ongoing support are by Ian Soboroff and other contributors on https://github.com/usnistgov/trec_eval. trec_eval is now made available under the following license.
>
> NIST-developed software is provided by NIST as a public service. You may use, copy, and distribute copies of the software in any medium, provided that you keep intact this entire notice. You may improve, modify, and create derivative works of the software or any portion of the software, and you may copy and distribute such modifications or works. Modified works should carry a notice stating that you changed the software and should note the date and nature of any such change. Please explicitly acknowledge the National Institute of Standards and Technology as the source of the software.
>
> NIST-developed software is expressly provided "AS IS." NIST MAKES NO WARRANTY OF ANY KIND, EXPRESS, IMPLIED, IN FACT, OR ARISING BY OPERATION OF LAW, INCLUDING, WITHOUT LIMITATION, THE IMPLIED WARRANTY OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND DATA ACCURACY. NIST NEITHER REPRESENTS NOR WARRANTS THAT THE OPERATION OF THE SOFTWARE WILL BE UNINTERRUPTED OR ERROR-FREE, OR THAT ANY DEFECTS WILL BE CORRECTED. NIST DOES NOT WARRANT OR MAKE ANY REPRESENTATIONS REGARDING THE USE OF THE SOFTWARE OR THE RESULTS THEREOF, INCLUDING BUT NOT LIMITED TO THE CORRECTNESS, ACCURACY, RELIABILITY, OR USEFULNESS OF THE SOFTWARE.
>
> You are solely responsible for determining the appropriateness of using and distributing the software and you assume all risks associated with its use, including but not limited to the risks and costs of program errors, compliance with applicable laws, damage to or loss of data, programs or equipment, and the unavailability or interruption of operation. This software is not intended to be used in any situation where a failure could cause risk of injury or damage to property. The software developed by NIST employees is not subject to copyright protection within the United States.
