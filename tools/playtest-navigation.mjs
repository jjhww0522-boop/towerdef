// Exercise the same home → destination flow as a player.
export async function selectDestination(page) {
  if (await page.locator('#home-screen').isVisible()) await page.locator('#home-play:enabled').click();
  await page.locator('#stage-screen:not([hidden])').waitFor();
  await page.locator('#quick-start:enabled').waitFor();
  await page.locator('#stage-screen').evaluate(async element => {
    await Promise.allSettled(element.getAnimations().map(animation => animation.finished));
  });
}
