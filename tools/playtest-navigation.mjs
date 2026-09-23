// Exercise the same home → destination flow as a player.
export async function selectDestination(page) {
  if (await page.locator('#home-screen').isVisible()) await page.locator('#home-play:enabled').click();
  await page.locator('#stage-screen:not([hidden])').waitFor();
  await page.locator('#quick-start').waitFor();
  await page.locator('#stage-screen').evaluate(async element => {
    await Promise.allSettled(element.getAnimations().map(animation => animation.finished));
  });
}

export async function selectBattlefield(page, battlefieldId) {
  await selectDestination(page);
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
