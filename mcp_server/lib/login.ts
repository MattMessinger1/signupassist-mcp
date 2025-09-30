import { Page } from 'playwright';

export interface ProviderLoginConfig {
  loginUrl: string;
  selectors: {
    username: string;
    password: string;
    submit: string;
  };
  postLoginCheck: string; // CSS or text locator
}

export async function loginWithCredentials(
  page: Page, 
  config: ProviderLoginConfig, 
  creds: { email: string; password: string }
) {
  console.log("DEBUG Navigating to login page:", config.loginUrl);
  // Wait for full page load including scripts (Antibot JS needs to load)
  await page.goto(config.loginUrl, { waitUntil: "networkidle" });

  // Wait for form elements to be present
  console.log("DEBUG Waiting for login form to be ready...");
  await page.waitForSelector(config.selectors.username, { timeout: 15000 });
  await page.waitForSelector(config.selectors.password, { timeout: 15000 });

  // Antibot bypass: simulate human-like behavior with delay
  console.log("DEBUG Pausing to mimic human reading time (Antibot bypass)...");
  await page.waitForTimeout(3000);

  // Simulate mouse movement to trigger pointer events
  await page.mouse.move(0, 0);
  await page.mouse.move(100, 100, { steps: 20 });

  // Focus and type username with realistic delay (not instant fill)
  console.log("DEBUG Clicking and typing username...");
  await page.click(config.selectors.username);
  await page.type(config.selectors.username, creds.email, { delay: 75 });

  // Focus and type password with realistic delay
  console.log("DEBUG Clicking and typing password...");
  await page.click(config.selectors.password);
  await page.type(config.selectors.password, creds.password, { delay: 75 });

  // Small pause before submit
  await page.waitForTimeout(500);

  // Submit the form
  console.log("DEBUG Clicking submit button...");
  await page.click(config.selectors.submit);

  // Wait for logout link instead of navigation idle
  if (await page.waitForSelector(config.postLoginCheck, { timeout: 15000 }).catch(() => null)) {
    const url = page.url();
    const title = await page.title();
    console.log("DEBUG Login successful, landed on:", url, "title:", title);
    return { url, title };
  } else {
    const html = await page.content();
    console.log("DEBUG Login failed, page snippet:", html.slice(0, 500));
    throw new Error("Login failed: Logout not found after form submit");
  }
}

export async function logoutIfLoggedIn(page: Page, logoutSelector: string = 'text=Logout') {
  if (await page.$(logoutSelector)) {
    console.log("DEBUG Found logout link — logging out...");
    await Promise.all([
      page.click(logoutSelector),
      page.waitForNavigation({ waitUntil: "networkidle" })
    ]);
    console.log("DEBUG Logout successful");
  } else {
    console.log("DEBUG No logout link found — already logged out");
  }
}
