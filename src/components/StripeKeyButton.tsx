import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { StripeKeyModal } from './StripeKeyModal';
import { Key } from 'lucide-react';

export function StripeKeyButton() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleKeySaved = () => {
    // Modal handles the refresh
  };

  return (
    <>
      <Button onClick={() => setIsModalOpen(true)} variant="outline" className="flex items-center gap-2">
        <Key className="h-4 w-4" />
        Set Stripe Key
      </Button>
      
      <StripeKeyModal
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        onKeySaved={handleKeySaved}
      />
    </>
  );
}