import { expect, test } from "bun:test"
import "bun-match-svg"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { NegotiatedLaneSolver, type SimpleRouteJson } from "../lib"
import { busLengthReports, pairLengthReports } from "../lib/route-lengths"

// AM3354 processor to one 96-ball DDR3 device on a four-layer board (top and bottom
// carry signals, the inner layers are planes). The ball order needs about eight
// crossing-free layers, so the matched signals must change layer along the route.
test("routes the AM3354 DDR3 block on two signal layers inside TI's length windows", async (): Promise<void> => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/am3354-ddr3-block/input.srj.json.gz",
          import.meta.url,
        ),
      ),
    ).toString("utf8"),
  )
  const bus = (id: string) =>
    input.buses!.find((b) => b.busId === id)!.connectionNames
  const paired = new Set(
    input.differentialPairs!.flatMap((p) => p.connectionNames),
  )
  const bytes = [...bus("DDR_BYTE0"), ...bus("DDR_BYTE1")]
  const address = bus("DDR_ADDR_CTRL_CK")
  const timed = new Set([...bytes, ...address])
  const near = { zone: [-59, -55] }
  const wide = { zone: [-61, -54] }
  const solver = new NegotiatedLaneSolver(input, {
    region: { minX: -84, maxX: -45.4, minY: 1.95, maxY: 30.2 },
    router: { zoneRows: [2.5, 29.5] },
    stages: [
      {
        connectionNames: bytes.filter((n) => paired.has(n)),
        options: { ...near, maxIters: 120 },
      },
      {
        connectionNames: bytes.filter((n) => !paired.has(n)),
        options: { ...near, maxIters: 300 },
      },
      {
        connectionNames: address.filter((n) => paired.has(n)),
        options: { ...wide, maxIters: 150 },
      },
      {
        // RESET: no timing class, but its balls sit inside the data field
        connectionNames: input.connections
          .map((c) => c.name)
          .filter((n) => !timed.has(n)),
        options: { ...wide, viaCost: 0.6 },
      },
      {
        connectionNames: address.filter((n) => !paired.has(n)),
        options: { ...wide, maxIters: 200 },
      },
    ],
  })
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  const output = solver.getOutput()
  expect(solver.traces.length).toBe(50)

  const connectivity = validateOriginalEndpointConnectivity({
    inputSrj: input,
    routedSrj: output,
  } as unknown as Parameters<typeof validateOriginalEndpointConnectivity>[0])
  expect(connectivity.issues).toEqual([])
  expect(connectivity.connectedConnectionCount).toBe(50)
  // the supplied power fanout belongs to nets outside this routing problem
  const supplied = [
    ...new Set(input.traces!.map((t) => t.connection_name)),
  ].map((name) => ({ name, pointsToConnect: [] }))
  const drc = validateRoutedCopperDrc({
    inputSrj: { ...input, connections: [...input.connections, ...supplied] },
    routedSrj: { ...output, connections: [...input.connections, ...supplied] },
    clearance: 0.1,
    allowBlindAndBuriedVias: false,
  } as unknown as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(drc.issues).toEqual([])

  for (const report of busLengthReports(input, solver.traces)) {
    expect(report.aboveMinimumLength).toBe(true)
    expect(report.withinLengthLimit).toBe(true)
    expect(report.matched).toBe(true)
  }
  expect(
    pairLengthReports(input, solver.traces).every((pair) => pair.matched),
  ).toBe(true)
  // the extra layer changes land on the least important signals
  const vias = (name: string) =>
    solver.traces
      .find((t) => t.connection_name === name)!
      .route.filter((p) => p.route_type === "via").length
  expect(Math.max(...bytes.map(vias))).toBeLessThanOrEqual(2)
  for (const pair of input.differentialPairs!)
    expect(vias(pair.connectionNames[0])).toBe(vias(pair.connectionNames[1]))

  await expect(
    getSvgFromGraphicsObject(solver.visualize(), { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
}, 1_200_000)
