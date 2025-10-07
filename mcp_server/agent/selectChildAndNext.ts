import type { Page } from "playwright-core";

export async function selectChildAndNext(page: Page, { child_id, child_name }: {
  child_id?: string; 
  child_name?: string;
}) {
  const childSelect = page.locator('select#edit-participant, select[name*="child"], select[name*="participant"]').first();
  if (!(await childSelect.count())) return;

  const options = await childSelect.locator("option").evaluateAll(els =>
    els.map(e => ({ value: (e as HTMLOptionElement).value, text: (e.textContent||"").trim() }))
  );

  let valueToPick: string | undefined;

  if (child_id) {
    const byId = options.find(o => o.value === child_id);
    if (byId) valueToPick = byId.value;
  }
  if (!valueToPick && child_name) {
    const byName = options.find(o => o.text.toLowerCase().includes(child_name.toLowerCase()));
    if (byName) valueToPick = byName.value;
  }
  if (!valueToPick) {
    const firstReal = options.find(o => o.value && o.value !== "_none");
    valueToPick = firstReal?.value;
  }

  if (valueToPick) await childSelect.selectOption(valueToPick);

  const nextBtn = page.locator('input[value="Next"], button:has-text("Next")').first();
  if (await nextBtn.count()) {
    await nextBtn.click();
    await page.waitForLoadState("networkidle");
  }
}
