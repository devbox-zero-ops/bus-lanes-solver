import { expect, test } from "bun:test"
import { negotiateBusTuning } from "../lib/negotiate-bus-tuning"
import { busLengthReports, pairLengthReports } from "../lib/route-lengths"
import { fixedCopper, routeCopper, VectorScene } from "../lib/vector-scene"
import type { Trace } from "../lib/types"
import {
  shortestSurroundingRoutes,
  surroundedTuningBus,
} from "./fixtures/surrounded-tuning-bus"

test("ordinary banks respect paired length anchors and immutable fanout copper", () => {
  const input = surroundedTuningBus()
  input.connections = input.connections.slice(0, 3)
  input.buses = [
    {
      busId: "BYTE",
      connectionNames: input.connections.map((connection) => connection.name),
      maxLengthSkew: 0.02,
      maxLength: 13,
    },
  ]
  input.differentialPairs = [
    {
      connectionNames: ["CENTER_1", "NORTH1_0"],
      lengthTolerance: 0,
      traceGap: 0.2,
    },
  ]
  const straight = shortestSurroundingRoutes(input)
  const paired = straight
    .slice(1)
    .map((trace): Trace => ({ ...trace, coupledSection: [0, 1] }))
  input.traces = [
    {
      ...straight[0],
      pcb_trace_id: "fixed_fanout",
      route: [
        { route_type: "wire", x: -0.5, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      ],
    },
  ]
  const original = structuredClone({ input, paired })
  const proposal = negotiateBusTuning({ input, traces: [straight[0]], paired })
  const complete = [...proposal.traces, ...paired]
  expect(busLengthReports(input, complete)[0].matched).toBe(true)
  expect(busLengthReports(input, complete)[0].lengths[0].fixedLengthMm).toBe(
    0.5,
  )
  expect(pairLengthReports(input, complete)[0].matched).toBe(true)
  const copper = [...fixedCopper(input), ...complete.flatMap(routeCopper)]
  for (const trace of complete) {
    const connection = input.connections.find(
      (member) => member.name === trace.connection_name,
    )!
    expect(
      new VectorScene(input, connection, 0.1, copper).pathVisible(trace.route),
    ).toBe(true)
  }
  expect({ input, paired }).toEqual(original)
})
