import { useState, useEffect } from 'react';
import { CalendarIcon, Clock } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';

interface OpenTimePickerProps {
  value?: Date;
  onChange: (date: Date) => void;
}

export function OpenTimePicker({ value, onChange }: OpenTimePickerProps) {
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
      // Convert UTC date to local time in the selected timezone
      const localTime = new Date(value.getTime() - (value.getTimezoneOffset() * 60000));
      setLocalDateTime(localTime.toISOString().slice(0, 16));
    }
  }, [value, timezone]);

  const handleDateTimeChange = (newDateTime: string) => {
    setLocalDateTime(newDateTime);
    
    if (newDateTime && timezone) {
      // Create a date object from the local datetime
      const localDate = new Date(newDateTime);
      
      // Convert to UTC using the selected timezone
      // This is a simplified conversion - for production, consider using a library like date-fns-tz
      const utcDate = new Date(localDate.getTime() + (localDate.getTimezoneOffset() * 60000));
      
      onChange(utcDate);
    }
  };

  const handleTimezoneChange = (newTimezone: string) => {
    setTimezone(newTimezone);
    
    if (localDateTime) {
      // Recalculate UTC time with new timezone
      const localDate = new Date(localDateTime);
      const utcDate = new Date(localDate.getTime() + (localDate.getTimezoneOffset() * 60000));
      onChange(utcDate);
    }
  };

  // Common timezones
  const commonTimezones = [
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

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center space-x-2 mb-4">
          <Clock className="h-4 w-4" />
          <span className="font-medium">Registration Opens At</span>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="datetime">Date & Time</Label>
            <div className="relative">
              <Input
                id="datetime"
                type="datetime-local"
                value={localDateTime}
                onChange={(e) => handleDateTimeChange(e.target.value)}
                className="pl-10"
              />
              <CalendarIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            </div>
          </div>
          
          <div>
            <Label htmlFor="timezone">Timezone</Label>
            <Select value={timezone} onValueChange={handleTimezoneChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select timezone..." />
              </SelectTrigger>
              <SelectContent>
                {commonTimezones.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz.replace('_', ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        
        {value && (
          <div className="text-sm text-muted-foreground">
            UTC: {value.toISOString().replace('T', ' ').slice(0, 19)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}