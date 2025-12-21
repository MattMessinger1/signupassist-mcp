/**
 * ReviewStep - Step 3 of the registration form
 * Review all information, show fee breakdown, and get consent before payment
 */

import React, { useState } from 'react';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription,
  CardFooter,
  Button,
  Badge,
  Separator,
  Checkbox,
  Label
} from '../ui';
import { TrustCallout } from '../ui/TrustCallout';
import { FeeBreakdown, calculateServiceFee } from '../ui/FeeBreakdown';
import { COPY } from '../../lib/copy';
import type { DelegateProfile } from '../../types/openai';

interface ParticipantData {
  firstName: string;
  lastName: string;
  dob?: string;
  grade?: string;
}

interface ReviewStepProps {
  guardianData: DelegateProfile;
  participantData: ParticipantData[];
  program?: {
    title: string;
    price?: string;
    priceCents?: number;
    startDate?: string;
  };
  onConfirm: () => void;
  onBack: () => void;
  isSubmitting?: boolean;
}

interface ConsentItem {
  id: string;
  label: string;
  required: boolean;
}

const CONSENT_ITEMS: ConsentItem[] = [
  { id: 'login', label: 'Authorize SignupAssist to log in to the activity provider on my behalf', required: true },
  { id: 'fill', label: 'Allow form fields to be filled with my provided information', required: true },
  { id: 'payment', label: 'Process payment for the program fee through the provider', required: true },
  { id: 'delegate', label: 'I understand SignupAssist acts as my authorized delegate', required: true },
];

export function ReviewStep({ 
  guardianData, 
  participantData, 
  program,
  onConfirm, 
  onBack,
  isSubmitting = false
}: ReviewStepProps) {
  const [consents, setConsents] = useState<Record<string, boolean>>({});
  
  const allConsentsGiven = CONSENT_ITEMS.every(
    item => !item.required || consents[item.id]
  );

  const handleConsentChange = (id: string, checked: boolean) => {
    setConsents(prev => ({ ...prev, [id]: checked }));
  };

  // Calculate fees
  const programFeeCents = program?.priceCents || 0;
  const serviceFeeCents = programFeeCents > 0 ? calculateServiceFee(programFeeCents) : 0;

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            Step 3 of 4
          </Badge>
          <span className="text-green-600">✓</span>
        </div>
        <CardTitle>{COPY.form.reviewTitle}</CardTitle>
        <CardDescription>{COPY.form.reviewSubtitle}</CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Program Summary */}
        {program && (
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
            <h4 className="font-semibold text-blue-900 mb-2">📚 Program</h4>
            <p className="text-blue-800">{program.title}</p>
            {program.price && (
              <p className="text-sm text-blue-700 mt-1">
                💰 {program.price}
              </p>
            )}
            {program.startDate && (
              <p className="text-sm text-blue-700">
                🗓 Starts: {program.startDate}
              </p>
            )}
          </div>
        )}

        <Separator />

        {/* Guardian Summary */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-gray-600">👤</span>
            <h4 className="font-semibold text-gray-900">Responsible Delegate</h4>
          </div>
          <div className="pl-6 space-y-1 text-sm">
            <p>
              <span className="text-gray-500">Name:</span>{' '}
              <span className="font-medium">
                {guardianData.delegate_firstName} {guardianData.delegate_lastName}
              </span>
            </p>
            {guardianData.delegate_email && (
              <p>
                <span className="text-gray-500">Email:</span>{' '}
                <span className="font-medium">{guardianData.delegate_email}</span>
              </p>
            )}
            {guardianData.delegate_phone && (
              <p>
                <span className="text-gray-500">Phone:</span>{' '}
                <span className="font-medium">{guardianData.delegate_phone}</span>
              </p>
            )}
            {guardianData.delegate_relationship && (
              <p>
                <span className="text-gray-500">Relationship:</span>{' '}
                <span className="font-medium capitalize">{guardianData.delegate_relationship}</span>
              </p>
            )}
          </div>
        </div>

        <Separator />

        {/* Participants Summary */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-gray-600">👥</span>
            <h4 className="font-semibold text-gray-900">
              Participant{participantData.length > 1 ? 's' : ''} ({participantData.length})
            </h4>
          </div>
          <div className="pl-6 space-y-3">
            {participantData.map((participant, index) => (
              <div key={index} className="text-sm">
                <p className="font-medium">
                  {index + 1}. {participant.firstName} {participant.lastName}
                </p>
                {participant.dob && (
                  <p className="text-gray-500 text-xs">DOB: {participant.dob}</p>
                )}
                {participant.grade && (
                  <p className="text-gray-500 text-xs">Grade: {participant.grade}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        <Separator />

        {/* Fee Breakdown */}
        {programFeeCents > 0 && (
          <>
            <div className="space-y-2">
              <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                💰 Fee Summary
              </h4>
              <FeeBreakdown
                programFeeCents={programFeeCents}
                serviceFeeCents={serviceFeeCents}
                serviceFeeNote="Service fee covers secure processing and support"
              />
            </div>
            <Separator />
          </>
        )}

        {/* Consent Checkboxes */}
        <div className="space-y-4">
          <h4 className="font-semibold text-gray-900 flex items-center gap-2">
            ✅ Authorization
          </h4>
          <div className="space-y-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
            {CONSENT_ITEMS.map((item) => (
              <div key={item.id} className="flex items-start gap-3">
                <Checkbox
                  id={item.id}
                  checked={consents[item.id] || false}
                  onCheckedChange={(checked) => handleConsentChange(item.id, !!checked)}
                  className="mt-0.5"
                />
                <Label htmlFor={item.id} className="text-sm text-gray-700 cursor-pointer">
                  {item.label}
                  {item.required && <span className="text-red-500 ml-1">*</span>}
                </Label>
              </div>
            ))}
          </div>
          {!allConsentsGiven && (
            <p className="text-xs text-gray-500">
              Please check all required boxes to proceed
            </p>
          )}
        </div>

        <Separator />

        {/* Trust Messaging */}
        <TrustCallout
          title={COPY.trust.title}
          bullets={COPY.trust.bullets}
          footer={COPY.trust.payment}
        />
      </CardContent>

      <CardFooter className="flex justify-between gap-4">
        <Button type="button" variant="outline" onClick={onBack} disabled={isSubmitting}>
          ← Back
        </Button>
        <Button 
          variant="accent" 
          onClick={onConfirm}
          disabled={isSubmitting || !allConsentsGiven}
          className="min-w-[200px]"
        >
          {isSubmitting ? (
            <>
              <span className="animate-spin mr-2">⏳</span>
              Processing...
            </>
          ) : (
            '💳 Authorize & Continue to Payment'
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
