import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Body, WorldState } from '../src/types';
import type { Prediction } from '../src/prediction/types';
import { worldToScreen } from '../src/rendering/coordinates';

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), 'No uncaught browser errors').toEqual([]);
});

async function openLab(page: Page) {
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/sessions') && r.request().method() === 'POST' && r.status() === 200,
  );
  await page.goto('/');
  const session: { id: string; state: WorldState } = await (await created).json();
  await expect(page.getByText('ENGINE CONNECTED', { exact: true })).toBeVisible();
  await expect(
    page.getByLabel('Interactive ground-truth physics world').locator('canvas'),
  ).toBeVisible();
  return session.id;
}
async function live(page: Page, id: string): Promise<WorldState> {
  const response = await page.request.get(`/api/sessions/${id}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function selectBody(page: Page, body: Body) {
  await page.getByRole('tab', { name: 'Object inspector', exact: true }).click();
  const host = page.getByLabel('Interactive ground-truth physics world');
  const box = await host.boundingBox();
  expect(box).not.toBeNull();
  const point = worldToScreen(body.position, { x: 12, y: 6.6, zoom: 1 }, box!.width, box!.height);
  await host.click({ position: point });
  await expect(page.getByRole('heading', { name: body.label, exact: true })).toBeVisible();
}
async function recordIfNeeded(page: Page) {
  const record = page.getByRole('button', { name: /^Record (observations|\d+ ticks)/ });
  if (await record.isVisible()) await record.click();
}

test('Main Lab connects, pauses, steps and applies a real body edit', async ({ page }) => {
  const id = await openLab(page);
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  const before = await live(page, id);
  await page.getByRole('button', { name: 'Step simulation', exact: true }).click();
  await expect.poll(async () => (await live(page, id)).tick).toBe(before.tick + 1);
  const stepped = await live(page, id);
  const body = stepped.objects.find((b) => !b.static)!;
  await selectBody(page, body);
  const mass = page.getByRole('slider', { name: 'Mass', exact: true });
  await mass.focus();
  await mass.press('End');
  const updatedMass = Number(await mass.inputValue());
  expect(updatedMass).not.toBe(body.mass);
  await page.getByRole('button', { name: 'Apply to world' }).click();
  await expect
    .poll(async () => (await live(page, id)).objects.find((b) => b.id === body.id)?.mass)
    .toBe(updatedMass);
  expect((await live(page, id)).playing).toBe(false);
});

test('Prediction uses trained fixture weights and separates learned and Pymunk futures', async ({
  page,
}) => {
  const id = await openLab(page);
  await page.getByRole('tab', { name: 'Prediction', exact: true }).click();
  await page.getByLabel('Prediction model', { exact: true }).selectOption('oracle-e2e');
  await page.getByLabel('Prediction horizon', { exact: true }).selectOption('5');
  await recordIfNeeded(page);
  await expect(page.getByRole('button', { name: 'Predict future' })).toBeEnabled();
  const before = await live(page, id);
  const response = page.waitForResponse((r) => r.url().endsWith('/predict') && r.status() === 200);
  await page.getByRole('button', { name: 'Predict future' }).click();
  const result: Prediction = await (await response).json();
  expect(result.source).toBe('learned_model');
  expect(result.reference.source).toBe('pymunk-7.2.0');
  expect(result.model.id).toBe('oracle-e2e');
  expect(result.model.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(result.frames).toHaveLength(5);
  expect(result.frames).not.toEqual(result.reference.frames);
  await expect(page.getByRole('region', { name: 'Learned forecast timeline' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Toggle learned ghosts' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Toggle Pymunk reference' })).toBeVisible();
  expect((await live(page, id)).objects).toEqual(before.objects);
});

test('Counterfactual saves an intervention without changing its live source', async ({ page }) => {
  const id = await openLab(page);
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('button', { name: 'Counterfactual', exact: true })
    .click();
  await page.getByLabel('Counterfactual model', { exact: true }).selectOption('oracle-e2e');
  await recordIfNeeded(page);
  await page.getByRole('button', { name: 'Capture source', exact: true }).click();
  const before = await live(page, id);
  const target = before.objects.find((b) => !b.static)!;
  await page.getByLabel('Counterfactual object', { exact: true }).selectOption(target.id);
  await page.getByRole('button', { name: 'Mass ×2', exact: true }).click();
  await page.getByLabel('Alternative branch name').fill('E2E doubled mass');
  await page.getByRole('button', { name: 'Save alternative', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select branch E2E doubled mass' })).toBeVisible();
  expect((await live(page, id)).objects).toEqual(before.objects);
  expect((await live(page, id)).tick).toBe(before.tick);
});

test('Research renders real dataset, training and both comparison views', async ({ page }) => {
  await openLab(page);
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('button', { name: /^Research/ })
    .click();
  await expect(
    page.getByRole('heading', { name: 'From observation to understanding.' }),
  ).toBeVisible();
  await expect(page.getByLabel('Training dataset')).not.toHaveValue('');
  await page.getByRole('button', { name: /Dataset engine/ }).click();
  await expect(page.getByRole('heading', { name: 'Evidence before intelligence.' })).toBeVisible();
  await expect(page.getByLabel('Active dataset')).not.toHaveValue('');
  await page.getByRole('button', { name: /Checkpoint comparison/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Same evidence. Different models.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Family comparison/ }).click();
  await expect(page.getByRole('heading', { name: 'Families across seeds.' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Planning measures real learned candidates and hides stale evidence after a goal edit', async ({
  page,
}) => {
  await openLab(page);
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('button', { name: 'Planning', exact: true })
    .click();
  await page.getByLabel('Planning model', { exact: true }).selectOption('oracle-e2e');
  await page.getByLabel('Observed horizon', { exact: true }).fill('5');
  await recordIfNeeded(page);
  await page.getByRole('button', { name: 'Search learned futures', exact: true }).click();
  await expect(page.locator('.planning-candidate')).toHaveCount(9);
  await expect(page.getByText('SELECTED BY MODEL', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run reality', exact: true })).toBeEnabled();
  await page.getByText('Goal & search settings', { exact: true }).click();
  await page.getByLabel('Goal X · m', { exact: true }).fill('10');
  await expect(page.locator('.planning-candidate')).toHaveCount(0);
  await expect(
    page.getByText(
      'Goal or search settings changed. Run a new search to measure these candidates.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run reality', exact: true })).toBeDisabled();
});
