/**
 * GuardianInfoStep - Step 1 of the registration form
 * Collects responsible delegate (guardian/parent) information
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
  Alert
} from '../ui';
import { TrustCallout } from '../ui/TrustCallout';
import { AlertCircle, Shield } from 'lucide-react';
import { COPY } from '../../lib/copy';
import type { DelegateProfile } from '../../types/openai';

interface GuardianInfoStepProps {
  initialData?: DelegateProfile;
  onSubmit: (data: DelegateProfile) => void;
  onBack?: () => void;
}

const RELATIONSHIP_OPTIONS = [
  { value: 'parent', label: 'Parent' },
  { value: 'guardian', label: 'Legal Guardian' },
  { value: 'grandparent', label: 'Grandparent' },
  { value: 'other', label: 'Other Family Member' },
];

export function GuardianInfoStep({ initialData = {}, onSubmit, onBack }: GuardianInfoStepProps) {
  const [formData, setFormData] = useState<DelegateProfile>(initialData);
  const [saveProfile, setSaveProfile] = useState(true);
  const [ageError, setAgeError] = useState<string | null>(null);

  const handleChange = (field: keyof DelegateProfile, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Validate age if DOB changes
    if (field === 'delegate_dob' && value) {
      const age = calculateAge(value);
      if (age < 18) {
        setAgeError('You must be at least 18 years old to register participants.');
      } else {
        setAgeError(null);
      }
    }
  };

  const calculateAge = (dob: string): number => {
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (formData.delegate_dob && calculateAge(formData.delegate_dob) < 18) {
      setAgeError('You must be at least 18 years old to register participants.');
      return;
    }
    
    onSubmit(formData);
  };

  const isValid = formData.delegate_firstName && 
                  formData.delegate_lastName && 
                  formData.delegate_email && 
                  !ageError;

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            Step 1 of 3
          </Badge>
          <Shield className="h-4 w-4 text-blue-600" />
        </div>
        <CardTitle>{COPY.form.guardianTitle}</CardTitle>
        <CardDescription>{COPY.form.guardianSubtitle}</CardDescription>
      </CardHeader>
      
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {/* Name Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="delegate_firstName">
                First Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="delegate_firstName"
                type="text"
                required
                value={formData.delegate_firstName || ''}
                onChange={(e) => handleChange('delegate_firstName', e.target.value)}
                placeholder="Your first name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="delegate_lastName">
                Last Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="delegate_lastName"
                type="text"
                required
                value={formData.delegate_lastName || ''}
                onChange={(e) => handleChange('delegate_lastName', e.target.value)}
                placeholder="Your last name"
              />
            </div>
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="delegate_email">
              Email <span className="text-red-500">*</span>
            </Label>
            <Input
              id="delegate_email"
              type="email"
              required
              value={formData.delegate_email || ''}
              onChange={(e) => handleChange('delegate_email', e.target.value)}
              placeholder="your.email@example.com"
            />
          </div>

          {/* Phone */}
          <div className="space-y-2">
            <Label htmlFor="delegate_phone">Phone (optional)</Label>
            <Input
              id="delegate_phone"
              type="tel"
              value={formData.delegate_phone || ''}
              onChange={(e) => handleChange('delegate_phone', e.target.value)}
              placeholder="(555) 123-4567"
            />
          </div>

          {/* Date of Birth */}
          <div className="space-y-2">
            <Label htmlFor="delegate_dob">
              Date of Birth (for age verification)
            </Label>
            <Input
              id="delegate_dob"
              type="date"
              value={formData.delegate_dob || ''}
              onChange={(e) => handleChange('delegate_dob', e.target.value)}
            />
            {ageError && (
              <Alert variant="destructive" className="mt-2 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">{ageError}</span>
              </Alert>
            )}
          </div>

          {/* Relationship */}
          <div className="space-y-2">
            <Label htmlFor="delegate_relationship">Relationship to Participant</Label>
            <Select
              id="delegate_relationship"
              value={formData.delegate_relationship || ''}
              onChange={(e) => handleChange('delegate_relationship', e.target.value)}
            >
              <option value="">Select relationship...</option>
              {RELATIONSHIP_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>
          </div>

          {/* Save Profile Checkbox */}
          <div className="flex items-center gap-2 pt-2">
            <Checkbox
              id="save-profile"
              checked={saveProfile}
              onCheckedChange={setSaveProfile}
            />
            <Label htmlFor="save-profile" className="text-sm text-gray-600 cursor-pointer">
              Save my information for future registrations
            </Label>
          </div>

          {/* Trust Messaging */}
          <TrustCallout
            title="🔒 Your information is secure"
            bullets={[
              "Encrypted end-to-end",
              "Only used to complete your registration",
              "Never shared with third parties",
            ]}
          />
        </CardContent>

        <CardFooter className="flex justify-between">
          {onBack && (
            <Button type="button" variant="outline" onClick={onBack}>
              Back
            </Button>
          )}
          <Button 
            type="submit" 
            variant="accent" 
            disabled={!isValid}
            className="ml-auto"
          >
            Continue to Participant Info →
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
