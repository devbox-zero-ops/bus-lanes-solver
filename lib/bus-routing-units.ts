import { windingOrders } from "./winding-orders"
import { negotiateBusTuning } from "./negotiate-bus-tuning"
import type { Connection, SimpleRouteJson, Trace } from "./types"

type DifferentialPair = NonNullable<
  SimpleRouteJson["differentialPairs"]
>[number]
type ConnectionName = Connection["name"]

export interface LaneRoutingUnit {
  pair?: DifferentialPair
  connections: Connection[]
  members?: LaneRoutingUnit[]
}

/** Keep each bus's generated copper in one candidate and rip-up unit.
 * Coupled rails stay indivisible inside the bus. Cross-bus pairs retain the
 * existing lane strategy because they cannot belong to two independent units. */
export function busRoutingUnits({
  input,
  units,
}: {
  input: SimpleRouteJson
  units: LaneRoutingUnit[]
}): LaneRoutingUnit[] | null {
  const grouped = new Set<LaneRoutingUnit>()
  const buses: LaneRoutingUnit[] = []
  for (const bus of input.buses ?? []) {
    const members = new Set<LaneRoutingUnit>()
    for (const name of bus.connectionNames) {
      const unit = units.find((unit) =>
        unit.connections.some((connection) => connection.name === name),
      )
      if (!unit) continue
      if (
        unit.connections.some(
          (connection) => !bus.connectionNames.includes(connection.name),
        )
      )
        return null
      members.add(unit)
      grouped.add(unit)
    }
    if (!members.size) continue
    buses.push({
      connections: [...members].flatMap((unit) => unit.connections),
      members: [...members],
    })
  }
  return [...buses, ...units.filter((unit) => !grouped.has(unit))]
}

/** Try declared bus order first, then the existing geometric winding orders.
 * Endpoint points are board-world mm, +X right and +Y up. */
export function busRoutingOrders(unit: LaneRoutingUnit): LaneRoutingUnit[][] {
  const members = unit.members ?? [unit]
  const byName = new Map<ConnectionName, LaneRoutingUnit>(
    members.map((member) => [member.connections[0].name, member]),
  )
  const orders = windingOrders(members.map((member) => member.connections[0]))
  const declared = orders.findIndex((order) =>
    order.every(
      (connection, position) =>
        connection.name === members[position].connections[0].name,
    ),
  )
  if (declared > 0) orders.unshift(orders.splice(declared, 1)[0])
  return orders.map((order) =>
    order.map((connection) => byName.get(connection.name)!),
  )
}

/** Update the provisional bank before the next member can consume its space.
 * Foreign buses stay soft; final selection still uses the complete bus. */
export function tuneRoutingUnit({
  input,
  unit,
  paired,
  routed,
}: {
  input: SimpleRouteJson
  unit: LaneRoutingUnit
  paired: Trace[]
  routed: Map<ConnectionName, Trace>
}): Trace[] {
  const names = new Set(unit.connections.map((connection) => connection.name))
  const traces = [...routed.values()]
  const tuned = negotiateBusTuning({
    input,
    paired,
    traces: traces.filter((trace) => names.has(trace.connection_name!)),
    soft: traces.filter((trace) => !names.has(trace.connection_name!)),
  })
  for (const trace of tuned) routed.set(trace.connection_name!, trace)
  return tuned
}
