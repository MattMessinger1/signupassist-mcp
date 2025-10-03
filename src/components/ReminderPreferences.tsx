import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Bell, Mail, MessageSquare } from 'lucide-react';

export interface ReminderPrefs {
  channels: { email: boolean; sms: boolean };
  offsets_sec: number[];
}

interface Props {
  value: ReminderPrefs;
  onChange: (prefs: ReminderPrefs) => void;
}

const OFFSET_OPTIONS = [
  { label: '24 hours before', value: 86400 },
  { label: '1 hour before', value: 3600 },
  { label: '10 minutes before', value: 600 },
];

export default function ReminderPreferences({ value, onChange }: Props) {
  const toggleChannel = (channel: 'email' | 'sms') => {
    onChange({
      ...value,
      channels: { ...value.channels, [channel]: !value.channels[channel] }
    });
  };

  const toggleOffset = (offset: number) => {
    const current = value.offsets_sec;
    const newOffsets = current.includes(offset)
      ? current.filter(o => o !== offset)
      : [...current, offset].sort((a, b) => b - a);
    onChange({ ...value, offsets_sec: newOffsets });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          <CardTitle>Reminders</CardTitle>
        </div>
        <CardDescription>
          We'll remind you before registration opens and update you after we try.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <Label className="text-sm font-medium">Notification channels</Label>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={value.channels.email}
                onCheckedChange={() => toggleChannel('email')}
              />
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Email notifications</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={value.channels.sms}
                onCheckedChange={() => toggleChannel('sms')}
              />
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">SMS notifications</span>
            </label>
          </div>
        </div>

        <div className="space-y-3">
          <Label className="text-sm font-medium">When to remind</Label>
          <div className="flex flex-col gap-2">
            {OFFSET_OPTIONS.map(opt => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={value.offsets_sec.includes(opt.value)}
                  onCheckedChange={() => toggleOffset(opt.value)}
                />
                <span className="text-sm">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
