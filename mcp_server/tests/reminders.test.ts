import { describe, expect, it, vi } from "vitest";
import {
  buildSmsReminderMessage,
  createReminderNotifier,
  isSupervisedReminderDue,
  normalizeSmsRecipientNumber,
} from "../lib/reminders";

const reminderRun = {
  id: "run_123",
  provider_name: "DaySmart / Dash",
  target_program: "Soccer camp",
  target_url: "https://example.com/signup",
  status: "scheduled",
  caps: {
    registration_opens_at: "2026-05-01T14:00:00.000Z",
    reminder: {
      minutesBefore: 10,
      channels: ["sms"],
      phoneNumber: "(555) 123-4567",
    },
  },
};

describe("supervised reminder SMS", () => {
  it("keeps the reminder message free of sensitive child and payment data", () => {
    const message = buildSmsReminderMessage(reminderRun);

    expect(message).toContain("Soccer camp");
    expect(message).toContain("DaySmart / Dash");
    expect(message).not.toContain("Ava");
    expect(message).not.toContain("123 Family Lane");
    expect(message).not.toContain("peanuts");
    expect(message).not.toContain("4242424242424242");
    expect(message).not.toContain("token");
  });

  it("only treats a supervised run as due during the reminder window", () => {
    expect(isSupervisedReminderDue(reminderRun, new Date("2026-05-01T13:49:59.000Z"))).toBe(false);
    expect(isSupervisedReminderDue(reminderRun, new Date("2026-05-01T13:50:00.000Z"))).toBe(true);
    expect(isSupervisedReminderDue(reminderRun, new Date("2026-05-01T14:00:00.000Z"))).toBe(false);
  });

  it("skips Twilio when SMS reminders are disabled and normalizes phone numbers when enabled", async () => {
    const fetchSpy = vi.fn();
    const disabledNotifier = createReminderNotifier({
      env: {
        ENABLE_SMS_REMINDERS: "false",
        TWILIO_ACCOUNT_SID: "AC123",
        TWILIO_AUTH_TOKEN: "secret",
        TWILIO_FROM_NUMBER: "+15551234567",
      },
      fetchImpl: fetchSpy,
    });

    const disabledResult = await disabledNotifier.sendSmsReminder({
      run: reminderRun,
      to: "(555) 123-4567",
    });

    expect(disabledResult.status).toBe("disabled");
    expect(disabledResult.disabledReason).toBe("feature_flag_disabled");
    expect(fetchSpy).not.toHaveBeenCalled();

    const twilioCalls: Array<[string, RequestInit | undefined]> = [];
    const notifier = createReminderNotifier({
      env: {
        ENABLE_SMS_REMINDERS: "true",
        TWILIO_ACCOUNT_SID: "AC123",
        TWILIO_AUTH_TOKEN: "secret",
        TWILIO_FROM_NUMBER: "+15551234567",
      },
      fetchImpl: async (input, init) => {
        twilioCalls.push([input, init]);
        return new Response(JSON.stringify({ sid: "SM123" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    const result = await notifier.sendSmsReminder({
      run: reminderRun,
      to: "555-123-4567",
    });

    expect(result.status).toBe("sent");
    expect(result.messageSid).toBe("SM123");
    expect(twilioCalls).toHaveLength(1);

    const [url, init] = twilioCalls[0];
    expect(url).toContain("/Accounts/AC123/Messages.json");
    expect(init?.method).toBe("POST");

    const body = typeof init?.body === "string" ? init.body : "";
    const params = new URLSearchParams(body);
    expect(normalizeSmsRecipientNumber(params.get("From"))).toBe("+15551234567");
    expect(normalizeSmsRecipientNumber(params.get("To"))).toBe("+15551234567");
    expect(params.get("Body")).toContain("SignupAssist reminder");
  });
});
