// Exercise the same home → destination flow as a player.
export async function selectDestination(page, { mode = 'solo' } = {}) {
  if (!['solo', 'coop'].includes(mode)) throw new Error('Expected solo or coop destination');
  if (await page.locator('#stage-screen').isVisible()) {
    const currentMode = await page.locator('#stage-join').isVisible() ? 'coop' : 'solo';
    if (currentMode !== mode) await page.locator('#stage-back').click();
  }
  if (await page.locator('#home-screen').isVisible()) await page.locator(mode === 'coop' ? '#home-coop:enabled' : '#home-play:enabled').click();
  await page.locator('#stage-screen:not([hidden])').waitFor();
  await page.locator('#quick-start').waitFor();
  await page.locator('#stage-screen').evaluate(async element => {
    await Promise.allSettled(element.getAnimations().map(animation => animation.finished));
  });
}

export async function selectBattlefield(page, battlefieldId, options) {
  const mode = options?.mode ?? (await page.locator('#stage-screen').isVisible() && await page.locator('#stage-join').isVisible() ? 'coop' : 'solo');
  await selectDestination(page, { mode });
  await page.locator('#planet-picker').click();
  await page.locator('#planet-dialog[open]').waitFor();
  await page.locator(`#planet-dialog [data-battlefield="${battlefieldId}"]`).click();
  await page.locator('#planet-dialog').waitFor({ state: 'hidden' });
}

export async function openUnitInspection(page) {
  if (!await page.locator('#unit-inspection-dialog').evaluate(dialog => dialog.open)) {
    await page.locator('#unit-manage').click();
    await page.locator('#unit-inspection-dialog[open]').waitFor();
  }
}

export async function closeUnitInspection(page) {
  if (await page.locator('#unit-inspection-dialog').evaluate(dialog => dialog.open)) {
    await page.locator('[data-close="unit-inspection-dialog"]').click();
    await page.locator('#unit-inspection-dialog').waitFor({ state: 'hidden' });
  }
}

export async function openEvolutionDetail(page, recipeId) {
  await page.locator(`[data-evolution-detail="${recipeId}"]`).click();
  await page.locator('#unit-inspection-dialog[open]').waitFor();
}

export async function selectRunSpeed(page, speed) {
  const settings = page.locator('#practice-settings');
  const wasOpen = await settings.getAttribute('open') !== null;
  if (!wasOpen) await settings.locator('summary').click();
  await page.selectOption('#speed-select', speed);
  if (!wasOpen) await settings.locator('summary').click();
}
