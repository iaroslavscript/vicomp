/** Small greedy + iterative-repair placer for map labels and leg emoji. */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Candidate extends Rect {
  /** Preference cost, relative to the box area (0 = ideal spot). */
  readonly penalty: number;
  /** Line from the anchor to the box, when the box is detached from its anchor. */
  readonly leader: Segment | null;
  /** The point this box labels, if any. */
  readonly anchor?: Point;
}

export interface Item {
  readonly candidates: readonly Candidate[];
  /** Labels should not cover route lines; emoji sit on their own line by design. */
  readonly avoidSegments: boolean;
}

export interface Scene {
  readonly bounds: Rect;
  /** Fixed things to keep clear: stop markers, the overview inset… */
  readonly obstacles: readonly Rect[];
  readonly segments: readonly Segment[];
  /** Labelled points; a label should be nearer to its own point than to any other. */
  readonly points: readonly Point[];
}

const W_ITEMS = 20;
const W_OBSTACLES = 10;
const W_OUTSIDE = 50;
const W_SEGMENTS = 2;
const W_CROSSING = 0.5;
const W_AMBIGUOUS = 0.6;

export const overlap = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** True when two segments cross or touch each other. */
export function crosses(a: Segment, b: Segment): boolean {
  const side = (s: Segment, x: number, y: number) => Math.sign((s.x2 - s.x1) * (y - s.y1) - (s.y2 - s.y1) * (x - s.x1));
  return side(a, b.x1, b.y1) * side(a, b.x2, b.y2) <= 0 && side(b, a.x1, a.y1) * side(b, a.x2, a.y2) <= 0;
}

const distanceTo = (r: Rect, p: Point): number => {
  const q = nearestPoint(r, p.x, p.y);
  return Math.hypot(q.x - p.x, q.y - p.y);
};

/** Cost of two chosen boxes (and their leader lines) getting in each other's way. */
function pairCost(a: Candidate, b: Candidate): number {
  let cost = W_ITEMS * overlap(a, b);
  if (a.leader) cost += W_SEGMENTS * clippedLength(a.leader, b) * b.h;
  if (b.leader) cost += W_SEGMENTS * clippedLength(b.leader, a) * a.h;
  if (a.leader && b.leader && crosses(a.leader, b.leader)) cost += W_CROSSING * (a.w * a.h + b.w * b.h);
  return cost;
}

/** Length of the part of a segment inside a rectangle (Liang–Barsky clipping). */
export function clippedLength(s: Segment, r: Rect): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, s.x1 - r.x],
    [dx, r.x + r.w - s.x1],
    [-dy, s.y1 - r.y],
    [dy, r.y + r.h - s.y1],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return 0;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return 0;
    }
  }
  return (t1 - t0) * Math.hypot(dx, dy);
}

function staticCost(c: Candidate, avoidSegments: boolean, scene: Scene): number {
  const area = c.w * c.h;
  let cost = c.penalty * area + W_OUTSIDE * (area - overlap(c, scene.bounds));
  for (const o of scene.obstacles) cost += W_OBSTACLES * overlap(c, o);
  if (avoidSegments) for (const s of scene.segments) cost += W_SEGMENTS * clippedLength(s, c) * c.h;
  if (c.anchor) {
    const own = distanceTo(c, c.anchor);
    for (const p of scene.points) {
      if ((p.x !== c.anchor.x || p.y !== c.anchor.y) && distanceTo(c, p) < own) cost += W_AMBIGUOUS * area;
    }
  }
  return cost;
}

/** Picks one candidate per item, minimising overlaps. Deterministic. */
export function place(items: readonly Item[], scene: Scene, passes = 4): Candidate[] {
  const base = items.map((item) => item.candidates.map((c) => staticCost(c, item.avoidSegments, scene)));
  const chosen: (Candidate | undefined)[] = items.map(() => undefined);
  const best = (i: number): Candidate => {
    let pick = items[i].candidates[0];
    let pickCost = Infinity;
    items[i].candidates.forEach((c, k) => {
      let cost = base[i][k];
      for (let j = 0; j < items.length; j++) {
        const other = chosen[j];
        if (j !== i && other) cost += pairCost(c, other);
      }
      if (cost < pickCost) [pick, pickCost] = [c, cost];
    });
    return pick;
  };
  for (let pass = 0; pass <= passes; pass++) {
    let changed = false;
    for (let i = 0; i < items.length; i++) {
      const next = best(i);
      if (next !== chosen[i]) [chosen[i], changed] = [next, true];
    }
    if (!changed) break;
  }
  return chosen as Candidate[];
}

/** Closest point of a rectangle to (x, y), for drawing leader lines. */
export const nearestPoint = (r: Rect, x: number, y: number): Point => ({
  x: Math.min(Math.max(x, r.x), r.x + r.w),
  y: Math.min(Math.max(y, r.y), r.y + r.h),
});

const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, -1],
  [1, 1],
  [-1, -1],
  [-1, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
  [0, 1],
];
/** Extra distances from the anchor, in label heights; further away means a leader line. */
const DISTANCES = [0, 1.2, 2.5, 4];

/** Boxes of size w×h around an anchor point, at least `gap` away from it. */
export function labelCandidates(x: number, y: number, w: number, h: number, gap: number): Candidate[] {
  const out: Candidate[] = [];
  DISTANCES.forEach((extra, di) => {
    const g = gap + extra * h;
    DIRECTIONS.forEach(([dx, dy], k) => {
      const gx = dy === 0 ? g : g * 0.7;
      const gy = dx === 0 ? g : g * 0.7;
      const box: Rect = {
        x: dx > 0 ? x + gx : dx < 0 ? x - gx - w : x - w / 2,
        y: dy > 0 ? y + gy : dy < 0 ? y - gy - h : y - h / 2,
        w,
        h,
      };
      const end = nearestPoint(box, x, y);
      out.push({
        ...box,
        penalty: 0.03 * k + 0.5 * di,
        leader: di > 0 ? { x1: x, y1: y, x2: end.x, y2: end.y } : null,
        anchor: { x, y },
      });
    });
  });
  return out;
}

const ALONG = [0.5, 0.38, 0.62, 0.26, 0.74];
const BESIDE = [0.5, 0.35, 0.65];

/**
 * Boxes centred on points along a segment, preferring the middle. On legs too short to
 * hold the box, it may also sit just beside the line.
 */
export function alongCandidates(s: Segment, w: number, h: number): Candidate[] {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const box = (cx: number, cy: number, penalty: number): Candidate => ({
    x: cx - w / 2,
    y: cy - h / 2,
    w,
    h,
    penalty,
    leader: null,
  });
  const out = ALONG.map((t) => box(s.x1 + dx * t, s.y1 + dy * t, Math.abs(t - 0.5) * 2));
  const length = Math.hypot(dx, dy) || 1;
  const offset = Math.max(w, h) * 0.9;
  const [nx, ny] = [(-dy / length) * offset, (dx / length) * offset];
  for (const t of BESIDE) {
    for (const side of [1, -1]) out.push(box(s.x1 + dx * t + side * nx, s.y1 + dy * t + side * ny, 1.2 + Math.abs(t - 0.5) * 2));
  }
  return out;
}
