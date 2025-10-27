/**
 * Production System Prompt - Single source of truth for SignupAssist tone and behavior
 * Duplicated from AIOrchestrator for frontend use (tone training)
 */
export const PRODUCTION_SYSTEM_PROMPT = `Role & audience: You are SignupAssist, a friendly, efficient helper for parents. Be concise, warm, and clear. Use simple words. Use the child's name whenever known.

Conversational workflow (never skip): 1) Explain what you'll do in 1-2 sentences. 2) Show options as cards (short titles, key facts). 3) Ask the parent to confirm the next action (Yes/No). 4) After any write (registration or payment), restate what happened.

Tone rules: Friendly, concise, parent-first. One idea per sentence. Emoji sparingly where it adds clarity. Never scold or over-explain; if unclear, ask a simple follow-up. Always acknowledge before the next step.

Security & transparency: When asking for login or payment, remind that credentials and card data stay with the provider; SignupAssist never stores card numbers. Before any charge or enrollment, summarize child, program, schedule, price, and payment method, then ask Shall I proceed?

Error & recovery style: Be calm and actionable. Offer one clear fix and a retry option; never show stack traces or raw codes.

Context use: Remember prior choices (provider, program, child details). Never ask twice. If context is missing, ask the smallest next question to proceed.

Output rules: Write only the assistant message. The app attaches cards and buttons from tool outputs. Always return one short, upbeat line before showing cards. If meta.tone_hints or security_note are present, blend them naturally. When a tool is needed, request it by name once; after it responds, summarize briefly and move to confirmation.

Never do: Never proceed with payments or registrations without explicit Yes. Never ask for full card numbers or passwords in chat. Never dump long lists - prefer short, scannable bullets.

Stay consistent with SignupAssist's Design DNA: friendly, concise, secure.`;

export const prompts = {
  ui: {
    // ------------------------------------------------------------
    // 1. FLOW HEADERS & CTAs
    // ------------------------------------------------------------
    titles: {
      plan: 'Create your signup plan',
      signin: (orgName: string) => `Sign in to ${orgName}`,
      program: 'Pick your program',
      child: 'Choose the child',
      openTime: 'Set the registration open time',
      limit: 'Payment limit',
      defaults: 'How we\'ll handle extra questions',
      contact: 'If we need you',
      review: 'Review & authorize',
      success: 'Mandate created',
    },
    cta: {
      saveCheck: 'Save & check my account',
      fetchPrograms: 'Fetch programs',
      useProgram: 'Use this program',
      useChild: 'Use this child',
      continue: 'Continue',
      createMandate: 'Looks good — create mandate',
      done: 'Done',
      changeProgram: 'Change program',
      changeChild: 'Change child',
      editTime: 'Edit time',
      editLimit: 'Edit payment limit',
    },

    // ------------------------------------------------------------
    // 2. SIGN-IN / PREREQUISITES
    // ------------------------------------------------------------
    signin: {
      emailLabel: 'Email or username',
      emailPh: 'you@example.com',
      passwordLabel: 'Password',
      passwordPh: '••••••••',
      helper1: (orgName: string) =>
        `Use the same login you use for ${orgName} registrations. We\'ll only use it to sign you in and register.`,
      helper2:
        'Before registration opens, please make sure your membership is current and any required waivers are signed.',
      nudges: [
        'I\'ve paid the current membership fee',
        'I\'ve signed required waivers',
      ],
      helpers: {
        purpose: (orgName: string) =>
          `Use the same login you use for ${orgName} registrations. We\'ll only use it to sign you in and register.`,
      },
      errors: {
        badLogin:
          'That login didn\'t work. Please check your email/username and password.',
        prereqMissing:
          'Your account is missing something (membership, waiver, or payment method). You can fix it in your account and try again.',
      },
    },

  // ------------------------------------------------------------
  // 3. PROGRAM SELECTION
  // ------------------------------------------------------------
  programs: {
    searchLabel: 'Find a program',
    searchPh: 'Start typing the program name (e.g., "Saturday Beginners")',
    helper: (orgName: string) =>
      `We\'ll pull the current program list from ${orgName} so you can choose the exact one.`,
    item: (title: string, local: string, utc: string) =>
      `${title}\nOpens: ${local} (${utc} UTC)`,
    empty: 'No results match that search. Try a shorter phrase.',
    loadError: 'We couldn\'t load programs right now. Please try again.',
    toastSelected: (title: string) => `Great — ${title} selected.`,
  },

  // ------------------------------------------------------------
  // 4. CHILD PROFILE
  // ------------------------------------------------------------
  child: {
    label: 'Choose the child',
    helper: (orgName: string) =>
      `Select the child exactly as listed in your ${orgName} account.`,
    ph: 'Select a child',
    notFound:
      'We didn\'t find a matching child on your account. Please check the profile name in your account, then try again.',
    toastSelected: (name: string) => `Child ${name} selected.`,
  },

  // ------------------------------------------------------------
  // 5. OPEN TIME (LOCAL → UTC)
  // ------------------------------------------------------------
  openTime: {
    helper:
      'We\'ll convert this to UTC to avoid any time drift. Please double-check.',
    preview: (local: string, utc: string) =>
      `Runs at ${local} your time (${utc} UTC).`,
    errors: {
      future: 'Please enter a future date and time.',
      tz: 'Time zone required.',
    },
  },

  // ------------------------------------------------------------
  // 6. PAYMENT LIMIT / CAP
  // ------------------------------------------------------------
  limit: {
    label: 'Maximum program charge you approve',
    ph: '$175.00',
    helper:
      'We\'ll never authorize more than this. We\'ll also choose no-cost options for add-ons.',
    errors: {
      invalid: 'Please enter a valid dollar amount (e.g., 175 or 175.00).',
      tooLow: (hint: string) =>
        `This amount looks too low for this program. Consider raising it to at least ${hint}.`,
    },
  },

  // ------------------------------------------------------------
  // 7. EXTRA QUESTIONS / SMART DEFAULTS
  // ------------------------------------------------------------
  defaults: {
    headline: 'How we\'ll handle extra questions',
    explainer:
      'If the form asks extra questions (jersey size, color group, rentals, etc.), we\'ll answer them so your signup can finish without delay.',
    rules: [
      'We\'ll pick the first or default option for general questions.',
      'If the first option is a placeholder (e.g., "— Select —"), we\'ll pick the first real choice.',
      'If a choice affects cost, we\'ll select the $0 / no-cost option.',
      'If anything would exceed your payment limit, we\'ll stop and let you know.',
    ],
  },

  // ------------------------------------------------------------
  // 8. CONTACT FOR BLOCKERS
  // ------------------------------------------------------------
  contact: {
    label: 'Mobile number',
    ph: '(555) 123-4567',
    helper:
      'We\'ll only use this if something requires your input (e.g., a CAPTCHA or a new waiver).',
    error: 'Please enter a valid mobile number we can text.',
  },

  // ------------------------------------------------------------
  // 9. REVIEW & AUTHORIZATION / MANDATE
  // ------------------------------------------------------------
  review: {
    summaryLabels: {
      org: 'Organization',
      program: 'Program',
      child: 'Child',
      opens: 'Registration opens',
      limit: 'Payment limit',
      contact: 'Contact',
    },
    consent: (maxAmount: string, orgName: string) => [
      `I authorize SignupAssist to sign in to my ${orgName} account on my behalf for this signup.`,
      'I authorize SignupAssist to fill out and submit the program\'s registration form for me.',
      'I authorize SignupAssist to answer additional form questions using the rules above (first/default; $0 options).',
      `I authorize SignupAssist to pay up to ${maxAmount} to complete this registration.`,
      'I understand SignupAssist will pause and contact me if something requires my input (e.g., CAPTCHA or waiver).',
      'I agree that a simple audit log (including key screenshots) may be kept to confirm the steps taken for my signup.',
    ],
    scopeDescriptions: {
      'scp:login': {
        label: 'Login Access',
        description: 'Sign in to your account on your behalf',
        icon: 'shield',
      },
      'scp:enroll': {
        label: 'Enrollment',
        description: 'Fill out and submit registration forms',
        icon: 'user-plus',
      },
      'scp:pay': {
        label: 'Payment Authorization',
        description: 'Process payments up to your specified limit',
        icon: 'credit-card',
      },
      'scp:write:register': {
        label: 'Form Submission',
        description: 'Submit registration on your behalf',
        icon: 'file-text',
      },
      'signupassist:fee': {
        label: 'Service Fee',
        description: '$20 success fee upon completion',
        icon: 'dollar-sign',
      },
    },
    warnings: [
      'This authorization is valid for 30 days from issuance',
      'You can revoke this authorization at any time from your dashboard',
      'We will contact you if we encounter any blockers (CAPTCHA, new waivers, etc.)',
      'All actions are logged and can be audited',
    ],
  },

  // ------------------------------------------------------------
  // 10. MANDATE CONSENT MESSAGING (Two-Tier System)
  // ------------------------------------------------------------
  mandates: {
    discovery: {
      title: '🔐 Browsing Permissions Granted',
      body: (validHours: number) => [
        'You\'re connected! I can now help you browse programs.',
        '',
        '**What I can do right now:**',
        '• Browse available programs and their details',
        '• Check prerequisites for your account',
        '• Answer questions about registration options',
        '',
        '**What I CAN\'T do (yet):**',
        '• Submit registrations',
        '• Process payments',
        '• Modify your account',
        '',
        `These permissions last for ${validHours} hours so we can help you explore options freely.`,
        '',
        'Ready to find a program? Just tell me what you\'re looking for!',
      ].join('\n'),
    },
    execution: {
      title: '🎯 Authorization Required',
      body: (program: string, child: string, maxAmount: string, validUntil: string) => [
        `Ready to set up automatic registration for ${child} in ${program}?`,
        '',
        '**🔐 Authorization & Consent**',
        '',
        '✓ **What we\'re asking permission for:**',
        '  By authorizing this plan, you allow SignupAssist to:',
        '  • Log into your account when registration opens',
        `  • Fill out and submit the registration form for ${child}`,
        `  • Process payment up to ${maxAmount} using your saved payment method`,
        '',
        '✓ **How it works:**',
        '  We create a cryptographically signed "mandate" (permission token)',
        '  that authorizes these specific actions. This mandate is valid until',
        `  ${validUntil} and cannot be reused after that.`,
        '',
        '✓ **Security guarantees:**',
        '  • Your credentials are encrypted end-to-end',
        '  • We never see your full credit card number',
        '  • Registration happens in an isolated browser session',
        '  • Session is destroyed immediately after completion',
        '',
        '✓ **Full transparency:**',
        '  Every action is logged in your audit trail, including:',
        '  • When the mandate was issued',
        '  • What actions were attempted',
        '  • Screenshots of key moments (form filled, confirmation)',
        '  • Final outcome (success or any blockers)',
        '',
        '  [View your audit trail →](/mandates-audit)',
        '',
        '✓ **Your control:**',
        '  • You can revoke this at any time from your audit trail',
        '  • Mandate expires automatically after registration',
        '  • If we hit a blocker (CAPTCHA, new waiver), we\'ll pause and notify you',
        '',
        `💰 **Cost Limit:** ${maxAmount}`,
        `⏰ **Valid Until:** ${validUntil}`,
        '',
        'Say "authorize" to proceed, or "cancel" to stop.',
      ].join('\n'),
    },
    audit: {
      discoveryBadge: '🔍 Discovery',
      executionBadge: '⚡ Execution',
      discoveryDescription: 'Browse programs and check prerequisites',
      executionDescription: (program: string, child: string) =>
        `Register ${child} for ${program}`,
    },
  },

  // ------------------------------------------------------------
  // 11. SUCCESS & TOASTS
  // ------------------------------------------------------------
  success: {
    title: 'Mandate created',
    body: (local: string, utc: string) =>
      `You\'re all set. We\'ll run your signup at ${local} (${utc} UTC). You\'ll get a confirmation once it\'s done.`,
  },
  toasts: {
    programsUpdated: 'Programs updated just now.',
    prereqsOk:
      'Account looks ready — membership, waivers, and payment method found.',
    prereqsMissing:
      'Heads up: something\'s missing (membership / waiver / payment). You can save this plan and fix it before open.',
    saved: 'Saved.',
    scheduled: (local: string) => `Signup scheduled for ${local}.`,
    priceLimit: (max: string) =>
      `We stopped because the total would exceed your ${max} limit.`,
  },

    // ------------------------------------------------------------
    // 11. BLOCKER NOTIFICATIONS (SMS / EMAIL)
    // ------------------------------------------------------------
    notify: {
      smsSubject: (program: string) => `Quick help needed for ${program}`,
      smsBody: (child: string, program: string, reason: string) =>
        `SignupAssist: blocker while registering ${child} for ${program} (reason: ${reason}). Please resolve in your account, then tap "Try again".`,
      emailSubject: (program: string) => `Action needed for ${program}`,
      emailBody: (child: string, program: string, reason: string) =>
        `We hit a blocker while registering ${child} for ${program}.\n\nReason: ${reason}\n\nPlease resolve this in your account and then choose "Try again".`,
    },
  },

  // ------------------------------------------------------------
  // 12. FIELD DISCOVERY
  // ------------------------------------------------------------
  discovery: {
    success: {
      noQuestions: 'No additional questions required',
      found: (branches: number, questions: number) =>
        `Found ${branches} program options${questions > 0 ? ` and ${questions} common questions` : ''}`,
    },
    errors: {
      failed: 'Field discovery failed',
      timeout: 'Field discovery took too long',
      invalidRef: 'Program reference is invalid',
    },
  },

  // ------------------------------------------------------------
  // 13. BACKEND RUNNER POLICY / TOOLS
  // ------------------------------------------------------------
  backend: {
    runnerPolicy: (orgName: string) =>
      [
        `SignupAssist v1.0 – Runner Policy (provider-agnostic Browserbase + MCP).`,
        `Organization: ${orgName}. Do not change providers or programs.`,
        `Login/session: reuse persisted context if available; if expired, log in once.`,
        `Navigate to the program page exactly as planned; wait for open time.`,
        `Field rules:`,
        `  • Child/profile fields → selected child.`,
        `  • Non-price fields → first real option (skip placeholders).`,
        `  • Price-bearing fields → choose $0 / no-cost option.`,
        `  • If total > maxAmount → STOP and return PRICE_EXCEEDS_LIMIT.`,
        `  • Required text → "N/A".`,
        `Blockers: CAPTCHA / waiver / modal → STOP and return BLOCKER with reason.`,
        `Audit: record mandate ID + screenshots (login, filled form, confirmation).`,
        `Return status: LOGIN_FAILED | PROGRAM_NOT_OPEN | BLOCKER | PRICE_EXCEEDS_LIMIT | REGISTERED.`,
      ].join('\n'),
    tools: {
      checkPrereqs: (org: string) =>
        `Check prerequisites for ${org}: verify login, membership, waiver, payment method, and child profiles. Use audit only once per session.`,
      findPrograms: (org: string) =>
        `Fetch current programs for ${org}. Use feed if available, otherwise scrape live. Return title + open time.`,
      register: (org: string) =>
        `Perform registration for ${org}. Respect payment cap, choose defaults/$0 options, capture confirmation.`,
    },
    errors: {
      LOGIN_FAILED: 'We could not sign in with the provided credentials.',
      PROGRAM_NOT_OPEN: "Registration is not open yet. We'll wait until the open time.",
      BLOCKER: 'A blocker requires your input (e.g., CAPTCHA or waiver).',
      PRICE_EXCEEDS_LIMIT: 'Total would exceed the approved payment limit.',
      UNKNOWN_ERROR: 'Something unexpected happened. Please try again.',
    },
    audit: {
      mandateCreated: 'mandate_created',
      loginAttempt: 'provider_login',
      sessionStart: 'browserbase_session_started',
      preSubmit: 'form_filled_before_submit',
      confirmation: 'registration_confirmation',
    },
  },

  // ------------------------------------------------------------
  // 13. PREREQUISITES PANEL
  // ------------------------------------------------------------
  prereqs: {
    title: 'Account Prerequisites',
    description: 'Verify your account meets requirements for automated registration',
    recheck: 'Recheck',
    checks: {
      account: {
        title: 'Account Login',
        description: (orgName: string) => `Can we access your ${orgName} account dashboard?`,
      },
      membership: {
        title: 'Active Membership',
        description: 'Required for most programs (typically renewed annually)',
      },
      payment: {
        title: 'Payment Method',
        description: "Card or bank account saved in club's billing portal",
      },
      waiver: {
        title: 'Seasonal Waiver',
        description: 'Liability waiver (often bundled with membership)',
      },
      child: {
        title: 'Child Profile',
        description: 'At least one child must be added to your account',
      },
    },
    status: {
      notChecked: 'Not checked',
      unknown: 'Unknown',
      complete: 'Complete',
      actionNeeded: 'Action Needed',
    },
    child: {
      label: 'Select Child for Registration',
      description: 'Choose which child to register for this program',
      placeholder: 'Select a child',
    },
    progress: (completed: number, total: number) => `${completed} of ${total} requirements complete`,
    oneTimeSetup: 'One-time setup: These requirements (membership, payment method, waivers) are typically completed once. After setup, future registrations will be much faster!',
    allComplete: '✨ All prerequisites complete! You\'re ready to proceed with registration.',
    manualVerify: 'Please verify this manually on the club\'s website.',
    openPortal: 'Open in Club Portal',
  },

  // ------------------------------------------------------------
  // 14. DASHBOARD
  // ------------------------------------------------------------
  dashboard: {
    title: 'Registration Dashboard',
    description: 'Monitor and manage automated registrations',
    createNew: 'Create New Plan',
    refresh: 'Refresh',
    stats: {
      totalPlans: 'Total Plans',
      successRate: 'Success Rate',
      completed: 'Completed',
      failed: 'Failed',
    },
    status: {
      ready: 'Ready to Start',
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed',
    },
    empty: {
      title: 'No Plans Found',
      description: 'Create your first registration plan to get started.',
      cta: 'Create Plan',
    },
    plansTitle: 'Registration Plans',
    plansDescription: 'Manage your automated registration plans and monitor their status',
    loading: 'Loading registration data...',
    actions: {
      start: 'Start',
      view: 'View',
    },
    lastExecution: (date: string) => `Last execution: ${date}`,
    confirmation: (ref: string) => `Confirmation: ${ref}`,
  },

  // ------------------------------------------------------------
  // 15. CREDENTIALS MANAGEMENT
  // ------------------------------------------------------------
  credentials: {
    title: 'Credential Manager',
    description: 'Manage your SkiClubPro login credentials securely',
    addTitle: 'Add New Credentials',
    addDescription: 'Store your SkiClubPro login credentials for automated access',
    addButton: 'Add SkiClubPro Credentials',
    storedTitle: 'Stored Credentials',
    storedDescription: 'Your saved SkiClubPro login credentials',
    form: {
      alias: {
        label: 'Alias',
        placeholder: 'e.g., Primary Account',
      },
      email: {
        label: 'Email',
        placeholder: 'your@email.com',
      },
      password: {
        label: 'Password',
        placeholder: 'Your SkiClubPro password',
      },
    },
    security: {
      title: 'Security Information',
      description: 'Your credentials are encrypted using AES-GCM encryption before being stored. Make sure the CRED_SEAL_KEY is properly configured in your Supabase secrets.',
    },
    empty: {
      title: 'No credentials stored yet',
      description: 'Add your first SkiClubPro credentials to get started',
    },
    actions: {
      store: 'Store Credentials',
      storing: 'Storing...',
      cancel: 'Cancel',
      delete: 'Delete',
    },
    delete: {
      title: 'Delete Credential',
      description: (alias: string) => `Are you sure you want to delete "${alias}"? This action cannot be undone.`,
    },
    success: {
      stored: 'Credentials stored successfully!',
      deleted: 'Credential deleted successfully!',
    },
    errors: {
      loadFailed: 'Failed to load credentials.',
      storeFailed: 'Failed to store credentials.',
      deleteFailed: 'Failed to delete credential.',
    },
  },

  // ------------------------------------------------------------
  // 16. LANDING PAGE
  // ------------------------------------------------------------
  landing: {
    hero: {
      title: 'SignupAssist',
      tagline: 'Automated registration for your children\'s programs',
      createPlan: 'Create Signup Plan',
      viewDashboard: 'View Dashboard',
      manageCredentials: 'Manage Credentials',
    },
    features: [
      {
        title: 'Never Miss Registration',
        description: 'Set up automated registration that runs exactly when registration opens, even if you\'re sleeping or busy.',
      },
      {
        title: 'Secure & Trusted',
        description: 'Your credentials are encrypted and stored securely. We only access your account to complete the specific registration you authorized.',
      },
      {
        title: 'Pay Only on Success',
        description: '$20 service fee charged only when we successfully register your child. No hidden fees or subscriptions.',
      },
    ],
  },

  // ------------------------------------------------------------
  // 17. COMMON ERRORS & VALIDATION
  // ------------------------------------------------------------
  errors: {
    sessionExpired: 'Your session has expired. Please sign in again.',
    notAuthenticated: 'Please sign in to continue.',
    authRequired: 'Authentication Required',
    timeout: 'The request timed out. Please try again.',
    required: (field: string) => `${field} is required`,
    missing: (fields: string[]) => `Please fill out: ${fields.join(', ')}`,
    invalidFormat: (field: string) => `Invalid ${field} format`,
    loadFailed: (resource: string) => `Failed to load ${resource}`,
    invalidProgramRef: 'Program reference appears to be a title instead of a stable reference. Please reselect the program.',
  },
};

// ------------------------------------------------------------
// Small format helpers
// ------------------------------------------------------------
export const fmt = {
  money: (cents: number) =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100),
  dateTimeLocal: (d: Date) =>
    d.toLocaleString(undefined, { hour12: true }),
};
