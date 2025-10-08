import { DiscoveredField } from "./htmlToJsonSchema.js";

export type ProgramQuestion = {
  id: string;
  label: string;
  type: "text"|"number"|"date"|"select"|"radio"|"checkbox"|"textarea";
  required: boolean;
  options?: Array<{ value: string; label: string }>;
  description?: string;
  dependsOn?: string;
  showWhen?: any;
};

function normText(s?: string) {
  return (s || "").trim().replace(/\s+/g, " ");
}

function dedupe<T>(arr: T[]) { return Array.from(new Set(arr)); }

function stripPlaceholders(arr: string[]) {
  return arr.filter(o =>
    o &&
    !/^(-\s*)?select\s*-?$/i.test(o) &&
    !/^choose|pick/i.test(o) &&
    o !== "_none"
  );
}

function stripTrailingPrice(arr: string[]) {
  // Remove trailing " ($25.00)" etc.
  return arr.map(o => o.replace(/\s*\(\$\s*\d+(?:\.\d{2})?\)\s*$/,"").trim());
}

function normalizeOptions(opts: any): Array<{ value: string; label: string }> | undefined {
  if (!opts) return undefined;
  let out: Array<{ value: string; label: string }> = [];

  if (Array.isArray(opts)) {
    out = opts.map((o: any) => {
      if (typeof o === "string") {
        return { value: o, label: normText(o) };
      } else if (typeof o === "object" && (o.value || o.label)) {
        return {
          value: o.value || o.label || o.text,
          label: normText(o.label || o.text || o.value)
        };
      }
      return null;
    }).filter(Boolean) as Array<{ value: string; label: string }>;
  } else if (typeof opts === "object") {
    out = Object.entries(opts).map(([key, val]) => ({
      value: key,
      label: normText(String(val))
    }));
  }

  // Filter placeholders and empty values
  out = out.filter(o => 
    o.label &&
    o.value &&
    o.value.trim() !== '' &&
    !/^(-\s*)?select\s*-?$/i.test(o.label) &&
    !/^choose|pick/i.test(o.label) &&
    o.value !== "_none"
  );

  // Strip trailing prices from labels
  out = out.map(o => ({
    ...o,
    label: o.label.replace(/\s*\(\$\s*\d+(?:\.\d{2})?\)\s*$/, "").trim()
  }));

  // Dedupe by value
  const seen = new Set<string>();
  out = out.filter(o => {
    if (seen.has(o.value)) return false;
    seen.add(o.value);
    return true;
  });

  return out.length ? out : undefined;
}

function inferType(f: any): ProgramQuestion["type"] {
  const t = (f.type || f.inputType || f.widget || f.control || f.tagName || "").toLowerCase();
  if (t.includes("select") || (Array.isArray(f.options) && f.options.length)) return "select";
  if (t.includes("radio")) return "radio";
  if (t.includes("checkbox")) return "checkbox";
  if (t.includes("textarea")) return "textarea";
  if (t.includes("number")) return "number";
  if (t.includes("date")) return "date";
  return "text";
}

function shouldSkip(f: DiscoveredField): boolean {
  const id = (f.id || "").toLowerCase();
  const label = (f.label || "").toLowerCase();
  // Filter out honeypots, hidden participant controls, coupon/captcha, etc.
  if (id.startsWith("anon_")) return true;
  if (/participant/.test(id) || /participant/.test(label)) return true;
  if (/captcha|coupon|discount|code/.test(id + " " + label)) return true;
  if ((f as any).hidden === true || (f as any).visible === false) return true;
  return false;
}

export function mapFieldsToProgramQuestions(fields: DiscoveredField[]): ProgramQuestion[] {
  return fields
    .filter(f => !shouldSkip(f))
    .map(f => {
      const type = inferType(f);
      const options = normalizeOptions((f as any).options);
      return {
        id: f.id,
        label: f.label ? normText(f.label) : f.id,
        type,
        required: !!f.required,
        options,
        description: (f as any).description,
        dependsOn: (f as any).visibleWhen?.dependsOn,
        showWhen: (f as any).visibleWhen?.value,
      };
    })
    // Only keep real questions: select/radio/checkbox/textarea/date/number or
    // text fields that are explicitly required with no prefilled value.
    .filter(q =>
      q.type !== "text"
        ? true
        : q.required === true
    );
}
