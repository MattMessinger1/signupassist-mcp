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
  await page.goto(config.loginUrl, { waitUntil: "domcontentloaded" });

  await page.fill(config.selectors.username, creds.email);
  await page.fill(config.selectors.password, creds.password);

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
