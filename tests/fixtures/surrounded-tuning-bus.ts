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
export function surroundedTuningBus(): SimpleRouteJson {
  return {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -1, maxX: 11, minY: -2.5, maxY: 2.5 },
    obstacles: [],
    connections: [
      horizontalConnection({ name: "CENTER_0", y: 0, spanMm: 8 }),
      horizontalConnection({ name: "CENTER_1", y: 0.3 }),
      horizontalConnection({ name: "NORTH1_0", y: 0.6 }),
      horizontalConnection({ name: "NORTH1_1", y: 0.9 }),
      horizontalConnection({ name: "NORTH2_0", y: 1.2 }),
      horizontalConnection({ name: "NORTH2_1", y: 1.5 }),
      horizontalConnection({ name: "SOUTH1_0", y: -0.3 }),
      horizontalConnection({ name: "SOUTH1_1", y: -0.6 }),
      horizontalConnection({ name: "SOUTH2_0", y: -0.9 }),
      horizontalConnection({ name: "SOUTH2_1", y: -1.2 }),
    ],
    buses: [
      {
        busId: "CENTER",
        connectionNames: ["CENTER_0", "CENTER_1"],
        maxLengthSkew: 0.02,
        maxLength: 13,
      },
      {
        busId: "NORTH1",
        maxLengthSkew: 0.02,
        connectionNames: ["NORTH1_0", "NORTH1_1"],
        maxLength: 13,
      },
      {
        busId: "NORTH2",
        maxLengthSkew: 0.02,
        connectionNames: ["NORTH2_0", "NORTH2_1"],
        maxLength: 13,
      },
      {
        busId: "SOUTH1",
        maxLengthSkew: 0.02,
        connectionNames: ["SOUTH1_0", "SOUTH1_1"],
        maxLength: 13,
      },
      {
        busId: "SOUTH2",
        maxLengthSkew: 0.02,
        connectionNames: ["SOUTH2_0", "SOUTH2_1"],
        maxLength: 13,
      },
    ],
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
