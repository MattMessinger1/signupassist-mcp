import { describe, it, expect, beforeEach, vi } from 'vitest';
import Logger from '../utils/logger.js';
import { sanitizeForLogs } from '../utils/sanitization.js';

describe('logging sanitization snapshots', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('masks nested sensitive fields in logger payload output', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    Logger.info('audit payload', {
      status: 'ok',
      id: 'reg_123',
      participant_names: ['Ava', 'Liam'],
      profile: {
        first_name: 'Alice',
        lastName: 'Doe',
        dob: '2012-01-01',
        metadata_count: 2,
      },
      contact: {
        email: 'alice@example.com',
        phone: '+1 555-123-1234',
      },
      count: 4,
    });

    const entry = JSON.parse(String(spy.mock.calls[0][0]));
    expect(entry.data).toMatchInlineSnapshot(`
      {
        "contact": {
          "email": "[REDACTED]",
          "phone": "[REDACTED]",
        },
        "count": 4,
        "id": "reg_123",
        "participant_names": "[REDACTED]",
        "profile": {
          "dob": "[REDACTED]",
          "first_name": "[REDACTED]",
          "lastName": "[REDACTED]",
          "metadata_count": 2,
        },
        "status": "ok",
      }
    `);
  });

  it('sanitizes object payloads while preserving non-sensitive metadata', () => {
    const value = sanitizeForLogs({
      request_id: 'req_456',
      status: 'pending',
      date_of_birth: '2014-03-04',
      nested: {
        participantName: 'Kid Name',
        retries: 1,
      },
    });

    expect(value).toMatchInlineSnapshot(`
      {
        "date_of_birth": "[REDACTED]",
        "nested": {
          "participantName": "[REDACTED]",
          "retries": 1,
        },
        "request_id": "req_456",
        "status": "pending",
      }
    `);
  });
});
