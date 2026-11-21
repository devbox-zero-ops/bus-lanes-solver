import { expect } from "bun:test"
import "bun-match-svg"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  BusLanesPipelineSolver,
  BusLanesSolver,
  type SimpleRouteJson,
} from "../../lib"
import { VectorScene } from "../../lib/vector-scene"
import { nativeValidationSrj } from "./expect-completed-routing"

type NativeDdrByte = "a13-ram-byte1" | "a64-byte2"

export async function expectNativeDdrVisibility(
  byte: NativeDdrByte,
  testPath: string,
): Promise<void> {
  const {
    input,
    previousConnections,
  }: {
    input: SimpleRouteJson
    previousConnections: SimpleRouteJson["connections"]
  } = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(`./native-ddr-visibility/${byte}.json.gz`, import.meta.url),
      ),
    ).toString(),
  )
  const original = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input)
  const visible = VectorScene.prototype.visible
  let segmentChecks = 0
  // The solve is synchronous. Count checks without retaining their arguments.
  VectorScene.prototype.visible = function (start, end): boolean {
    segmentChecks++
    return visible.call(this, start, end)
  }
  try {
    solver.solve()
  } finally {
    VectorScene.prototype.visible = visible
  }
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(solver.traces).toHaveLength(8)
  const output = solver.getOutput()
  expect(input).toEqual(original)
  expect(output.traces?.slice(0, input.traces!.length)).toEqual(input.traces)
  // Core requests only the active byte. Restore the earlier net owners for DRC.
  const connections = [...previousConnections, ...input.connections]
  const validation = {
    inputSrj: nativeValidationSrj({ ...input, connections }),
    routedSrj: nativeValidationSrj({ ...output, connections }),
  }
  const connectivity = validateOriginalEndpointConnectivity(validation)
  expect(connectivity.issues).toEqual([])
  expect(connectivity.connectedConnectionCount).toBe(connections.length)
  expect(
    validateRoutedCopperDrc({
      ...validation,
      clearance: input.minTraceToPadEdgeClearance!,
      allowBlindAndBuriedVias: input.allowBlindAndBuriedVias ?? false,
    }).issues,
  ).toEqual([])
  const graphics = new BusLanesSolver(output).visualize()
  const left = Math.min(
    ...input.obstacles.map((pad) => pad.center.x - pad.width / 2),
  )
  const top = Math.max(
    ...input.obstacles.map((pad) => pad.center.y + pad.height / 2),
  )
  graphics.texts = [
    {
      x: left,
      y: top + 1,
      text: `${byte === "a64-byte2" ? "A64 byte 2" : "A13 RAM byte 1"}  ·  8/8 signals  ·  ${segmentChecks.toLocaleString("en-US")} segment checks`,
      anchorSide: "bottom_left",
      fontSize: 0.55,
      color: "#164e63",
    },
  ]
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(testPath)
}
