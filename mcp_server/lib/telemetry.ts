/**
 * Telemetry module for tracking operational metrics
 * Records events for monitoring, debugging, and analytics
 */

import Logger from '../utils/logger.js';

interface TelemetryEvent {
  event: string;
  metadata: Record<string, any>;
  timestamp: string;
}

class Telemetry {
  private events: TelemetryEvent[] = [];
  private counters = new Map<string, number>();

  /**
   * Record a telemetry event
   */
  record(event: string, metadata: Record<string, any> = {}): void {
    const telemetryEvent: TelemetryEvent = {
      event,
      metadata,
      timestamp: new Date().toISOString()
    };

    this.events.push(telemetryEvent);

    // Export to durable log sink for production dashboarding.
    Logger.info('[telemetry_event]', {
      event,
      metadata,
      timestamp: telemetryEvent.timestamp,
    });
    
    // Log to console for immediate visibility
    console.log(`[TELEMETRY] ${event}:`, JSON.stringify(metadata));
  }


  /**
   * Increment a telemetry counter by name
   */
  incrementCounter(
    name: string,
    by = 1,
    tags: Record<string, string | number | boolean | undefined> = {}
  ): number {
    const current = this.counters.get(name) ?? 0;
    const next = current + by;
    this.counters.set(name, next);

    // Export to durable metric sink for production dashboarding.
    Logger.info('[metrics]', {
      metric_type: 'counter',
      metric_name: name,
      value: next,
      tags,
    });

    console.log(`[TELEMETRY] counter.${name}: ${next}`);
    return next;
  }

  /**
   * Get a telemetry counter value
   */
  getCounter(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  /**
   * Get all recorded events
   */
  getEvents(): TelemetryEvent[] {
    return [...this.events];
  }

  /**
   * Clear all recorded events
   */
  clear(): void {
    this.events = [];
    this.counters.clear();
  }

  /**
   * Get events by type
   */
  getEventsByType(event: string): TelemetryEvent[] {
    return this.events.filter(e => e.event === event);
  }

  /**
   * Snapshot all counters
   */
  getCounters(): Record<string, number> {
    return Object.fromEntries(this.counters.entries());
  }
}

// Singleton instance
export const telemetry = new Telemetry();
