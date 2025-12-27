# V1 Action Matrix (OpenAPI `/orchestrator/chat` action enum)

This matrix is the sign-off document for the full `action` enum defined in `mcp/openapi.json`.

- **Routing**: All actions are handled inside `mcp_server/ai/APIOrchestrator.ts` (`handleAction`).
- **OAuth gating**: Enforced in `mcp_server/index.ts` using `mcp_server/config/protectedActions.ts`.
- **Text-only v1**: even though the API can return cards/CTAs, ChatGPT v1 responses are guardrailed to text-only.

Legend:
- **Auth**: `public` = no login required, `protected` = requires OAuth (401 triggers OAuth)
- **Primary handler**: method invoked by the switch in `handleAction`

---

## Action-by-action

| Action | Auth | Primary handler | Purpose (v1) | Notes / key gates |
|---|---|---|---|---|
| `search_programs` | public | `searchPrograms()` | List programs for org/provider | Clears stale selection state before listing. |
| `browse_all_programs` | public | `handleBrowseAllPrograms()` | Browse without activity filter | Uses same search path; intended to reduce follow-up loops. |
| `clear_activity_filter` | public | `handleClearActivityFilter()` | Remove activity filter and re-list | Safe to run unauthenticated. |
| `show_out_of_area_programs` | public | `handleShowOutOfAreaPrograms()` | Show programs even if location mismatch | Sets `ignoreLocationFilter`. |
| `confirm_provider` | public | `handleConfirmProvider()` | Confirm provider selection | Supports “yes” confirmation patterns. |
| `deny_provider` | public | `handleDenyProvider()` | Decline provider suggestion | Returns graceful decline / alternative prompt. |
| `save_location` | public | `handleSaveLocation()` | Store/accept location context | Persists only when authenticated; otherwise used as filter. |
| `select_program` | public | `selectProgram()` | Choose a program and load required fields | Recovers from missing payload via NL parsing + `displayedPrograms`. |
| `submit_form` | public | `submitForm()` | Submit collected form data to advance flow | Step-gated to `FORM_FILL`; hydrates from free-text if payload empty; asks for required fields in chunks (2 at a time). |
| `setup_payment_method` | protected | `setupPaymentMethod()` | Ensure a payment method exists | Used before any booking/charge. |
| `setup_payment` | protected | `setupPaymentMethod()` | Alias path into payment setup | Exists for client compatibility. |
| `check_payment_method` | protected | `checkPaymentMethod()` | Check saved payment method status | Used to avoid re-collection. |
| `show_payment_authorization` | protected | `showPaymentAuthorization()` | Show the explicit authorization prompt | Should precede any booking/charge. |
| `authorize_payment` | protected | `confirmPayment()` / `confirmScheduledRegistration()` | User explicitly authorizes the action | Hard step gates: selected program, correct step, payment method present, form data present. Sets `paymentAuthorized=true`. |
| `confirm_payment` | protected | `confirmPayment()` | Execute booking now | Should only run after authorization gates (or via explicit action flow). |
| `schedule_auto_registration` | protected | `scheduleAutoRegistration()` | Prepare “set-and-forget” scheduling | Stores scheduling data; validates time window; triggers payment setup if needed. |
| `confirm_scheduled_registration` | protected | `confirmScheduledRegistration()` | Create scheduled job + mandate + scheduler | Creates `scheduled_registrations` payload and schedules via MCP scheduler tool. |
| `view_receipts` | protected | `viewReceipts()` | Show registrations + scheduled jobs | Includes `REG-` and `SCH-` short codes for text-only control. |
| `view_audit_trail` | protected | `viewAuditTrail()` | Show audit history for REG or SCH | Accepts `registration_ref` like `REG-xxxx` / `SCH-xxxx` (resolved server-side). |
| `cancel_registration` | protected | `cancelRegistrationStep1()` | Initiate cancellation | Accepts `registration_ref`; for ChatGPT v1 uses text “yes/no” confirmation via `pendingCancellation`. |
| `confirm_cancel_registration` | protected | `cancelRegistrationStep2()` | Execute cancellation | Cancels scheduled jobs or confirmed bookings; refunds success fee when applicable. |
| `cancel_flow` | public | (inline in switch) | Reset current flow | Resets to BROWSE and clears scheduling/payment flags. |
| `clear_context` | public | `handleClearContext()` | Hard reset conversation context | Used for “start over”. |

---

## Non-enum / internal actions (not in OpenAPI)

These may appear in internal UI or legacy clients but are not part of the published `action` enum:

- `select_child` (handled by `handleSelectChild()`)
- Back-compat aliases resolved in `protectedActions.ts` + `APIOrchestrator.handleAction()`: `confirm_booking`, `cancel_booking`, `answer_questions`, etc.


