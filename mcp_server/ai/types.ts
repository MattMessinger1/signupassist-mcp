/**
 * Shared type definitions for orchestrators
 */

export interface ButtonSpec {
  label: string;
  action: string;
  payload?: any;
  variant?: "accent" | "secondary" | "ghost";
}

export interface CardSpec {
  title: string;
  subtitle?: string;
  caption?: string;
  body?: string;
  actions?: ButtonSpec[];
}

export interface OrchestratorResponse {
  message: string;
  cards?: CardSpec[];
  cta?: {
    buttons: ButtonSpec[];
  };
  metadata?: any;
}
