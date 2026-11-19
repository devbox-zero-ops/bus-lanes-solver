import { test } from "bun:test"
import { BusLanesSolver } from "../lib/bus-lanes-solver"
import { expectCompletedRouting } from "./fixtures/expect-completed-routing"
import { surroundedTuningBus } from "./fixtures/surrounded-tuning-bus"

test("surrounded buses retain their matching banks through smooth tuning", () => {
  const input = surroundedTuningBus()
  const original = structuredClone(input)
  const solver = new BusLanesSolver(input, {
    denseSearch: true,
    smoothTuning: true,
    maxSearchIterations: 20000,
  })
  solver.solve()
  expectCompletedRouting(solver, original)
}, 60000)
