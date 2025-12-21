import { useState, useEffect } from 'react';
import { CalendarIcon, Clock } from 'lucide-react';

interface OpenTimePickerProps {
  value?: Date;
  onChange: (date: Date) => void;
  label?: string;
}

// Common timezones
const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Vancouver',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
  'UTC'
];

export function OpenTimePicker({ value, onChange, label = "When does registration open?" }: OpenTimePickerProps) {
  const [localDateTime, setLocalDateTime] = useState('');
  const [timezone, setTimezone] = useState('');

  // Get browser timezone on mount
  useEffect(() => {
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setTimezone(browserTimezone);
  }, []);

  // Update local datetime when value changes
  useEffect(() => {
    if (value && timezone) {
      // Format date for datetime-local input
      const options: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: timezone
      };
      const parts = new Intl.DateTimeFormat('en-CA', options).formatToParts(value);
      const getPart = (type: string) => parts.find(p => p.type === type)?.value || '';
      const formatted = `${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}:${getPart('minute')}`;
      setLocalDateTime(formatted);
    }
  }, [value, timezone]);

  const handleDateTimeChange = (newDateTime: string) => {
    setLocalDateTime(newDateTime);
    
    if (newDateTime && timezone) {
      // Parse the local datetime and convert to UTC
      const localDate = new Date(newDateTime);
      // Get the offset for the target timezone
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'longOffset'
      });
      const formatted = formatter.format(localDate);
      const match = formatted.match(/GMT([+-]\d{1,2}):?(\d{2})?/);
      
      if (match) {
        const hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2] || '0', 10);
        const offsetMs = (hours * 60 + (hours < 0 ? -minutes : minutes)) * 60 * 1000;
        const utcDate = new Date(localDate.getTime() - offsetMs + localDate.getTimezoneOffset() * 60 * 1000);
        onChange(utcDate);
      } else {
        onChange(localDate);
      }
    }
  };

  const handleTimezoneChange = (newTimezone: string) => {
    setTimezone(newTimezone);
    
    if (localDateTime && value) {
      // Recalculate with new timezone
      handleDateTimeChange(localDateTime);
    }
  };

  const formatDisplayDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: timezone || undefined
    }).format(date);
  };

  return (
    <div className="border border-border rounded-lg p-4 space-y-4 bg-card">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{label}</span>
      </div>
      <p className="text-xs text-muted-foreground">We'll attempt signup at this exact time</p>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="datetime" className="block text-sm font-medium mb-1">Date & Time</label>
          <div className="relative">
            <input
              id="datetime"
              type="datetime-local"
              value={localDateTime}
              onChange={(e) => handleDateTimeChange(e.target.value)}
              className="w-full pl-10 pr-3 py-2 border border-input rounded-md bg-background text-foreground"
            />
            <CalendarIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
        </div>
        
        <div>
          <label htmlFor="timezone" className="block text-sm font-medium mb-1">Timezone</label>
          <select
            id="timezone"
            value={timezone}
            onChange={(e) => handleTimezoneChange(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
          >
            <option value="">Select timezone...</option>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
      </div>
      
      {value && localDateTime && timezone && (
        <div className="text-sm space-y-1 bg-muted/50 p-3 rounded-lg">
          <div className="font-medium">Preview:</div>
          <div className="text-muted-foreground">
            Local: {formatDisplayDate(value)} ({timezone})
          </div>
          <div className="text-muted-foreground">
            UTC: {value.toISOString()} (stored)
          </div>
        </div>
      )}
    </div>
  );
}
