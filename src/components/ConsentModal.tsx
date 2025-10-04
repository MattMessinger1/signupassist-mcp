import React, { useState } from 'react';
import { Shield, DollarSign, AlertTriangle, UserPlus, CreditCard, FileText } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { prompts } from '@/lib/prompts';

interface ConsentModalProps {
  open: boolean;
  onClose: () => void;
  onApprove: (maxCostCents: number) => void;
  programRef: string;
  childName: string;
  scopes: string[];
  loading?: boolean;
}

export function ConsentModal({ 
  open, 
  onClose, 
  onApprove, 
  programRef, 
  childName,
  scopes,
  loading = false 
}: ConsentModalProps) {
  const [maxCostInput, setMaxCostInput] = useState('');

  const iconMap = {
    shield: Shield,
    'user-plus': UserPlus,
    'credit-card': CreditCard,
    'file-text': FileText,
    'dollar-sign': DollarSign,
  };

  const scopeDescriptions = prompts.ui.review.scopeDescriptions;

  const handleApprove = () => {
    const maxCostCents = Math.round(parseFloat(maxCostInput || '0') * 100);
    onApprove(maxCostCents);
  };

  const maxCostDollars = parseFloat(maxCostInput || '0');
  const isValidAmount = maxCostDollars > 0;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Shield className="h-5 w-5" />
            <span>Authorize Registration Plan</span>
          </DialogTitle>
          <DialogDescription>
            Review and approve the permissions for automatic registration
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Plan Summary */}
          <div className="bg-muted/50 p-4 rounded-lg">
            <h3 className="font-medium mb-2">Plan Summary</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Program:</span>
                <div className="font-medium">{programRef}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Child:</span>
                <div className="font-medium">{childName}</div>
              </div>
            </div>
          </div>

          {/* Permissions */}
          <div>
            <h3 className="font-medium mb-3">Requested Permissions</h3>
            <div className="space-y-3">
              {scopes.map((scope) => {
                const info = scopeDescriptions[scope];
                if (!info) return null;
                const Icon = iconMap[info.icon as keyof typeof iconMap] || Shield;
                
                return (
                  <div key={scope} className="flex items-start space-x-3 p-3 border rounded-lg">
                    <Icon className="h-4 w-4" />
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium">{info.label}</span>
                        <Badge variant="outline" className="text-xs">{scope}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {info.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <Separator />

          {/* Cost Limit */}
          <div>
            <Label htmlFor="max-cost">Maximum Program Cost *</Label>
            <div className="mt-2">
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="max-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={maxCostInput}
                  onChange={(e) => setMaxCostInput(e.target.value)}
                  placeholder="0.00"
                  className="pl-6"
                />
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Maximum amount you authorize us to charge for this program registration
              </p>
            </div>
          </div>

          {/* Warning */}
          <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg">
            <div className="flex items-start space-x-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-amber-800">Important:</p>
                <ul className="text-amber-700 mt-1 space-y-1">
                  {prompts.ui.review.warnings.map((warning, index) => (
                    <li key={index}>• {warning}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex space-x-3">
            <Button
              onClick={handleApprove}
              disabled={!isValidAmount || loading}
              className="flex-1"
            >
              {loading ? 'Creating Plan...' : 'Approve & Create Plan'}
            </Button>
            <Button
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}