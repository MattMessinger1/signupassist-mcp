/**
 * Telemetry module for tracking operational metrics
 * Records events for monitoring, debugging, and analytics
 */

interface TelemetryEvent {
  event: string;
  metadata: Record<string, any>;
  timestamp: string;
}

class Telemetry {
  private events: TelemetryEvent[] = [];

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
    
    // Log to console for immediate visibility
    console.log(`[TELEMETRY] ${event}:`, JSON.stringify(metadata));
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
  }

  /**
   * Get events by type
   */
  getEventsByType(event: string): TelemetryEvent[] {
    return this.events.filter(e => e.event === event);
  }
}

// Singleton instance
export const telemetry = new Telemetry();
