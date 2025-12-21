/**
 * ParticipantInfoStep - Step 2 of the registration form
 * Collects participant information with support for saved children
 */

import React, { useState } from 'react';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription,
  CardFooter,
  Input, 
  Label, 
  Select, 
  Button,
  Badge,
  Checkbox,
  Separator
} from '../ui';
import { User, UserPlus } from 'lucide-react';
import { COPY } from '../../lib/copy';
import type { SavedChild } from '../../types/openai';

interface ParticipantData {
  firstName: string;
  lastName: string;
  dob?: string;
  grade?: string;
}

interface ParticipantInfoStepProps {
  savedChildren?: SavedChild[];
  numParticipants?: number;
  initialData?: ParticipantData[];
  onSubmit: (participants: ParticipantData[], saveNew: boolean[]) => void;
  onBack: () => void;
}

export function ParticipantInfoStep({ 
  savedChildren = [], 
  numParticipants = 1,
  initialData = [],
  onSubmit, 
  onBack 
}: ParticipantInfoStepProps) {
  const [participants, setParticipants] = useState<ParticipantData[]>(
    initialData.length ? initialData : Array(numParticipants).fill(null).map(() => ({
      firstName: '',
      lastName: '',
      dob: '',
      grade: '',
    }))
  );
  const [selectedChildIds, setSelectedChildIds] = useState<(string | null)[]>(
    Array(numParticipants).fill(null)
  );
  const [saveNew, setSaveNew] = useState<boolean[]>(
    Array(numParticipants).fill(true)
  );

  const handleParticipantChange = (index: number, field: keyof ParticipantData, value: string) => {
    setParticipants(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleSelectSavedChild = (index: number, childId: string) => {
    if (childId === 'new') {
      // Switch to new entry mode
      setSelectedChildIds(prev => {
        const updated = [...prev];
        updated[index] = null;
        return updated;
      });
      setParticipants(prev => {
        const updated = [...prev];
        updated[index] = { firstName: '', lastName: '', dob: '', grade: '' };
        return updated;
      });
    } else {
      // Use saved child data
      const child = savedChildren.find(c => c.id === childId);
      if (child) {
        setSelectedChildIds(prev => {
          const updated = [...prev];
          updated[index] = childId;
          return updated;
        });
        setParticipants(prev => {
          const updated = [...prev];
          updated[index] = {
            firstName: child.first_name,
            lastName: child.last_name,
            dob: child.dob || '',
            grade: '',
          };
          return updated;
        });
      }
    }
  };

  const handleSaveNewChange = (index: number, checked: boolean) => {
    setSaveNew(prev => {
      const updated = [...prev];
      updated[index] = checked;
      return updated;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(participants, saveNew);
  };

  const isValid = participants.every(p => p.firstName && p.lastName);

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            Step 2 of 3
          </Badge>
        </div>
        <CardTitle>{COPY.form.participantTitle}</CardTitle>
        <CardDescription>{COPY.form.participantSubtitle}</CardDescription>
      </CardHeader>
      
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-6">
          {participants.map((participant, index) => (
            <div key={index} className="space-y-4">
              {index > 0 && <Separator />}
              
              <div className="flex items-center gap-2">
                <Badge variant="secondary">
                  Participant {index + 1}
                </Badge>
              </div>

              {/* Saved Children Selector */}
              {savedChildren.length > 0 && (
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
                  <Label className="flex items-center gap-2 text-sm font-medium">
                    <User className="h-4 w-4" />
                    Select from saved participants
                  </Label>
                  <Select
                    value={selectedChildIds[index] || 'new'}
                    onChange={(e) => handleSelectSavedChild(index, e.target.value)}
                  >
                    <option value="new">
                      ➕ Add new participant
                    </option>
                    {savedChildren.map(child => (
                      <option key={child.id} value={child.id}>
                        {child.first_name} {child.last_name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}

              {/* Participant Fields */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor={`participant-${index}-firstName`}>
                    First Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id={`participant-${index}-firstName`}
                    type="text"
                    required
                    value={participant.firstName}
                    onChange={(e) => handleParticipantChange(index, 'firstName', e.target.value)}
                    disabled={!!selectedChildIds[index]}
                    placeholder="Participant's first name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`participant-${index}-lastName`}>
                    Last Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id={`participant-${index}-lastName`}
                    type="text"
                    required
                    value={participant.lastName}
                    onChange={(e) => handleParticipantChange(index, 'lastName', e.target.value)}
                    disabled={!!selectedChildIds[index]}
                    placeholder="Participant's last name"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor={`participant-${index}-dob`}>Date of Birth</Label>
                  <Input
                    id={`participant-${index}-dob`}
                    type="date"
                    value={participant.dob || ''}
                    onChange={(e) => handleParticipantChange(index, 'dob', e.target.value)}
                    disabled={!!selectedChildIds[index]}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`participant-${index}-grade`}>Grade (optional)</Label>
                  <Input
                    id={`participant-${index}-grade`}
                    type="text"
                    value={participant.grade || ''}
                    onChange={(e) => handleParticipantChange(index, 'grade', e.target.value)}
                    placeholder="e.g., 5th"
                  />
                </div>
              </div>

              {/* Save New Participant Checkbox */}
              {!selectedChildIds[index] && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`save-participant-${index}`}
                    checked={saveNew[index]}
                    onCheckedChange={(checked) => handleSaveNewChange(index, checked)}
                  />
                  <Label htmlFor={`save-participant-${index}`} className="text-sm text-gray-600 cursor-pointer">
                    Save this participant for future registrations
                  </Label>
                </div>
              )}
            </div>
          ))}
        </CardContent>

        <CardFooter className="flex justify-between gap-4">
          <Button type="button" variant="outline" onClick={onBack}>
            ← Back
          </Button>
          <Button 
            type="submit" 
            variant="accent" 
            disabled={!isValid}
          >
            Continue to Review →
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
