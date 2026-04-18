import type { IncomingMessage, ServerResponse } from "node:http";

export interface HeaderMap {
  [header: string]: string;
}

function splitOrigins(value: string | undefined) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function configuredCorsOrigins(env: NodeJS.ProcessEnv = process.env) {
  return splitOrigins(
    env.CORS_ALLOW_ORIGINS ||
      env.CORS_ALLOWED_ORIGINS ||
      env.WEB_APP_ALLOWED_ORIGINS ||
      env.PUBLIC_WEB_ORIGIN,
  );
}

export function resolveCorsAllowOrigin(
  requestOrigin?: string | null,
  env: NodeJS.ProcessEnv = process.env,
) {
  const allowed = configuredCorsOrigins(env);
  if (allowed.length === 0 || allowed.includes("*")) return "*";
  if (requestOrigin && allowed.includes(requestOrigin)) return requestOrigin;
  return "null";
}

export function corsHeadersForRequest(
  req: IncomingMessage,
  env: NodeJS.ProcessEnv = process.env,
): HeaderMap {
  const rawOrigin = req.headers.origin;
  const requestOrigin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
  const allowOrigin = resolveCorsAllowOrigin(requestOrigin, env);
  const headers: HeaderMap = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Cache-Control": "no-store",
  };

  if (allowOrigin !== "*") {
    headers.Vary = "Origin";
  }

  return headers;
}

export const BASIC_SECURITY_HEADERS: HeaderMap = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
};

export function writeJson(
  req: IncomingMessage,
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
  extraHeaders: HeaderMap = {},
) {
  res.writeHead(statusCode, {
    ...BASIC_SECURITY_HEADERS,
    ...corsHeadersForRequest(req),
    ...extraHeaders,
    "Content-Type": "application/json",
  });
  res.end(JSON.stringify(payload));
}
