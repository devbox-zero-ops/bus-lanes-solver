# Bus tuning space negotiation

Evidence for [PR #223](https://github.com/tscircuit/bus-lanes-solver/pull/223), production commit `f37a130e83b2034fdfcf1bba5bafa88d8f73346c`, against main `202b034659fb96bad44d11b8190f4044b675116f`. Production routing code in this evidence branch matches the production commit; later commits add only evidence, reproduction scripts and the capture workflow.

Routing can satisfy connectivity and copper clearance while consuming the space needed for matching. The old matcher then treats neighboring buses as fixed. Selecting individual wire alternatives also loses the relationship between a bus's routes and its tuning bank.

The repair forecasts banks with the existing tuner as signals are routed, then selects complete matched buses as atomic candidates. Actual meander copper supplies the existing soft congestion and history costs. Generated neighbors can move through normal rip-up negotiation; supplied copper stays immutable. The final connectivity, DRC, length and coupling checks still determine acceptance. This recovery runs after the existing dense-routing lane orders fail matching.

## Regression

Five buses surround the short center signal; every bus requests 0.02 mm skew and a 13 mm maximum length. Three fresh processes per revision use the identical forty-signal input, options, dependency tree and 15-second budget, interleaved base/head/head/base/base/head on CPU2 with Bun 1.4.3.

| Check | Main | Fix |
| --- | --- | --- |
| Connected signals | 40/40 | 40/40 |
| Copper DRC | Pass | Pass |
| Matched buses | 4/5 | 5/5 |
| Center skew | 2 mm | 0.02 mm |
| Solve time range | 0.315–0.578 s, matching fails | 0.678–1.129 s, completes |

These timings compare different outcomes and establish no speedup. The baseline is a fresh public solver failure, not a deliberately failed refinement substituted for a successful solve. [Raw measurements](reports/regression-runtime.json) include every bus's total copper lengths, native connectivity, DRC, input preservation, iterations and CPU affinity.

The permanent tests also cover the ten-signal layout, its rotation, smooth tuning, coupled neighbors and immutable fixed fanout length anchors. All 35 focused tests pass, along with TypeScript and isolated Node/browser/TypeScript package consumers.

Completed regression snapshots: [forty signals](../../tests/__snapshots__/surrounded-byte-bus-tuning-pcb.snap.svg), [ten signals](../../tests/__snapshots__/surrounded-bus-tuning-pcb.snap.svg), [rotated](../../tests/__snapshots__/surrounded-bus-tuning-rotated-pcb.snap.svg).

## Full-board comparison

| Check | Main | Fix |
| --- | --- | --- |
| AM3352 completed | 11/11 | 11/11 |
| AM3352 solver seconds, sum | 3,282.1 | 3,090.6 |
| Core DDR completed | 1/10 | 1/10 |
| Core connected nets | 217/606 | 217/606 |

All eleven AM3352 pairs have identical iteration counts and routing-quality validations. Individual timings vary in both directions; this single paired run establishes no general speedup. Core completion is unchanged.

[AM3352 paired comparison](reports/am3352-comparison.md) · [Core DDR comparison](reports/core-ddr-comparison.md) · [Raw summary](reports/summary.json) · [Core provenance](reports/core-provenance.json).

Every AM3352 pair uses a fresh process per revision, the base revision's harness/fixtures, Bun 1.4.0, the same Blacksmith 4 vCPU runner within each pair, and 3,600 seconds per solver/sample. The full JSON reports retain per-bus and pair lengths, coupling/geometry findings, runtime, fixed power copper preservation and input hashes. Length measurements include the full signal routes. The completed gallery is collected by separate fresh solves of the same production revision and independently revalidated before rendering; rendering saved copper is not another solve or a performance comparison. Nine cases are captured locally with Bun 1.4.3; the two slow cases use the [artifact capture workflow](../../.github/workflows/am3352-benchmark.yml), Bun 1.4.0 and Blacksmith 4 vCPU runners. Per-route provenance records the source of each capture. [Gallery provenance and validations](am3352/provenance.json).

Core uses the identical Core `1799ee7` checkout, official fixture/harness fingerprints, Bun 1.4.3 and 120 seconds per board. Base and fix each receive one pinned CPU (2/3); read-only observers verify all ten workers and every observed thread mask. Core fixtures declare no skew targets, so Core checks routing regression; explicit matching coverage comes from AM3352 and the focused regressions. The historical 4/10 Core result used a different Core/dependency baseline and is not this comparison.

## Reproduce

From this evidence checkout, install its dependencies once and share that dependency tree between the two pinned solver checkouts:

```sh
bun install --ignore-scripts
git worktree add --detach /tmp/bus-tuning-base 202b034659fb96bad44d11b8190f4044b675116f
git worktree add --detach /tmp/bus-tuning-fix f37a130e83b2034fdfcf1bba5bafa88d8f73346c
ln -s "$PWD/node_modules" /tmp/bus-tuning-base/node_modules
ln -s "$PWD/node_modules" /tmp/bus-tuning-fix/node_modules
taskset -c 2 bun docs/negotiated-bus-tuning/reproduce/run-regression.ts \
  /tmp/bus-tuning-base /tmp/bus-tuning-fix /tmp/bus-tuning-regression.json
```

The [paired acceptance workflow](https://github.com/tscircuit/bus-lanes-solver/blob/f37a130e83b2034fdfcf1bba5bafa88d8f73346c/.github/workflows/am3352-benchmark.yml) contains the exact full-board commands and resource/budget settings. Its trusted controller is `base/scripts/pr-benchmark/run-pair.ts`; `benchmark.sh` forwards to the same `scripts/benchmark.ts` worker. For a local serial comparison, invoke the base checkout's `./benchmark.sh --solver <base-or-fix>/lib/index.ts --timeout-seconds 3600 --output <report.json>` separately for each revision. For Core, use the pinned dependencies in the provenance report and invoke `bun scripts/benchmark-ddr/run.ts --out <directory> --timeout 120` in each unchanged Core checkout, with only the bus package resolver differing.

## Completed AM3352 gallery

| Sample | Completed route |
| --- | --- |
| control | [PNG](am3352/control-solved.png) |
| control-inner1 | [PNG](am3352/control-inner1-solved.png) |
| right | [PNG](am3352/right-solved.png) |
| left | [PNG](am3352/left-solved.png) |
| above | [PNG](am3352/above-solved.png) |
| inner-layers | [PNG](am3352/inner-layers-solved.png) |
| inner-layers-right | [PNG](am3352/inner-layers-right-solved.png) |
| inner-layers-left | [PNG](am3352/inner-layers-left-solved.png) |
| inner-layers-above | [PNG](am3352/inner-layers-above-solved.png) |
| inner-layers-complete-ca | [PNG](am3352/inner-layers-complete-ca-solved.png) |
| outer-layers | [PNG](am3352/outer-layers-solved.png) |

All eleven rendered images were inspected after independent validation. Fresh paired acceptance: [Blacksmith run](https://github.com/tscircuit/bus-lanes-solver/actions/runs/44594082907). Slow-case fresh captures: [gallery run](https://github.com/tscircuit/bus-lanes-solver/actions/runs/44598592003).
