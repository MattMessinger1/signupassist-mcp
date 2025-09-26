import React, { useState } from 'react';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalDescription } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

interface StripeKeyModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onKeySaved: () => void;
}

export function StripeKeyModal({ isOpen, onOpenChange, onKeySaved }: StripeKeyModalProps) {
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSave = () => {
    if (!key.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a valid Stripe publishable key',
        variant: 'destructive',
      });
      return;
    }

    if (!key.startsWith('pk_')) {
      toast({
        title: 'Error',
        description: 'Publishable key must start with "pk_"',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    
    try {
      localStorage.setItem('stripe_publishable_key', key.trim());
      
      toast({
        title: 'Success',
        description: 'Stripe publishable key saved! Please refresh the page.',
      });
      
      onKeySaved();
      onOpenChange(false);
      setKey('');
      
      // Force page reload to reinitialize Stripe
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to save the key',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={isOpen} onOpenChange={onOpenChange}>
      <ModalContent className="sm:max-w-md">
        <ModalHeader>
          <ModalTitle>Enter Stripe Publishable Key</ModalTitle>
          <ModalDescription>
            Enter your Stripe publishable key (starts with pk_test_ or pk_live_)
          </ModalDescription>
        </ModalHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="stripe-key">Publishable Key</Label>
            <Input
              id="stripe-key"
              placeholder="pk_test_..."
              value={key}
              onChange={(e) => setKey(e.target.value)}
              type="password"
            />
          </div>
          
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={loading}>
              {loading ? 'Saving...' : 'Save Key'}
            </Button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}