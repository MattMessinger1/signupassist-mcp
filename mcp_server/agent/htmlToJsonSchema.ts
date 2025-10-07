import { Page } from "playwright";
import crypto from "crypto";

export interface DiscoveredField {
  id: string; // stable key from name|id
  label: string;
  type: "text"|"number"|"date"|"select"|"radio"|"checkbox"|"textarea"|string;
  required: boolean;
  options?: { value: string; label: string }[];
  x?: { selector?: string; step_id?: string; group?: string; label_confidence?: "high"|"low" };
  visibleWhen?: { dependsOn: string; value: any };
}

export interface DiscoveredSchema {
  type: "object";
  properties: Record<string, any>;
  required: string[];
  $defs?: { flow?: { id: string; title: string; fields: string[] }[] };
  fingerprint: string;
}

const NEXT_BUTTON_SELECTORS = [
  "button[type=submit]",
  "button:has-text('Next')",
  "button:has-text('Continue')",
  "input[type=submit]",
  "[role=button]:has-text('Next')",
  "[role=button]:has-text('Continue')"
];

const ERROR_LOCATORS = [
  ":invalid",
  "[role='alert']",
  "[aria-live]",
  ".error, .errors, .error-message, .invalid-feedback, .form-item--error-message, .webform-submission-errors"
];

export async function harvestVisibleFields(page: Page, stepId = "step1"): Promise<DiscoveredField[]> {
  const controls = await page.$$eval("input, select, textarea", (elements) =>
    (elements as HTMLElement[])
      .filter((el: any) => {
        const cs = window.getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
      })
      .filter((el: any) => !["hidden", "submit", "button", "image", "file"].includes(el.type))
      .map((el: any) => {
        const id = el.name || el.id || `anon_${Math.random().toString(36).slice(2)}`;
        const isSelect = el.tagName === "SELECT";
        const isTextArea = el.tagName === "TEXTAREA";
        const type = isSelect ? "select" : isTextArea ? "textarea" : (el.type || "text");
        const explicit = document.querySelector(`label[for='${el.id}']`);
        const implicit = el.closest("label");
        const label = (explicit?.textContent || implicit?.textContent || el.ariaLabel || el.placeholder || "").trim();
        const options = isSelect
          ? Array.from((el as HTMLSelectElement).options).map(o => ({ value: o.value, label: o.textContent || o.value }))
          : undefined;
        const selector = el.id ? `#${el.id}` : el.name ? `[name="${el.name}"]` : undefined;
        return {
          id,
          label,
          type,
          required: !!el.required,
          options,
          x: { selector, step_id: stepId, label_confidence: label ? "high" : "low" }
        } as DiscoveredField;
      })
  );

  // dedupe by id
  const map = new Map<string, DiscoveredField>();
  for (const f of controls) if (!map.has(f.id)) map.set(f.id, f);
  return Array.from(map.values());
}

async function clickNextOrSubmit(page: Page) {
  for (const sel of NEXT_BUTTON_SELECTORS) {
    const btn = page.locator(sel).first();
    if (await btn.count()) { await btn.click({ trial: false }).catch(()=>{}); break; }
  }
}

export async function proveRequiredOnStep(page: Page, fields: DiscoveredField[]): Promise<DiscoveredField[]> {
  await clickNextOrSubmit(page);
  const errors = await page.$$eval(ERROR_LOCATORS.join(","), nodes =>
    nodes.map(n => {
      const t = (n.textContent || "").trim();
      const input = (n.closest("label")?.querySelector("input,select,textarea")
        || n.previousElementSibling
        || n.parentElement?.querySelector("input,select,textarea")) as HTMLInputElement | null;
      const name = input?.name || input?.id || "";
      return { text: t, name };
    })
  ).catch(()=>[] as any[]);
  const reqNames = new Set(errors.filter(e => e.name).map(e => e.name));
  for (const f of fields) {
    if (reqNames.has(f.id)) f.required = true;
  }
  return fields;
}

export function toJsonSchema(fields: DiscoveredField[], stepFlow?: string[]): DiscoveredSchema {
  const schema: DiscoveredSchema = { type:"object", properties:{}, required:[], $defs:{ flow:[] }, fingerprint:"" };
  for (const f of fields) {
    const prop: any = { title: f.label || f.id };
    if (f.type === "checkbox") prop.type = "boolean";
    else if (f.type === "number") prop.type = "number";
    else prop.type = "string";
    if (f.options?.length) {
      prop.enum = f.options.map(o => o.value);
      prop["x-enumNames"] = f.options.map(o => o.label);
    }
    if (f.visibleWhen) prop["x-visibleWhen"] = f.visibleWhen;
    if (f.x) prop["x-metadata"] = f.x;
    (schema.properties as any)[f.id] = prop;
    if (f.required) schema.required.push(f.id);
  }
  if (stepFlow)
    schema.$defs!.flow = stepFlow.map(id => ({
      id,
      title: id,
      fields: fields.filter(f => f.x?.step_id === id).map(f => f.id)
    }));
  const canonical = JSON.stringify(schema, Object.keys(schema).sort());
  schema.fingerprint = crypto.createHash("sha256").update(canonical).digest("hex");
  return schema;
}

export async function extractSingleStep(page: Page, stepId: string) {
  const fields = await harvestVisibleFields(page, stepId);
  const after = await proveRequiredOnStep(page, fields);
  return toJsonSchema(after, [stepId]);
}
