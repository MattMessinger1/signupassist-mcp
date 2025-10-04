import { retryWithBackoff, logExecutionAttempt } from './retry.ts';
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

/**
 * Browserbase client wrapper with automatic retry logic
 */
export class BrowserbaseClient {
  private apiKey: string;
  private projectId: string;
  private supabase: SupabaseClient;

  constructor(apiKey: string, projectId: string, supabase: SupabaseClient) {
    this.apiKey = apiKey;
    this.projectId = projectId;
    this.supabase = supabase;
  }

  /**
   * Create a Browserbase session with retry logic
   */
  async createSession(context: {
    correlationId: string;
    planId?: string;
    planExecutionId?: string;
    mandateId?: string;
  }): Promise<any> {
    console.log('[Browserbase] Creating session with retry logic...');

    return await retryWithBackoff(
      async () => {
        const response = await fetch('https://www.browserbase.com/v1/sessions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-BB-API-Key': this.apiKey,
          },
          body: JSON.stringify({
            projectId: this.projectId,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw {
            status: response.status,
            message: `Browserbase session creation failed: ${errorText}`,
          };
        }

        const session = await response.json();
        console.log('[Browserbase] Session created:', session.id);

        // Log success
        await logExecutionAttempt(this.supabase, {
          ...context,
          stage: 'browser_automation',
          status: 'success',
          attempt: 1,
          metadata: {
            sessionId: session.id,
            action: 'create_session',
          },
        });

        return session;
      },
      {
        maxAttempts: 3,
        initialDelayMs: 2000,
        maxDelayMs: 8000,
        onRetry: async (attempt, error) => {
          console.log(`[Browserbase] Retry attempt ${attempt} after error:`, error.message);

          // Log retry attempt
          await logExecutionAttempt(this.supabase, {
            ...context,
            stage: 'browser_automation',
            status: 'failed',
            attempt,
            errorMessage: error.message || String(error),
            metadata: {
              action: 'create_session',
              retrying: true,
            },
          });
        },
      }
    );
  }

  /**
   * Execute automation script with retry logic
   */
  async executeAutomation(
    sessionId: string,
    script: string,
    context: {
      correlationId: string;
      planId?: string;
      planExecutionId?: string;
      mandateId?: string;
    }
  ): Promise<any> {
    console.log('[Browserbase] Executing automation with retry logic...');

    return await retryWithBackoff(
      async () => {
        const response = await fetch(
          `https://www.browserbase.com/v1/sessions/${sessionId}/execute`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-BB-API-Key': this.apiKey,
            },
            body: JSON.stringify({
              script,
            }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw {
            status: response.status,
            message: `Browserbase automation failed: ${errorText}`,
          };
        }

        const result = await response.json();
        console.log('[Browserbase] Automation completed');

        // Log success
        await logExecutionAttempt(this.supabase, {
          ...context,
          stage: 'browser_automation',
          status: 'success',
          attempt: 1,
          metadata: {
            sessionId,
            action: 'execute_automation',
          },
        });

        return result;
      },
      {
        maxAttempts: 3,
        initialDelayMs: 2000,
        maxDelayMs: 8000,
        onRetry: async (attempt, error) => {
          console.log(`[Browserbase] Retry attempt ${attempt} after error:`, error.message);

          // Log retry attempt
          await logExecutionAttempt(this.supabase, {
            ...context,
            stage: 'browser_automation',
            status: 'failed',
            attempt,
            errorMessage: error.message || String(error),
            metadata: {
              sessionId,
              action: 'execute_automation',
              retrying: true,
            },
          });
        },
      }
    );
  }

  /**
   * Close a Browserbase session
   */
  async closeSession(
    sessionId: string,
    context: {
      correlationId: string;
      planId?: string;
      planExecutionId?: string;
      mandateId?: string;
    }
  ): Promise<void> {
    try {
      await fetch(`https://www.browserbase.com/v1/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: {
          'X-BB-API-Key': this.apiKey,
        },
      });

      console.log('[Browserbase] Session closed:', sessionId);

      // Log success
      await logExecutionAttempt(this.supabase, {
        ...context,
        stage: 'browser_automation',
        status: 'success',
        attempt: 1,
        metadata: {
          sessionId,
          action: 'close_session',
        },
      });
    } catch (error) {
      console.error('[Browserbase] Failed to close session:', error);
      // Don't throw - closing errors shouldn't fail the main flow
    }
  }
}
