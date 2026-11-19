import { expect, test } from "bun:test"
import { BusLanesSolver } from "../lib/bus-lanes-solver"
import { negotiateLanes } from "../lib/negotiate-lanes"
import { fixedCopper } from "../lib/vector-scene"
import type { Connection } from "../lib/types"
import { expectCompletedRouting } from "./fixtures/expect-completed-routing"
import { surroundedTuningBus } from "./fixtures/surrounded-tuning-bus"

test("bus tuning negotiation keeps coupled neighbors indivisible", () => {
  const input = surroundedTuningBus()
  input.differentialPairs = [
    {
      connectionNames: ["NORTH1_0", "NORTH1_1"],
      lengthTolerance: 0.02,
      traceGap: 0.2,
      maxUncoupledLength: 1,
    },
  ]
  const original = structuredClone(input)
  const widths = new Map<Connection["name"], number>(
    input.connections.map((connection) => [
      connection.name,
      input.minTraceWidth,
    ]),
  )
  const negotiation = negotiateLanes({
    input: structuredClone(input),
    connections: structuredClone(input.connections),
    fixed: fixedCopper(input),
    paired: [],
    widths,
    negotiateTuning: true,
  })
  let step = negotiation.next()
  while (!step.done) step = negotiation.next()
  expect(step.value).not.toBeNull()
  const solver = BusLanesSolver.forRefinement(input, step.value!, {
    smoothTuning: false,
  })
  solver.solve()
  expectCompletedRouting(solver, original)
}, 15000)
