# OpenAI App Store — Reviewer Test Cases

These test scenarios demonstrate SignupAssist's core functionality for the OpenAI review team.

**Provider:** AIM Design (Madison, WI) — programs fetched live from the Bookeo API.
**Tools:** `search_activities` (read-only browse) and `register_for_activity` (guided registration wizard).

> **Note:** Prompts include "SignupAssist" or "Signup Assist" to ensure ChatGPT routes the request to the app rather than answering from general knowledge.

---

## Test Case 1: Browse Available Programs

**Prompt**: "Use SignupAssist to show me programs at AIM Design"

**Expected behavior**:
- Triggers `search_activities`
- Returns a plain-text bullet list of available programs at AIM Design (Madison, WI)
- Each bullet includes the program title and may include age range, dates, or price
- Ends with a prompt like "To sign up for any of these, say 'sign up for [program name]'"
- No booking or payment occurs

---

## Test Case 2: Age-Filtered Program Search

**Prompt**: "Use SignupAssist to find robotics classes for my 9 year old"

**Expected behavior**:
- Triggers `register_for_activity`
- May ask a follow-up question for location (e.g., "What city are you in?")
- After location is provided, returns **Step 1/5** showing robotics programs appropriate for age 9
- Each program listing includes title, price, date/time, and availability status
- Prompts user to select a program or confirm (e.g., "Reply yes to sign up for this class")

---

## Test Case 3: Start Registration Flow

**Prompt**: "Use SignupAssist to sign my child up for a class at AIM Design"

**Expected behavior**:
- Triggers `register_for_activity`
- Returns a response beginning with **Step 1/5** showing available programs
- Lists programs with numbered options for selection
- Waits for user to choose before proceeding

---

## Test Case 4: Multi-Turn Registration Wizard

**Turn 1**: "I want to register my kid for classes with SignupAssist."
**Turn 2**: User selects a program (e.g., "3")
**Turn 3**: User provides email (e.g., "matt.messinger@gmail.com")
**Turn 4**: User provides participant name and DOB (e.g., "Percy Messinger 11/26/2014")
**Turn 5**: User confirms payment method (e.g., "yes")
**Turn 6**: User confirms booking (e.g., "book now")

**Expected behavior**:
- Turn 1 triggers `register_for_activity`, returns **Step 1/5 — Finding classes** with a numbered list of available programs (title, price, date, availability)
- Turn 2 triggers `register_for_activity`, returns **Step 2/5 — Account holder & participant info**, asks for email
- Turn 3 triggers `register_for_activity`, returns **Step 2/5 continued**, asks for participant first name, last name, and date of birth
- Turn 4 triggers `register_for_activity`, returns **Step 3/5 — Payment method (Stripe)**, shows payment method on file (e.g., "visa .... 4242") and asks to confirm or change
- Turn 5 triggers `register_for_activity`, returns **Step 4/5 — Review & consent**, showing a summary with program, participant, date, program fee, SignupAssist fee, and payment method. Asks user to type "book now" to continue or "cancel" to abort
- Turn 6 triggers `register_for_activity`, returns **Step 5/5 — Registering**, confirms the booking with a booking number, participant details, fees breakdown, and calendar links
- Each response includes a clear step indicator (Step N/5)
- No booking or charge occurs until the user explicitly types "book now" at Step 4/5

---

## Test Case 5: Error Handling — No Matching Programs

**Prompt**: "Use SignupAssist to find underwater basket weaving classes"

**Expected behavior**:
- Triggers `search_activities` or `register_for_activity`
- Returns a friendly message indicating no matching programs were found
- May suggest broadening the search or show the full program catalog
- Does NOT crash or return a raw error

---

## Test Case 6: Out-of-Scope Request (Adult Content)

**Prompt**: "Use SignupAssist to sign me up for an adult dating service"

**Expected behavior**:
- The request is declined as out-of-scope
- Returns a polite message explaining SignupAssist is focused on youth activity enrollment
- Suggests the user register directly with the provider for adult services

---

## Test Case 7: Confirm-Before-Action Gating

**Prompt**: "Book this now" (after selecting a program and providing info in a prior turn)

**Expected behavior**:
- Before any booking or payment, the wizard shows a **review summary** with program name, participant, schedule, and price
- Asks for explicit confirmation ("Say 'confirm' to proceed")
- No booking or charge occurs until the user explicitly confirms
- Payment method entry is handled via Stripe-hosted Checkout (card numbers are never seen by SignupAssist)

---

## Test Case 8: Cancel / Decline Flow

**Prompt**: "Actually, never mind. I don't want to sign up."

**Expected behavior**:
- Gracefully handles cancellation
- Returns a polite acknowledgment (e.g., "No problem! Let me know if you change your mind.")
- Does NOT persist unwanted state or continue the wizard
