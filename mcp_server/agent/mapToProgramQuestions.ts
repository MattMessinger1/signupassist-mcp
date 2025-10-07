import type { DiscoveredField } from './htmlToJsonSchema.js';

export interface ProgramQuestion {
  id: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "radio" | "checkbox" | "textarea";
  required: boolean;
  options?: string[];
  description?: string;
  dependsOn?: string;
  showWhen?: any;
}

export function mapFieldsToProgramQuestions(fields: DiscoveredField[]): ProgramQuestion[] {
  return fields.map(f => ({
    id: f.id,
    label: f.label || f.id,
    type: (f.type as any) ?? "text",
    required: !!f.required,
    options: f.options?.map(o => o.value),
    dependsOn: f.visibleWhen?.dependsOn,
    showWhen: f.visibleWhen?.value,
  }));
}
