/**
 * ConfirmationStep - Final step showing registration success
 * Displays confirmation number, summary, and completion actions
 */

import React, { useEffect, useState } from 'react';
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
import { useSendMessage, useToolOutput } from '../../hooks/useOpenAiGlobal';

interface ConfirmationStepProps {
  guardianData: Record<string, any>;
  participantData: Record<string, any>[];
  program?: {
    title: string;
    price?: string;
    startDate?: string;
  };
  confirmationNumber?: string;
  onDone?: () => void;
}

export function ConfirmationStep({ 
  guardianData, 
  participantData,
  program,
  confirmationNumber,
  onDone
}: ConfirmationStepProps) {
  const sendMessage = useSendMessage();
  const toolOutput = useToolOutput();
  const [showConfetti, setShowConfetti] = useState(false);

  // Get confirmation number from props or toolOutput
  const bookingNumber = confirmationNumber || 
    toolOutput?.metadata?.summary?.confirmationNumber ||
    `SA-${Date.now().toString(36).toUpperCase()}`;

  // Trigger celebration animation on mount
  useEffect(() => {
    const timer = setTimeout(() => setShowConfetti(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleDone = () => {
    if (onDone) {
      onDone();
    } else {
      sendMessage('Registration complete! What would you like to do next?');
    }
  };

  const handleViewDetails = () => {
    sendMessage(`Show me details for registration ${bookingNumber}`);
  };

  return (
    <Card className="w-full max-w-2xl mx-auto overflow-hidden">
      {/* Success Header with Animation */}
      <div className="relative bg-gradient-to-br from-green-500 to-green-600 p-8 text-white text-center">
        {showConfetti && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {/* Simple confetti dots */}
            {[...Array(20)].map((_, i) => (
              <div
                key={i}
                className="absolute animate-bounce"
                style={{
                  left: `${Math.random() * 100}%`,
                  top: `${Math.random() * 100}%`,
                  animationDelay: `${Math.random() * 0.5}s`,
                  animationDuration: `${0.5 + Math.random() * 0.5}s`,
                }}
              >
                {['🎉', '⭐', '✨', '🎊'][Math.floor(Math.random() * 4)]}
              </div>
            ))}
          </div>
        )}
        
        <div className="relative z-10">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-2xl font-bold mb-2">Registration Complete!</h2>
          <p className="text-green-100">Your registration has been successfully submitted</p>
        </div>
      </div>

      <CardContent className="p-6 space-y-6">
        {/* Confirmation Number */}
        <div className="text-center p-4 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
          <p className="text-sm text-gray-500 mb-1">Confirmation Number</p>
          <p className="text-2xl font-mono font-bold text-gray-900">{bookingNumber}</p>
        </div>

        <Separator />

        {/* Registration Summary */}
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900">Registration Summary</h3>
          
          {/* Program */}
          {program && (
            <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
              <span className="text-lg">📚</span>
              <div>
                <p className="font-medium text-blue-900">{program.title}</p>
                {program.startDate && (
                  <p className="text-sm text-blue-700">Starts: {program.startDate}</p>
                )}
              </div>
            </div>
          )}

          {/* Delegate */}
          <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
            <span className="text-lg">👤</span>
            <div>
              <p className="font-medium text-gray-900">
                {guardianData.delegate_firstName} {guardianData.delegate_lastName}
              </p>
              <p className="text-sm text-gray-600">Responsible Delegate</p>
            </div>
          </div>

          {/* Participants */}
          <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
            <span className="text-lg">👥</span>
            <div>
              <p className="font-medium text-gray-900">
                {participantData.length} Participant{participantData.length > 1 ? 's' : ''}
              </p>
              <p className="text-sm text-gray-600">
                {participantData.map(p => `${p.firstName} ${p.lastName}`).join(', ')}
              </p>
            </div>
          </div>
        </div>

        <Separator />

        {/* What's Next */}
        <div className="space-y-3">
          <h3 className="font-semibold text-gray-900">What's Next?</h3>
          <div className="space-y-2 text-sm text-gray-600">
            <div className="flex items-start gap-2">
              <span className="text-green-500">✓</span>
              <p>You'll receive a confirmation email shortly</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-green-500">✓</span>
              <p>The activity provider will process your registration</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-green-500">✓</span>
              <p>You can view your registration details anytime</p>
            </div>
          </div>
        </div>

        {/* Audit Trail Note */}
        <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
          <div className="flex items-start gap-3">
            <span className="text-lg">📋</span>
            <div>
              <p className="text-sm font-medium text-purple-900">Audit Trail Available</p>
              <p className="text-xs text-purple-700 mt-1">
                A complete record of this registration has been cryptographically signed 
                and stored for your records.
              </p>
            </div>
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex flex-col sm:flex-row gap-3 p-6 bg-gray-50">
        <Button
          variant="outline"
          onClick={handleViewDetails}
          className="w-full sm:w-auto"
        >
          📋 View Full Details
        </Button>
        <Button
          variant="accent"
          onClick={handleDone}
          className="w-full sm:w-auto"
        >
          ✓ Done
        </Button>
      </CardFooter>
    </Card>
  );
}
