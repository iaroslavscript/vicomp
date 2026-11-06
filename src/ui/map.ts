import type { City, Leg } from '../core/algorithm';
import { TRANSPORT_BANDS } from '../data/glyphs';
import { alongCandidates, clippedLength, labelCandidates, place, type Item, type Rect, type Segment } from './labels';

const SVG_NS = 'http://www.w3.org/2000/svg';
const LAND_ID = 'vicomp-land';
const ASPECT = 16 / 10;
const BAND_COLORS = ['#43a047', '#1e88e5', '#e53935'];
const MAX_LABEL_PX = 15;
const MAX_EMOJI_PX = 22;
const MAX_STOP_UNIT_PX = 6;
/** Corners the overview inset may use, in order of preference; top-right holds the enlarge button. */
const INSET_CORNERS = ['br', 'bl', 'tl'] as const;

const svg = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

interface Point {
  readonly x: number;
  readonly y: number;
  readonly city: City;
}

/** Equirectangular projection; longitudes are unwrapped so legs never jump across the antimeridian. */
function project(cities: readonly City[]): Point[] {
  const points: Point[] = [];
  for (const city of cities) {
    let lon = city.lon;
    const prev = points.at(-1);
    if (prev) {
      const prevLon = prev.x - 180;
      while (lon - prevLon > 180) lon -= 360;
      while (prevLon - lon > 180) lon += 360;
    }
    points.push({ x: lon + 180, y: 90 - city.lat, city });
  }
  return points;
}

function fitBox(points: readonly Point[], aspect: number): { x: number; y: number; w: number; h: number } {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = Math.max(1.5, (x1 - x0) * 0.15, (y1 - y0) * 0.15);
  let w = Math.max(x1 - x0 + 2 * pad, 8);
  let h = y1 - y0 + 2 * pad;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  return { x: (x0 + x1 - w) / 2, y: (y0 + y1 - h) / 2, w, h };
}

const bandColor = (leg: Leg): string =>
  BAND_COLORS[TRANSPORT_BANDS.findIndex((band) => band.includes(leg.transport))] ?? '#888';

export class RouteMap {
  private readonly main = svg('svg', { class: 'map-main', role: 'img' });
  private readonly overview = svg('svg', { class: 'map-overview', viewBox: '0 0 360 180', 'aria-hidden': 'true' });
  private readonly route = svg('g');
  private readonly overviewBox = svg('rect', { class: 'map-overview-box' });

  /** `avoid` lists overlays (such as buttons) drawn on top of the map that labels must not sit under. */
  constructor(
    container: HTMLElement,
    private readonly avoid: readonly HTMLElement[] = [],
  ) {
    const land = svg('path', { id: LAND_ID });
    const landLayer = svg('g', { class: 'land' });
    for (const dx of [-720, -360, 0, 360, 720]) landLayer.append(svg('use', { href: `#${LAND_ID}`, x: dx }));
    const defs = svg('defs');
    defs.append(land);
    this.main.append(defs, svg('rect', { class: 'sea', x: -1080, y: -360, width: 2520, height: 900 }), landLayer, this.route);
    this.overview.append(
      svg('rect', { class: 'sea', width: 360, height: 180 }),
      svg('use', { class: 'land', href: `#${LAND_ID}` }),
      this.overviewBox,
    );
    container.append(this.main, this.overview);
    // The outline is large, so it is loaded as a separate chunk after first render.
    void import('../data/land').then(({ LAND_PATH }) => land.setAttribute('d', LAND_PATH));
  }

  render(legs: readonly Leg[]): void {
    if (legs.length === 0) return;
    const points = project([legs[0].from, ...legs.map((l) => l.to)]);
    // The enlarged map takes the shape of the screen, so the box follows the element's real aspect.
    const size = this.main.getBoundingClientRect();
    const box = fitBox(points, size.width > 0 && size.height > 0 ? size.width / size.height : ASPECT);
    this.main.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
    this.main.setAttribute('aria-label', `Route map: ${points.map((p) => p.city.name).join(' → ')}`);

    const overviewX = ((box.x % 360) + 360) % 360;
    for (const [k, v] of Object.entries({ x: overviewX, y: box.y, width: box.w, height: box.h })) {
      this.overviewBox.setAttribute(k, String(v));
    }

    const unit = box.w / 100;
    const segments: Segment[] = legs.map((_, i) => ({ x1: points[i].x, y1: points[i].y, x2: points[i + 1].x, y2: points[i + 1].y }));
    // Text and stops scale with the map, but are capped in screen pixels so an enlarged map does not get huge ones.
    const perPx = size.width > 0 ? box.w / size.width : Infinity;
    const stopUnit = Math.min(unit, MAX_STOP_UNIT_PX * perPx);
    const radius = (i: number): number => stopUnit * (i === 0 || i === points.length - 1 ? 1.6 : 1.1);
    this.placeOverview(box, points, segments, radius);

    const lines = legs.map((leg, i) => {
      const { x1, y1, x2, y2 } = segments[i];
      return svg('line', { x1, y1, x2, y2, stroke: bandColor(leg), class: 'leg' });
    });
    const stops = points.map((p, i) => {
      const end = i === 0 ? ' start' : i === points.length - 1 ? ' end' : '';
      return svg('circle', { cx: p.x, cy: p.y, r: radius(i), class: `stop${end}` });
    });
    const emojiSize = Math.min(unit * 4, MAX_EMOJI_PX * perPx);
    const emojis = legs.map((leg) => {
      const emoji = svg('text', { 'font-size': emojiSize, class: 'leg-emoji' });
      emoji.textContent = leg.transport.emoji;
      return emoji;
    });
    const fontSize = Math.min(unit * 3, MAX_LABEL_PX * perPx);
    const halo = fontSize * 0.2;
    const labels = points.map((p, i) => {
      const label = svg('text', { 'font-size': fontSize, 'stroke-width': halo, class: 'stop-label' });
      label.textContent = `${i + 1}. ${p.city.name}`;
      return label;
    });
    const leaderLayer = svg('g', { class: 'leaders', 'stroke-width': stopUnit * 0.25, 'stroke-dasharray': `${stopUnit} ${stopUnit * 0.6}` });
    // Stops above emoji, so a crowded leg can never hide where the route goes.
    this.route.replaceChildren(...lines, leaderLayer, ...emojis, ...stops, ...labels);

    // Text is measured after insertion; if the map is not laid out yet, estimate instead.
    const textWidth = (label: SVGTextElement): number => {
      const measured = label.getComputedTextLength();
      return measured > 0 ? measured : (label.textContent?.length ?? 0) * fontSize * 0.62;
    };
    const labelHeight = fontSize * 1.25;
    const labelGap = stopUnit * 0.4;
    const emojiBox = (emoji: SVGTextElement): [number, number] => {
      try {
        const { width, height } = emoji.getBBox();
        if (width > 0) return [width, height];
      } catch {
        // Firefox throws for elements that are not rendered yet.
      }
      return [emojiSize * 1.2, emojiSize * 1.2];
    };
    const items: Item[] = [
      ...segments.map((seg, i) => ({ candidates: alongCandidates(seg, ...emojiBox(emojis[i])), avoidSegments: false })),
      ...points.map((p, i) => ({
        candidates: labelCandidates(p.x, p.y, textWidth(labels[i]) + halo + labelGap * 2, labelHeight, radius(i) + stopUnit * 0.5),
        avoidSegments: true,
      })),
    ];
    const obstacles: Rect[] = points.map((p, i) => {
      const r = radius(i) + stopUnit * 0.3;
      return { x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r };
    });
    // Not laid out yet: fall back to the CSS default of the inset (28% wide, bottom-right).
    obstacles.push(
      this.coveredRect(this.overview, box) ?? { x: box.x + box.w * 0.7, y: box.y + box.h * 0.76, w: box.w * 0.3, h: box.h * 0.24 },
    );
    for (const el of this.avoid) {
      const rect = this.coveredRect(el, box);
      if (rect) obstacles.push(rect);
    }
    const placed = place(items, { bounds: box, obstacles, segments, points });

    emojis.forEach((emoji, i) => {
      const r = placed[i];
      emoji.setAttribute('x', String(r.x + r.w / 2));
      emoji.setAttribute('y', String(r.y + r.h / 2));
    });
    const leaders: SVGElement[] = [];
    labels.forEach((label, i) => {
      const r = placed[legs.length + i];
      label.setAttribute('x', String(r.x + labelGap + halo / 2));
      label.setAttribute('y', String(r.y + labelHeight * 0.78));
      if (r.leader) leaders.push(svg('line', { ...r.leader }));
    });
    leaderLayer.replaceChildren(...leaders);
  }

  /** Moves the overview inset to the corner where it hides the least of the route. */
  private placeOverview(box: Rect, points: readonly Point[], segments: readonly Segment[], radius: (i: number) => number): void {
    this.overview.dataset.corner = INSET_CORNERS[0];
    const home = this.coveredRect(this.overview, box);
    if (!home) return;
    const mx = box.x + box.w - home.x - home.w;
    const my = box.y + box.h - home.y - home.h;
    const cost = (corner: (typeof INSET_CORNERS)[number]): number => {
      const r: Rect = {
        x: corner.endsWith('r') ? home.x : box.x + mx,
        y: corner.startsWith('b') ? home.y : box.y + my,
        w: home.w,
        h: home.h,
      };
      const hidden = points.filter((p, i) => {
        const pad = radius(i) * 2;
        return p.x > r.x - pad && p.x < r.x + r.w + pad && p.y > r.y - pad && p.y < r.y + r.h + pad;
      }).length;
      // Hiding a stop is far worse than hiding part of a line.
      return hidden * box.w * 10 + segments.reduce((sum, seg) => sum + clippedLength(seg, r), 0);
    };
    const best = INSET_CORNERS.reduce((a, b) => (cost(b) < cost(a) ? b : a));
    this.overview.dataset.corner = best;
  }

  /** Area covered by an overlay element, in map coordinates; null if not laid out. */
  private coveredRect(el: Element, box: Rect): Rect | null {
    const main = this.main.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (main.width === 0 || r.width === 0) return null;
    const scale = box.w / main.width;
    return {
      x: box.x + (r.left - main.left) * scale,
      y: box.y + (r.top - main.top) * scale,
      w: r.width * scale,
      h: r.height * scale,
    };
  }
}
