/**
 * ReviewStep - Step 3 of the registration form
 * Review all information before submitting
 */

import React from 'react';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription,
  CardFooter,
  Button,
  Badge,
  Separator
} from '../ui';
import { TrustCallout } from '../ui/TrustCallout';
import { CheckCircle, User, Users, CreditCard } from 'lucide-react';
import { COPY } from '../../lib/copy';
import type { DelegateProfile, SavedChild } from '../../types/openai';

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
    startDate?: string;
  };
  onConfirm: () => void;
  onBack: () => void;
  isSubmitting?: boolean;
}

export function ReviewStep({ 
  guardianData, 
  participantData, 
  program,
  onConfirm, 
  onBack,
  isSubmitting = false
}: ReviewStepProps) {
  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            Step 3 of 3
          </Badge>
          <CheckCircle className="h-4 w-4 text-green-600" />
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
            <User className="h-4 w-4 text-gray-600" />
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
            <Users className="h-4 w-4 text-gray-600" />
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

        {/* Trust Messaging */}
        <TrustCallout
          title={COPY.trust.title}
          bullets={COPY.trust.bullets}
          footer={COPY.trust.payment}
        />

        {/* Payment Note */}
        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 flex items-start gap-3">
          <CreditCard className="h-5 w-5 text-gray-500 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-gray-900">
              Payment handled securely by Stripe
            </p>
            <p className="text-xs text-gray-500 mt-1">
              You'll be redirected to complete payment after confirmation.
            </p>
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex justify-between gap-4">
        <Button type="button" variant="outline" onClick={onBack} disabled={isSubmitting}>
          ← Back
        </Button>
        <Button 
          variant="accent" 
          onClick={onConfirm}
          disabled={isSubmitting}
          className="min-w-[200px]"
        >
          {isSubmitting ? (
            <>
              <span className="animate-spin mr-2">⏳</span>
              Processing...
            </>
          ) : (
            '✓ Confirm & Submit'
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
