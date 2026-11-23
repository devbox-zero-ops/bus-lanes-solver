# STM32MP157D motherboard DDR bus reproduction

The 4-Motor USB-C Control Motherboard completes native STM32 and DDR3L fanout,
then its DDR bus exhausts the bus-lanes search budget before length matching.
This reproduction records that failure; it does not establish whether the
underlying cause is a solver defect or the board's fixed escape arrangement.

Run `bun test tests/stm32-motherboard-ddr.test.ts`. The test calls
`new BusLanesPipelineSolver(input).solve()` with the captured input and default
options. There is no reduced solver budget or five-minute cutoff. The test's
one-hour timeout only leaves room for the native search to finish.

The test follows the A13 preloaded-byte reproduction: it writes a clearly labeled
failure snapshot and then requires solver completion. That final assertion fails
on the baseline. Failed snapshots show only the supplied fanout copper; pink
dashed lines mark requested DDR connections, not attempted or accepted copper.
The second snapshot changes only the viewport to make the two packages readable.
A future successful solve must pass the existing connectivity, DRC, matching and
fixed-copper checks before either snapshot can show new routes.

## Observed baseline

At bus-lanes-solver `69e2159483e062013728cd8ff256f9343224a90b`, Bun 1.4.4
on macOS arm64, the native solve took 1,189.4 seconds and stopped at 1,199,804
of 1,200,000 steps with `search_budget_exhausted`. It accepted zero new traces.
The process peaked at 3,001 MiB RSS; neither the 8 GiB memory guard nor an
external time limit stopped it. This is a native search failure, not a five-minute
test timeout.

The separate reachability control checks all 22 signals against the same supplied
obstacles and fixed fanout, before adding any other new bus lanes. Each has a
clear path individually. Those paths can conflict with each other: the control
does not prove that the complete bus fits, or that the solver can length-match it.
Run it alone with `bun test tests/stm32-motherboard-ddr.test.ts -t "each motherboard"`.

## Capture

Captured on 2026-11-24 from the board's native TSX render with
`<Board route routingMode="fanout-ddr" />`: tscircuit **0.0.3285**, Core
**0.0.2462**, bus-lanes-solver **0.0.65**. The package is
`@tsci/MustafaMulla29.four-motor-usbc-stm32mp157d` (local version 2.0.4).
The capture includes the subsequent local change that requests only fanout and
the DDR bus; it is not a claim that the published package has that same mode.

- Full 154 × 97 mm, six-layer board and all **3,330 obstacles**.
- All **351 fixed fanout traces**: 260 from the STM32 and 91 from DDR3L.
- All **40 raw connection records**, describing the **22 named bus signals**
  and their net requests. The original records are retained without filtering.
- One data/mask/strobe bus: 0.15 mm width, 120 mm maximum length and 1 mm skew.
- Two DQS pairs with 0.25 mm skew limits.
- Original allowed layers and fixed endpoints, including the DDR escape
  endpoints on `inner3`.

`input.srj.json.gz` is the exact `autorouting:start` payload for `DDR_BUS_ONLY`.
Its fixed routes contain only wire and via segments, so Core's bus input adapter
does not change them. No saved DDR routing, removed obstacles, relaxed rules or
hand-written replacement paths are used.

`unrouted.circuit.json.gz` is the full native Circuit JSON captured before the
fanout phases. It supplies the board, component footprints, pads and existing
vias for PCB rendering only. The test adds the supplied fanout traces and their
vias from the routing input; this rendering data does not affect the solve.

SHA-256 of the uncompressed captures:

| File | SHA-256 |
| --- | --- |
| `input.srj.json.gz` | `5ffa716e7180f059723083326124428f4ddaca4fa82d18d6d2e24cb46db53222` |
| `unrouted.circuit.json.gz` | `f2e0279660b3220395825b269da7b5769573b6b6a53c81288428fad863c45dc8` |

This is a full-board **DDR bus** reproduction. USB, motor power, DDR address,
control and clock routing are intentionally not requested by this phase.
