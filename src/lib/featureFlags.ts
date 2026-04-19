export function envBool(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === "true";
}

export function isAdminSurfaceEnabled(): boolean {
  return envBool(import.meta.env.VITE_ADMIN_CONSOLE_ENABLED);
}

export function isTestRoutesEnabled(): boolean {
  return import.meta.env.DEV || envBool(import.meta.env.VITE_ENABLE_TEST_ROUTES);
}
