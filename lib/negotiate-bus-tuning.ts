import { length } from "./geometry"
import { tuneLengths } from "./length-tuning"
import { reduceOrdinaryTurns } from "./reduce-ordinary-turns"
import { fixedCopper, routeCopper, VectorScene } from "./vector-scene"
import {
  assertLengthTargets,
  busLengthReports,
  fixedRouteLength,
  minimumLengthTargets,
  pairLengthReports,
} from "./route-lengths"
import type { Connection, SimpleRouteJson, Trace, Wire } from "./types"

type ConnectionName = Connection["name"]

export function busTuningMatchesTargets(
  input: SimpleRouteJson,
  traces: Trace[],
): boolean {
  return (
    busLengthReports(input, traces).every(
      (bus) =>
        bus.aboveMinimumLength &&
        bus.withinLengthLimit &&
        (bus.toleranceMm === null || bus.matched),
    ) && pairLengthReports(input, traces).every((pair) => pair.matched)
  )
}

/** Propose whole-bus tuning in board-world mm (+X right, +Y up).
 * Other generated buses remain movable; supplied copper remains hard.
 * These are provisional routing candidates, never an acceptance decision. */
export function negotiateBusTuning({
  input,
  traces,
  paired = [],
  soft = [],
}: {
  input: SimpleRouteJson
  traces: Trace[]
  paired?: Trace[]
  soft?: Trace[]
}): Trace[] {
  let result = traces
  const pairNames = new Set(
    input.differentialPairs?.flatMap((pair) => pair.connectionNames),
  )
  for (const bus of input.buses ?? []) {
    if (bus.minLength === undefined && bus.maxLengthSkew === undefined) continue
    const members = [...paired, ...result].filter((trace) =>
      bus.connectionNames.includes(trace.connection_name!),
    )
    if (
      !members.length ||
      members.some((trace) =>
        trace.route.some((point) => point.route_type !== "wire"),
      )
    )
      continue
    const local: SimpleRouteJson = {
      ...input,
      // Forecast the bank as the bus grows. Only routed members constrain
      // this proposal; complete-bus acceptance still checks every member.
      buses: [
        {
          ...bus,
          connectionNames: members.map((trace) => trace.connection_name!),
        },
      ],
      differentialPairs: input.differentialPairs?.filter((pair) =>
        pair.connectionNames.every((name) =>
          members.some((trace) => trace.connection_name === name),
        ),
      ),
      traces: [
        ...(input.traces ?? []),
        ...paired.filter(
          (trace) => !bus.connectionNames.includes(trace.connection_name!),
        ),
      ],
    }
    const targets = minimumLengthTargets(local, members)
    // Paired corridors can anchor an ordinary bank, but this repair must not
    // retune either rail independently or change their supplied geometry.
    if (
      members.some(
        (trace) =>
          (pairNames.has(trace.connection_name!) || trace.coupledSection) &&
          length(trace.route) +
            fixedRouteLength(input, trace.connection_name!) <
            targets.get(trace.connection_name!)! - 1e-7,
      )
    )
      continue
    if (
      members.every(
        (trace) =>
          length(trace.route) +
            fixedRouteLength(input, trace.connection_name!) >=
          targets.get(trace.connection_name!)! - 1e-7,
      )
    )
      continue
    try {
      assertLengthTargets(local, targets)
      const copper = [
        ...fixedCopper(local),
        ...paired.flatMap(routeCopper),
        ...soft.flatMap(routeCopper),
        ...result.flatMap(routeCopper),
      ]
      const carriers = members.map((trace) => {
        if (
          trace.curvedSegments?.length ||
          trace.coupledSection ||
          pairNames.has(trace.connection_name!)
        )
          return trace
        const connection = input.connections.find(
          (member) => member.name === trace.connection_name,
        )!
        const first = trace.route[0] as Wire
        const scene = new VectorScene(local, connection, first.width, copper)
        return {
          ...trace,
          route: reduceOrdinaryTurns(trace.route, scene).map((point) => ({
            ...point,
            route_type: "wire" as const,
            layer: first.layer,
            width: first.width,
          })),
        }
      })
      const tuned = tuneLengths(local, carriers, targets)
      const replacements = new Map<ConnectionName, Trace>(
        tuned.map((trace) => [trace.connection_name!, trace]),
      )
      result = result.map(
        (trace) => replacements.get(trace.connection_name!) ?? trace,
      )
    } catch {
      // A failed forecast does not invalidate ordinary routing alternatives.
      // Final matching retains its existing search and exact constraints.
    }
  }
  return result
}
