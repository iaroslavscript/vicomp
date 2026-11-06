import { registerSW } from 'virtual:pwa-register';
import { NORMALIZE_PARAMS, fingerprint, utcDate, type Fingerprint, type NormalizeMode, type Tile } from './core/algorithm';
import { ALGORITHM_HASH, ALGORITHM_VERSION } from './core/build-info';
import { RouteMap } from './ui/map';
import { CHUNK_SIZES, DEFAULT_CHUNK_SIZE, NORMALIZE_MODES, isNormalizeMode } from './ui/options';
import { chunkAtCaret, chunkSpans, type Span } from './ui/source-map';
import './styles.css';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string; title?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title) node.title = props.title;
  node.append(...children);
  return node;
};

// Only settings are persisted — never the compared value itself.
const SETTINGS_KEY = 'vicomp.settings';
const VIEWS = ['journey', 'chunks', 'details'] as const;
type View = (typeof VIEWS)[number];
interface Settings {
  mode: NormalizeMode;
  chunkSize: number;
  view: View;
}
function loadSettings(): Settings {
  const defaults: Settings = { mode: 'ws-case', chunkSize: DEFAULT_CHUNK_SIZE, view: 'journey' };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
    return {
      mode: isNormalizeMode(saved.mode) ? saved.mode : defaults.mode,
      chunkSize: CHUNK_SIZES.some((s) => s === saved.chunkSize) ? (saved.chunkSize as number) : defaults.chunkSize,
      view: VIEWS.find((v) => v === saved.view) ?? defaults.view,
    };
  } catch {
    return defaults;
  }
}
function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable (private mode); settings then last for the session only.
  }
}

const input = $<HTMLTextAreaElement>('input');
const modeSelect = $<HTMLSelectElement>('mode');
const chunkSelect = $<HTMLSelectElement>('chunk-size');
// Not persisted: the daily date always starts off, as both computers must opt in.
const useDate = $<HTMLInputElement>('use-date');
useDate.checked = false;
const settings = loadSettings();

for (const { mode, label } of NORMALIZE_MODES) modeSelect.append(new Option(label, mode, false, mode === settings.mode));
for (const size of CHUNK_SIZES) chunkSelect.append(new Option(String(size), String(size), false, size === settings.chunkSize));
$('version').textContent = ALGORITHM_VERSION;
$('version').title = `Algorithm hash ${ALGORITHM_HASH}`;
$('app-version').textContent = `${__APP_VERSION__} (${__GIT_COMMIT__})`;

const map = new RouteMap($('map-frame'), [$('map-toggle')]);
let current: Fingerprint | null = null;

const mapBox = $('map');
const mapToggle = $<HTMLButtonElement>('map-toggle');
function setMapExpanded(expanded: boolean): void {
  if (mapBox.classList.contains('expanded') === expanded) return;
  mapBox.classList.toggle('expanded', expanded);
  document.body.classList.toggle('no-scroll', expanded);
  const label = expanded ? 'Close map' : 'Enlarge map';
  mapToggle.textContent = expanded ? '✕' : '⤢';
  mapToggle.setAttribute('aria-label', label);
  mapToggle.setAttribute('aria-expanded', String(expanded));
  mapToggle.title = label;
  mapToggle.focus();
  // Label sizes are capped in screen pixels, so they are recomputed for the new size.
  if (current) map.render(current.story.legs);
}
// Any click on the map (or the backdrop around it) toggles; the corner button bubbles up here too.
mapBox.addEventListener('click', () => setMapExpanded(!mapBox.classList.contains('expanded')));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (mapBox.classList.contains('expanded')) {
    e.preventDefault();
    setMapExpanded(false);
  } else if (pinned !== null) {
    pinned = null;
    updateHighlight();
  }
});

const tileNode = (tile: Tile, className = 'tile'): HTMLElement => {
  const node = el('span', { className, text: tile.symbol.emoji, title: `${tile.symbol.name} on ${tile.color.name}` });
  node.style.setProperty('--tile', tile.color.hex);
  return node;
};

const autoGrow = (): void => {
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`;
};

// ---- Linking Difference cells to the characters of the value ----------------------------------

const backdrop = $('input-backdrop');
const inputCard = input.closest<HTMLElement>('.input-card') ?? input;
const chunksBox = $('chunks');
/** Range of the typed value behind each chunk; null if it cannot be mapped. */
let spans: Span[] | null = null;
let marks: HTMLElement[] = [];
let items: HTMLButtonElement[] = [];
let hovered: number | null = null;
let focused: number | null = null;
let pinned: number | null = null;
let caretChunk: number | null = null;

const chunksShown = (): boolean => settings.view === 'chunks' && current !== null;

function syncBackdrop(): void {
  // The textarea's scrollbar narrows its text, so the copy behind it is narrowed to match.
  backdrop.style.setProperty('--gutter', `${input.offsetWidth - input.clientWidth - 2 * input.clientLeft}px`);
  backdrop.scrollTop = input.scrollTop;
}

function renderBackdrop(): void {
  const text = input.value;
  const nodes: (Node | string)[] = [];
  marks = [];
  let pos = 0;
  for (const [i, [start, end]] of (spans ?? []).entries()) {
    if (start > pos) nodes.push(text.slice(pos, start));
    const mark = el('mark', { className: i % 2 ? 'odd' : '', text: text.slice(start, end) });
    mark.style.setProperty('--tile', current?.chunks[i]?.color.hex ?? 'transparent');
    marks.push(mark);
    nodes.push(mark);
    pos = end;
  }
  // The trailing space gives a final empty line the same height as in the textarea.
  nodes.push(`${text.slice(pos)} `);
  backdrop.replaceChildren(...nodes);
}

function updateStickyHeight(): void {
  const sticky = getComputedStyle(inputCard).position === 'sticky';
  document.documentElement.style.setProperty('--sticky-height', `${sticky ? inputCard.offsetHeight : 0}px`);
}

function revealInInput(mark: HTMLElement | undefined): void {
  if (!mark) return;
  const top = mark.offsetTop;
  const bottom = top + mark.offsetHeight;
  if (top < input.scrollTop || bottom > input.scrollTop + input.clientHeight) {
    input.scrollTop = Math.max(0, top - input.clientHeight / 3);
    syncBackdrop();
  }
}

function updateHighlight(reveal = false): void {
  const active = hovered ?? focused ?? pinned;
  for (const [i, mark] of marks.entries()) mark.classList.toggle('active', i === active);
  for (const [i, item] of items.entries()) {
    item.classList.toggle('active', i === active);
    item.classList.toggle('caret', i === caretChunk);
    item.setAttribute('aria-pressed', String(i === pinned));
  }
  if (reveal && active !== null) revealInInput(marks[active]);
}

/** Marks the cell the caret is in; while typing it is scrolled into view below the sticky input. */
function updateCaret(reveal: boolean): void {
  const caret = input.selectionDirection === 'backward' ? input.selectionStart : input.selectionEnd;
  const next = document.activeElement === input && chunksShown() && spans?.length ? chunkAtCaret(spans, caret) : null;
  const changed = next !== caretChunk;
  caretChunk = next;
  if (changed) updateHighlight();
  if (next !== null && (reveal || changed) && getComputedStyle(inputCard).position === 'sticky') {
    updateStickyHeight();
    items[next]?.scrollIntoView({ block: 'nearest' });
  }
}

const itemIndex = (target: EventTarget | null): number | null => {
  const item = target instanceof Element ? target.closest<HTMLElement>('.chunk') : null;
  return item ? Number(item.dataset.index) : null;
};

chunksBox.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const i = itemIndex(e.target);
  if (i === hovered) return;
  hovered = i;
  updateHighlight(true);
});
chunksBox.addEventListener('pointerleave', () => {
  if (hovered === null) return;
  hovered = null;
  updateHighlight();
});
chunksBox.addEventListener('focusin', (e) => {
  if (!(e.target instanceof Element) || !e.target.matches(':focus-visible')) return;
  focused = itemIndex(e.target);
  updateHighlight(true);
});
chunksBox.addEventListener('focusout', () => {
  focused = null;
  updateHighlight();
});
// Clicking a cell while typing leaves the caret in the value.
chunksBox.addEventListener('mousedown', (e) => {
  if (document.activeElement === input && itemIndex(e.target) !== null) e.preventDefault();
});
chunksBox.addEventListener('click', (e) => {
  const i = itemIndex(e.target);
  if (i === null) return;
  pinned = pinned === i ? null : i;
  updateHighlight(true);
});

input.addEventListener('scroll', syncBackdrop);
const backdropObserver = new ResizeObserver(() => {
  syncBackdrop();
  updateStickyHeight();
});
backdropObserver.observe(inputCard);
backdropObserver.observe(input);
document.addEventListener('selectionchange', () => updateCaret(false));
for (const type of ['focus', 'blur', 'keyup', 'click']) input.addEventListener(type, () => updateCaret(false));

function render(): void {
  const modeLabel = NORMALIZE_MODES.find((m) => m.mode === settings.mode)?.label ?? settings.mode;
  current = fingerprint(input.value, { ...settings, date: useDate.checked ? utcDate() : null });
  $('results').hidden = current === null;
  $('empty').hidden = current !== null;
  $('clear').hidden = input.value === '';
  autoGrow();
  document.body.classList.toggle('chunks-mode', chunksShown());
  // The active settings stay visible even while the options are collapsed, so both computers can check them.
  const dateLabel = useDate.checked ? ` · date ${current?.context.date ?? utcDate()} (UTC)` : '';
  if (!current) {
    spans = null;
    items = [];
    hovered = focused = pinned = caretChunk = null;
    renderBackdrop();
    syncBackdrop();
    $('meta').textContent = input.value
      ? `Nothing left after normalization (${modeLabel}).`
      : `${modeLabel}${dateLabel}`;
    return;
  }
  const fp = current;
  $('meta').textContent = `${fp.length} characters · ${modeLabel}${dateLabel} · algorithm ${ALGORITHM_VERSION}`;

  const tiles = $('tiles');
  tiles.replaceChildren(...fp.tiles.map((t) => tileNode(t)));
  tiles.setAttribute('aria-label', fp.tiles.map((t) => `${t.symbol.name} on ${t.color.name}`).join(', '));

  $('legs').replaceChildren(
    el(
      'li',
      { className: 'leg-row start' },
      el('span', { className: 'leg-emoji', text: '🏁' }),
      el('span', { className: 'leg-text' }, 'Start in ', el('strong', { text: fp.story.start.name }), `, ${fp.story.start.country}`),
    ),
    ...fp.story.legs.map((leg) =>
      el(
        'li',
        { className: 'leg-row' },
        el('span', { className: 'leg-emoji', text: leg.transport.emoji }),
        el(
          'span',
          { className: 'leg-text' },
          `${leg.transport.phrase} to `,
          el('strong', { text: leg.to.name }),
          leg.crossesBorder ? el('span', { className: 'border', text: ` 🛂 ${leg.to.country}` }) : '',
        ),
        el('span', { className: 'km', text: `${Math.round(leg.km).toLocaleString('en')} km` }),
      ),
    ),
  );

  // Hidden panels cannot measure text; the map is rendered again when its tab is shown.
  if (settings.view === 'journey') map.render(fp.story.legs);
  $('words').textContent = fp.words.join(' · ');

  const chars = Array.from(fp.normalized);
  items = fp.chunks.map((c) => {
    const tile = tileNode(c, 'tile small');
    tile.removeAttribute('title');
    const item = el(
      'button',
      {
        className: 'chunk',
        title: `#${c.index + 1} · characters ${c.start + 1}–${c.start + c.length}: ${chars.slice(c.start, c.start + c.length).join('')}\n${c.symbol.name} on ${c.color.name}`,
      },
      el('span', { className: 'chunk-pos', text: `#${c.index + 1}` }),
      tile,
      el('span', { className: 'chunk-word', text: c.word }),
    );
    item.type = 'button';
    item.dataset.index = String(c.index);
    item.style.setProperty('--tile', c.color.hex);
    return item;
  });
  chunksBox.replaceChildren(...items);
  spans = chunkSpans(input.value, fp.context.mode, fp.chunks);
  const valid = (i: number | null): number | null => (i !== null && i < items.length ? i : null);
  hovered = valid(hovered);
  pinned = valid(pinned);
  // The focused cell was just replaced.
  focused = null;
  renderBackdrop();
  syncBackdrop();
  caretChunk = null;
  updateHighlight();
  updateCaret(true);

  $('normalized').textContent = fp.normalized;
  $('sha').textContent = fp.sha256;
  $('context').textContent = `normalize=${NORMALIZE_PARAMS[fp.context.mode]} · date=${fp.context.date ?? 'none'}`;
}

let scheduled = false;
const scheduleRender = (): void => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    render();
  });
};

input.addEventListener('input', scheduleRender);
modeSelect.addEventListener('change', () => {
  if (isNormalizeMode(modeSelect.value)) settings.mode = modeSelect.value;
  saveSettings(settings);
  scheduleRender();
});
chunkSelect.addEventListener('change', () => {
  settings.chunkSize = Number(chunkSelect.value);
  pinned = null;
  saveSettings(settings);
  scheduleRender();
});
useDate.addEventListener('change', scheduleRender);
// Keep the date current if the page stays open across midnight UTC.
setInterval(() => {
  if (useDate.checked && current && current.context.date !== utcDate()) render();
}, 10_000);
const optionsToggle = $<HTMLButtonElement>('options-toggle');
optionsToggle.addEventListener('click', () => {
  const open = optionsToggle.getAttribute('aria-expanded') !== 'true';
  optionsToggle.setAttribute('aria-expanded', String(open));
  $('options').hidden = !open;
});

const tabs = VIEWS.map((view) => ({ view, tab: $<HTMLButtonElement>(`tab-${view}`), panel: $(`panel-${view}`) }));
function showView(view: View, focus = false): void {
  for (const t of tabs) {
    const selected = t.view === view;
    t.tab.setAttribute('aria-selected', String(selected));
    t.tab.tabIndex = selected ? 0 : -1;
    t.panel.hidden = !selected;
    if (selected && focus) t.tab.focus();
  }
  if (settings.view !== view) {
    settings.view = view;
    saveSettings(settings);
  }
  if (view === 'journey' && current) map.render(current.story.legs);
  document.body.classList.toggle('chunks-mode', chunksShown());
  autoGrow();
  syncBackdrop();
  updateStickyHeight();
  updateCaret(false);
}
for (const [i, t] of tabs.entries()) {
  t.tab.addEventListener('click', () => showView(t.view));
  t.tab.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    const target = step
      ? tabs[(i + step + tabs.length) % tabs.length]
      : e.key === 'Home'
        ? tabs[0]
        : e.key === 'End'
          ? tabs.at(-1)
          : undefined;
    if (!target) return;
    e.preventDefault();
    showView(target.view, true);
  });
}
showView(settings.view);

$('find-diff').addEventListener('click', () => {
  showView('chunks', true);
  $('tab-chunks').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('clear').addEventListener('click', () => {
  input.value = '';
  input.focus();
  render();
});

const pasteButton = $<HTMLButtonElement>('paste');
if (!navigator.clipboard?.readText) pasteButton.hidden = true;
pasteButton.addEventListener('click', async () => {
  try {
    input.value = await navigator.clipboard.readText();
    render();
  } catch {
    input.focus();
  }
});

$('copy').addEventListener('click', async () => {
  if (!current) return;
  const text = [
    `Vicomp ${ALGORITHM_VERSION} (${settings.mode}${current.context.date ? `, date ${current.context.date} UTC` : ''}, ${current.length} chars, app ${__APP_VERSION__})`,
    current.tiles.map((t) => t.symbol.emoji).join(''),
    current.story.text,
    current.words.join(' '),
  ].join('\n');
  try {
    await navigator.clipboard.writeText(text);
    const button = $('copy');
    button.textContent = '✅';
    button.title = 'Copied';
    setTimeout(() => {
      button.textContent = '📄';
      button.title = 'Copy as text';
    }, 1500);
  } catch {
    // Clipboard permission denied; nothing else to do.
  }
});

render();
registerSW({ immediate: true });
