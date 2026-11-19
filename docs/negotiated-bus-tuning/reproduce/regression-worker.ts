import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { surroundedTuningBus } from "../../../tests/fixtures/surrounded-tuning-bus"
import { busLengthReports } from "../../../lib/route-lengths"

const [revision, solverCheckout] = process.argv.slice(2)
const { BusLanesSolver } = await import(
  resolve(solverCheckout, "lib/bus-lanes-solver.ts")
)
const input = surroundedTuningBus(8)
const original = JSON.stringify(input)
const solver = new BusLanesSolver(input, {
  denseSearch: true,
  smoothTuning: false,
  maxSearchIterations: 20000,
})
const started = performance.now()
solver.solve()
const validationInput = {
  ...input,
  obstacles: input.obstacles.map((obstacle) => ({
    ...obstacle,
    type: "rect" as const,
  })),
  traces: input.traces?.map((trace) => {
    const connection_name =
      trace.connection_name ??
      input.connections.find(
        (connection) => connection.source_trace_id === trace.source_trace_id,
      )?.name
    if (!connection_name) throw Error("Missing native fixed-copper ownership")
    return { ...trace, connection_name }
  }),
}
const validation = {
  inputSrj: validationInput,
  routedSrj: { ...validationInput, traces: solver.traces },
}
console.log(
  JSON.stringify({
    revision,
    solved: solver.solved,
    failureCode: solver.failureCode,
    error: solver.error,
    milliseconds: performance.now() - started,
    iterations: solver.iterations,
    inputUnchanged: JSON.stringify(input) === original,
    drc: validateRoutedCopperDrc({ ...validation, clearance: 0.1 }),
    connectivity: validateOriginalEndpointConnectivity(validation),
    buses: busLengthReports(input, solver.traces),
    cpuAffinity: readFileSync("/proc/self/status", "utf8").match(
      /Cpus_allowed_list:\s+(.*)/,
    )?.[1],
  }),
)
