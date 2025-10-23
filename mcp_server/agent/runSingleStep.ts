import { chromium } from "playwright-core";
import { extractSingleStep } from "./htmlToJsonSchema.js";

// First step of the Blackhawk Ski Club (SkiClubPro 309) registration form.
const PROGRAM_URL = process.env.SCP_REG_URL || "https://blackhawk.skiclubpro.team/registration/309/start";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(PROGRAM_URL, { waitUntil: "domcontentloaded" });

  const stepId = new URL(page.url()).pathname.split("/").pop() || "step1";
  const h1 = await page.locator("h1, h2").first().textContent().catch(() => null);
  const id = (h1?.trim() || stepId).toLowerCase().replace(/\s+/g, "_");

  const schema = await extractSingleStep(page, id);
  console.log(JSON.stringify(schema, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
