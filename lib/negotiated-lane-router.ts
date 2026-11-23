// Negotiated two-layer DDR router with mid-route vias, reserved tuning lanes and coupled pairs.
// Board space in mm, +X right, +Y up. Input/Output: SimpleRouteJson (tscircuit).
//
// Model
//  - Fine grid (cfg.p) over both signal layers; negotiated congestion (rip-up and reroute with history).
//  - A "zone" between the two packages holds horizontal tuning lanes. Every net crosses the zone on
//    exactly one lane; the strip above the lane is reserved for that net's length-tuning bumps.
//  - A differential pair is routed as ONE fat centreline on a single layer without vias; its two
//    traces are the +/- offsets of that centreline, joined to their pads by short stubs.
//  - Vias are priced per bus, so important signals keep them to a minimum and the rest absorb them.
type Pt = { x: number; y: number }
export type NegotiatedLaneResult = {
  solved: boolean
  traces: any[]
  stuck: string[]
  log: string[]
  iterations: number
}
/** Routes the connections of `input` on the top and bottom layers; see the model above. */
export function routeNegotiatedLanes(
  input: any,
  options: Record<string, any> = {},
): NegotiatedLaneResult {
  const srj = structuredClone(input)
  const cfg = {
    p: 0.05,
    region: null as null | {
      minX: number
      maxX: number
      minY: number
      maxY: number
    },
    zone: [0, 0] as [number, number],
    zoneRows: null as null | [number, number],
    w: 0.102,
    pairGap: 0.18,
    viaD: 0.3,
    viaHole: 0.15,
    viaCost: 1.0,
    viaCostByBus: {} as Record<string, number>,
    maxIters: 200,
    evalEvery: 4,
    histInc: 1.0,
    presGrowth: 1.25,
    presMax: 30,
    ownCopperRadius: 0.9,
    incremental: true,
    lengthCap: true,
    stallIters: 60,
    stuckRounds: 1e9,
    stuckBoost: 1.6,
    capMargin: 1.5,
    seed: 0,
    slackK: 4,
    pairFarLayerCost: 3,
    stubViaCost: 0.6,
    pairWeight: 6,
    overBoost: 1.6,
    overWeightMax: 60,
    presRestart: 2,
    minWeight: 0.2,
    weightMax: 10,
    weightGrow: 1.1,
    skewMargin: 0.12,
    windowMargin: 0.08,
    preloadedTraces: [] as any[],
    onlyNets: null as string[] | null,
    verbose: false,
    busWindow: null as Record<string, [number, number]> | null,
    labels: {} as Record<string, string>,
    ...options,
  }
  const origProblem = {
    connections: srj.connections,
    buses: srj.buses ?? [],
    differentialPairs: srj.differentialPairs ?? [],
  }
  const label = (n: string) => cfg.labels[n] ?? n
  if (cfg.onlyNets)
    srj.connections = srj.connections.filter((c: any) =>
      cfg.onlyNets!.includes(c.name),
    )
  {
    const keep = new Set(srj.connections.map((c: any) => c.name))
    srj.differentialPairs = (srj.differentialPairs ?? []).filter((p: any) =>
      p.connectionNames.every((n: string) => keep.has(n)),
    )
  }
  const logLines: string[] = []
  const log = (...a: any[]) => {
    logLines.push(a.join(" "))
    if (cfg.verbose) console.log(...a)
  }
  let iterations = 0
  const t0 = performance.now()

  // ---------- grid ----------
  const P = cfg.p,
    LAYERS = ["top", "bottom"]
  const allPts = [
    ...srj.obstacles.map((o: any) => o.center),
    ...origProblem.connections.flatMap((c: any) => c.pointsToConnect),
  ]
  const region = cfg.region ?? {
    minX: Math.min(...allPts.map((p: Pt) => p.x)) - 6,
    maxX: Math.max(...allPts.map((p: Pt) => p.x)) + 2,
    minY: Math.min(...allPts.map((p: Pt) => p.y)) - 6,
    maxY: Math.max(...allPts.map((p: Pt) => p.y)) + 6,
  }
  const anchor = origProblem.connections[0].pointsToConnect[0] // pads sit on the grid
  const X0 = anchor.x - Math.ceil((anchor.x - region.minX) / P) * P,
    Y0 = anchor.y - Math.ceil((anchor.y - region.minY) / P) * P
  const NX = Math.round((region.maxX - X0) / P) + 1,
    NY = Math.round((region.maxY - Y0) / P) + 1,
    NN = NX * NY
  const gx = (x: number) => Math.round((x - X0) / P),
    gy = (y: number) => Math.round((y - Y0) / P)
  const wx = (i: number) => X0 + i * P,
    wy = (j: number) => Y0 + j * P
  const nodeOf = (p: Pt) => gy(p.y) * NX + gx(p.x)

  // ---------- clearances (centre to centre, mm) ----------
  const GAP = 0.102 // copper-to-copper spacing (TI minimum = one trace width)
  const H = (cfg.w + cfg.pairGap) / 2 // pair member offset from the pair centreline
  const R_TT = 0.235 // thin trace centre to thin trace centre on the grid (>= w + GAP)
  const R_TV = cfg.viaD / 2 + GAP + cfg.w / 2 + 0.02
  const R_VV =
    Math.max(
      cfg.viaD + GAP,
      cfg.viaHole + (srj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.24),
    ) + 0.001
  const C_TP = (srj.minTraceToPadEdgeClearance ?? 0.12) + cfg.w / 2 + 0.006
  const C_VP = (srj.minViaEdgeToPadEdgeClearance ?? 0.15) + cfg.viaD / 2 + 0.006
  const disk = (r: number) => {
    const o: number[] = []
    const n = Math.ceil(r / P)
    for (let dy = -n; dy <= n; dy++)
      for (let dx = -n; dx <= n; dx++)
        if (Math.hypot(dx, dy) * P < r - 1e-9) o.push(dx, dy)
    return o
  }
  // stamp radii: [into thin raster, into fat raster] for thin copper, fat copper and vias
  const D = {
    thinT: disk(R_TT),
    thinF: disk(R_TT + H),
    fatT: disk(R_TT + H),
    fatF: disk(R_TT + 2 * H),
    viaT: disk(R_TV),
    viaF: disk(R_TV + H),
    trV: disk(R_TV),
    fatV: disk(R_TV + H),
    viaV: disk(R_VV),
  }

  // ---------- static rasters ----------
  const staticT = LAYERS.map(() => new Uint8Array(NN)),
    staticF = LAYERS.map(() => new Uint8Array(NN)),
    staticV = new Uint8Array(NN)
  function obstacleCells(o: any, clear: number): number[] {
    const cells: number[] = [],
      hx = o.width / 2,
      hy = o.height / 2
    const i0 = Math.max(0, gx(o.center.x - hx - clear) - 1),
      i1 = Math.min(NX - 1, gx(o.center.x + hx + clear) + 1),
      j0 = Math.max(0, gy(o.center.y - hy - clear) - 1),
      j1 = Math.min(NY - 1, gy(o.center.y + hy + clear) + 1)
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const dx = Math.abs(wx(i) - o.center.x),
          dy = Math.abs(wy(j) - o.center.y)
        const d =
          o.shape === "circle"
            ? Math.hypot(dx, dy) - hx
            : Math.hypot(Math.max(0, dx - hx), Math.max(0, dy - hy))
        if (d < clear) cells.push(j * NX + i)
      }
    return cells
  }
  type PadStamp = { t: Int32Array[]; v: Int32Array; f?: Int32Array[] }
  const padKey = (p: Pt) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`
  const padStamps = new Map<string, PadStamp>()
  const connPads = new Set<string>(
    origProblem.connections.flatMap((c: any) => c.pointsToConnect.map(padKey)),
  )
  for (const o of srj.obstacles) {
    const ls = o.layers
      .map((l: string) => LAYERS.indexOf(l))
      .filter((l: number) => l >= 0)
    const t = obstacleCells(o, C_TP),
      f = obstacleCells(o, C_TP + H),
      v = obstacleCells(o, C_VP)
    const st: PadStamp = {
      t: [new Int32Array(0), new Int32Array(0)],
      v: new Int32Array(v),
    }
    for (const l of ls) {
      st.t[l] = new Int32Array(t)
      for (const c of t) staticT[l][c]++
      for (const c of f) staticF[l][c]++
    }
    for (const c of v) staticV[c]++
    if (connPads.has(padKey(o.center)) && o.layers.includes("top"))
      padStamps.set(padKey(o.center), st)
  }
  // keep a via site under every bus ball free of other nets' copper on the far layer
  for (const c of origProblem.connections)
    for (const p of c.pointsToConnect) {
      const st = padStamps.get(padKey(p))
      if (!st) continue
      const cells = obstacleCells(
        { shape: "circle", center: p, width: cfg.viaD, height: cfg.viaD },
        GAP + cfg.w / 2 + 0.02,
      )
      const have = new Set(st.t[1])
      for (const q of cells) if (!have.has(q)) staticT[1][q]++
      st.t[1] = Int32Array.from(new Set([...st.t[1], ...cells]))
    }
  const applyPad = (st: PadStamp, s: number) => {
    for (let l = 0; l < 2; l++) {
      for (const c of st.t[l]) staticT[l][c] += s
      if (st.f) for (const c of st.f[l]) staticF[l][c] += s
    }
    for (const c of st.v) staticV[c] += s
  }
  // a terminal may be a pad or the end of supplied (fanout) copper on either signal layer
  const LOf = (p: any) => Math.max(0, LAYERS.indexOf(p.layer ?? "top"))
  const termNode = (p: any) => nodeOf(p) + LOf(p) * NN

  // ---------- zone / lanes ----------
  const zXL = gx(cfg.zone[0]),
    zXR = gx(cfg.zone[1]),
    laneLen = (zXR - zXL) * P
  const inZone = (i: number) => i > zXL && i < zXR
  const rowsRange = cfg.zoneRows ?? [region.minY + 0.5, region.maxY - 0.5]
  const laneBlocked = LAYERS.map((name) => {
    const b = new Uint8Array(NY).fill(1)
    for (let j = gy(rowsRange[0]); j <= gy(rowsRange[1]); j++)
      if (j >= 0 && j < NY) b[j] = 0
    for (const o of srj.obstacles) {
      if (
        !o.layers.includes(name) ||
        o.center.x + o.width / 2 + C_TP < wx(zXL) ||
        o.center.x - o.width / 2 - C_TP > wx(zXR)
      )
        continue
      for (
        let j = Math.max(0, gy(o.center.y - o.height / 2 - C_TP));
        j <= Math.min(NY - 1, gy(o.center.y + o.height / 2 + C_TP));
        j++
      )
        b[j] = 1
    }
    return b
  })
  const occLane = LAYERS.map(() => new Uint16Array(NY)),
    histLane = LAYERS.map(() => new Float32Array(NY))
  const LP = 0.21,
    BW = LP,
    BG = LP,
    CH = 0.08 // single-trace bump width / gap / chamfer
  const PW = 0.5,
    PG = 0.5,
    PCH = 0.13,
    TRIM = 0.45,
    TRIM_LEN = 1.9 // pair bump width / gap / chamfer, trim amplitude and length
  const kSingle = Math.max(1, Math.floor((laneLen - 0.5) / (BW + BG))),
    kPair = Math.max(1, Math.floor((laneLen - TRIM_LEN - 0.4 + PG) / (PW + PG)))
  const bumpExtra = (a: number, ch = CH) => {
    const c = Math.min(ch, a / 2)
    return 2 * a - (8 - 4 * Math.SQRT2) * c
  }
  const bumpAmp = (e: number, ch = CH) =>
    e >= bumpExtra(2 * ch, ch)
      ? (e + (8 - 4 * Math.SQRT2) * ch) / 2
      : e / (2 - (4 - 2 * Math.SQRT2))
  const PAIR_MIN_AMP = 0.46,
    PAIR_MIN_EXTRA = bumpExtra(PAIR_MIN_AMP, PCH)

  // ---------- preloaded (frozen) copper ----------
  const preTraces: any[] = cfg.preloadedTraces ?? []
  const fixedLen = new Map<string, number>(),
    ownCopper = new Map<string, PadStamp[]>()
  const fixedOf = (name: string) => fixedLen.get(name) ?? 0
  function collectCells(cells: number[], offs: number[]): number[] {
    const seen = new Set<number>()
    for (const c of cells) {
      const ci = c % NX,
        cj = (c / NX) | 0
      for (let k = 0; k < offs.length; k += 2) {
        const i = ci + offs[k],
          j = cj + offs[k + 1]
        if (i >= 0 && j >= 0 && i < NX && j < NY) seen.add(j * NX + i)
      }
    }
    return [...seen]
  }
  {
    const pts: number[][] = [[], []],
      vias: number[] = []
    const blockRows = (l: number, x: number, y: number, r: number) => {
      if (x < wx(zXL) - 0.3 || x > wx(zXR) + 0.3) return
      for (
        let j = Math.max(0, Math.floor((y - r - Y0) / P));
        j <= Math.min(NY - 1, Math.ceil((y + r - Y0) / P));
        j++
      )
        laneBlocked[l][j] = 1
    }
    const inside = (x: number, y: number) =>
      x >= region.minX &&
      x <= region.maxX &&
      y >= region.minY &&
      y <= region.maxY
    for (const t of preTraces)
      for (let i = 0; i < t.route.length; i++) {
        const a = t.route[i]
        if (a.route_type === "via") {
          if (inside(a.x, a.y)) {
            vias.push(nodeOf(a))
            for (let l = 0; l < 2; l++) blockRows(l, a.x, a.y, R_TV)
          }
          continue
        }
        const b = t.route[i + 1],
          l = LAYERS.indexOf(a.layer)
        if (l < 0) continue
        if (!b || b.route_type !== "wire" || b.layer !== a.layer) {
          if (inside(a.x, a.y)) pts[l].push(nodeOf(a))
          continue
        }
        const n = Math.max(
          1,
          Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.02),
        )
        for (let k = 0; k <= n; k++) {
          const x = a.x + ((b.x - a.x) * k) / n,
            y = a.y + ((b.y - a.y) * k) / n
          if (!inside(x, y)) continue
          pts[l].push(nodeOf({ x, y }))
          blockRows(l, x, y, 0.23)
        }
      }
    // Supplied copper of a net being routed (its fanout): its length counts toward the net, and the
    // part next to the net's terminal must not block the net itself.
    const routed = new Map<string, any>(
      srj.connections.map((c: any) => [c.name, c]),
    )
    for (const t of preTraces) {
      const c = routed.get(t.connection_name)
      if (!c) continue
      const own: number[][] = [[], []]
      let len = 0
      for (let i = 0; i + 1 < t.route.length; i++) {
        const a = t.route[i],
          b = t.route[i + 1]
        if (
          a.route_type !== "wire" ||
          b.route_type !== "wire" ||
          a.layer !== b.layer
        )
          continue
        const l = LAYERS.indexOf(a.layer),
          d = Math.hypot(b.x - a.x, b.y - a.y)
        len += d
        if (l < 0) continue
        const n = Math.max(1, Math.ceil(d / 0.02))
        for (let k = 0; k <= n; k++) {
          const x = a.x + ((b.x - a.x) * k) / n,
            y = a.y + ((b.y - a.y) * k) / n
          if (
            inside(x, y) &&
            c.pointsToConnect.some(
              (q: any) =>
                LAYERS[l] === (q.layer ?? "top") &&
                Math.hypot(q.x - x, q.y - y) < cfg.ownCopperRadius,
            )
          )
            own[l].push(nodeOf({ x, y }))
        }
      }
      fixedLen.set(c.name, (fixedLen.get(c.name) ?? 0) + len)
      if (!own[0].length && !own[1].length) continue
      const pad = P * 0.71,
        cells = (ids: number[], offs: number[]) =>
          Int32Array.from(collectCells([...new Set(ids)], offs))
      const st: PadStamp = {
        t: [cells(own[0], disk(0.225 + pad)), cells(own[1], disk(0.225 + pad))],
        f: [
          cells(own[0], disk(0.225 + H + pad)),
          cells(own[1], disk(0.225 + H + pad)),
        ],
        v: cells([...own[0], ...own[1]], disk(R_TV + pad)),
      }
      ownCopper.set(c.name, [...(ownCopper.get(c.name) ?? []), st])
    }
    const m = new Uint8Array(NN)
    const stampSet = (cells: number[], offs: number[], dst: Uint8Array) => {
      m.fill(0)
      for (const c of new Set(cells)) {
        const ci = c % NX,
          cj = (c / NX) | 0
        for (let k = 0; k < offs.length; k += 2) {
          const i = ci + offs[k],
            j = cj + offs[k + 1]
          if (i >= 0 && j >= 0 && i < NX && j < NY) m[j * NX + i] = 1
        }
      }
      for (let c = 0; c < NN; c++) if (m[c]) dst[c]++
    }
    const pad = P * 0.71
    for (let l = 0; l < 2; l++) {
      stampSet(pts[l], disk(0.225 + pad), staticT[l])
      stampSet(vias, disk(R_TV + pad), staticT[l])
      stampSet(pts[l], disk(0.225 + H + pad), staticF[l])
      stampSet(vias, disk(R_TV + H + pad), staticF[l])
    }
    stampSet([...pts[0], ...pts[1]], disk(R_TV + pad), staticV)
    stampSet(vias, disk(R_VV + pad), staticV)
    if (preTraces.length) log(`preloaded ${preTraces.length} frozen traces`)
  }

  // ---------- nets ----------
  type Net = {
    id: string
    kind: "single" | "fat" | "stub"
    label: string
    bus?: any
    src: number
    dst: number
    ownPads: PadStamp[]
    ignore: Net[]
    viaCost: number
    lenWeight: number
    above: number
    below: number
    path?: number[]
    laneAt?: number
    laneLayer?: number
    stamp?: {
      t: Int32Array[]
      f: Int32Array[]
      v: Int32Array
      lane?: [number, number, number]
    }
    base?: number
    target?: number
    top?: number
    lo?: number
    // single: the connection; fat: the pair; stub: member connection and end index
    conn?: any
    pair?: PairInfo
    member?: 0 | 1
    end?: 0 | 1
    exact?: Pt
    fatLayer?: number
    stuckRounds?: number
  }
  type PairInfo = {
    conns: [any, any]
    fat: Net
    stubs: Net[]
    G: [Pt, Pt]
    d: [Pt, Pt]
    M: [[Pt, Pt], [Pt, Pt]]
    leftMember: number
    bus?: any
  }
  const busOf = (n: string) =>
    (srj.buses ?? []).find((b: any) => b.connectionNames.includes(n))
  const oct = (a: Pt, b: Pt) => {
    const dx = Math.abs(a.x - b.x),
      dy = Math.abs(a.y - b.y)
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)
  }
  const sortedPads = (c: any): [Pt, Pt] =>
    [...c.pointsToConnect].sort((a: Pt, b: Pt) => a.x - b.x) as [Pt, Pt] // [far-left chip, right chip]
  const nets: Net[] = [],
    pairs: PairInfo[] = []
  const inPair = new Set<string>(
    (srj.differentialPairs ?? []).flatMap((p: any) => p.connectionNames),
  )
  const viaCostOf = (bus: any) => cfg.viaCostByBus[bus?.busId] ?? cfg.viaCost
  for (const c of srj.connections) {
    if (inPair.has(c.name)) continue
    const pads = sortedPads(c),
      bus = busOf(c.name)
    nets.push({
      id: c.name,
      kind: "single",
      label: label(c.name),
      bus,
      conn: c,
      src: termNode(pads[0]),
      dst: termNode(pads[1]),
      ownPads: [
        ...pads.map((p) => padStamps.get(padKey(p))!).filter(Boolean),
        ...(ownCopper.get(c.name) ?? []),
      ],
      ignore: [],
      viaCost: viaCostOf(bus),
      lenWeight: 1,
      above: 2,
      below: 0,
    })
  }
  const allPads = srj.obstacles.filter((o: any) => o.layers.includes("top"))
  for (const pr of srj.differentialPairs ?? []) {
    const conns = pr.connectionNames.map((n: string) =>
      srj.connections.find((c: any) => c.name === n),
    ) as [any, any]
    const pads = conns.map(sortedPads) as [[Pt, Pt], [Pt, Pt]]
    const G: Pt[] = [],
      d: Pt[] = [],
      M: [Pt, Pt][] = []
    for (const e of [0, 1]) {
      const a = pads[0][e],
        b = pads[1][e],
        mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        other = {
          x: (pads[0][1 - e].x + pads[1][1 - e].x) / 2,
          y: (pads[0][1 - e].y + pads[1][1 - e].y) / 2,
        }
      // leave the pads in the free direction that heads most toward the other chip
      let best: { d: Pt; g: Pt; score: number } | null = null
      for (const dir of [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ]) {
        const reach =
          Math.max(
            (a.x - mid.x) * dir.x + (a.y - mid.y) * dir.y,
            (b.x - mid.x) * dir.x + (b.y - mid.y) * dir.y,
          ) + 0.7
        const g = { x: mid.x + dir.x * reach, y: mid.y + dir.y * reach }
        let blocked = false
        for (const o of allPads) {
          if (padKey(o.center) === padKey(a) || padKey(o.center) === padKey(b))
            continue
          for (let s = 0.2; s <= reach + 0.9 && !blocked; s += 0.1) {
            const q = { x: mid.x + dir.x * s, y: mid.y + dir.y * s }
            if (
              Math.hypot(q.x - o.center.x, q.y - o.center.y) <
              o.width / 2 + C_TP + H
            )
              blocked = true
          }
        }
        if (blocked) continue
        const score = (other.x - mid.x) * dir.x + (other.y - mid.y) * dir.y
        if (!best || score > best.score) best = { d: dir, g, score }
      }
      if (!best)
        throw Error(
          `pair ${label(conns[0].name)}: no free direction to leave its pads at end ${e}`,
        )
      G.push({ x: wx(gx(best.g.x)), y: wy(gy(best.g.y)) })
      d.push(best.d)
    }
    // which member is on the left of the direction of travel (end 0 -> end 1)
    const a0 = pads[0][0],
      mid0 = {
        x: (pads[0][0].x + pads[1][0].x) / 2,
        y: (pads[0][0].y + pads[1][0].y) / 2,
      }
    const crossA = d[0].x * (a0.y - mid0.y) - d[0].y * (a0.x - mid0.x)
    let leftMember = crossA > 1e-9 ? 0 : crossA < -1e-9 ? 1 : -1
    if (leftMember < 0) {
      // pads lie along the leaving direction at end 0: decide at end 1, else arbitrarily
      const a1 = pads[0][1],
        mid1 = {
          x: (pads[0][1].x + pads[1][1].x) / 2,
          y: (pads[0][1].y + pads[1][1].y) / 2,
        }
      const crossB = -d[1].x * (a1.y - mid1.y) + d[1].y * (a1.x - mid1.x)
      leftMember = crossB > 1e-9 ? 0 : crossB < -1e-9 ? 1 : 0
    }
    for (const e of [0, 1]) {
      const t = e === 0 ? d[0] : { x: -d[1].x, y: -d[1].y },
        left = { x: -t.y, y: t.x }
      const ml = { x: G[e].x + left.x * H, y: G[e].y + left.y * H },
        mr = { x: G[e].x - left.x * H, y: G[e].y - left.y * H }
      M.push(leftMember === 0 ? [ml, mr] : [mr, ml])
    }
    const bus = busOf(conns[0].name)
    const inner = (e: number) =>
      nodeOf({ x: G[e].x + d[e].x * 0.3, y: G[e].y + d[e].y * 0.3 })
    const fat: Net = {
      id: `pair:${conns[0].name}`,
      kind: "fat",
      label: `${label(conns[0].name)}+${label(conns[1].name)}`,
      bus,
      src: inner(0),
      dst: inner(1),
      ownPads: conns.flatMap((c: any) => ownCopper.get(c.name) ?? []),
      ignore: [],
      viaCost: Infinity,
      lenWeight: 1,
      above: 12,
      below: 12,
    }
    const info: PairInfo = {
      conns,
      fat,
      stubs: [],
      G: G as [Pt, Pt],
      d: d as [Pt, Pt],
      M: M as any,
      leftMember,
      bus,
    }
    fat.pair = info
    for (const m of [0, 1] as const)
      for (const e of [0, 1] as const) {
        const pad = pads[m][e]
        const st: Net = {
          id: `stub:${conns[m].name}:${e}`,
          kind: "stub",
          label: `${label(conns[m].name)}.${e ? "cpu" : "ram"}`,
          bus,
          src: termNode(pad),
          dst: nodeOf(M[e][m]),
          exact: M[e][m],
          ownPads: [
            ...[padStamps.get(padKey(pad))!].filter(Boolean),
            ...(ownCopper.get(conns[m].name) ?? []),
          ],
          ignore: [fat],
          viaCost: cfg.stubViaCost,
          lenWeight: 3,
          above: 0,
          below: 0,
          pair: info,
          member: m,
          end: e,
          conn: conns[m],
        }
        info.stubs.push(st)
        fat.ignore.push(st)
      }
    pairs.push(info)
    nets.push(fat, ...info.stubs)
  }
  // length priority from slack: nets close to their maximum get the direct lanes
  for (const n of nets) {
    if (n.kind === "stub") continue
    const ends: [Pt, Pt] =
      n.kind === "single" ? sortedPads(n.conn) : [n.pair!.G[0], n.pair!.G[1]]
    const fixed =
      n.kind === "single"
        ? fixedOf(n.conn.name)
        : Math.max(...n.pair!.conns.map((c: any) => fixedOf(c.name)))
    const slack =
      (cfg.busWindow?.[n.bus?.busId]?.[1] ?? n.bus?.maxLength ?? 1e9) -
      oct(ends[0], ends[1]) -
      fixed
    n.lenWeight = Math.max(
      cfg.minWeight,
      Math.min(cfg.weightMax, cfg.slackK / Math.max(slack, 0.1)),
    )
    if (n.kind === "fat") n.lenWeight = Math.max(n.lenWeight, cfg.pairWeight)
  } // pairs are the most timing-critical: they get the direct route

  // ---------- dynamic occupancy ----------
  const occT = LAYERS.map(() => new Uint8Array(NN)),
    occF = LAYERS.map(() => new Uint8Array(NN)),
    occV = new Uint8Array(NN)
  const histT = LAYERS.map(() => new Float32Array(NN)),
    histV = new Float32Array(NN)
  const mark = new Uint32Array(NN)
  let markGen = 0
  function collect(cells: number[], offs: number[]): number[] {
    markGen++
    const out: number[] = []
    for (const c of cells) {
      const ci = c % NX,
        cj = (c / NX) | 0
      for (let k = 0; k < offs.length; k += 2) {
        const i = ci + offs[k],
          j = cj + offs[k + 1]
        if (i < 0 || j < 0 || i >= NX || j >= NY) continue
        const q = j * NX + i
        if (mark[q] !== markGen) {
          mark[q] = markGen
          out.push(q)
        }
      }
    }
    return out
  }
  const union = (...lists: number[][]) => Int32Array.from(new Set(lists.flat()))
  function stampNet(n: Net, s: number) {
    if (!n.stamp) return
    for (let l = 0; l < 2; l++) {
      for (const c of n.stamp.t[l]) occT[l][c] += s
      for (const c of n.stamp.f[l]) occF[l][c] += s
    }
    for (const c of n.stamp.v) occV[c] += s
    if (n.stamp.lane) {
      const [l, a, b] = n.stamp.lane
      for (let j = Math.max(0, a); j <= Math.min(NY - 1, b); j++)
        occLane[l][j] += s
    }
  }
  function buildStamp(n: Net) {
    const tr: number[][] = [[], []],
      vias: number[] = [],
      path = n.path!
    for (let k = 0; k < path.length; k++) {
      const id = path[k],
        l = id >= NN ? 1 : 0,
        c = id - l * NN
      tr[l].push(c)
      if (k && (path[k - 1] >= NN ? 1 : 0) !== l) vias.push(c)
    }
    const fat = n.kind === "fat"
    const t = [0, 1].map((l) =>
      union(collect(tr[l], fat ? D.fatT : D.thinT), collect(vias, D.viaT)),
    )
    const f = [0, 1].map((l) =>
      union(collect(tr[l], fat ? D.fatF : D.thinF), collect(vias, D.viaF)),
    )
    const v = union(
      collect([...tr[0], ...tr[1]], fat ? D.fatV : D.trV),
      collect(vias, D.viaV),
    )
    n.stamp = { t, f, v }
    if (n.laneAt !== undefined) {
      const row = ((path[n.laneAt] % NN) / NX) | 0
      n.stamp.lane = [n.laneLayer!, row - n.below - 2, row + n.above + 2]
    }
  }

  // ---------- A* ----------
  const LEN = new Float32Array(2 * NN),
    Gs = new Float32Array(2 * NN),
    PAR = new Int32Array(2 * NN),
    SEEN = new Uint32Array(2 * NN),
    DONE = new Uint32Array(2 * NN),
    LANE = new Uint8Array(2 * NN)
  let gen = 0
  class Heap {
    k: number[] = []
    v: number[] = []
    push(key: number, val: number) {
      const k = this.k,
        v = this.v
      let i = k.length
      k.push(key)
      v.push(val)
      while (i > 0) {
        const p = (i - 1) >> 1
        if (k[p] <= key) break
        k[i] = k[p]
        v[i] = v[p]
        i = p
      }
      k[i] = key
      v[i] = val
    }
    pop(): number {
      const k = this.k,
        v = this.v
      const top = v[0]
      const key = k.pop()!,
        val = v.pop()!
      const n = k.length
      if (n) {
        let i = 0
        for (;;) {
          let c = 2 * i + 1
          if (c >= n) break
          if (c + 1 < n && k[c + 1] < k[c]) c++
          if (k[c] >= key) break
          k[i] = k[c]
          v[i] = v[c]
          i = c
        }
        k[i] = key
        v[i] = val
      }
      return top
    }
    get size() {
      return this.k.length
    }
  }
  const DIRS = [1, 0, 1, 1, 0, 1, -1, 1, -1, 0, -1, -1, 0, -1, 1, -1]
  let presFac = 0.5
  function laneCost(n: Net, l: number, row: number): number {
    const a = row - n.below,
      b = row + n.above
    if (a < 0 || b >= NY) return Infinity
    for (let j = a; j <= b; j++) if (laneBlocked[l][j]) return Infinity
    let occ = 0,
      h = 0
    for (let j = Math.max(0, a - 2); j <= Math.min(NY - 1, b + 2); j++) {
      if (occLane[l][j] > occ) occ = occLane[l][j]
      h += histLane[l][j]
    }
    return laneLen * (n.lenWeight + h / (b - a + 5) + presFac * occ)
  }
  /** A pair lives on one layer end to end; try both and keep the cheaper (the far layer costs its members a via each end). */
  /** Longest path the search may return for a net: the top of its bus window (members of a pair also carry their stubs). */
  function capOf(n: Net): number {
    if (!cfg.lengthCap || n.kind === "stub") return Infinity
    const bus = n.bus,
      w = cfg.busWindow?.[bus?.busId]
    const top = w
      ? w[1]
      : bus?.minLength !== undefined
        ? bus.maxLength - 0.05
        : bus?.maxLength !== undefined
          ? bus.maxLength - 0.02
          : Infinity
    if (n.kind === "single") return top - 0.1 - fixedOf(n.conn.name)
    const pr = n.pair!,
      stubs = Math.max(
        ...[0, 1].map((m) =>
          pr.stubs[m * 2].path && pr.stubs[m * 2 + 1].path
            ? stubLen(pr.stubs[m * 2]) + stubLen(pr.stubs[m * 2 + 1])
            : 2.4,
        ),
      )
    return (
      top - stubs - 0.4 - Math.max(...pr.conns.map((c: any) => fixedOf(c.name)))
    )
  }
  const routeCapped = (n: Net) => {
    const cap = capOf(n)
    return (cap < Infinity && routeCore(n, cap)) || routeCore(n, Infinity)
  }
  function route(n: Net): boolean {
    if (n.kind === "stub") {
      const L = n.pair!.fat.fatLayer ?? 0
      n.dst = (n.dst % NN) + L * NN
      return routeCore(n, Infinity)
    }
    if (n.kind !== "fat") return routeCapped(n)
    let best: {
      cost: number
      path: number[]
      laneAt?: number
      layer: number
    } | null = null
    for (const L of [0, 1]) {
      n.fatLayer = L
      n.src = (n.src % NN) + L * NN
      n.dst = (n.dst % NN) + L * NN
      if (!routeCapped(n)) continue
      const cost = Gs[n.dst] + (L ? cfg.pairFarLayerCost * n.lenWeight : 0)
      if (!best || cost < best.cost)
        best = { cost, path: n.path!, laneAt: n.laneAt, layer: L }
    }
    if (!best) return false
    n.fatLayer = best.layer
    n.path = best.path
    n.laneAt = best.laneAt
    n.laneLayer = best.layer
    n.src = (n.src % NN) + best.layer * NN
    n.dst = (n.dst % NN) + best.layer * NN
    return true
  }
  function routeCore(n: Net, cap: number): boolean {
    gen++
    const heap = new Heap(),
      fat = n.kind === "fat",
      stub = n.kind === "stub"
    const sStat = fat ? staticF : staticT,
      sOcc = fat ? occF : occT
    const ti = n.dst % NX,
      tj = (n.dst / NX) | 0
    const oct2 = (id: number) => {
      const c = id >= NN ? id - NN : id
      const dx = Math.abs((c % NX) - ti),
        dy = Math.abs(((c / NX) | 0) - tj)
      return (Math.max(dx, dy) + 0.4142 * Math.min(dx, dy)) * P
    }
    const hfun = (id: number) => oct2(id) * n.lenWeight
    Gs[n.src] = 0
    LEN[n.src] = 0
    SEEN[n.src] = gen
    PAR[n.src] = -1
    LANE[n.src] = 0
    heap.push(hfun(n.src), n.src)
    // a path that could no longer finish inside the net's length window is not expanded, so over-length
    // detours never appear: the net stays in conflict on its short route and the others have to yield
    const relax = (
      to: number,
      g: number,
      from: number,
      lane: number,
      len: number,
    ) => {
      const L = LEN[from] + len
      if (L + oct2(to) > cap) return
      if (SEEN[to] !== gen || g < Gs[to] - 1e-9) {
        SEEN[to] = gen
        Gs[to] = g
        LEN[to] = L
        PAR[to] = from
        LANE[to] = lane
        heap.push(g + hfun(to), to)
      }
    }
    let found = false
    while (heap.size) {
      const id = heap.pop()
      if (DONE[id] === gen) continue
      DONE[id] = gen
      if (id === n.dst) {
        found = true
        break
      }
      const l = id >= NN ? 1 : 0,
        c = id - l * NN,
        i = c % NX,
        j = (c / NX) | 0,
        g = Gs[id]
      const sT = sStat[l],
        oT = sOcc[l],
        hT = histT[l]
      for (let d = 0; d < 16; d += 2) {
        const ni = i + DIRS[d],
          nj = j + DIRS[d + 1]
        if (ni < 0 || nj < 0 || ni >= NX || nj >= NY || inZone(ni)) continue
        const q = nj * NX + ni
        if (sT[q] && q !== n.dst % NN) continue
        const len = DIRS[d] && DIRS[d + 1] ? P * Math.SQRT2 : P
        relax(
          q + l * NN,
          g + len * (n.lenWeight + hT[q] + presFac * oT[q]),
          id,
          0,
          len,
        )
      }
      if (
        n.viaCost < Infinity &&
        !staticV[c] &&
        !staticT[1 - l][c] &&
        !inZone(i) &&
        i !== zXL &&
        i !== zXR
      )
        relax(
          c + (1 - l) * NN,
          g + n.viaCost + 0.5 * (histV[c] + presFac * occV[c]),
          id,
          0,
          0,
        )
      if (!stub && i === zXL && !laneBlocked[l][j]) {
        const end = j * NX + zXR
        if (!sStat[l][end]) {
          const cst = laneCost(n, l, j)
          if (cst < Infinity) relax(end + l * NN, g + cst, id, 1, laneLen)
        }
      }
    }
    if (!found) return false
    const path: number[] = []
    let laneTo = -1
    for (let id = n.dst; id !== -1; id = PAR[id]) {
      path.push(id)
      if (LANE[id] && laneTo < 0) laneTo = id
    }
    path.reverse()
    n.path = path
    if (laneTo >= 0) {
      n.laneAt = path.indexOf(laneTo) - 1
      n.laneLayer = laneTo >= NN ? 1 : 0
    } else {
      n.laneAt = undefined
      n.laneLayer = undefined
    }
    return true
  }
  function withExemptions<T>(n: Net, fn: () => T): T {
    stampNet(n, -1)
    for (const o of n.ignore) stampNet(o, -1)
    for (const st of n.ownPads) applyPad(st, -1)
    const r = fn()
    for (const st of n.ownPads) applyPad(st, +1)
    for (const o of n.ignore) stampNet(o, +1)
    stampNet(n, +1)
    return r
  }
  function ripAndRoute(n: Net): boolean {
    stampNet(n, -1)
    for (const o of n.ignore) stampNet(o, -1)
    for (const st of n.ownPads) applyPad(st, -1)
    const ok = route(n)
    for (const st of n.ownPads) applyPad(st, +1)
    for (const o of n.ignore) stampNet(o, +1)
    if (ok) buildStamp(n)
    else n.stamp = undefined
    stampNet(n, +1)
    return ok
  }
  function conflictsOf(n: Net, bumpHist: number): number {
    if (!n.path) return 1
    return withExemptions(n, () => {
      let cnt = 0
      const path = n.path!,
        occ = n.kind === "fat" ? occF : occT
      for (let k = 0; k < path.length; k++) {
        const id = path[k],
          l = id >= NN ? 1 : 0,
          c = id - l * NN
        if (occ[l][c]) {
          cnt++
          histT[l][c] += bumpHist
        }
        if (k && (path[k - 1] >= NN ? 1 : 0) !== l && occV[c]) {
          cnt++
          histV[c] += bumpHist
        }
      }
      if (n.stamp?.lane) {
        const [l, a, b] = n.stamp.lane
        let hit = false
        for (let j = Math.max(0, a); j <= Math.min(NY - 1, b); j++)
          if (occLane[l][j]) {
            hit = true
            histLane[l][j] += bumpHist * 0.5
          }
        if (hit) cnt++
      }
      return cnt
    })
  }
  const xy = (id: number): Pt => ({
    x: wx((id % NN) % NX),
    y: wy(((id % NN) / NX) | 0),
  })
  const plen = (pts: Pt[]) =>
    pts.reduce(
      (s, p, i) =>
        i ? s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0,
      0,
    )
  const viaCount = (n: Net) => {
    let v = 0
    const p = n.path ?? []
    for (let k = 1; k < p.length; k++) if (p[k] >= NN !== p[k - 1] >= NN) v++
    return v
  }

  // ---------- geometry ----------
  function bump(
    x: number,
    y: number,
    a: number,
    dir: number,
    W = BW,
    ch = CH,
  ): Pt[] {
    const c = Math.min(ch, a / 2)
    return [
      { x: x - c, y },
      { x, y: y + dir * c },
      { x, y: y + dir * (a - c) },
      { x: x + c, y: y + dir * a },
      { x: x + W - c, y: y + dir * a },
      { x: x + W, y: y + dir * (a - c) },
      { x: x + W, y: y + dir * c },
      { x: x + W + c, y },
    ]
  }
  function simplify(pts: Pt[]): Pt[] {
    const out: Pt[] = []
    for (const p of pts) {
      const m = out.length
      if (m && Math.hypot(out[m - 1].x - p.x, out[m - 1].y - p.y) < 1e-9)
        continue
      if (m >= 2) {
        const a = out[m - 2],
          b = out[m - 1]
        const cr = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x),
          dot = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y)
        if (Math.abs(cr) < 1e-9 && dot >= 0) {
          out[m - 1] = p
          continue
        }
      }
      out.push(p)
    }
    return out
  }
  function offsetPolyline(pts: Pt[], d: number): Pt[] {
    const out: Pt[] = []
    const nrm = (a: Pt, b: Pt) => {
      const L = Math.hypot(b.x - a.x, b.y - a.y)
      return { x: -(b.y - a.y) / L, y: (b.x - a.x) / L }
    }
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) {
        const n = nrm(pts[0], pts[1])
        out.push({ x: pts[0].x + n.x * d, y: pts[0].y + n.y * d })
        continue
      }
      if (i === pts.length - 1) {
        const n = nrm(pts[i - 1], pts[i])
        out.push({ x: pts[i].x + n.x * d, y: pts[i].y + n.y * d })
        continue
      }
      const n1 = nrm(pts[i - 1], pts[i]),
        n2 = nrm(pts[i], pts[i + 1]),
        k = d / (1 + n1.x * n2.x + n1.y * n2.y)
      out.push({
        x: pts[i].x + (n1.x + n2.x) * k,
        y: pts[i].y + (n1.y + n2.y) * k,
      })
    }
    return out
  }
  /** Single-trace centreline (pad to pad on the grid) split at its lane. */
  function singleParts(n: Net) {
    const p = n.path!,
      a = p.slice(0, n.laneAt! + 1),
      b = p.slice(n.laneAt! + 1)
    return { a, b }
  }
  const pathLen = (ids: number[]) => {
    let s = 0
    for (let k = 1; k < ids.length; k++) {
      const u = xy(ids[k - 1]),
        v = xy(ids[k])
      s += Math.hypot(u.x - v.x, u.y - v.y)
    }
    return s
  }
  /** Bump count and amplitude that add `e` to a single lane (shared by the strip reservation and the emitted copper). */
  function singleBumps(e: number): { k: number; a: number } {
    const k = Math.max(1, Math.min(kSingle, Math.ceil(e / bumpExtra(0.3))))
    return { k, a: bumpAmp(e / k) }
  }
  function singleLane(xL: number, xR: number, y: number, e: number): Pt[] {
    const pts: Pt[] = [{ x: xL, y }]
    if (e > 1e-6) {
      const { k, a } = singleBumps(e),
        span = k * BW + (k - 1) * BG,
        x0 = xL + (xR - xL - span) / 2
      for (let b = 0; b < k; b++)
        pts.push(...bump(x0 + b * (BW + BG), y, a, +1))
    }
    pts.push({ x: xR, y })
    return pts
  }
  /** Pair centreline end to end; `ec` of coupled extra length is added in the lane. */
  function pairCentre(n: Net, ec: number): Pt[] {
    const pr = n.pair!,
      p = n.path!,
      la = n.laneAt!
    const head = p.slice(0, la + 1).map(xy),
      tail = p.slice(la + 1).map(xy),
      y = head.at(-1)!.y,
      xL = head.at(-1)!.x
    const laneBumps: Pt[] = []
    if (ec > 0) {
      let k = Math.max(
          1,
          Math.min(kPair, Math.round(ec / bumpExtra(0.9, PCH))),
        ),
        a = bumpAmp(ec / k, PCH)
      if (a < PAIR_MIN_AMP) {
        k = 1
        a = Math.max(PAIR_MIN_AMP, bumpAmp(ec, PCH))
      }
      for (let b = 0; b < k; b++)
        laneBumps.push(
          ...bump(xL + TRIM_LEN + 0.2 + b * (PW + PG), y, a, +1, PW, PCH),
        )
    }
    return [
      pr.G[0],
      ...head,
      { x: xL + 0.3, y },
      ...laneBumps,
      ...tail,
      pr.G[1],
    ]
  }
  function pairMembers(
    n: Net,
    ec: number,
    trims: [number, number],
  ): { pts: [Pt[], Pt[]]; ok: boolean } {
    const pr = n.pair!,
      centre = pairCentre(n, ec),
      xL = xy(n.path![n.laneAt!]).x
    const keep = (pts: Pt[]) =>
      pts.filter(
        (q, i) =>
          i === 0 || Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y) > 1e-9,
      )
    const yL = xy(n.path![n.laneAt!]).y,
      isTrim = (q: Pt) =>
        Math.abs(q.x - (xL + 0.3)) < 1e-9 && Math.abs(q.y - yL) < 1e-9
    // drop collinear grid nodes (a mitred offset of a 1-cell segment would backtrack), keeping the trim anchor
    const c1 = keep(centre),
      c2 = c1.filter((q, i) => {
        if (i === 0 || i === c1.length - 1 || isTrim(q)) return true
        const a = c1[i - 1],
          b = c1[i + 1],
          cr = (q.x - a.x) * (b.y - q.y) - (q.y - a.y) * (b.x - q.x),
          dot = (q.x - a.x) * (b.x - q.x) + (q.y - a.y) * (b.y - q.y)
        return !(Math.abs(cr) < 1e-9 && dot > 0)
      })
    const iTrim = c2.findIndex(
      (q) =>
        Math.abs(q.x - (xL + 0.3)) < 1e-9 &&
        Math.abs(q.y - xy(n.path![n.laneAt!]).y) < 1e-9,
    )
    let ok = true
    const out = [0, 1].map((m) => {
      const side = m === pr.leftMember ? +1 : -1
      let poly = offsetPolyline(c2, side * H)
      const e = trims[m]
      if (e > 1e-6) {
        let k = 1
        while (k < 3 && bumpAmp(e / k, 0.1) > 0.4) k++
        const a = bumpAmp(e / k, 0.1)
        if (a > TRIM - 0.02 || iTrim < 0) ok = false
        const y = poly[iTrim]?.y ?? 0,
          ins: Pt[] = []
        for (let b = 0; b < k; b++)
          ins.push(...bump(xL + 0.5 + b * 0.5, y, a, side, 0.25, 0.1))
        poly = [...poly.slice(0, iTrim + 1), ...ins, ...poly.slice(iTrim + 1)]
      }
      return poly
    }) as [Pt[], Pt[]]
    return { pts: out, ok }
  }
  const stubLen = (st: Net) =>
    st.path
      ? pathLen(st.path) +
        Math.hypot(
          xy(st.path.at(-1)!).x - st.exact!.x,
          xy(st.path.at(-1)!).y - st.exact!.y,
        )
      : Infinity
  /** Lengths of the two members with no added tuning. */
  function pairBase(n: Net): [number, number] {
    const pr = n.pair!,
      m = pairMembers(n, 0, [0, 0]).pts
    return [0, 1].map(
      (k) =>
        plen(m[k]) +
        stubLen(pr.stubs[k * 2]) +
        stubLen(pr.stubs[k * 2 + 1]) +
        fixedOf(pr.conns[k].name),
    ) as [number, number]
  }
  /** Coupled extra plus per-member trims that bring both members to `target`. */
  function pairTune(
    n: Net,
    target: number,
  ): { ec: number; trims: [number, number]; amp: number; ok: boolean } {
    const pr = n.pair!,
      stubs = [0, 1].map(
        (k) =>
          stubLen(pr.stubs[k * 2]) +
          stubLen(pr.stubs[k * 2 + 1]) +
          fixedOf(pr.conns[k].name),
      )
    const need = (ec: number) => {
      const m = pairMembers(n, ec, [0, 0]).pts
      return [0, 1].map((k) => target - plen(m[k]) - stubs[k])
    }
    let ec = 0
    const n0 = need(0),
      want = Math.min(n0[0], n0[1])
    if (want >= PAIR_MIN_EXTRA + 0.02) {
      let lo = PAIR_MIN_EXTRA,
        hi = want + 1
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2,
          r = need(mid)
        if (Math.min(r[0], r[1]) > 0.004) lo = mid
        else hi = mid
      }
      ec = lo
    }
    const r = need(ec),
      trims: [number, number] = [Math.max(0, r[0]), Math.max(0, r[1])]
    const k =
      ec > 0
        ? Math.max(1, Math.min(kPair, Math.round(ec / bumpExtra(0.9, PCH))))
        : 0
    const amp = ec > 0 ? Math.max(PAIR_MIN_AMP, bumpAmp(ec / k, PCH)) : 0
    return {
      ec,
      trims,
      amp,
      ok: r[0] > -0.01 && r[1] > -0.01 && pairMembers(n, ec, trims).ok,
    }
  }

  // ---------- targets ----------
  function evaluate(): {
    ok: boolean
    msgs: string[]
    over: Net[]
    changed: Net[]
  } {
    const msgs: string[] = [],
      over: Net[] = [],
      changed: Net[] = []
    let ok = true
    const routable = nets.filter((n) => n.kind !== "stub")
    for (const n of routable) {
      if (
        !n.path ||
        n.laneAt === undefined ||
        (n.kind === "fat" && n.pair!.stubs.some((s) => !s.path))
      ) {
        n.base = Infinity
        ok = false
        continue
      }
      n.base =
        n.kind === "single"
          ? pathLen(singleParts(n).a) +
            laneLen +
            pathLen(singleParts(n).b) +
            fixedOf(n.conn.name)
          : Math.max(...pairBase(n))
    }
    for (const bus of srj.buses ?? []) {
      const ms = routable.filter((n) => n.bus === bus)
      if (!ms.length) continue
      let top: number, lo: number
      if (cfg.busWindow?.[bus.busId]) [lo, top] = cfg.busWindow[bus.busId]
      else if (bus.minLength !== undefined) {
        lo = bus.minLength + cfg.windowMargin
        top = bus.maxLength - 0.05
      } else if (bus.maxLength !== undefined) {
        top = bus.maxLength - 0.02
        lo = top - (bus.maxLengthSkew ?? 0.635) + cfg.skewMargin
      } else {
        top = Math.max(...ms.map((n) => n.base!).filter(Number.isFinite)) + 0.02
        lo = top - (bus.maxLengthSkew ?? 0.635) + cfg.skewMargin
      }
      for (const n of ms) {
        n.top = top
        n.lo = lo
        if (n.base! > top + 1e-6) {
          ok = false
          over.push(n)
          n.lenWeight = Math.min(n.lenWeight * cfg.weightGrow, cfg.weightMax)
        }
        n.target = Math.max(Math.min(n.base!, top), lo)
      }
    }
    for (const n of routable) {
      if (n.target === undefined || !Number.isFinite(n.base!)) {
        n.target ??= n.base
        continue
      }
      if (n.kind === "single") {
        const e = n.target - n.base!,
          need =
            e <= 1e-6
              ? 0
              : Math.max(
                  0,
                  Math.ceil((singleBumps(e).a + 0.004 + LP) / P - 1e-9) - 5,
                )
        if (need > n.above || n.above - need > 2) {
          if (need > n.above) ok = false
          msgs.push(`${n.label} strip ${n.above}->${need}`)
          n.above = need
          changed.push(n)
        }
      } else {
        const t = pairTune(n, n.target)
        if (!t.ok) {
          ok = false
          msgs.push(
            `${n.label} pair cannot be tuned (trims ${t.trims.map((x) => x.toFixed(2)).join("/")})`,
          )
        }
        const side = Math.ceil((H + TRIM + 0.06) / P),
          up = Math.ceil((H + Math.max(t.amp, TRIM) + 0.06) / P)
        if (up > n.above || n.above - up > 2 || side !== n.below) {
          if (up > n.above || side > n.below) ok = false
          msgs.push(`${n.label} pair strip ${n.above}->${up}`)
          n.above = up
          n.below = side
          changed.push(n, ...n.pair!.stubs)
        }
      }
    }
    return { ok, msgs, over, changed }
  }

  // ---------- negotiation ----------
  // A different seed gives a different (deterministic) routing order: a cheap, independent retry.
  let rngState = (cfg.seed * 2654435761) >>> 0
  const rng = () => {
    rngState =
      (Math.imul(rngState ^ (rngState >>> 15), 2246822507) + 0x9e3779b9) >>> 0
    return rngState / 4294967296
  }
  const shuffled = cfg.seed
    ? nets
        .map((n) => ({ n, k: rng() }))
        .sort((a, b) => a.k - b.k)
        .map((e) => e.n)
    : [...nets]
  const order = shuffled.sort(
    (a, b) =>
      ({ fat: 0, stub: 1, single: 2 })[a.kind] -
      { fat: 0, stub: 1, single: 2 }[b.kind],
  )
  function negotiate(): boolean {
    // Only nets that are in conflict (or whose reservation changed) are ripped up: re-routing settled
    // nets every round makes crossing pairs swap places for ever instead of one of them taking a via.
    let dirty: Set<Net> | null = null,
      best = Infinity,
      bestAt = 0
    for (let it = 0; it < cfg.maxIters; it++) {
      iterations = it + 1
      for (const n of order)
        if (!dirty || dirty.has(n))
          if (!ripAndRoute(n)) log(`  no path for ${n.label}`)
      let total = 0
      const bad: string[] = []
      dirty = new Set()
      for (const n of nets) {
        const c = conflictsOf(n, cfg.histInc)
        if (c) {
          total += c
          bad.push(n.label)
          dirty.add(n)
          if (n.pair) {
            dirty.add(n.pair.fat)
            for (const st of n.pair.stubs) dirty.add(st)
          }
        }
      }
      if (!cfg.incremental) dirty = null
      // A net that stays in conflict while close to its length cap has no other way round: its
      // neighbours have to make room, so it gains priority and takes its direct route through them.
      for (const n of nets) {
        if (n.kind === "stub") continue
        const hit = dirty ? dirty.has(n) : false
        n.stuckRounds = hit ? (n.stuckRounds ?? 0) + 1 : 0
        if (
          n.stuckRounds > cfg.stuckRounds &&
          n.path &&
          pathLen(n.path) > capOf(n) - cfg.capMargin
        ) {
          n.lenWeight = Math.min(
            n.lenWeight * cfg.stuckBoost,
            cfg.overWeightMax,
          )
          n.stuckRounds = 0
        }
      }
      if (total < best) {
        best = total
        bestAt = it
      }
      if (it - bestAt > cfg.stallIters && total) {
        log(`  stalled at ${total} conflicts for ${cfg.stallIters} rounds`)
        return false
      }
      const ev =
        it % cfg.evalEvery === cfg.evalEvery - 1 || !total ? evaluate() : null
      if (it % 5 === 4 || !total)
        log(
          `  iter ${it} [${((performance.now() - t0) / 1e3).toFixed(0)}s] pres=${presFac.toFixed(1)} conflicts=${total} nets=${bad.length} ${bad.slice(0, 8).join(",")} vias=${nets.reduce((s, n) => s + viaCount(n), 0)}` +
            (ev
              ? ` | ok=${ev.ok} over=${ev.over.map((v) => `${v.label}:${v.base!.toFixed(2)}>${v.top!.toFixed(2)}`).join(",")} ${ev.msgs.slice(0, 3).join("; ")}`
              : ""),
        )
      if (!total && ev?.ok) return true
      if (ev && dirty) {
        for (const n of ev.changed) dirty.add(n)
        if (!total)
          for (const n of ev.over) {
            dirty.add(n)
            if (n.pair) for (const st of n.pair.stubs) dirty.add(st)
          }
      }
      if (!total && ev && ev.over.length) {
        // Conflict-free but a net is longer than its window allows: the others have settled on its
        // direct route. Reopen the negotiation with that net weighted up so it can take the route back.
        for (const n of ev.over)
          n.lenWeight = Math.min(n.lenWeight * cfg.overBoost, cfg.overWeightMax)
        presFac = cfg.presRestart
        continue
      }
      presFac = Math.min(presFac * cfg.presGrowth, cfg.presMax)
    }
    return false
  }

  // ---------- output ----------
  function emit(): any[] {
    const traces: any[] = []
    const wire = (p: Pt, l: number) => ({
      route_type: "wire",
      x: +p.x.toFixed(5),
      y: +p.y.toFixed(5),
      layer: LAYERS[l],
      width: cfg.w,
    })
    const fromIds = (ids: number[]): any[] => {
      const r: any[] = []
      for (let k = 0; k < ids.length; k++) {
        const id = ids[k],
          l = id >= NN ? 1 : 0,
          p = xy(id)
        if (k && (ids[k - 1] >= NN ? 1 : 0) !== l)
          r.push({
            route_type: "via",
            x: +p.x.toFixed(5),
            y: +p.y.toFixed(5),
            from_layer: LAYERS[1 - l],
            to_layer: LAYERS[l],
            via_diameter: cfg.viaD,
            via_hole_diameter: cfg.viaHole,
          })
        r.push(wire(p, l))
      }
      return r
    }
    const tidy = (route: any[]) => {
      const out: any[] = []
      for (const r of route) {
        const m = out.length
        if (
          r.route_type === "wire" &&
          m &&
          out[m - 1].route_type === "wire" &&
          out[m - 1].layer === r.layer &&
          Math.hypot(out[m - 1].x - r.x, out[m - 1].y - r.y) < 1e-7
        )
          continue
        if (
          r.route_type === "wire" &&
          m >= 2 &&
          out[m - 1].route_type === "wire" &&
          out[m - 2].route_type === "wire" &&
          out[m - 1].layer === r.layer &&
          out[m - 2].layer === r.layer
        ) {
          const cr =
              (out[m - 1].x - out[m - 2].x) * (r.y - out[m - 1].y) -
              (out[m - 1].y - out[m - 2].y) * (r.x - out[m - 1].x),
            dot =
              (out[m - 1].x - out[m - 2].x) * (r.x - out[m - 1].x) +
              (out[m - 1].y - out[m - 2].y) * (r.y - out[m - 1].y)
          if (Math.abs(cr) < 1e-9 && dot >= 0) {
            out[m - 1] = r
            continue
          }
        }
        out.push(r)
      }
      return out
    }
    const trace = (c: any, route: any[]) =>
      traces.push({
        type: "pcb_trace",
        pcb_trace_id: `ddr_lane_${c.name}`,
        connection_name: c.name,
        source_trace_id: c.source_trace_id ?? c.name,
        route: tidy(route),
      })
    for (const n of nets) {
      if (n.kind === "single") {
        const { a, b } = singleParts(n),
          pads = sortedPads(n.conn),
          u = xy(a.at(-1)!),
          v = xy(b[0]),
          l = n.laneLayer!
        trace(n.conn, [
          wire(pads[0], LOf(pads[0])),
          ...fromIds(a),
          ...singleLane(u.x, v.x, u.y, n.target! - n.base!)
            .slice(1)
            .map((q) => wire(q, l)),
          ...fromIds(b).slice(1),
          wire(pads[1], LOf(pads[1])),
        ])
      } else if (n.kind === "fat") {
        const pr = n.pair!,
          t = pairTune(n, n.target!),
          mem = pairMembers(n, t.ec, t.trims).pts
        for (const m of [0, 1]) {
          const sa = pr.stubs[m * 2],
            sb = pr.stubs[m * 2 + 1],
            pads = sortedPads(pr.conns[m])
          trace(pr.conns[m], [
            wire(pads[0], LOf(pads[0])),
            ...fromIds(sa.path!),
            ...mem[m].map((q) => wire(q, n.fatLayer ?? 0)),
            ...fromIds([...sb.path!].reverse()),
            wire(pads[1], LOf(pads[1])),
          ])
        }
      }
    }
    return traces
  }

  // ---------- main ----------
  log(
    `grid ${NX}x${NY} @${P}mm, ${nets.filter((n) => n.kind === "single").length} single nets, ${pairs.length} pairs, lane ${laneLen.toFixed(2)}mm (${kSingle} bumps, ${kPair} pair bumps)`,
  )
  for (const pr of pairs)
    log(
      `  pair ${pr.fat.label}: leaves ${JSON.stringify(pr.d[0])} at (${pr.G[0].x.toFixed(2)},${pr.G[0].y.toFixed(2)}), arrives from ${JSON.stringify(pr.d[1])} at (${pr.G[1].x.toFixed(2)},${pr.G[1].y.toFixed(2)})`,
    )
  const success = negotiate()
  if (success) {
    log(`SOLVED in ${((performance.now() - t0) / 1e3).toFixed(0)}s`)
    return {
      solved: true,
      traces: emit(),
      stuck: [],
      log: logLines,
      iterations,
    }
  }
  // Report what is still in the way: nets in conflict or without a path, else the nets over their window.
  const namesOf = (n: Net): string[] =>
    n.pair ? n.pair.conns.map((c: any) => c.name) : [n.conn.name]
  const stuck = new Set<string>()
  for (const n of nets)
    if (!n.path || conflictsOf(n, 0))
      for (const name of namesOf(n)) stuck.add(name)
  if (!stuck.size)
    for (const n of evaluate().over)
      for (const name of namesOf(n)) stuck.add(name)
  for (const n of nets) {
    if (!n.path) {
      log(`DIAG ${n.label}: no path`)
      continue
    }
    withExemptions(n, () => {
      const path = n.path!,
        occ = n.kind === "fat" ? occF : occT,
        tc: string[] = [],
        vc: string[] = []
      for (let k = 0; k < path.length; k++) {
        const id = path[k],
          l = id >= NN ? 1 : 0,
          c = id - l * NN,
          q = xy(c)
        if (occ[l][c])
          tc.push(
            `${LAYERS[l][0]}(${q.x.toFixed(2)},${q.y.toFixed(2)})h${histT[l][c].toFixed(0)}`,
          )
        if (k && (path[k - 1] >= NN ? 1 : 0) !== l && occV[c])
          vc.push(
            `(${q.x.toFixed(2)},${q.y.toFixed(2)})h${histV[c].toFixed(0)}`,
          )
      }
      let lane = ""
      if (n.stamp?.lane) {
        const [l, a, b] = n.stamp.lane
        for (let j = Math.max(0, a); j <= Math.min(NY - 1, b); j++)
          if (occLane[l][j]) lane += ` ${LAYERS[l][0]}y${wy(j).toFixed(2)}`
      }
      if (tc.length || vc.length || lane)
        log(
          `DIAG ${n.label} w=${n.lenWeight.toFixed(1)} len=${pathLen(path).toFixed(1)} cap=${capOf(n).toFixed(1)} trace[${tc.length}]: ${tc.slice(0, 4).join(" ")} .. ${tc.slice(-1).join(" ")} | via: ${vc.join(" ")} | lane:${lane.slice(0, 120)}`,
        )
    })
  }
  log(
    `FAILED after ${((performance.now() - t0) / 1e3).toFixed(0)}s, stuck: ${[...stuck].map(label).join(",")}`,
  )
  return {
    solved: false,
    traces: [],
    stuck: [...stuck],
    log: logLines,
    iterations,
  }
}
