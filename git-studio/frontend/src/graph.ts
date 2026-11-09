// Turns a topo-ordered commit list into lanes for the history graph.
import type { CommitRow } from './types'

export interface Segment { x1: number; y1: 0 | 1 | 2; x2: number; y2: 0 | 1 | 2; lane: number }
export interface GraphRow { lane: number; segments: Segment[]; width: number }

// y: 0 = top of row, 1 = middle (the dot), 2 = bottom of row
export function buildGraph(commits: CommitRow[]): { rows: GraphRow[]; maxLanes: number } {
  let lanes: (string | null)[] = []
  const rows: GraphRow[] = []
  let maxLanes = 1
  for (const c of commits) {
    let idx = lanes.indexOf(c.hash)
    if (idx === -1) {
      idx = lanes.indexOf(null)
      if (idx === -1) { idx = lanes.length; lanes.push(null) }
    }
    const before = lanes.slice()
    const segments: Segment[] = []
    // Lanes coming in from above
    before.forEach((h, i) => {
      if (h === null) return
      if (h === c.hash) segments.push({ x1: i, y1: 0, x2: idx, y2: 1, lane: i })
    })
    // Lanes merging into this commit end here
    lanes = lanes.map((h) => (h === c.hash ? null : h))
    lanes[idx] = c.parents[0] ?? null
    if (c.parents[0]) segments.push({ x1: idx, y1: 1, x2: idx, y2: 2, lane: idx })
    for (const p of c.parents.slice(1)) {
      let j = lanes.indexOf(p)
      if (j === -1) {
        j = lanes.findIndex((h, k) => h === null && k !== idx)
        if (j === -1) { j = lanes.length; lanes.push(null) }
        lanes[j] = p
      }
      segments.push({ x1: idx, y1: 1, x2: j, y2: 2, lane: j })
    }
    // Lanes passing straight through
    before.forEach((h, i) => {
      if (h !== null && h !== c.hash && lanes[i] === h) segments.push({ x1: i, y1: 0, x2: i, y2: 2, lane: i })
    })
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    const width = Math.max(before.length, lanes.length, idx + 1)
    maxLanes = Math.max(maxLanes, width)
    rows.push({ lane: idx, segments, width })
  }
  return { rows, maxLanes }
}

export const LANE_COLORS = ['#5B9DFF', '#F0883E', '#3FB950', '#B392F0', '#E3B341', '#FF7B9C', '#39C5CF', '#C9D1D9']
export const laneColor = (i: number): string => LANE_COLORS[i % LANE_COLORS.length]
