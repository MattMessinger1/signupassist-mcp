SignupAssist MCP

SignupAssist MCP (Model Context Protocol) is an AI-driven assistant for finding and completing activity registrations in a safe, conversational way. It is focused on enrollment workflows and does not provide adult, dating, or NSFW services. **Production flows use provider HTTP APIs (Bookeo)** for catalog sync, form discovery, and booking—under explicit user mandates, audit logging, and scope checks. Built to integrate with ChatGPT’s conversational interface, SignupAssist emphasizes clarity, authorization, and security.

Design Principles (ChatGPT-Native UX & Safety)

Chat-Native Flow: All interactions occur through a natural back-and-forth chat. The assistant first explains or asks questions, then presents information or options in a card, and finally awaits the user’s confirmation before proceeding. This conversational pattern (explain → card → confirm) keeps the experience intuitive and avoids disruptive modals or external popups, aligning with ChatGPT’s guidelines for conversational apps.

SDK Component Purity: The UI uses only ChatGPT’s built-in interface components – such as message bubbles, cards/carousels for options, short forms for inputs, confirmation dialogs, and status chips – with no external web views or custom dialogs. By sticking to the ChatGPT SDK’s native elements, the app remains fully accessible, responsive, and compliant with ChatGPT App Store requirements.

Explicit Confirmations for “Writes”: Before performing any irreversible action (like scheduling a registration or charging a payment), the assistant always shows a confirmation card summarizing the action and requires the user to confirm explicitly. This guarantee of “no surprise actions” is mandated for safety – the user must clearly consent to any external effect such as submitting a form or making a payment.

User-Friendly Tone & Secure Messaging: The assistant communicates in a friendly, reassuring tone that’s mindful of busy users (concise, helpful, and non-technical). At every important step, it emphasizes security – for example, reminding users that their credentials and payment details stay safe with the trusted provider or Stripe, and that SignupAssist never stores sensitive card numbers. These assurances help build trust and meet privacy and compliance standards.

Audit Trail & “Responsible Delegate” Transparency: SignupAssist operates under a responsible-delegation model. It only acts with the parent’s explicit consent and logs every action it takes on the user’s behalf. This audit trail means any login, form fill, or submission is recorded with time stamps and details, so users (and reviewers) can trace exactly what the assistant did. This transparency is core to the app’s ethos and is surfaced to the user with gentle reminders that “all actions are logged for your review”.

Consistent Visual Rhythm & Hierarchy: Each step in the flow follows the same predictable visual structure for ease of understanding. The pattern is: the assistant’s explanation text, followed by a card (with details, options, or form inputs), and then a clear call-to-action (e.g. a Confirm button). Design elements like button styles and colors are kept uniform (primary actions vs. secondary) to maintain a coherent visual hierarchy across the app. Users quickly recognize the stages of the process, which improves usability and trust.

(These design tenets ensure the app feels like a natural extension of ChatGPT, and they fulfill OpenAI’s review guidelines by prioritizing clarity, consent, and user control.)

Technical Features & Architecture

**API-first providers:** Program catalogs and registration flows integrate through documented HTTP APIs (e.g. **Bookeo** for products, availability, and bookings). Supabase edge functions such as `sync-bookeo` keep `cached_provider_feed` up to date on a schedule.

**Mandate scope enforcement:** Actions are gated by signed mandates (scopes, caps, expiry). The MCP server and edge functions record tool usage for auditability.

**A-A-P narrowing:** The orchestrator narrows by Age, Activity, and Provider early so searches stay focused.

**Caching:** Feed rows and discovery hints are cached to keep chat turns fast; stale data is refreshed via scheduled syncs.

**Telemetry & logging:** Tool calls, sync jobs, and orchestrator steps emit structured logs for debugging and operations.

**Security & data privacy:** Sensitive values live in Supabase/Stripe with least-privilege access; the UI avoids collecting more than needed for the current step.

**Future:** Deeper provider OAuth and verifiable delegation remain on the roadmap as APIs mature.

Getting Started (Development Setup)

To set up the SignupAssist MCP project for development or testing, follow these steps:

Prerequisites: Ensure you have Node.js 20.x and a package manager (npm or yarn) installed on your system
GitHub
. You’ll also need access to a Supabase instance (for the database and edge functions) and API keys for any external services used (detailed below).

Clone the Repository: Clone this repo to your local machine and navigate into the project directory. Then install the NPM dependencies:

git clone https://github.com/YourOrg/signupassist-mcp.git
cd signupassist-mcp
npm install


Configure Environment Variables: Copy or create a .env file in the project root to provide necessary configuration. At minimum, set the following variables with your credentials:

OpenAI API Key: OPENAI_API_KEY (required for the AI Orchestrator’s language model calls)
GitHub

Model Choice: OPENAI_MODEL (optional, defaults to a suitable model like GPT-4)
GitHub

Supabase Connection: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (for database and storage access)
GitHub
. You should have a Supabase project set up; use the URL and the Service Role API key from your instance.

Google Places API Key: GOOGLE_PLACES_API_KEY for location-based provider search fallback
GitHub
. (Enable the Google Places API in Google Cloud and put your key here; this is used if the provider feed doesn’t cover location queries).

Other Keys: If your deployment uses any other services (email/SMS for notifications, Stripe for payments, etc.), provide those keys as needed. For example, STRIPE_API_KEY for payment processing (if applicable), and any OAuth client secrets for provider integrations that support OAuth.

Refer to the Railway Deployment guide or environment docs for a full list of required variables and their descriptions
GitHub
. The above are the primary ones to get started.

Run the Development Server(s): This project involves a backend MCP server and a front-end interface:

Start the MCP Server: This runs the core backend (Node/Express server) that performs the automated tasks. Use:

npm run mcp:server


This will build and launch the MCP server (by default on port 8080). It connects to the database and awaits tool invocation requests.

Start the Frontend (Test Harness): For development, you can run the Vite dev server to use the provided ChatGPT-like test harness UI. In a separate terminal, run:

npm run dev


This will start the local dev server (typically at http://localhost:5173). Open your browser to /chat-test on that server to access the Chat Test Harness interface
GitHub
. The test harness simulates the ChatGPT environment and lets you interact with SignupAssist in a chat UI for debugging. (See docs/CHAT_TEST_HARNESS_USER_GUIDE.md for detailed usage of the harness, demo flows, and troubleshooting.)

Supabase Setup: Deploy the necessary Supabase Edge Functions and database schema:

The repository’s supabase/ directory contains any custom Postgres functions or Edge Functions (such as cred-get for secure credential retrieval and maintenance-discovery for cron maintenance). Follow the instructions in docs/PRODUCTION_BACKEND_SETUP.md and Supabase’s documentation to deploy these. For local dev, you can use the Supabase CLI or connect your app to a remote Supabase project. Ensure that the database tables (e.g., for mandates, audit logs, sessions, etc.) are set up as per the project’s migration files.

Credential Storage: Use the cred-get function or a similar secure mechanism to store and retrieve user credentials (login information for activity providers). This function is called by the MCP server when it needs to log in, so it must be deployed and accessible. It also logs whenever credentials are accessed as part of the audit trail
GitHub
.

Verification: If running locally without a full Supabase setup, you might disable certain features or use the USE_REAL_MCP=false mode (which uses mock data) as described in the docs
GitHub
. However, for full functionality, having the Supabase backend configured is recommended.

Test the Flow: With the server and frontend running and your environment configured, you can simulate a signup conversation. For example, in the chat UI, try “Find AIM Design classes for my 8-year-old” and follow the prompts. The assistant should walk through provider selection, program search, prerequisites, and booking steps as configured. Use the Debug Panel in the test harness to see tool calls and responses in real time
GitHub
GitHub
. This is useful for development and verifying that each step (login, find_programs, check_prerequisites, etc.) is working as expected.

Deployment

When you’re ready to deploy SignupAssist MCP in a production or staging environment, the project supports cloud deployment via containerization or platform-as-a-service:

Docker / Container Deployments: A Dockerfile is provided to build the app into a production container image. It installs dependencies, compiles the TypeScript code, builds the frontend, and then starts the Node server on port 8080. You can use this Dockerfile to deploy on any container-based service or on your own infrastructure. For example:

docker build -t signupassist-mcp:latest .
docker run -p 8080:8080 --env-file .env signupassist-mcp:latest


Ensure your .env or environment variables are configured in the container (including database URL, keys, etc. as described above).

Railway.app (PaaS): The project is set up to deploy easily on Railway (or similar Node hosting platforms). The repository includes a Railway configuration guide. In summary:

Push the code to your repository and connect the Railway project to it. Railway will detect the Node.js project and use the start command specified (it runs npm run build and then npm run mcp:start by default)
GitHub
.

Set the required environment variables in the Railway dashboard (OpenAI keys, Supabase keys, etc.)
GitHub
. This matches what you used locally.

Deploy the Supabase Edge Functions (if you haven’t already) on your Supabase instance and update any endpoints/keys in your environment vars for production. For instance, ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY correspond to your production Supabase project, and that MCP_SERVER_URL (if used by the frontend or other services) points to your Railway app’s URL
GitHub
GitHub
.

Once deployed, you should see the MCP server running. The front-end (if included) will be served from the same server (static files in dist/client). You can then interact with the live app via the ChatGPT interface if this is an official plugin, or via the web UI if exposing it.

ChatGPT App Store Considerations: If deploying as a ChatGPT Plugin or App, make sure to double-check the OpenAI Plugin manifest (if any) and that your OAuth callbacks, endpoints, etc., are correctly configured. The README’s emphasis on confirmations, security, and data handling is intended to ease the approval process. Be prepared to provide OpenAI with testing credentials or a demo account for any review, since they will want to validate the end-to-end flow. (All the design principles like explicit user confirmation before actions, no sensitive data retention, and clear user messaging are crucial for passing the review.)

Maintenance (Discovery Data Upkeep)

Over time, provider data and learned form-hints can become stale. SignupAssist includes an automated maintenance routine for discovery data to keep the system efficient and up-to-date
GitHub
. This routine is implemented as a Supabase Edge Function (named maintenance-discovery) that is triggered on a schedule via the Postgres cron extension:

What it Does: Each maintenance run performs housekeeping on the “discovery learning” system, which is the component that caches form field hints and program discovery results. Specifically, the cron job:

Refreshes “best hints” – Updates the cache of form field hints or provider-specific data extraction hints. (Currently this is a no-op placeholder, meaning the logic is in place but not actively changing hints yet.)
GitHub
 This is designed to accommodate future improvements where the system might learn better form-filling strategies over time.

Prunes old discovery runs – Cleans up stored data from past discovery sessions. It deletes records of discovery runs older than 90 days, keeping at most the last 200 runs per provider/program/stage for reference
GitHub
. This prevents the database from growing indefinitely with old logs and ensures new runs have priority.

Decays stale confidence scores – Reduces the confidence score of hints that haven’t been utilized in the last 45 days by 10%
GitHub
. In other words, if the system inferred a form field mapping hint but hasn’t needed to use it recently, the system gradually lowers its confidence in that hint. This way, if a provider changed their form and the old hint is outdated, it will eventually be treated with caution or replaced by a new hint discovered later.

Scheduling the Cron Job: We recommend scheduling this maintenance function to run daily during off-peak hours. If you’re using Supabase, you can enable the pg_cron extension and schedule the function as follows (example for 2 AM UTC daily):

-- (Ensure the pg_cron and pg_net extensions are enabled in your database)
SELECT cron.schedule(
  'discovery-maintenance-daily',
  '0 2 * * *',  -- Run every day at 02:00 UTC
  $$
  SELECT
    net.http_post(
      url := 'https://<YOUR_SUPABASE_PROJECT>.supabase.co/functions/v1/maintenance-discovery',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer <YOUR_ANON_KEY>"}'::jsonb,
      body := '{}'::jsonb
    );
  $$ 
);


This uses Supabase’s ability to call an HTTP webhook (the deployed edge function) on a schedule
GitHub
GitHub
. Be sure to replace the placeholder URL with your actual Supabase project URL and provide the anon API key (or a service role key if appropriate) for authorization. Once scheduled, you can verify it’s active by checking SELECT * FROM cron.job;
GitHub
.

Manual Trigger: You can also invoke the maintenance on-demand (for example, after making changes to the hint system) by calling the endpoint directly:

curl -X POST "https://<YOUR_SUPABASE_PROJECT>.supabase.co/functions/v1/maintenance-discovery" \
     -H "Authorization: Bearer <YOUR_ANON_KEY>" \
     -H "Content-Type: application/json" \
     -d '{}'


The HTTP response will return a JSON summary of what the maintenance did, including how many items were pruned or updated, and any errors encountered
GitHub
GitHub
.

Regular maintenance ensures that SignupAssist’s discovery mechanism remains fast and accurate. By pruning and refreshing data, the system avoids clutter and always leans on the most relevant, recent information when guiding the user through program selections and form fills.

Contributing

Contributions to SignupAssist MCP are welcome! :handshake: As this project orchestrates AI with web automation, we ask contributors to maintain the high standards of safety, clarity, and reliability set out above. Here are some guidelines for those looking to extend or improve the system:

Align with Design DNA: Please follow the established UX patterns (chat-native cards and confirmations, parent-friendly tone, etc.) for any new user-facing feature. New cards or messages should remain consistent with the voice and style (see Design Principles section). For example, any new action must include a confirmation step if it performs an external write, and error messages should be polite and helpful (no raw exceptions).

Extend Providers & Forms: A common contribution is adding support for new activity providers or new form fields. In such cases, update the relevant modules (e.g. mcp_server/providers/ for provider-specific logic, or lib/formHelpers.ts for form filling logic)
GitHub
. Make sure to include the provider’s details in the discovery feed (if applicable) and add any unique form field hints or login steps needed. We encourage writing unit tests or using the Chat Test Harness to simulate a full flow with the new provider.

Enhance provider integrations: Help extend Bookeo (and future API providers) with clearer error handling, retries, and tests. OAuth and additional providers are welcome as long as they follow mandate and audit patterns.

Follow the Architecture Patterns: When altering the orchestration logic or adding new tools, strive to keep calls deterministic and idempotent, reuse sessions where possible, and utilize caching layers appropriately. These patterns (detailed in Technical Features) are critical for performance and maintainability. Log relevant telemetry for any new tool or process so we can observe its impact in production.

Testing and QA: Before submitting a pull request, please test your changes using the Chat Test Harness and, if possible, in a staging environment. Ensure that all existing flows (login, search, register) still work and that your addition doesn’t break the visual flow or confirmation steps. If you introduce a new dependency or environment variable, document it clearly in the README or a relevant doc.

We use GitHub issues and PR reviews for tracking changes. Feel free to open an issue if you plan a major change, so we can discuss the approach. By contributing to this project, you’ll be helping busy parents by improving an AI tool that makes their lives easier, while also setting a standard for responsible AI agent design. Thank you for collaborating!

By adhering to the above guidelines and leveraging the robust architecture in place, SignupAssist MCP aims to remain the gold standard for safe, efficient automation in the family activities domain. We welcome feedback and contributions as we continue to evolve towards an even more secure and seamless delegate sign-up experience.
