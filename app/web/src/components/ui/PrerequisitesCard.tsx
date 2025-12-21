/**
 * PrerequisitesCard - Displays prerequisite check status
 * Ported from src/components/PrereqsChecklist.tsx for ChatGPT Apps SDK
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/primitives';

export interface PrereqItem {
  id: string;
  label: string;
  description?: string;
  status: 'pass' | 'fail' | 'pending';
}

interface PrerequisitesCardProps {
  items?: PrereqItem[];
  title?: string;
  className?: string;
}

const DEFAULT_PREREQS: PrereqItem[] = [
  { id: 'account', label: 'Account Verified', description: 'Provider credentials verified', status: 'pass' },
  { id: 'payment', label: 'Payment Method', description: 'Valid payment method on file', status: 'pass' },
  { id: 'child', label: 'Child Profile', description: 'Complete participant information', status: 'pass' },
];

export function PrerequisitesCard({ 
  items = DEFAULT_PREREQS, 
  title = 'Prerequisites',
  className = ''
}: PrerequisitesCardProps) {
  const allPassing = items.every(item => item.status === 'pass');
  const hasFailure = items.some(item => item.status === 'fail');

  const getStatusIcon = (status: PrereqItem['status']) => {
    switch (status) {
      case 'pass':
        return <span className="text-green-500">✓</span>;
      case 'fail':
        return <span className="text-red-500">✗</span>;
      case 'pending':
        return <span className="text-yellow-500 animate-pulse">○</span>;
    }
  };

  const getStatusBadgeColor = () => {
    if (hasFailure) return 'bg-red-100 text-red-700 border-red-200';
    if (allPassing) return 'bg-green-100 text-green-700 border-green-200';
    return 'bg-yellow-100 text-yellow-700 border-yellow-200';
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            {allPassing ? '✅' : hasFailure ? '❌' : '⏳'}
            {title}
          </CardTitle>
          <span className={`text-xs px-2 py-1 rounded-full border ${getStatusBadgeColor()}`}>
            {allPassing ? 'All Clear' : hasFailure ? 'Action Required' : 'Checking...'}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {items.map((prereq) => (
            <div 
              key={prereq.id} 
              className={`flex items-start gap-3 p-2 rounded-lg transition-colors ${
                prereq.status === 'fail' ? 'bg-red-50' : 
                prereq.status === 'pass' ? 'bg-green-50' : 'bg-gray-50'
              }`}
            >
              <div className="mt-0.5 flex-shrink-0 text-lg">
                {getStatusIcon(prereq.status)}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${
                  prereq.status === 'fail' ? 'text-red-900' : 'text-gray-900'
                }`}>
                  {prereq.label}
                </p>
                {prereq.description && (
                  <p className={`text-xs mt-0.5 ${
                    prereq.status === 'fail' ? 'text-red-600' : 'text-gray-500'
                  }`}>
                    {prereq.description}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {hasFailure && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800">
              ⚠️ Some prerequisites need attention before proceeding.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
