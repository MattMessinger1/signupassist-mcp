SignupAssist MCP

SignupAssist MCP (Model Context Protocol) is an AI-driven agent designed to help parents sign their kids up for extracurricular activities in a safe, conversational way. It automates tasks like logging into provider websites, discovering and filling out registration forms, and submitting enrollments on a parent’s behalf – all under explicit user mandates and strict oversight. Built to integrate with ChatGPT’s conversational interface, SignupAssist emphasizes a parent-friendly experience while ensuring that every action is transparent, authorized, and secure.

Design Principles (ChatGPT-Native UX & Safety)

Chat-Native Flow: All interactions occur through a natural back-and-forth chat. The assistant first explains or asks questions, then presents information or options in a card, and finally awaits the user’s confirmation before proceeding. This conversational pattern (explain → card → confirm) keeps the experience intuitive and avoids disruptive modals or external popups, aligning with ChatGPT’s guidelines for conversational apps.

SDK Component Purity: The UI uses only ChatGPT’s built-in interface components – such as message bubbles, cards/carousels for options, short forms for inputs, confirmation dialogs, and status chips – with no external web views or custom dialogs. By sticking to the ChatGPT SDK’s native elements, the app remains fully accessible, responsive, and compliant with ChatGPT App Store requirements.

Explicit Confirmations for “Writes”: Before performing any irreversible action (like scheduling a registration or charging a payment), the assistant always shows a confirmation card summarizing the action and requires the user to confirm explicitly. This guarantee of “no surprise actions” is mandated for safety – the user must clearly consent to any external effect such as submitting a form or making a payment.

Parent-Friendly Tone & Secure Messaging: The assistant communicates in a friendly, reassuring tone that’s mindful of busy parents (concise, helpful, and non-technical). At every important step, it emphasizes security – for example, reminding users that their credentials and payment details stay safe with the trusted provider or Stripe, and that SignupAssist never stores sensitive card numbers. These assurances help build trust and meet privacy and compliance standards.

Audit Trail & “Responsible Delegate” Transparency: SignupAssist operates under a responsible-delegation model. It only acts with the parent’s explicit consent and logs every action it takes on the user’s behalf. This audit trail means any login, form fill, or submission is recorded with time stamps and details, so users (and reviewers) can trace exactly what the assistant did. This transparency is core to the app’s ethos and is surfaced to the user with gentle reminders that “all actions are logged for your review”.

Consistent Visual Rhythm & Hierarchy: Each step in the flow follows the same predictable visual structure for ease of understanding. The pattern is: the assistant’s explanation text, followed by a card (with details, options, or form inputs), and then a clear call-to-action (e.g. a Confirm button). Design elements like button styles and colors are kept uniform (primary actions vs. secondary) to maintain a coherent visual hierarchy across the app. Users quickly recognize the stages of the process, which improves usability and trust.

(These design tenets ensure the app feels like a natural extension of ChatGPT, and they fulfill OpenAI’s review guidelines by prioritizing clarity, consent, and user control.)

Technical Features & Architecture

Antibot-Aware Automation: SignupAssist navigates provider websites in a human-like manner to evade bot detection. It simulates real user behavior with techniques like realistic typing speeds, randomized input delays, and detection of hidden honeypot fields that some sites use to trap bots
GitHub
. By mimicking a normal user and avoiding known bot triggers, it can log in and browse without getting blocked by anti-bot defenses.

Smart Form Submission Helpers: Many registration sites inject dynamic anti-bot tokens or use client-side scripts to validate forms. The MCP agent includes helpers that wait for required JavaScript-generated tokens or fields to appear before submitting a form
GitHub
. For example, on Drupal-based activity sites like SkiClubPro, the assistant will pause until an anti-bot token is present, ensuring the submission isn’t rejected for missing hidden fields
GitHub
.

Mandate Scope Enforcement: Every action the agent takes is gated by a signed mandate from the parent defining what’s allowed – e.g. “log in to Provider X”, “register child for Program Y”, “use saved payment Z up to $ amount”. The MCP core strictly enforces these scopes: it will only perform actions covered by the user’s explicit mandate, nothing more. All operations are tied back to the mandate ID and recorded, producing a transparent audit log of what was done under which permission
GitHub
. This prevents scope creep and ensures the assistant cannot do anything outside the user’s authorized requests.

Pre-Login A-A-P Narrowing: To optimize discovery and avoid unnecessary steps, the system first narrows down the context using the A-A-P triad – Age, Activity type, and Provider. On each request, if any of these key parameters are missing or ambiguous, the assistant will ask the user (at most once per missing item) to clarify. Using Age-Activity-Provider as a filter, SignupAssist can then target the appropriate program listings and forms, rather than blindly searching across all possibilities. This early A-A-P narrowing focuses the automation on the relevant programs and reduces extraneous browsing.

Cron-Prefetching & Feed Caching: The architecture shifts heavy data fetching out of the real-time chat flow by using background cron jobs. Providers that support it can supply structured program feeds which the system periodically fetches and caches. On each user query, SignupAssist first checks the prefetched feed data for available programs. If the feed is fresh (within a defined TTL), results are served near-instantly without hitting the live website. If data is stale or missing, the assistant will quickly return what it has and silently trigger a background refresh (using a “stale-while-revalidate” strategy) so that updated info can be loaded by the next turn. This feed-first approach greatly reduces latency and cost by avoiding redundant live scraping for popular providers, and falls back to on-demand page fetches only when necessary. In short, most program search results come from a fast cache, keeping the conversation snappy.

Session Reuse & Deterministic Orchestration: The MCP orchestrator ensures efficient and reliable tool usage. It produces deterministic tool calls – given the same context and query, it will generate the same sequence of tool invocations with stable parameters. This idempotent behavior makes debugging and testing easier, and avoids unpredictable AI loops. Additionally, the agent reuses sessions and avoids duplicate work: it will never run two login processes in parallel for the same user and provider, and it keeps an active session alive to use across multiple steps. Once logged in, the session is retained and refreshed only as needed (e.g. when a mandate is near expiry or a session cookie times out). By reusing browser sessions, SignupAssist minimizes extra logins and keeps context (like cookies or authentication state) warm throughout the signup flow.

Cache-Based Extraction: When live web scraping or form discovery is unavoidable, the system employs caching at the page-level to avoid repeating expensive extractions. Pages are keyed by a hash or stable identifier, and their parsed content is cached for a short window (e.g. 5–15 minutes). If another user or step needs the same page data shortly after, the cached result is used instead of re-scraping. The cache is careful to invalidate or update when A-A-P context changes, so that, for example, age-specific program filtering is always correct. This strategy, combined with limited concurrency, keeps the system responsive even under load by cutting down duplicate work.

Telemetry & Logging: The platform logs fine-grained telemetry for each operation to aid in observability and tuning. Every time a program search or form extraction runs, it records metrics such as whether a cached feed was used, how old the data was, if it had to fall back to a live scrape, how long extraction took, how many items or snippets were found, etc. These telemetry events (e.g. feed_hit, feed_age_ms, fallback_to_live, extract_ms, counts of items) are stored alongside audit logs. This not only provides a performance audit trail but also helps developers identify bottlenecks or failures in the field. For example, if a particular provider’s feed is often stale or incomplete, the logs will make that visible so the team can improve the feed or adjust the scraping logic.

Security & Data Privacy: All sensitive data is handled with care. User credentials and payment information are never stored in plaintext by SignupAssist – they remain in secure storage (e.g. Supabase with RLS policies, Stripe’s vault, etc.) and are retrieved only when needed via secure methods (for instance, through a Supabase Edge Function that returns credentials on-demand). The assistant’s messaging reinforces this by reminding users that their private data stays with the provider or payment processor. Furthermore, the system abides by a data minimization principle: it only asks for information that is essential for the current step (for example, it won’t ask for a child’s birthdate or any details unless they are required for a form at hand). This reduces unnecessary data collection and aligns with privacy best practices.

Future-Ready: Verifiable Credentials & Trusted Automation: The long-term vision for SignupAssist is to move away from relying solely on human-like behavior to bypass bot checks, and instead collaborate with providers on a trust-based model. The team is exploring W3C Verifiable Credentials (VCs) and similar cryptographic tokens to prove the legitimacy of the automation
GitHub
. In the future, parents’ authorizations could be converted into cryptographic credentials that the agent presents to provider sites. A provider could verify the token (for example, via a plugin or API) to confirm:

the request comes from an AI agent operating with a real parent’s consent, and

the action (login, registration, payment) is within the approved scope
GitHub
.

With such verifiable delegate tokens in place, providers would be able to confidently skip anti-bot measures (like CAPTCHAs or honeypot fields) when they see a valid MCP credential, knowing the action is authorized and legitimate
GitHub
. This approach – part of what we call the “Responsible Delegate Mode” – would shift the system from mimicking humans to being recognized as an authorized agent in its own right
GitHub
. In practical terms, this could mean smoother, faster sign-ups with even less friction, once the industry is ready to accept these standards. (Note: This capability is on the roadmap and not yet in production, pending provider adoption of such verification methods.)

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

Browser Automation (Browserbase): BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID (if using an external browser automation service for running headless browser tasks)
GitHub
.

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

Test the Flow: With the server and frontend running and your environment configured, you can simulate a signup conversation. For example, in the chat UI, type something like “Sign up my 8-year-old for ski lessons at Blackhawk Ski Club” and follow the prompts. The assistant should walk through provider selection, login (you’ll be prompted to provide saved credentials or enter them), program search results, form filling, and confirmation. Use the Debug Panel in the test harness to see tool calls and responses in real time
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

Enhance Anti-bot and Security Measures: As websites evolve, so do their bot defenses. Contributors can help by improving the anti-bot evasion techniques (e.g., handling new types of CAPTCHAs or honeypot patterns) and expanding the debugging tools for it
GitHub
. Similarly, if you have ideas for integrating verifiable credentials or OAuth flows once providers support them, those contributions would be valuable (keeping in mind backward compatibility).

Follow the Architecture Patterns: When altering the orchestration logic or adding new tools, strive to keep calls deterministic and idempotent, reuse sessions where possible, and utilize caching layers appropriately. These patterns (detailed in Technical Features) are critical for performance and maintainability. Log relevant telemetry for any new tool or process so we can observe its impact in production.

Testing and QA: Before submitting a pull request, please test your changes using the Chat Test Harness and, if possible, in a staging environment. Ensure that all existing flows (login, search, register) still work and that your addition doesn’t break the visual flow or confirmation steps. If you introduce a new dependency or environment variable, document it clearly in the README or a relevant doc.

We use GitHub issues and PR reviews for tracking changes. Feel free to open an issue if you plan a major change, so we can discuss the approach. By contributing to this project, you’ll be helping busy parents by improving an AI tool that makes their lives easier, while also setting a standard for responsible AI agent design. Thank you for collaborating!

By adhering to the above guidelines and leveraging the robust architecture in place, SignupAssist MCP aims to remain the gold standard for safe, efficient automation in the family activities domain. We welcome feedback and contributions as we continue to evolve towards an even more secure and seamless delegate sign-up experience.
