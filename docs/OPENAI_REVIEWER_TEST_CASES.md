# OpenAI App Store - Reviewer Test Cases

These test scenarios demonstrate SignupAssist's current ChatGPT app behavior for the OpenAI review team. SignupAssist is for adult parents and guardians managing child-safe youth activity signups; it is not child-directed and is not for adult-only activities.

**Provider:** AIM Design (Madison, WI) - programs fetched live from the Bookeo API.

**Public tools:** `search_activities` (read-only browse) and `register_for_activity` (OAuth-gated guided registration wizard).

**Important safety posture:** SignupAssist can complete a supported Bookeo/API-connected youth activity booking only after the adult reviewer signs in, provides required details, completes Stripe-hosted payment method setup if prompted, reviews the final summary, and explicitly confirms with `book now`. Full unattended set-and-forget delegation is not live.

**COPPA/privacy posture:** Use synthetic test data. General age or grade is acceptable for search. Do not use real child data, and do not submit personal information about children under 13 in ChatGPT.

> Prompts include "SignupAssist" or "Signup Assist" to encourage ChatGPT to route the request to the app instead of answering from general knowledge.

---

## Positive Test Case 1: Browse AIM Design Programs

**Scenario:** Browse AIM Design programs

**Prompt:** "Use SignupAssist to show me programs at AIM Design."

**Tool expected:** `search_activities`

**Expected behavior:**

- Returns available AIM Design programs from the Bookeo-connected catalog.
- Each result may include title, age range, schedule, price, or availability when available.
- Invites the reviewer to start signup for a selected program.
- Does not create a booking, collect payment, or charge anything.

---

## Positive Test Case 2: Age-Filtered Browse

**Scenario:** Age-filtered AIM Design program browse

**Prompt:** "Use SignupAssist to find robotics classes for my 9 year old at AIM Design."

**Tool expected:** `search_activities`

**Expected behavior:**

- Returns AIM Design robotics or youth-program results appropriate for the requested age when available.
- If no exact match exists, explains closest available programs or asks a narrow follow-up.
- Does not start the signup wizard unless the reviewer asks to sign up.
- Does not create a booking, collect payment, or charge anything.

---

## Positive Test Case 3: Start Signup Flow

**Scenario:** Start AIM Design signup flow

**Prompt:** "Use SignupAssist to sign my child up for a class at AIM Design."

**Tool expected:** `register_for_activity`

**Expected behavior:**

- If the reviewer is not authenticated, SignupAssist prompts them to sign in before proceeding. ChatGPT will display a "Connect SignupAssist" button or similar OAuth prompt.
- After sign-in, returns **Step 1/5** with available AIM Design programs.
- Lists numbered program options.
- Waits for the reviewer to select a program before collecting registration details.
- Does not create a booking or charge anything at Step 1/5.

---

## Positive Test Case 4: Complete Connected Bookeo Signup

**Scenario:** Complete connected AIM Design / Bookeo signup

**Prompt sequence:**

1. "Use SignupAssist to sign my child up for a class at AIM Design."
2. Select one available program, for example: "3".
3. Provide the requested synthetic parent/account-holder details.
4. Provide synthetic participant details. Prefer a participant age 13 or older for review, such as a synthetic teen matching the selected program's age requirements.
5. Complete Stripe-hosted payment method setup if prompted.
6. Review the summary.
7. Type: "book now" or "yes" to confirm.

**Tool expected:** `register_for_activity`

**Expected behavior:**

- Step 1/5 shows available programs and waits for selection.
- Step 2/5 collects account-holder and participant information required by Bookeo.
- Payment method setup, when required, happens through Stripe-hosted checkout; SignupAssist does not see raw card numbers.
- Before booking or charging, SignupAssist shows a final review summary with program, participant, schedule, program fee, SignupAssist fee, and payment method context.
- No booking or charge occurs before the explicit final confirmation.
- At the final review step, the reviewer may type `book now` or `yes` to confirm. SignupAssist then creates the supported Bookeo booking and returns confirmation details such as a booking number or receipt summary.

---

## Positive Test Case 5: Explicit Out-Of-Scope Safety

**Scenario:** Adult-only activity is outside SignupAssist scope

**Prompt:** "Use SignupAssist to sign me up for a wine tasting class for adults only."

**Tool expected:** `register_for_activity`

**Expected behavior:**

- If the reviewer is not already authenticated, ChatGPT may ask them to connect SignupAssist before invoking this consequential tool.
- SignupAssist declines or redirects because it is focused on parent-controlled child-safe youth activity registration.
- Does not start an adult-only signup flow.
- Does not create a booking, collect payment, or charge anything.

---

## Negative Test Case 1: General Recipe Question

**Scenario:** General recipe question unrelated to activity signups

**Prompt:** "What's a good recipe for chicken parmesan?"

**Expected behavior:**

- SignupAssist should not trigger because the request is unrelated to parent/guardian youth activity search or signup.

---

## Negative Test Case 2: Product Shopping

**Scenario:** Shopping for a physical product, not activity registration

**Prompt:** "Find me the best laptop under $1000."

**Expected behavior:**

- SignupAssist should not trigger because the request is unrelated to parent/guardian youth activity search or signup.

---

## Negative Test Case 3: General Business Education

**Scenario:** General education question unrelated to activity signups

**Prompt:** "Summarize the difference between Agile and Scrum."

**Expected behavior:**

- SignupAssist should not trigger because the request is unrelated to parent/guardian youth activity search or signup.

---

## Review Notes

- The dedicated reviewer account must be provided only in the OpenAI Platform submission form.
- The reviewer account should not require MFA, SMS verification, email verification loops, or private-network access.
- Use synthetic test data only.
- If a final booking is completed, record the booking number, cancellation/refund evidence, and Stripe/test-payment evidence.
