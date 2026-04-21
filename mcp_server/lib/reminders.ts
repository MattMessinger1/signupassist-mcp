import { format } from "date-fns";

export const DEFAULT_SUPERVISED_REMINDER_MINUTES = 10;
export const SUPERVISED_REMINDER_ELIGIBLE_STATUSES = [
  "ready",
  "scheduled",
  "waiting_for_registration_open",
  "running",
  "paused_for_parent",
  "registration_review_required",
  "payment_review_required",
  "payment_paused",
  "waiver_review_required",
  "final_submit_review_required",
] as const;

export type ReminderChannel = "email" | "sms" | string;
export type ReminderNotifierMode = "twilio" | "disabled";
export type ReminderDispatchStatus = "sent" | "disabled" | "failed";

export interface SupervisedReminderRun {
  id: string;
  provider_name: string;
  target_program: string | null;
  target_url: string;
  status: string;
  caps: unknown;
}

interface ReminderRecord {
  minutesBefore?: number;
  channels?: unknown;
  phoneNumber?: unknown;
  sms_reminder_sent_at?: unknown;
  sms_reminder_status?: unknown;
  sms_reminder_disabled_reason?: unknown;
  sms_reminder_error?: unknown;
}

export interface ReminderNotifierReadiness {
  mode: ReminderNotifierMode;
  disabledReason: string | null;
  accountSid: string | null;
  authToken: string | null;
  fromNumber: string | null;
}

export interface ReminderDispatchResult {
  status: ReminderDispatchStatus;
  provider: "twilio" | "none";
  disabledReason?: string | null;
  messageSid?: string | null;
  error?: string | null;
}

export interface ReminderDispatchInput {
  run: SupervisedReminderRun;
  to: string;
  body?: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCapsRecord(run: SupervisedReminderRun) {
  return isRecord(run.caps) ? run.caps : {};
}

function readReminderRecord(run: SupervisedReminderRun): ReminderRecord {
  const reminder = readCapsRecord(run).reminder;
  return isRecord(reminder) ? reminder : {};
}

export function readReminderMinutes(run: SupervisedReminderRun) {
  const minutes = readReminderRecord(run).minutesBefore;
  return typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0
    ? minutes
    : DEFAULT_SUPERVISED_REMINDER_MINUTES;
}

export function readReminderChannels(run: SupervisedReminderRun): string[] {
  const channels = readReminderRecord(run).channels;
  if (!Array.isArray(channels)) return [];
  return channels.filter((channel): channel is string => typeof channel === "string" && channel.trim().length > 0);
}

export function readReminderPhoneNumber(run: SupervisedReminderRun) {
  const phoneNumber = readReminderRecord(run).phoneNumber;
  return typeof phoneNumber === "string" && phoneNumber.trim().length > 0 ? phoneNumber.trim() : null;
}

export function readReminderSentAt(run: SupervisedReminderRun) {
  const sentAt = readReminderRecord(run).sms_reminder_sent_at;
  return typeof sentAt === "string" && sentAt.trim().length > 0 ? sentAt : null;
}

export function readReminderStatus(run: SupervisedReminderRun) {
  const status = readReminderRecord(run).sms_reminder_status;
  return typeof status === "string" && status.trim().length > 0 ? status : null;
}

export function buildReminderCapsPatch(
  run: SupervisedReminderRun,
  patch: Record<string, unknown>,
) {
  const caps = readCapsRecord(run);
  const reminder = readReminderRecord(run);

  return {
    ...caps,
    reminder: {
      ...reminder,
      ...patch,
    },
  };
}

export function normalizeSmsRecipientNumber(value?: string | null) {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    return digits.length >= 10 ? `+${digits}` : null;
  }

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 11 && digits.startsWith("1")) return `+${digits}`;

  return null;
}

export function buildSmsReminderMessage(run: SupervisedReminderRun) {
  const providerLabel = run.provider_name?.trim() || "the provider";
  const programLabel = run.target_program?.trim() || "your supervised registration";
  const opensAt = readRegistrationOpensAt(run);
  const openDate = opensAt ? new Date(opensAt) : null;
  const openLabel = openDate && Number.isFinite(openDate.getTime()) ? format(openDate, "PPP p") : "soon";

  return `SignupAssist reminder: ${programLabel} at ${providerLabel} opens ${openLabel}. Parent review is still required before login, payment, or submit.`;
}

export function readRegistrationOpensAt(run: SupervisedReminderRun) {
  const value = readCapsRecord(run).registration_opens_at;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function isSupervisedReminderDue(run: SupervisedReminderRun, now = new Date()) {
  const opensAt = readRegistrationOpensAt(run);
  if (!opensAt) return false;

  const status = (run.status || "").trim().toLowerCase();
  if (!(SUPERVISED_REMINDER_ELIGIBLE_STATUSES as readonly string[]).includes(status)) return false;
  const reminderStatus = readReminderStatus(run);
  if (readReminderSentAt(run) || reminderStatus === "sent" || reminderStatus === "disabled" || reminderStatus === "failed") {
    return false;
  }

  const opensAtMs = new Date(opensAt).getTime();
  if (!Number.isFinite(opensAtMs)) return false;

  const reminderAtMs = opensAtMs - readReminderMinutes(run) * 60_000;
  const nowMs = now.getTime();

  return nowMs >= reminderAtMs && nowMs < opensAtMs;
}

export function getReminderNotifierReadiness(env: NodeJS.ProcessEnv = process.env): ReminderNotifierReadiness {
  const enabled = String(env.ENABLE_SMS_REMINDERS || "").trim().toLowerCase();
  const smsEnabled = enabled === "true" || enabled === "1" || enabled === "on" || enabled === "yes";

  const accountSid = env.TWILIO_ACCOUNT_SID?.trim() || null;
  const authToken = env.TWILIO_AUTH_TOKEN?.trim() || null;
  const fromNumber = normalizeSmsRecipientNumber(env.TWILIO_FROM_NUMBER);

  if (!smsEnabled) {
    return {
      mode: "disabled",
      disabledReason: "feature_flag_disabled",
      accountSid,
      authToken,
      fromNumber,
    };
  }

  if (!accountSid || !authToken || !fromNumber) {
    return {
      mode: "disabled",
      disabledReason: "twilio_config_missing",
      accountSid,
      authToken,
      fromNumber,
    };
  }

  return {
    mode: "twilio",
    disabledReason: null,
    accountSid,
    authToken,
    fromNumber,
  };
}

export function createReminderNotifier(options: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
} = {}) {
  const readiness = getReminderNotifierReadiness(options.env);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  return {
    ...readiness,
    async sendSmsReminder(input: ReminderDispatchInput): Promise<ReminderDispatchResult> {
      if (readiness.mode !== "twilio") {
        return {
          status: "disabled",
          provider: "none",
          disabledReason: readiness.disabledReason,
        };
      }

      const to = normalizeSmsRecipientNumber(input.to);
      if (!to) {
        return {
          status: "disabled",
          provider: "none",
          disabledReason: "invalid_phone_number",
        };
      }

      const body = input.body?.trim() || buildSmsReminderMessage(input.run);
      const messageUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(readiness.accountSid || "")}/Messages.json`;
      const response = await fetchImpl(messageUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${readiness.accountSid}:${readiness.authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: readiness.fromNumber || "",
          To: to,
          Body: body,
        }).toString(),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        return {
          status: "failed",
          provider: "twilio",
          error: errorText || `twilio_http_${response.status}`,
        };
      }

      const payload = await response.json().catch(() => null);
      const messageSid = isRecord(payload) && typeof payload.sid === "string" ? payload.sid : null;

      return {
        status: "sent",
        provider: "twilio",
        messageSid,
      };
    },
  };
}
