/**
 * prompts.ts
 * Lovable-optimized, provider-agnostic prompts for SignupAssist v1.0
 */

export const prompts = {
  ui: {
    titles: {
      plan: 'Create your signup plan',
      signin: (orgName: string) => `Sign in to ${orgName}`,
      program: 'Pick your program',
      child: 'Choose the child',
      openTime: 'Set the registration open time',
      priceLimit: 'Payment limit',
      defaults: 'How we will handle extra questions',
      contact: 'If we need you',
      review: 'Review and authorize',
      success: 'Mandate created',
    },

    cta: {
      saveAndCheck: 'Save and check my account',
      fetchPrograms: 'Fetch programs',
      useProgram: 'Use this program',
      useChild: 'Use this child',
      continue: 'Continue',
      createMandate: 'Looks good - create mandate',
      done: 'Done',
      changeProgram: 'Change program',
      changeChild: 'Change child',
      editTime: 'Edit time',
      editLimit: 'Edit payment limit',
    },

    signin: {
      fields: {
        usernameLabel: 'Email or username',
        usernamePh: 'you@example.com',
        passwordLabel: 'Password',
        passwordPh: '••••••••',
      },
      helpers: {
        purpose: (orgName: string) =>
          `Use the same login you use for ${orgName} registrations. We will only use it to sign you in and register.`,
        prep: 'Before registration opens, please make sure your membership is current and any required waivers are signed.',
      },
      nudges: [
        'I have paid the current membership fee',
        'I have signed required waivers',
      ],
      errors: {
        badLogin: 'That login did not work. Please check your email/username and password.',
        missingPrereq: 'Your account is missing something (membership, waiver, or payment method). You can fix it in your account and try again.',
      },
    },

    programs: {
      searchLabel: 'Find a program',
      searchPh: 'Start typing the program name',
      helper: (orgName: string) =>
        `We will load the current program list from ${orgName} so you can choose the exact one.`,
      item: (title: string, local: string, utc: string) =>
        `${title}\nOpens: ${local} (converted: ${utc} UTC)`,
      empty: 'No results match that search. Try a shorter phrase.',
      loadError: 'We could not load programs right now. Please try again.',
      toastSelected: (title: string) => `Great - ${title} selected.`,
    },

    child: {
      label: 'Choose the child',
      helper: (orgName: string) =>
        `Select the child exactly as listed in your ${orgName} account.`,
      ph: 'Select a child',
      notFound: 'We did not find a matching child on your account. Please check the profile name in your account, then try again.',
      toastSelected: (name: string) => `Child ${name} selected.`,
    },

    openTime: {
      helper: 'We will convert this to UTC to avoid any time drift. Please double-check.',
      preview: (local: string, utc: string) =>
        `Runs at ${local} your time (${utc} UTC).`,
      errors: {
        future: 'Please enter a future date and time.',
        tz: 'Time zone required.',
      },
    },

    limit: {
      label: 'Maximum program charge you approve',
      ph: '$175.00',
      helper: 'We will never authorize more than this. We will also choose no-cost options for add-ons.',
      errors: {
        invalid: 'Please enter a valid dollar amount (e.g., 175 or 175.00).',
        tooLow: (hint: string) => `This amount looks low for this program. Consider at least ${hint}.`,
      },
    },

    defaults: {
      headline: 'How we will handle extra questions',
      explainer: 'If the form asks extra questions (jersey size, color group, rentals, etc.), we will answer them so your signup can finish without delay.',
      rules: [
        'We will pick the first or default option for general questions.',
        'If the first option is just a placeholder (e.g., "Select"), we will pick the first real choice.',
        'If a choice affects cost, we will select the $0 / no-cost option.',
        'If anything would exceed your payment limit, we will stop and let you know.',
      ],
      toggles: {
        pickDefault: 'Pick first/default for general questions',
        pickFree: 'Always choose the no-cost option for extras',
        stopOnLimit: 'Stop if anything would exceed my payment limit',
      },
    },

    contact: {
      label: 'Mobile number',
      ph: '(555) 123-4567',
      helper: 'We will only use this if something requires your input (e.g., a CAPTCHA or a new waiver).',
      error: 'Please enter a valid mobile number we can text.',
    },

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
        'I authorize SignupAssist to fill out and submit the program registration form for me.',
        'I authorize SignupAssist to answer additional form questions using the rules above (first/default; $0 options).',
        `I authorize SignupAssist to pay up to ${maxAmount} to complete this registration.`,
        'I understand SignupAssist will pause and contact me if something requires my input (e.g., CAPTCHA or waiver).',
        'I agree that a simple audit log (including key screenshots) may be kept to confirm the steps taken for my signup.',
      ],
    },

    success: {
      title: 'Mandate created',
      body: (local: string, utc: string) =>
        `You are all set. We will run your signup at ${local} (${utc} UTC). You will get a confirmation once it is done.`,
    },

    toasts: {
      programsUpdated: 'Programs updated just now.',
      prereqsOk: 'Account looks ready - membership, waivers, and payment method found.',
      prereqsMissing: 'Heads up: something is missing (membership/waiver/payment). You can save this plan and fix it before open.',
      saved: 'Saved.',
      scheduled: (local: string) => `Signup scheduled for ${local}.`,
      priceLimit: (max: string) => `We stopped because the total would exceed your ${max} limit.`,
    },

    notify: {
      smsSubject: (program: string) => `Quick help needed for ${program}`,
      smsBody: (child: string, program: string, reason: string) =>
        `SignupAssist: blocker while registering ${child} for ${program} (reason: ${reason}). Please resolve in your account, then tap "Try again" in SignupAssist.`,
      emailSubject: (program: string) => `Action needed for ${program}`,
      emailBody: (child: string, program: string, reason: string) =>
        `We hit a blocker while registering ${child} for ${program}.\n\nReason: ${reason}\n\nPlease resolve this in your account. After that, return to SignupAssist and choose "Try again".`,
    },
  },

  backend: {
    runnerPolicy: (orgName: string) =>
      [
        'SignupAssist v1.0 - Runner Policy (provider-agnostic; Browserbase + MCP on Railway).',
        `Organization: ${orgName}. Do not change providers or programs.`,
        'Use existing Browserbase integration as-is. Do NOT spawn local browsers. Do NOT alter session mechanics.',
        'Login/session: reuse persisted Context when available. If login state is missing or expired, log in once.',
        'Timing: wait until the program is open, then submit.',
        'Field-filling rules:',
        '  1) Map child/profile fields to the selected child.',
        '  2) For non-price fields with options, pick the first/default option.',
        '  3) If the first option is a placeholder (e.g., "Select"), pick the first real choice.',
        '  4) For price-bearing options (detect $, fee, add-on), choose the $0 / no-cost option.',
        '  5) If total > maxAmount, STOP and return PRICE_EXCEEDS_LIMIT.',
        '  6) Required text fields with no cost impact: use "N/A".',
        'Blockers: if CAPTCHA, new waiver, or an unpassable modal appears, STOP and return BLOCKER with a short reason.',
        'Audit: keep it simple - record mandate reference and key screenshots for login, filled form pre-submit, and confirmation.',
        'Return status: one of LOGIN_FAILED | PROGRAM_NOT_OPEN | BLOCKER | PRICE_EXCEEDS_LIMIT | REGISTERED, plus any confirmation info.',
      ].join('\n'),

    tools: {
      checkPrereqs: (orgName: string) =>
        `Check prerequisites for ${orgName}: verify login, membership, waivers, payment method, and list children. Keep audit simple (one login/session event).`,
      findPrograms: (orgName: string) =>
        `Fetch current programs for ${orgName}. Prefer feed; fall back to live discovery. Return accurate titles and open datetimes.`,
      register: (orgName: string) =>
        `Perform registration for ${orgName} exactly as planned. Respect payment cap. Default/$0 choices for extras. Capture confirmation.`,
    },

    errors: {
      LOGIN_FAILED: 'We could not sign in with the provided credentials.',
      PROGRAM_NOT_OPEN: 'Registration is not open yet. We will wait until the specified open time.',
      BLOCKER: 'A blocker requires your input (e.g., CAPTCHA or waiver).',
      PRICE_EXCEEDS_LIMIT: 'Total would exceed the approved payment limit.',
      UNKNOWN_ERROR: 'Something unexpected happened. Please try again.',
    },

    logs: {
      start: (tool: string, mandateId?: string) =>
        `[${tool}] start${mandateId ? ` mandate=${mandateId}` : ''}`,
      done: (tool: string, status: string) =>
        `[${tool}] done status=${status}`,
      blocker: (reason: string) => `[register] BLOCKER reason="${reason}"`,
      price: (totalCents: number, maxCents: number) =>
        `[register] PRICE_EXCEEDS_LIMIT total=${totalCents} max=${maxCents}`,
    },

    audit: {
      mandateCreated: 'mandate_created',
      loginAttempt: 'provider_login',
      sessionStart: 'browserbase_session_started',
      preSubmit: 'form_filled_before_submit',
      confirmation: 'registration_confirmation',
    },

    notify: {
      sms: (child: string, program: string, reason: string) =>
        `SignupAssist: blocker while registering ${child} for ${program} - ${reason}. Please resolve, then tap "Try again".`,
      emailSubject: (program: string) => `Help needed for ${program}`,
      emailBody: (child: string, program: string, reason: string) =>
        `We ran into a blocker while registering ${child} for ${program}.\n\nReason: ${reason}\n\nPlease fix this in your account and then retry from SignupAssist.`,
    },
  },
};

export const fmt = {
  money: (cents: number) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100),
  dateTimeLocal: (d: Date) =>
    d.toLocaleString(undefined, { hour12: true }),
};
