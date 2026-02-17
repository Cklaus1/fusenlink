const { chromium } = require('playwright');

(async () => {
  const context = await chromium.launchPersistentContext('/tmp/chrome-profile', {
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--disable-extensions-except=/root/projects/fusenlink',
      '--load-extension=/root/projects/fusenlink',
      '--no-sandbox',
      '--remote-debugging-port=9222'
    ]
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://www.linkedin.com/mynetwork/invitation-manager/');
  await page.waitForTimeout(8000);
  await page.screenshot({ path: '/tmp/invitations3.png', fullPage: true });

  const hasButtons = await page.evaluate(() => {
    return Boolean(document.querySelector('.li-bulk-action-buttons'));
  });
  console.log('Has extension buttons:', hasButtons);
  console.log('Screenshot saved');

  // Keep open for 1 hour
  await page.waitForTimeout(3600000);
  await context.close();
})().catch(e => console.error(e));
