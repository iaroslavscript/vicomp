import { expect, test, type Page } from '@playwright/test';

const legTexts = (page: Page): Promise<string[]> => page.locator('#legs .leg-text').allTextContents();

const storyFor = async (page: Page, value: string): Promise<string> => {
  await page.getByRole('textbox', { name: 'Value to compare' }).fill(value);
  // Rendering is batched per animation frame; wait until this value is shown.
  await expect(page.locator('#normalized')).toHaveText(value.replace(/\s/g, '').toUpperCase());
  return (await legTexts(page)).join('\n');
};

test('shows instructions until a value is entered', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
  await expect(page.locator('#results')).toBeHidden();
});

test('same value with different spacing gives the same story; a typo changes it', async ({ page }) => {
  await page.goto('./');
  const a = await storyFor(page, 'DE89 3704 0044 0532 0130 00');
  const b = await storyFor(page, 'de89370400440532013000');
  const typo = await storyFor(page, 'DE89 3704 0044 0582 0130 00');
  expect(a).toBe(b);
  expect(typo).not.toBe(a);
  await expect(page.locator('#meta')).toContainText('22 characters');
});

test('every browser engine produces the same golden story', async ({ page }) => {
  await page.goto('./');
  // Same value as the unit-test golden vector (src/core/core.test.ts).
  expect(await storyFor(page, 'DE89 3704 0044 0532 0130 00')).toBe(
    [
      'Start in Kismayo, Somalia',
      'by balloon to Arba Minch 🛂 Ethiopia',
      'by motorbike to Juba 🛂 South Sudan',
      'by motorbike to Jimma 🛂 Ethiopia',
      'by bus to Addis Ababa',
      'by bus to Arabi',
      'by sailboat to Awasa',
    ].join('\n'),
  );
  await expect(page.locator('#legs .leg-emoji')).toHaveText(['🏁', '🎈', '🏍️', '🏍️', '🚌', '🚌', '⛵']);
  await expect(page.locator('#words')).toHaveText('famous · motion · alpha · top · pretty');
});

test('optional UTC date changes the result and is off by default', async ({ page }) => {
  // 23:30 in New York is already the next day in UTC.
  await page.clock.setFixedTime(new Date('2026-10-29T23:30:00-04:00'));
  await page.goto('./');
  const useDate = page.getByRole('checkbox', { name: "Include today's date (UTC)" });
  await expect(useDate).toBeHidden();
  await page.getByRole('button', { name: 'Options' }).click();
  await expect(useDate).not.toBeChecked();
  const plain = await storyFor(page, 'DE89 3704 0044 0532 0130 00');

  await useDate.check();
  await expect(page.locator('#meta')).toContainText('date 2026-10-30 (UTC)');
  await expect(page.locator('#context')).toHaveText(/date=2026-10-30$/);
  // Same value as the dated unit-test golden vector (src/core/core.test.ts).
  await expect(page.locator('#legs .leg-text').first()).toHaveText('Start in Austin, United States');
  await expect(page.locator('#legs .leg-text').nth(1)).toHaveText(/^by sailboat to Reynosa/);
  expect((await legTexts(page)).join('\n')).not.toBe(plain);

  await page.reload();
  await page.getByRole('button', { name: 'Options' }).click();
  await expect(useDate).not.toBeChecked();
});

test('shows app version and algorithm version', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#app-version')).toHaveText(/^\d+\.\d+\.\d+ \((\w+)\)$/);
  await expect(page.locator('#version')).toHaveText('v3');
});

test('renders all views', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('textbox', { name: 'Value to compare' }).fill('d41d8cd98f00b204e9800998ecf8427e');
  await expect(page.locator('#tiles .tile')).toHaveCount(8);
  await expect(page.locator('#legs li')).toHaveCount(7);
  await expect(page.locator('#words')).toHaveText(/^(\w+ · ){4}\w+$/);
  await expect(page.locator('#chunks .chunk')).toHaveCount(8);
  await expect(page.locator('#map .stop')).toHaveCount(7);
  await expect(page.locator('#vicomp-land')).toHaveAttribute('d', /^M/);
});

test('keeps secondary views behind tabs', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('textbox', { name: 'Value to compare' }).fill('d41d8cd98f00b204e9800998ecf8427e');
  await expect(page.locator('#tiles')).toBeVisible();
  await expect(page.locator('#words')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Journey' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#chunks')).toBeHidden();

  await page.getByRole('button', { name: /Find the difference/ }).click();
  await expect(page.getByRole('tab', { name: 'Difference' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#chunks')).toBeVisible();
  await expect(page.locator('#map')).toBeHidden();

  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Details' })).toBeFocused();
  await expect(page.locator('#normalized')).toBeVisible();
});

test('a Difference cell highlights its characters in the value', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('textbox', { name: 'Value to compare' }).fill('de89 3704\t0044 0532');
  await page.getByRole('tab', { name: 'Difference' }).click();
  const cell = page.locator('#chunks .chunk').nth(1);
  const highlight = page.locator('#input-backdrop mark.active');
  await expect(cell).toHaveAttribute('title', /^#2 · characters 5–8: 3704\n/);

  await cell.click();
  await expect(cell).toHaveAttribute('aria-pressed', 'true');
  await expect(highlight).toHaveText('3704');
  await page.locator('#chunks .chunk').nth(2).click();
  await expect(highlight).toHaveText('0044');
  // Pointing still highlights, so move away to see what is pinned.
  await page.mouse.move(0, 0);
  await expect(highlight).toHaveText('0044');
  await page.keyboard.press('Escape');
  await expect(highlight).toHaveCount(0);
  await expect(page.locator('#chunks [aria-pressed="true"]')).toHaveCount(0);
});

test('while typing, the cell under the caret is marked and kept in view', async ({ page }) => {
  await page.goto('./');
  const input = page.getByRole('textbox', { name: 'Value to compare' });
  await input.fill('d41d8cd98f00b204e9800998ecf8427e'.repeat(8));
  await page.getByRole('tab', { name: 'Difference' }).click();
  await input.focus();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('xy');
  const last = page.locator('#chunks .chunk').last();
  await expect(last).toHaveClass(/\bcaret\b/);
  await expect(last).toBeInViewport({ ratio: 1 });
  await expect(input).toBeInViewport();
  await expect(input).toBeFocused();
});

test('enlarges the map on click and closes it by click, Esc or the close button', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('textbox', { name: 'Value to compare' }).fill('d41d8cd98f00b204e9800998ecf8427e');
  const map = page.locator('#map');
  const width = async (): Promise<number> => (await page.locator('#map .map-main').boundingBox())?.width ?? 0;
  const small = await width();

  await page.locator('#map .map-main').click();
  await expect(map).toHaveClass(/expanded/);
  expect(await width()).toBeGreaterThan(small);
  await expect(page.locator('#map .map-main')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#map .map-overview')).toBeInViewport({ ratio: 1 });
  await page.locator('#map .map-main').click();
  await expect(map).not.toHaveClass(/expanded/);

  await page.getByRole('button', { name: 'Enlarge map' }).click();
  await expect(map).toHaveClass(/expanded/);
  await page.keyboard.press('Escape');
  await expect(map).not.toHaveClass(/expanded/);

  await page.getByRole('button', { name: 'Enlarge map' }).click();
  await page.getByRole('button', { name: 'Close map' }).click();
  await expect(map).not.toHaveClass(/expanded/);
  expect(await width()).toBeCloseTo(small, 0);
});

test('remembers settings and the open view but never the value', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('textbox', { name: 'Value to compare' }).fill('d41d8cd98f00b204e9800998ecf8427e');
  await page.getByRole('tab', { name: 'Difference' }).click();
  await page.getByLabel('Chunk size').selectOption('8');
  await expect(page.locator('#chunks .chunk')).toHaveCount(4);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Value to compare' })).toHaveValue('');
  await page.getByRole('textbox', { name: 'Value to compare' }).fill('d41d8cd98f00b204e9800998ecf8427e');
  await expect(page.getByRole('tab', { name: 'Difference' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Chunk size')).toHaveValue('8');
  await expect(page.locator('#chunks .chunk')).toHaveCount(4);
});

test('works offline after the first visit, including the map', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'offline emulation with service workers is reliable in Chromium only');
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:4173')) external.push(r.url());
  });
  await page.goto('./');
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const cached = async () => (await (await caches.open((await caches.keys())[0] ?? 'none')).keys()).length;
    while (reg.active?.state !== 'activated' || (await cached()) === 0) await new Promise((r) => setTimeout(r, 100));
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  expect(await storyFor(page, 'DE89 3704 0044 0532 0130 00')).toMatch(/^Start in Kismayo/);
  await expect(page.locator('#vicomp-land')).toHaveAttribute('d', /^M/);
  expect(external).toEqual([]);
});
