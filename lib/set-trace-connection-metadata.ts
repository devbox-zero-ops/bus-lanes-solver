import { effectiveCarrierLayers } from "./effective-carrier-layers"
import { distance } from "./geometry"
import type { SimpleRouteJson, Trace } from "./types"

/** Attach connection ownership to completed output copies. Board-world mm,
 * +X right, +Y up; route geometry and supplied copper remain unchanged. */
export function setTraceConnectionMetadata({
  input,
  traces,
}: {
  input: SimpleRouteJson
  traces: Trace[]
}): void {
  for (const trace of traces) {
    const connection = input.connections.find(
      (connection) => connection.name === trace.connection_name,
    )
    const start = trace.route.find((point) => point.route_type === "wire")
    if (!connection || connection.pointsToConnect.length !== 2 || !start)
      continue

    const endpoints = [...connection.pointsToConnect].sort(
      (left, right) => distance(left, start) - distance(right, start),
    )
    trace.connectsTo ??= endpoints.flatMap((point) => {
      if (point.pcb_port_id) return [point.pcb_port_id]
      return []
    })

    const hasBusLayerConstraints = input.buses?.some(
      (bus) =>
        bus.allowedLayers && bus.connectionNames.includes(connection.name),
    )
    if (!hasBusLayerConstraints) continue

    const traceAllowedLayers = trace.allowedLayers
    let allowedLayers = effectiveCarrierLayers(input, connection)
    if (traceAllowedLayers) {
      allowedLayers = allowedLayers.filter((layer) =>
        traceAllowedLayers.includes(layer),
      )
    }
    trace.allowedLayers = allowedLayers
  }
}
