/**
 * calendar.ts
 * Calendar link generators for registration confirmation.
 * Enables parents to easily save class times to their calendar.
 */

export interface CalendarEventData {
  title: string;
  startTime: string;       // ISO 8601 format
  endTime?: string;        // ISO 8601 format (defaults to startTime + 1 hour)
  location?: string;
  description?: string;
}

/**
 * Generate .ics file content for calendar import.
 * Works with Apple Calendar, Outlook, Google Calendar (import), and most calendar apps.
 */
export function generateIcsContent(event: CalendarEventData): string {
  const { title, startTime, endTime, location, description } = event;
  
  const start = new Date(startTime);
  if (isNaN(start.getTime())) {
    return ''; // Invalid date, can't generate calendar
  }
  
  // Default end time: 1 hour after start
  const end = endTime ? new Date(endTime) : new Date(start.getTime() + 60 * 60 * 1000);
  
  // Format dates for iCalendar (YYYYMMDDTHHMMSSZ for UTC)
  const formatIcsDate = (date: Date): string => {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  };
  
  // Escape special characters in text fields
  const escapeIcs = (text: string): string => {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  };
  
  const uid = `signupassist-${Date.now()}-${Math.random().toString(36).substring(2, 9)}@signupassist.ai`;
  
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SignupAssist//Class Registration//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(start)}`,
    `DTEND:${formatIcsDate(end)}`,
    `SUMMARY:${escapeIcs(title)}`,
  ];
  
  if (location) {
    lines.push(`LOCATION:${escapeIcs(location)}`);
  }
  
  if (description) {
    lines.push(`DESCRIPTION:${escapeIcs(description)}`);
  }
  
  lines.push('END:VEVENT', 'END:VCALENDAR');
  
  return lines.join('\r\n');
}

/**
 * Generate a data: URL for .ics file download.
 * Can be used directly in an <a href="..."> link.
 */
export function generateIcsDataUrl(event: CalendarEventData): string {
  const icsContent = generateIcsContent(event);
  if (!icsContent) return '';
  
  // Base64 encode for data URL
  const base64 = Buffer.from(icsContent).toString('base64');
  return `data:text/calendar;base64,${base64}`;
}

/**
 * Generate Google Calendar URL for one-click add.
 * Opens Google Calendar in a new tab with pre-filled event details.
 */
export function generateGoogleCalendarUrl(event: CalendarEventData): string {
  const { title, startTime, endTime, location, description } = event;
  
  const start = new Date(startTime);
  if (isNaN(start.getTime())) {
    return ''; // Invalid date
  }
  
  // Default end time: 1 hour after start
  const end = endTime ? new Date(endTime) : new Date(start.getTime() + 60 * 60 * 1000);
  
  // Google Calendar uses compact date format: YYYYMMDDTHHMMSSZ
  const formatGoogleDate = (date: Date): string => {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  };
  
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${formatGoogleDate(start)}/${formatGoogleDate(end)}`,
  });
  
  if (location) {
    params.set('location', location);
  }
  
  if (description) {
    params.set('details', description);
  }
  
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Generate calendar links section for success message.
 * Returns a formatted string with both Google Calendar and .ics download options.
 */
export function generateCalendarLinksSection(event: CalendarEventData): string {
  const googleUrl = generateGoogleCalendarUrl(event);
  const icsUrl = generateIcsDataUrl(event);
  
  if (!googleUrl && !icsUrl) {
    return ''; // No valid date, skip calendar section
  }
  
  const links: string[] = [];
  
  if (googleUrl) {
    links.push(`[Google Calendar](${googleUrl})`);
  }
  
  if (icsUrl) {
    links.push(`[Download .ics](${icsUrl})`);
  }
  
  return `📅 **Add to calendar:** ${links.join(' | ')}`;
}

