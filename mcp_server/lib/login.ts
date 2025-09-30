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
  await page.goto(config.loginUrl, { waitUntil: "networkidle" });

  await page.fill(config.selectors.username, creds.email);
  await page.fill(config.selectors.password, creds.password);

  await Promise.all([
    page.click(config.selectors.submit),
    page.waitForNavigation({ waitUntil: "networkidle" }),
  ]);

  if (await page.$(config.postLoginCheck) === null) {
    throw new Error("Login failed: post-login check not found");
  }

  const url = page.url();
  const title = await page.title();
  console.log("DEBUG Login successful, landed on:", url, "title:", title);

  return { url, title };
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
