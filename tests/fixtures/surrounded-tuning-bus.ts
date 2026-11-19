import type { Connection, SimpleRouteJson, Trace } from "../../lib/types"
import {
  applyToPoint,
  compose,
  rotateDEG,
  translate,
} from "transformation-matrix"

/** Native board-world endpoints in mm, +X right and +Y up. */
function horizontalConnection({
  name,
  y,
  spanMm = 10,
}: {
  name: Connection["name"]
  y: number
  spanMm?: number
}): Connection {
  return {
    name,
    pointsToConnect: [
      { x: 0, y, layer: "top" },
      { x: spanMm, y, layer: "top" },
    ],
  }
}

/** Five timed buses, with four independently movable neighbors around CENTER.
 * Their shortest routes are all legal, but leave neither side of CENTER_0
 * enough room for its required additional copper. Board-world mm, +Y up. */
export function surroundedTuningBus(signalsPerBus: 2 | 8 = 2): SimpleRouteJson {
  const busPitchMm = signalsPerBus * 0.3
  const regions = [
    { busId: "CENTER", firstY: 0, direction: 1 },
    { busId: "NORTH1", firstY: busPitchMm, direction: 1 },
    { busId: "NORTH2", firstY: 2 * busPitchMm, direction: 1 },
    { busId: "SOUTH1", firstY: -0.3, direction: -1 },
    { busId: "SOUTH2", firstY: -busPitchMm - 0.3, direction: -1 },
  ]
  const connections = regions.flatMap(({ busId, firstY, direction }) =>
    Array.from({ length: signalsPerBus }, (_, position) =>
      horizontalConnection({
        name: `${busId}_${position}`,
        y: firstY + direction * position * 0.3,
        spanMm: busId === "CENTER" && position === 0 ? 8 : 10,
      }),
    ),
  )
  return {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    bounds:
      signalsPerBus === 2
        ? { minX: -1, maxX: 11, minY: -2.5, maxY: 2.5 }
        : { minX: -1, maxX: 11, minY: -7, maxY: 9 },
    obstacles: [],
    connections,
    buses: regions.map(({ busId }) => ({
      busId,
      connectionNames: connections
        .filter((connection) => connection.name.startsWith(`${busId}_`))
        .map((connection) => connection.name),
      maxLengthSkew: 0.02,
      maxLength: 13,
    })),
  }
}

export function shortestSurroundingRoutes(input: SimpleRouteJson): Trace[] {
  return input.connections.map((connection) => ({
    type: "pcb_trace",
    pcb_trace_id: connection.name,
    connection_name: connection.name,
    route: connection.pointsToConnect.map((point) => ({
      ...point,
      route_type: "wire",
      width: input.minTraceWidth,
    })),
  }))
}

/** Rigid board-world point transform in mm, +X right, +Y up.
 * Rotate counterclockwise, then translate; layer identities stay unchanged. */
export function rotatedSurroundedTuningBus(
  ccwRotationDegrees: number,
): SimpleRouteJson {
  const input = surroundedTuningBus()
  const originalBoardToRotatedBoard = compose(
    translate(13, -7),
    rotateDEG(ccwRotationDegrees),
  )
  const bounds = input.bounds
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ].map((point) => applyToPoint(originalBoardToRotatedBoard, point))
  return {
    ...input,
    connections: input.connections.map((connection) => ({
      ...connection,
      pointsToConnect: connection.pointsToConnect.map((point) => ({
        ...point,
        ...applyToPoint(originalBoardToRotatedBoard, point),
      })),
    })),
    bounds: {
      minX: Math.min(...corners.map((point) => point.x)),
      maxX: Math.max(...corners.map((point) => point.x)),
      minY: Math.min(...corners.map((point) => point.y)),
      maxY: Math.max(...corners.map((point) => point.y)),
    },
  }
}
