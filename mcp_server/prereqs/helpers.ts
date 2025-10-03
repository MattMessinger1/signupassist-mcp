// mcp_server/prereqs/helpers.ts
export async function gotoAny(page: any, base: string, paths: string[], timeout = 15000) {
  for (const p of paths) {
    try {
      await page.goto(`${base}${p}`, { waitUntil: 'domcontentloaded', timeout });
      return true;
    } catch (_) {}
  }
  return false;
}

export async function bodyText(page: any, length = 2000) {
  const text = await page.evaluate(() => document.body?.innerText || '');
  return text.slice(0, length);
}
