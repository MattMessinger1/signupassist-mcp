# SHIPWORX LLC PRIVACY POLICY (SIGNUP ASSIST)

**Effective Date:** December 19, 2025  
**Last Updated:** December 19, 2025

This Privacy Policy explains how Shipworx LLC ("Shipworx," "we," "us," or "our") collects, uses, discloses, and protects information when you use Signup Assist (the "App"), including when the App is accessed through ChatGPT or similar interfaces, and when you visit our website at shipworx.ai (collectively, the "Services").

**IMPORTANT:** When you use Signup Assist inside ChatGPT, OpenAI may also process your information under OpenAI's own terms and privacy policy. This Privacy Policy covers what Shipworx does with information we receive and process.

---

## 1. WHO WE ARE

Signup Assist is an independent service operated by Shipworx LLC. We are not affiliated with, endorsed by, or sponsored by OpenAI.

**Contact Information:**
- **Company:** Shipworx LLC
- **Privacy Questions:** privacy@shipworx.ai
- **Support:** support@shipworx.ai

---

## 2. SCOPE / UNITED STATES ONLY

Our Services are intended for users located in the United States. We do not market the Services outside the United States at this time.

---

## 3. INFORMATION WE COLLECT

We follow a data-minimization approach: we aim to collect only what is reasonably necessary to provide the Services.

### A. Account Information

If you create an account or authenticate through ChatGPT, we collect:
- Name and email address
- Authentication identifiers (Auth0 user ID)
- Account preferences and settings

### B. Delegate (Parent/Guardian) Information

When you use Signup Assist as a "Responsible Delegate," you may provide:
- First and last name
- Email address and phone number
- Date of birth (for age verification)
- City and state of residence
- Relationship to participants (e.g., parent, guardian)

### C. Participant (Child) Information

When you register children or dependents for activities, you provide:
- First and last name
- Date of birth (required for age-appropriate program matching)

This information is stored to:
- Pre-fill future registration forms
- Verify age requirements for activities
- Enable you to manage multiple children's registrations

### D. Information from ChatGPT (App Requests)

If you use Signup Assist through ChatGPT:
- ChatGPT sends requests to our API that include your messages and intent
- OpenAI's language models process your messages to understand registration requests
- We receive the processed request and respond with program information or registration confirmations

We process these requests to return responses that help fulfill your registration needs.

### E. Registration and Transaction Information

When you complete registrations, we collect:
- Program selections and preferences
- Registration confirmation numbers
- Transaction amounts and success fees
- Scheduled registration times

### F. Automatically Collected Information

When you use our website or API, we may automatically collect:
- **Log and Device Data:** IP address, device and browser type, approximate region (derived from IP), timestamps, pages or endpoints accessed, and error logs
- **Security Signals:** Information used to help prevent abuse and secure the Services (e.g., rate-limit events and suspicious traffic patterns)

### G. Information from Third Parties

We may receive information from service providers that help us operate the Services (e.g., hosting, logging, and email delivery providers). We do not purchase consumer data lists.

---

## 4. INFORMATION WE DO NOT COLLECT ("RESTRICTED DATA")

Do NOT submit the following to Signup Assist, and we do not intentionally collect it:

- **Payment card numbers** or other data regulated under PCI DSS (we use Stripe for payment processing; card details go directly to Stripe)
- **Protected health information (PHI)** including medical conditions, allergies, or health records
- **Government identifiers** (e.g., Social Security numbers, passport numbers)
- **Provider login credentials** (our API-first architecture does not require your activity provider passwords)

If we become aware that we received Restricted Data, we will take reasonable steps to delete it or de-identify it, unless we must keep it to comply with law or to resolve security incidents.

---

## 5. CHILDREN'S PRIVACY

Signup Assist helps parents and guardians register children for activities. This section explains how we handle children's information.

### What We Collect

When you use our service, you provide your child's:
- First and last name
- Date of birth (for age verification by activity providers)

### How We Protect Children's Data

- **Parental Control:** Only authenticated parents/guardians can access and manage children's records
- **No Direct Interaction:** Children cannot create accounts or interact with the service directly
- **Limited Purpose:** Children's data is used solely to complete registrations you authorize
- **Deletion Rights:** You may request deletion of children's data at any time

### What We Do NOT Do

- Allow children under 13 to use the service directly
- Contact children directly for any purpose
- Share children's information for marketing or advertising
- Retain children's data after you request deletion
- Sell or share children's information with third parties for their marketing

### COPPA Compliance

If you believe we may have collected personal information about a child under 13 without proper parental consent, contact us immediately at privacy@shipworx.ai and we will take steps to delete it.

---

## 6. HOW WE USE INFORMATION

We use information for the following purposes:

### Provide Registration Services
- Process registration requests through activity provider APIs
- Match your children to age-appropriate programs
- Execute scheduled registrations at specified times
- Generate confirmation records for your reference

### Responsible Delegate Operations
- Issue and manage authorization mandates (scoped permissions)
- Maintain audit trails of all actions taken on your behalf
- Enforce spending limits and scope restrictions you authorize

### Account Management
- Create and manage your account
- Authenticate users through Auth0
- Provide customer support

### AI-Assisted Processing
- Use OpenAI to understand your natural language registration requests
- Match your intent to available programs and time slots
- Generate helpful responses and recommendations

### Safety and Security
- Protect the Services and detect/prevent abuse
- Troubleshoot issues and maintain reliability
- Monitor for suspicious activity

### Improve the Services
- Understand feature usage and performance
- Improve user experience using aggregated or de-identified data

### Legal Compliance
- Comply with applicable laws
- Enforce our terms of service
- Protect our rights and the rights of others

**We do not sell personal information. We do not use your personal information to deliver third-party targeted advertising.**

---

## 7. HOW WE SHARE INFORMATION

We may share information in the following situations:

### Service Providers

We work with the following service providers who process data on our behalf:

| Category | Provider | Purpose | Data Shared |
|----------|----------|---------|-------------|
| Activity Registration | Bookeo API | Submit registrations | Delegate info, participant names, program selections |
| Payment Processing | Stripe | Process success fees | Payment method tokens (not card numbers) |
| Authentication | Auth0 | Secure ChatGPT login | Email, user identifier |
| AI Processing | OpenAI | Understand requests | Chat messages, registration intent |
| Database | Supabase | Secure data storage | All user data (encrypted at rest) |

**Important:** We use server-side API keys for provider integrations. We do not store your personal login credentials for activity providers like Bookeo.

### Legal and Safety

We may disclose information if required by law, subpoena, or legal process; to protect rights, safety, and security; or to investigate fraud or misuse.

### Business Transfers

If we are involved in a merger, acquisition, financing, reorganization, or sale of assets, information may be transferred as part of that transaction. We will provide notice before your information becomes subject to a different privacy policy.

### With Your Instructions

We may share information when you explicitly direct us to (for example, when you authorize a registration that requires sharing your information with an activity provider).

**We do not authorize service providers to use your information for their own marketing purposes.**

---

## 8. THE RESPONSIBLE DELEGATE MODEL

Signup Assist operates on a "Responsible Delegate" model where you authorize us to perform specific actions on your behalf. This section explains how that works.

### Mandates (Authorization Tokens)

When you request a registration, you grant a **mandate** - a scoped, time-limited authorization:

- **Scoped Permissions:** Each mandate specifies exactly what actions are authorized (e.g., "register [Child Name] for [Program Name]")
- **Spending Limits:** Mandates include maximum amounts when applicable
- **Time-Limited:** Mandates expire automatically (typically within 24 hours)
- **Revocable:** You can revoke mandates at any time

### Audit Trail

Every action taken on your behalf is logged in a comprehensive audit trail:

- **What We Log:** Tool name, timestamps, arguments, results, and cryptographic hashes
- **Integrity Verification:** Results are hashed (SHA-256) to ensure records cannot be altered
- **Your Access:** You can view your complete audit history through the app
- **Export Rights:** You may request a full export of your audit trail

### Scope Limitations

Our system enforces strict boundaries:

- Actions are limited to permissions you explicitly authorize
- We cannot exceed spending limits you set
- Registration actions are specific to named children and programs
- Expired mandates cannot be used

---

## 9. DATA RETENTION

We retain information only as long as reasonably necessary for the purposes described above:

| Data Type | Retention Period |
|-----------|------------------|
| Delegate profile | Until account deletion requested |
| Children records | Until you delete them |
| Mandates (authorizations) | 24 hours (auto-expire), records kept 90 days |
| Audit logs | 90 days |
| Payment method info (last4/brand only) | Until you remove payment method |
| Registration confirmations | 2 years |
| API/security logs | 30 days (unless needed for security investigation) |

You may request deletion of your data at any time (see Section 11).

---

## 10. SECURITY

We maintain reasonable administrative, technical, and organizational safeguards designed to protect information:

### Technical Safeguards
- **Encryption at Rest:** All data stored in Supabase is encrypted
- **Encryption in Transit:** All API communications use TLS/HTTPS
- **Row Level Security (RLS):** Database policies ensure users can only access their own data
- **Secure Authentication:** Auth0 provides enterprise-grade identity management

### API-First Security Benefits
- **No Credential Storage:** Our API-first architecture means we never store your activity provider passwords
- **Server-Side Keys:** Provider API keys are stored securely on our servers, not exposed to clients
- **Audit Integrity:** Cryptographic hashes ensure audit records cannot be tampered with

### Access Controls
- Role-based access for internal systems
- Regular security reviews
- Monitoring for suspicious activity

No method of transmission or storage is 100% secure, but we work to protect your data using industry-standard measures.

---

## 11. YOUR PRIVACY CHOICES AND CONTROLS

### A. Access, Correction, Deletion

You may:
- **Access:** Request a copy of your personal information
- **Correct:** Update inaccurate information through the app or by contacting us
- **Delete:** Request deletion of your account and associated data

To make a request, contact privacy@shipworx.ai. We may need to verify your identity.

### B. Manage Children's Data

You can:
- View all children's profiles in your account
- Edit children's information at any time
- Delete individual children's records
- Request complete deletion of all children's data

### C. Audit Trail Access

You can:
- View your complete audit history in the app
- Request an export of all audit logs
- Receive explanations of any logged actions

### D. Marketing Communications

If we send marketing emails, you can opt out using the unsubscribe link. We may still send service-related or transactional messages (e.g., registration confirmations).

### E. Cookies (Website)

If we use cookies on shipworx.ai, they are primarily for basic site functionality and security. You can control cookies through browser settings.

---

## 12. STATE PRIVACY RIGHTS (UNITED STATES)

Depending on your state of residence (including California, Virginia, Colorado, Connecticut, and Utah), you may have additional rights:

- **Right to Know/Access:** What personal information we collect and how we use it
- **Right to Delete:** Request deletion of personal information (subject to exceptions)
- **Right to Correct:** Request correction of inaccurate personal information
- **Right to Opt Out:** Of "sale" or "sharing" of personal information
  - **Note:** We do not sell personal information
  - **Note:** We do not share for cross-context behavioral advertising
- **Right to Non-Discrimination:** For exercising privacy rights

### Exercising Your Rights

To exercise these rights:
1. Email privacy@shipworx.ai with your request
2. We will verify your identity
3. We will respond within the timeframe required by applicable law (typically 45 days)

You may designate an authorized agent to make requests on your behalf.

---

## 13. CHANGES TO THIS PRIVACY POLICY

We may update this Privacy Policy from time to time. If we make material changes:
- We will update the "Last Updated" date at the top
- We may notify you via email or in-app notification
- Material changes will be highlighted for easy review

Continued use of the Services after changes constitutes acceptance of the updated policy.

---

## 14. CONTACT US

**Privacy Questions or Requests:**
- Email: privacy@shipworx.ai

**General Support:**
- Email: support@shipworx.ai

**Mailing Address:**
```
Shipworx LLC
Attn: Privacy
[Street Address]
[City, State, ZIP]
United States
```

---

## SUMMARY OF KEY POINTS

| Topic | Key Point |
|-------|-----------|
| **What We Collect** | Delegate info, children's names/DOB, registration details |
| **Children's Data** | Collected only for registrations you authorize; you control deletion |
| **Credentials** | We do NOT store your provider login passwords |
| **AI Processing** | OpenAI helps understand your requests |
| **Sharing** | Only with service providers listed above; never sold |
| **Mandates** | Time-limited, scoped authorizations you control |
| **Audit Trail** | Complete log of all actions, exportable on request |
| **Your Rights** | Access, correct, delete, export your data anytime |

---

*This Privacy Policy is effective as of December 19, 2025.*
