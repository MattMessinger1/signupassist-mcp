export type EnvTarget =
  | "local"
  | "frontend"
  | "railway-web"
  | "railway-worker"
  | "supabase-functions"
  | "smoke"
  | "github-actions";

export type EnvRequirement = "required" | "recommended" | "optional";

export type EnvDefinition = {
  name: string;
  category: string;
  description: string;
  secret?: boolean;
  example?: string;
  defaultValue?: string;
  aliases?: string[];
  targets: Partial<Record<EnvTarget, EnvRequirement>>;
  notes?: string[];
  includeInExample?: boolean;
};

export const ENV_TARGET_LABELS: Record<EnvTarget, string> = {
  local: "Local development",
  frontend: "Frontend build",
  "railway-web": "Railway web service",
  "railway-worker": "Railway scheduled worker",
  "supabase-functions": "Supabase Edge Functions",
  smoke: "Local smoke scripts",
  "github-actions": "GitHub Actions",
};

export const ENV_DEFINITIONS: EnvDefinition[] = [
  {
    name: "VITE_MCP_BASE_URL",
    category: "Frontend MCP",
    description: "Public MCP server base URL used by the Vite app and chat harness.",
    example: "https://your-web-service.up.railway.app",
    targets: { local: "recommended", frontend: "required" },
  },
  {
    name: "VITE_ENABLE_TEST_ROUTES",
    category: "Frontend MCP",
    description: "Enables local/dev-only chat and MCP test harness routes. Keep unset in production.",
    example: "false",
    targets: { local: "optional", frontend: "optional" },
    notes: [
      "Do not expose MCP bearer tokens through VITE_* env vars.",
      "When test routes are deliberately enabled, the chat harness reads a temporary token from browser localStorage.",
    ],
  },
  {
    name: "MCP_SERVER_URL",
    category: "MCP runtime",
    description: "Server-to-server MCP base URL for orchestrator calls, Supabase functions, and smoke scripts.",
    example: "https://your-web-service.up.railway.app",
    targets: { local: "recommended", "railway-web": "recommended", "supabase-functions": "required", smoke: "recommended" },
  },
  {
    name: "MCP_ACCESS_TOKEN",
    category: "MCP runtime",
    description: "Bearer token accepted by protected MCP endpoints and used by smoke scripts.",
    secret: true,
    example: "your-mcp-access-token",
    targets: { local: "recommended", "railway-web": "required", "supabase-functions": "recommended", smoke: "recommended" },
  },
  {
    name: "SUPABASE_URL",
    category: "Supabase",
    description: "Supabase project URL.",
    example: "https://your-project.supabase.co",
    aliases: ["SB_URL"],
    targets: {
      local: "required",
      "railway-web": "required",
      "railway-worker": "required",
      "supabase-functions": "required",
      smoke: "required",
    },
  },
  {
    name: "SUPABASE_ANON_KEY",
    category: "Supabase",
    description: "Supabase anon key for public client and Edge Function user-token verification.",
    secret: true,
    example: "your-supabase-anon-key",
    targets: { local: "recommended", "supabase-functions": "required", smoke: "recommended" },
  },
  {
    name: "SUPABASE_PUBLISHABLE_KEY",
    category: "Supabase",
    description: "Supabase publishable key alias used by some Edge Function diagnostics.",
    secret: true,
    example: "your-supabase-publishable-key",
    targets: { "supabase-functions": "optional" },
    includeInExample: false,
  },
  {
    name: "VITE_SUPABASE_URL",
    category: "Supabase",
    description: "Supabase project URL exposed to the Vite frontend.",
    example: "https://your-project.supabase.co",
    targets: { local: "required", frontend: "required" },
  },
  {
    name: "VITE_SUPABASE_PUBLISHABLE_KEY",
    category: "Supabase",
    description: "Supabase publishable key exposed to the Vite frontend.",
    secret: true,
    example: "your-supabase-publishable-key",
    targets: { local: "required", frontend: "required" },
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    category: "Supabase",
    description: "Supabase service role key for server, worker, and privileged Edge Function work.",
    secret: true,
    example: "your-supabase-service-role-key",
    aliases: ["SERVICE_ROLE_KEY", "SB_SERVICE_ROLE_KEY"],
    targets: {
      local: "required",
      "railway-web": "required",
      "railway-worker": "required",
      "supabase-functions": "required",
      smoke: "required",
    },
    notes: ["Never expose this in Vite/client-side variables."],
  },
  {
    name: "SUPABASE_SMOKE_FUNCTIONS",
    category: "Supabase",
    description: "Comma-separated public Edge Functions checked by the Supabase smoke script.",
    example: "get-user-location",
    defaultValue: "get-user-location",
    targets: { smoke: "optional" },
  },
  {
    name: "STRIPE_SECRET_KEY",
    category: "Billing",
    description: "Stripe secret key for success-fee and autopilot subscription Edge Functions.",
    secret: true,
    example: "sk_test_your_key_here",
    targets: { local: "recommended", "supabase-functions": "required", smoke: "required" },
  },
  {
    name: "STRIPE_WEBHOOK_SECRET",
    category: "Billing",
    description: "Stripe webhook signing secret for subscription status updates.",
    secret: true,
    example: "whsec_your_webhook_secret_here",
    targets: { "supabase-functions": "required", smoke: "recommended" },
  },
  {
    name: "STRIPE_AUTOPILOT_PRICE_ID",
    category: "Billing",
    description: "Optional Stripe Price ID for the $9/month SignupAssist Autopilot plan.",
    example: "price_signupassist_autopilot_monthly",
    targets: { local: "optional", "supabase-functions": "optional", smoke: "optional" },
    notes: ["If omitted, subscription checkout creates inline $9/month price data."],
  },
  {
    name: "PUBLIC_SITE_URL",
    category: "Billing",
    description: "Public app URL used by Stripe subscription checkout redirects.",
    example: "http://localhost:8080",
    targets: { local: "recommended", "supabase-functions": "recommended" },
  },
  {
    name: "SITE_URL",
    category: "Billing",
    description: "Fallback public app URL for Stripe checkout redirects.",
    example: "https://your-site.example",
    targets: { "supabase-functions": "optional" },
    includeInExample: false,
  },
  {
    name: "BOOKEO_API_KEY",
    category: "Providers",
    description: "Bookeo API key for catalog, booking, sync, and scheduled worker flows.",
    secret: true,
    example: "your-bookeo-api-key",
    targets: { local: "recommended", "railway-web": "required", "railway-worker": "required", "supabase-functions": "recommended" },
  },
  {
    name: "BOOKEO_SECRET_KEY",
    category: "Providers",
    description: "Bookeo secret key for catalog, booking, sync, and scheduled worker flows.",
    secret: true,
    example: "your-bookeo-secret-key",
    targets: { local: "recommended", "railway-web": "required", "railway-worker": "required", "supabase-functions": "recommended" },
  },
  {
    name: "ACTIVE_SEARCH_API_V2_KEY",
    category: "Providers",
    description: "Active Network search API key for ActiveNet provider sync/search.",
    secret: true,
    example: "your-active-search-api-v2-key",
    targets: { local: "optional", "railway-web": "optional", "supabase-functions": "optional" },
  },
  {
    name: "ACTIVENET_API_KEY_US",
    category: "Providers",
    description: "ActiveNet US API key.",
    secret: true,
    example: "your-activenet-us-key",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "ACTIVENET_SECRET_US",
    category: "Providers",
    description: "ActiveNet US secret.",
    secret: true,
    example: "your-activenet-us-secret",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "ACTIVENET_API_KEY_CA",
    category: "Providers",
    description: "ActiveNet Canada API key.",
    secret: true,
    example: "your-activenet-ca-key",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "ACTIVENET_SECRET_CA",
    category: "Providers",
    description: "ActiveNet Canada secret.",
    secret: true,
    example: "your-activenet-ca-secret",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "GOOGLE_PLACES_API_KEY",
    category: "Providers",
    description: "Google Places key for provider search fallback.",
    secret: true,
    example: "your-google-api-key",
    targets: { local: "optional", "railway-web": "optional", "supabase-functions": "optional" },
  },
  {
    name: "IPAPI_KEY",
    category: "Providers",
    description: "IP geolocation key for get-user-location fallback.",
    secret: true,
    example: "your-ipapi-key",
    targets: { "railway-web": "optional", "supabase-functions": "optional" },
  },
  {
    name: "PROVIDER_EXCLUDE_KEYWORDS",
    category: "Providers",
    description: "Comma-separated provider search denylist keywords.",
    example: "adult,casino",
    targets: { local: "optional", "railway-web": "optional" },
    includeInExample: false,
  },
  {
    name: "OPENAI_API_KEY",
    category: "AI",
    description: "OpenAI API key for orchestration and extraction.",
    secret: true,
    example: "sk-your-openai-key",
    targets: { local: "recommended", "railway-web": "required", "supabase-functions": "optional", "github-actions": "optional" },
  },
  {
    name: "OPENAI_MODEL",
    category: "AI",
    description: "Default OpenAI model for orchestration.",
    example: "gpt-4o",
    defaultValue: "gpt-4o",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "OPENAI_TEMPERATURE",
    category: "AI",
    description: "Default OpenAI temperature for orchestration.",
    example: "0.3",
    defaultValue: "0.3",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "OPENAI_MODEL_PROGRAM_VISION",
    category: "AI",
    description: "Vision model for program extraction.",
    example: "gpt-5-vision-preview",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "OPENAI_MODEL_PROGRAM_EXTRACTOR",
    category: "AI",
    description: "Extractor model for program extraction.",
    example: "gpt-5.1",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "OPENAI_MODEL_PROGRAM_VALIDATOR",
    category: "AI",
    description: "Validator model for program extraction.",
    example: "gpt-5.1-mini",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "OPENAI_MODEL_ACTIVITY_FINDER",
    category: "AI",
    description: "Model used to parse parent Activity Finder searches.",
    example: "gpt-4o-mini",
    defaultValue: "gpt-4o-mini",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "OPENAI_VERIFICATION_TOKEN",
    category: "AI",
    description: "Token served for OpenAI ChatGPT App submission verification.",
    secret: true,
    example: "your-openai-verification-token",
    targets: { "railway-web": "recommended" },
  },
  {
    name: "RUN_OPENAI_SMOKE_TESTS",
    category: "AI",
    description: "Run OpenAI smoke tests during server startup.",
    example: "false",
    defaultValue: "false",
    targets: { "railway-web": "optional", "github-actions": "optional" },
  },
  {
    name: "AI_PROVIDER",
    category: "AI",
    description: "AI provider selector.",
    example: "openai",
    defaultValue: "openai",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "ANTHROPIC_API_KEY",
    category: "AI",
    description: "Anthropic API key when AI_PROVIDER=claude.",
    secret: true,
    example: "your-anthropic-key",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "CLAUDE_MODEL",
    category: "AI",
    description: "Claude text model when AI_PROVIDER=claude.",
    example: "claude-sonnet-4-6",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "CLAUDE_MODEL_VISION",
    category: "AI",
    description: "Claude vision model when AI_PROVIDER=claude.",
    example: "claude-sonnet-4-6",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "AUTH0_DOMAIN",
    category: "Auth",
    description: "Auth0 tenant domain for OAuth.",
    example: "your-tenant.us.auth0.com",
    targets: { local: "recommended", "railway-web": "required" },
  },
  {
    name: "AUTH0_CLIENT_ID",
    category: "Auth",
    description: "Auth0 application client ID.",
    example: "your-auth0-client-id",
    targets: { local: "recommended", "railway-web": "required" },
  },
  {
    name: "AUTH0_CLIENT_SECRET",
    category: "Auth",
    description: "Auth0 application client secret.",
    secret: true,
    example: "your-auth0-client-secret",
    targets: { local: "recommended", "railway-web": "required" },
  },
  {
    name: "AUTH0_AUDIENCE",
    category: "Auth",
    description: "Auth0 API audience.",
    example: "https://shipworx.ai/api",
    targets: { local: "recommended", "railway-web": "required" },
  },
  {
    name: "AUTH0_OAUTH_PROMPT",
    category: "Auth",
    description: "OAuth prompt behavior for account switching.",
    example: "login",
    defaultValue: "login",
    targets: { "railway-web": "optional" },
  },
  {
    name: "OAUTH_DEFAULT_REDIRECT_URI",
    category: "Auth",
    description: "Override OAuth callback URL used in metadata/authorize flows.",
    example: "https://oauth.openai.com/v1/callback",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "MANDATE_SIGNING_KEY",
    category: "Mandates and PII",
    description: "Base64 signing key for mandate issuance and verification.",
    secret: true,
    example: "base64-32-byte-signing-key",
    aliases: ["MANDATE_SIGNING_SECRET"],
    targets: { local: "recommended", "railway-web": "recommended", "supabase-functions": "required" },
  },
  {
    name: "DEV_MANDATE_JWS",
    category: "Mandates and PII",
    description: "Development-only mandate JWS used by local/test flows.",
    secret: true,
    example: "dev-mandate-jws",
    targets: { local: "optional" },
  },
  {
    name: "MANDATE_JWS_DEV",
    category: "Mandates and PII",
    description: "Legacy development mandate JWS alias.",
    secret: true,
    example: "dev-mandate-jws",
    targets: { local: "optional" },
    includeInExample: false,
  },
  {
    name: "MANDATE_OPTIONAL",
    category: "Mandates and PII",
    description: "Development-only bypass for mandate verification.",
    example: "false",
    defaultValue: "false",
    targets: { local: "optional" },
  },
  {
    name: "PII_ENCRYPTION_KEY",
    category: "Mandates and PII",
    description: "Base64 AES-256-GCM key for encrypted PII envelopes.",
    secret: true,
    example: "base64-32-byte-encryption-key",
    targets: { local: "recommended", "railway-web": "recommended" },
  },
  {
    name: "PII_ENCRYPTION_KEY_ID",
    category: "Mandates and PII",
    description: "Key identifier stored in encrypted PII envelopes.",
    example: "v1",
    defaultValue: "v1",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "PII_ENCRYPTION_KEYRING_JSON",
    category: "Mandates and PII",
    description: "JSON map of historical PII encryption keys for rotation.",
    secret: true,
    example: "{}",
    defaultValue: "{}",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "CRED_SEAL_KEY",
    category: "Mandates and PII",
    description: "Credential sealing key used by signup job Edge Functions.",
    secret: true,
    example: "your-credential-seal-key",
    targets: { "supabase-functions": "optional", "github-actions": "optional" },
  },
  {
    name: "SYSTEM_USER_PASSWORD",
    category: "Mandates and PII",
    description: "Setup password for the internal system user Edge Function.",
    secret: true,
    example: "use-a-strong-generated-password",
    targets: { "supabase-functions": "optional" },
  },
  {
    name: "SCHEDULED_WORKER_MAX_ATTEMPT_MS",
    category: "Worker",
    description: "Max time the scheduled worker rapid-retries near open time.",
    example: "120000",
    defaultValue: "120000",
    targets: { "railway-worker": "optional" },
  },
  {
    name: "RAILWAY_MCP_URL",
    category: "Smoke",
    description: "Railway web service URL for health smoke checks.",
    example: "https://your-web-service.up.railway.app",
    targets: { smoke: "recommended" },
  },
  {
    name: "RAILWAY_WORKER_URL",
    category: "Smoke",
    description: "Railway worker service URL for health smoke checks when public/accessible.",
    example: "https://your-worker-service.up.railway.app",
    aliases: ["WORKER_HEALTH_URL"],
    targets: { smoke: "optional" },
  },
  {
    name: "RAILWAY_WORKER_HEALTH_REQUIRED",
    category: "Smoke",
    description: "Fail Railway smoke if worker health URL is missing.",
    example: "false",
    defaultValue: "false",
    targets: { smoke: "optional" },
  },
  {
    name: "WORKER_URL",
    category: "Worker",
    description: "Worker URL used by refresh-feed Edge Function.",
    example: "https://your-worker-service.up.railway.app",
    targets: { "supabase-functions": "optional" },
  },
  {
    name: "WORKER_SERVICE_TOKEN",
    category: "Worker",
    description: "Token used by Edge Functions to call worker-only routes.",
    secret: true,
    example: "your-worker-service-token",
    targets: { "supabase-functions": "optional" },
  },
  {
    name: "E2E_USER_ID",
    category: "Smoke",
    description: "Test user ID for scheduled registration smoke scripts.",
    example: "00000000-0000-0000-0000-000000000000",
    targets: { smoke: "optional" },
  },
  {
    name: "E2E_EXECUTE",
    category: "Smoke",
    description: "Explicit opt-in for real worker execution smoke.",
    example: "0",
    defaultValue: "0",
    targets: { smoke: "optional" },
  },
  {
    name: "E2E_DUE_IN_MINUTES",
    category: "Smoke",
    description: "Minutes until a test scheduled registration is due.",
    example: "2",
    defaultValue: "2",
    targets: { smoke: "optional" },
  },
  {
    name: "V1_WATCH_POLL_MS",
    category: "Smoke",
    description: "Polling interval for v1 watch scripts.",
    example: "1000",
    defaultValue: "1000",
    targets: { smoke: "optional" },
  },
  {
    name: "V1_WATCH_TIMEOUT_MS",
    category: "Smoke",
    description: "Timeout for v1 watch scripts.",
    example: "600000",
    defaultValue: "600000",
    targets: { smoke: "optional" },
  },
  {
    name: "WORKER_E2E_RECEIPTS_POLL_MS",
    category: "Smoke",
    description: "Receipt polling interval for worker E2E smoke.",
    example: "5000",
    defaultValue: "5000",
    targets: { smoke: "optional" },
  },
  {
    name: "WORKER_E2E_RECEIPTS_TIMEOUT_MS",
    category: "Smoke",
    description: "Receipt polling timeout for worker E2E smoke.",
    example: "600000",
    defaultValue: "600000",
    targets: { smoke: "optional" },
  },
  {
    name: "ADMIN_API_ENABLED",
    category: "Admin and observability",
    description: "Enable /admin/api/* endpoints on the MCP server.",
    example: "false",
    defaultValue: "false",
    targets: { "railway-web": "optional" },
  },
  {
    name: "ADMIN_EMAIL_ALLOWLIST",
    category: "Admin and observability",
    description: "Comma-separated admin email allowlist.",
    secret: true,
    example: "you@example.com",
    targets: { "railway-web": "optional" },
  },
  {
    name: "ADMIN_METRICS_SAMPLE_LIMIT",
    category: "Admin and observability",
    description: "Recent audit events sampled by admin metrics.",
    example: "5000",
    defaultValue: "5000",
    targets: { "railway-web": "optional" },
  },
  {
    name: "VITE_ADMIN_CONSOLE_ENABLED",
    category: "Admin and observability",
    description: "Enable /admin route in the frontend.",
    example: "false",
    defaultValue: "false",
    targets: { frontend: "optional" },
  },
  {
    name: "VITE_ADMIN_API_BASE_URL",
    category: "Admin and observability",
    description: "Base URL for the admin API.",
    example: "https://your-web-service.up.railway.app",
    targets: { frontend: "optional" },
  },
  {
    name: "VITE_POSTHOG_PROJECT_URL",
    category: "Admin and observability",
    description: "PostHog project link shown in the admin UI.",
    example: "https://app.posthog.com/project/123",
    targets: { frontend: "optional" },
  },
  {
    name: "VITE_SENTRY_PROJECT_URL",
    category: "Admin and observability",
    description: "Sentry project link shown in the admin UI.",
    example: "https://sentry.io/organizations/example/projects/signupassist",
    targets: { frontend: "optional" },
  },
  {
    name: "POSTHOG_API_KEY",
    category: "Admin and observability",
    description: "PostHog project API key for server-side capture.",
    secret: true,
    example: "phc_your_key",
    targets: { "railway-web": "optional" },
  },
  {
    name: "POSTHOG_HOST",
    category: "Admin and observability",
    description: "PostHog host.",
    example: "https://app.posthog.com",
    defaultValue: "https://app.posthog.com",
    targets: { "railway-web": "optional" },
  },
  {
    name: "POSTHOG_TIMEOUT_MS",
    category: "Admin and observability",
    description: "PostHog network timeout.",
    example: "1200",
    defaultValue: "1200",
    targets: { "railway-web": "optional" },
  },
  {
    name: "SENTRY_DSN",
    category: "Admin and observability",
    description: "Optional Sentry DSN.",
    secret: true,
    example: "https://public@sentry.example/1",
    targets: { "railway-web": "optional", frontend: "optional" },
  },
  {
    name: "DEBUG_LOGGING",
    category: "Debug",
    description: "Enable scoped debug logging.",
    example: "false",
    defaultValue: "false",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "DEBUG_MCP_REFRESH",
    category: "Debug",
    description: "Enable MCP refresh debugging.",
    example: "false",
    defaultValue: "false",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "DEBUG_USER_ID",
    category: "Debug",
    description: "Scope debug logging to a single user ID.",
    example: "00000000-0000-0000-0000-000000000000",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "DEBUG_SESSION_ID",
    category: "Debug",
    description: "Scope debug logging to a single session ID.",
    example: "debug-session-id",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "EXPOSE_TELEMETRY_DEBUG",
    category: "Debug",
    description: "Expose debug telemetry endpoint.",
    example: "false",
    defaultValue: "false",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "EXPOSE_TELEMETRY_DEBUG_TOKEN",
    category: "Debug",
    description: "Token required for debug telemetry access.",
    secret: true,
    example: "your-debug-token",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "LOG_LEVEL",
    category: "Debug",
    description: "Logger verbosity.",
    example: "info",
    defaultValue: "info",
    targets: { local: "optional", "railway-web": "optional", "railway-worker": "optional" },
  },
  {
    name: "RATE_LIMIT_ENABLED",
    category: "Runtime limits",
    description: "Enable MCP HTTP rate limiting.",
    example: "true",
    defaultValue: "true in production",
    targets: { "railway-web": "optional" },
  },
  {
    name: "RATE_LIMIT_WINDOW_MS",
    category: "Runtime limits",
    description: "Rate-limit window in milliseconds.",
    example: "60000",
    defaultValue: "60000",
    targets: { "railway-web": "optional" },
  },
  {
    name: "RATE_LIMIT_TOOLS_MAX",
    category: "Runtime limits",
    description: "Max tool calls per rate-limit window.",
    example: "240",
    defaultValue: "240",
    targets: { "railway-web": "optional" },
  },
  {
    name: "RATE_LIMIT_MESSAGES_MAX",
    category: "Runtime limits",
    description: "Max messages per rate-limit window.",
    example: "600",
    defaultValue: "600",
    targets: { "railway-web": "optional" },
  },
  {
    name: "RATE_LIMIT_SSE_MAX",
    category: "Runtime limits",
    description: "Max SSE requests per rate-limit window.",
    example: "240",
    defaultValue: "240",
    targets: { "railway-web": "optional" },
  },
  {
    name: "RATE_LIMIT_OAUTH_TOKEN_MAX",
    category: "Runtime limits",
    description: "Max OAuth token requests per rate-limit window.",
    example: "2000",
    defaultValue: "2000",
    targets: { "railway-web": "optional" },
  },
  {
    name: "SSE_MAX_ACTIVE",
    category: "Runtime limits",
    description: "Concurrent SSE stream cap per token/IP.",
    example: "5",
    defaultValue: "5",
    targets: { "railway-web": "optional" },
  },
  {
    name: "MAX_TOOLS_CALL_BODY_BYTES",
    category: "Runtime limits",
    description: "Max /tools/call request body size.",
    example: "262144",
    defaultValue: "262144",
    targets: { "railway-web": "optional" },
  },
  {
    name: "MAX_MESSAGES_BODY_BYTES",
    category: "Runtime limits",
    description: "Max /messages request body size.",
    example: "262144",
    defaultValue: "262144",
    targets: { "railway-web": "optional" },
  },
  {
    name: "MAX_OAUTH_TOKEN_BODY_BYTES",
    category: "Runtime limits",
    description: "Max OAuth token request body size.",
    example: "65536",
    defaultValue: "65536",
    targets: { "railway-web": "optional" },
  },
  {
    name: "FEATURE_INTENT_UPFRONT",
    category: "Feature flags",
    description: "Enable up-front intent parsing.",
    example: "true",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "FEATURE_PARALLEL_EXTRACT",
    category: "Feature flags",
    description: "Enable parallel program extraction.",
    example: "true",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "FEATURE_SINGLE_PASS",
    category: "Feature flags",
    description: "Enable single-pass program extraction.",
    example: "false",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "FEATURE_SCHEDULE_FILTER",
    category: "Feature flags",
    description: "Enable schedule preference filtering.",
    example: "true",
    defaultValue: "true",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "USE_API_ORCHESTRATOR",
    category: "Feature flags",
    description: "Use APIOrchestrator runtime path.",
    example: "true",
    defaultValue: "true",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "USE_REAL_MCP",
    category: "Feature flags",
    description: "Call the real MCP server from orchestration code.",
    example: "false",
    defaultValue: "false",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "USE_NEW_AAP",
    category: "Feature flags",
    description: "Enable the newer AAP narrowing system.",
    example: "false",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "WIDGET_ENABLED",
    category: "Feature flags",
    description: "Enable legacy widget rendering if ever reintroduced.",
    example: "false",
    defaultValue: "false",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "VITE_DISCOVERY_V2_ENABLED",
    category: "Feature flags",
    description: "Enable discovery v2 frontend behavior.",
    example: "true",
    defaultValue: "true",
    targets: { local: "optional", frontend: "optional" },
  },
  {
    name: "VITE_DISCOVERY_MAX_STAGE_SECONDS",
    category: "Feature flags",
    description: "Frontend discovery stage timeout.",
    example: "60",
    defaultValue: "60",
    targets: { local: "optional", frontend: "optional" },
  },
  {
    name: "VGS_PROXY_ENABLED",
    category: "VGS",
    description: "Enable VGS proxying for tokenization/detokenization.",
    example: "false",
    defaultValue: "false",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "VGS_VAULT_ID",
    category: "VGS",
    description: "VGS vault identifier.",
    secret: true,
    example: "tntxxxxxxxx",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "VGS_PROXY_HOST",
    category: "VGS",
    description: "VGS proxy URL.",
    example: "https://tntxxxxxxxx.sandbox.verygoodproxy.com",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "VGS_USERNAME",
    category: "VGS",
    description: "VGS API username.",
    secret: true,
    example: "your-vgs-username",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "VGS_PASSWORD",
    category: "VGS",
    description: "VGS API password.",
    secret: true,
    example: "your-vgs-password",
    targets: { local: "optional", "railway-web": "optional" },
  },
  {
    name: "PORT",
    category: "Railway runtime",
    description: "HTTP port assigned by Railway or used for local worker health.",
    example: "8080",
    targets: { local: "optional", "railway-web": "optional", "railway-worker": "optional" },
    includeInExample: false,
  },
  {
    name: "NODE_ENV",
    category: "Railway runtime",
    description: "Node runtime environment.",
    example: "production",
    targets: { local: "optional", "railway-web": "optional", "railway-worker": "optional", "github-actions": "optional" },
    includeInExample: false,
  },
  {
    name: "RAILWAY_PUBLIC_DOMAIN",
    category: "Railway runtime",
    description: "Railway-provided public domain, used to compute base URLs.",
    example: "your-web-service.up.railway.app",
    targets: { "railway-web": "recommended" },
  },
  {
    name: "RAILWAY_AUTO_DEPLOY",
    category: "Railway runtime",
    description: "Optional deploy-mode flag used by Railway docs/scripts.",
    example: "true",
    targets: { "railway-web": "optional", "railway-worker": "optional" },
  },
  {
    name: "RAILWAY_PROJECT_ID",
    category: "Railway runtime",
    description: "Railway project ID used by GitHub deploy webhook and runtime detection.",
    secret: true,
    example: "your-railway-project-id",
    targets: { "github-actions": "optional" },
    includeInExample: false,
  },
  {
    name: "RAILWAY_TOKEN",
    category: "Railway runtime",
    description: "Railway API token used by GitHub deploy workflow.",
    secret: true,
    example: "your-railway-token",
    targets: { "github-actions": "optional" },
    includeInExample: false,
  },
  {
    name: "APP_VERSION",
    category: "Railway runtime",
    description: "Optional app version override for health/ping responses.",
    example: "2.4.0",
    targets: { "railway-web": "optional" },
    includeInExample: false,
  },
  {
    name: "APP_BUILD_ID",
    category: "Railway runtime",
    description: "Optional build ID override for health/ping responses.",
    example: "2026-04-15T00:00:00Z",
    targets: { "railway-web": "optional" },
    includeInExample: false,
  },
];

export type EnvStatus = EnvDefinition & {
  requirement: EnvRequirement;
  configuredName?: string;
  configuredValue?: string;
  missing: boolean;
};

export function getEnvDefinition(name: string): EnvDefinition | undefined {
  return ENV_DEFINITIONS.find((definition) => definition.name === name);
}

export function getEnvDefinitionsForTarget(
  target: EnvTarget,
  options: { includeOptional?: boolean } = {},
): Array<EnvDefinition & { requirement: EnvRequirement }> {
  return ENV_DEFINITIONS.flatMap((definition) => {
    const requirement = definition.targets[target];
    if (!requirement) return [];
    if (requirement === "optional" && !options.includeOptional) return [];
    return [{ ...definition, requirement }];
  });
}

export function resolveEnvValue(
  definition: EnvDefinition,
  env: Record<string, string | undefined> = process.env,
): { name?: string; value?: string } {
  const names = [definition.name, ...(definition.aliases || [])];
  for (const name of names) {
    const value = env[name];
    if (value != null && String(value).trim() !== "") {
      return { name, value };
    }
  }
  return {};
}

export function getEnvStatusForTarget(
  target: EnvTarget,
  env: Record<string, string | undefined> = process.env,
  options: { includeOptional?: boolean } = {},
): EnvStatus[] {
  return getEnvDefinitionsForTarget(target, options).map((definition) => {
    const resolved = resolveEnvValue(definition, env);
    return {
      ...definition,
      configuredName: resolved.name,
      configuredValue: resolved.value,
      missing: !resolved.value,
    };
  });
}

export function getMissingEnvForTarget(
  target: EnvTarget,
  env: Record<string, string | undefined> = process.env,
  options: { includeRecommended?: boolean } = {},
): EnvStatus[] {
  return getEnvStatusForTarget(target, env, { includeOptional: false }).filter((status) => {
    if (!status.missing) return false;
    if (status.requirement === "required") return true;
    return options.includeRecommended && status.requirement === "recommended";
  });
}

export function maskEnvValue(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function quoteDotenvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]*$/.test(value)) return value;
  return JSON.stringify(value);
}

export function renderDotenvTemplate(options: {
  target?: EnvTarget;
  env?: Record<string, string | undefined>;
  includeOptional?: boolean;
  includeValues?: boolean;
  includeMissingComments?: boolean;
} = {}): string {
  const definitions = options.target
    ? getEnvDefinitionsForTarget(options.target, { includeOptional: options.includeOptional })
    : ENV_DEFINITIONS.filter((definition) => definition.includeInExample !== false).map((definition) => ({
        ...definition,
        requirement: "optional" as EnvRequirement,
      }));
  const env = options.env || process.env;
  const lines: string[] = options.target
    ? [
        `# SignupAssist environment for ${ENV_TARGET_LABELS[options.target]}`,
        "# Generated from scripts/envRegistry.ts.",
        "# This file may contain secrets when generated with env:write; .env.* files are ignored by git.",
        "",
      ]
    : [
        "# SignupAssist environment template",
        "# Source of truth: scripts/envRegistry.ts",
        "# Generate target-specific ignored files with:",
        "#   npm run env:write -- --target=railway-web --out=.env.railway-web.generated",
        "#   npm run env:write -- --target=railway-worker --out=.env.railway-worker.generated",
        "#   npm run env:write -- --target=supabase-functions --out=.env.supabase.generated",
        "",
      ];
  let currentCategory = "";

  for (const definition of definitions) {
    if (definition.category !== currentCategory) {
      if (lines.length) lines.push("");
      lines.push(`# ${definition.category}`);
      currentCategory = definition.category;
    }

    if (definition.description) lines.push(`# ${definition.description}`);
    if ("requirement" in definition && options.target) {
      lines.push(`# ${definition.requirement}${definition.secret ? " secret" : ""}`);
    } else if (definition.secret) {
      lines.push("# secret");
    }

    const resolved = resolveEnvValue(definition, env);
    const fallback = definition.example ?? definition.defaultValue ?? "";
    const value = options.includeValues ? resolved.value ?? "" : fallback;

    if (options.includeValues && !resolved.value && options.includeMissingComments) {
      lines.push(`# MISSING ${definition.name}=`);
    } else {
      lines.push(`${definition.name}=${quoteDotenvValue(value)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function renderEnvTable(target: EnvTarget, options: { includeOptional?: boolean } = {}): string {
  const rows = getEnvDefinitionsForTarget(target, options);
  const lines = [`# ${ENV_TARGET_LABELS[target]}`, ""];
  for (const row of rows) {
    const markers = [row.requirement, row.secret ? "secret" : "public"];
    if (row.defaultValue) markers.push(`default: ${row.defaultValue}`);
    lines.push(`- ${row.name} (${markers.join(", ")}): ${row.description}`);
  }
  return `${lines.join("\n")}\n`;
}
