import { useState, useEffect } from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";

interface FieldOption {
  value: string;
  label: string;
}

interface DelegateField {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  helpText?: string;
  options?: FieldOption[];
}

interface ParticipantField {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  min?: number;
  max?: number;
}

interface FormSchema {
  delegate_fields?: DelegateField[];
  participant_fields?: ParticipantField[];
  max_participants?: number;
  requires_age_verification?: boolean;
  minimum_delegate_age?: number;
}

interface ResponsibleDelegateFormProps {
  schema: FormSchema | any; // Accept any format for flexibility
  programTitle: string;
  onSubmit: (formData: {
    delegate: Record<string, any>;
    participants: Record<string, any>[];
    numParticipants: number;
  }) => void;
}

export function ResponsibleDelegateForm({
  schema,
  programTitle,
  onSubmit
}: ResponsibleDelegateFormProps) {
  // Ensure schema has the expected structure
  const delegateFields = schema?.delegate_fields || [];
  const participantFields = schema?.participant_fields || [];
  const maxParticipants = schema?.max_participants || 10;
  const requiresAgeVerification = schema?.requires_age_verification ?? true;
  const minimumDelegateAge = schema?.minimum_delegate_age || 18;
  const [delegateData, setDelegateData] = useState<Record<string, any>>({});
  const [numParticipants, setNumParticipants] = useState(1);
  const [participantsData, setParticipantsData] = useState<Record<string, any>[]>([{}]);
  const [ageVerificationError, setAgeVerificationError] = useState<string | null>(null);

  // Update participants array when numParticipants changes
  useEffect(() => {
    const newParticipants = Array(numParticipants).fill(null).map((_, idx) => 
      participantsData[idx] || {}
    );
    setParticipantsData(newParticipants);
  }, [numParticipants]);

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

  const validateDelegateAge = (dob: string): boolean => {
    const age = calculateAge(dob);
    
    if (age < minimumDelegateAge) {
      setAgeVerificationError(`You must be at least ${minimumDelegateAge} years old to register participants.`);
      return false;
    }
    
    setAgeVerificationError(null);
    return true;
  };

  const handleDelegateChange = (fieldId: string, value: any) => {
    setDelegateData(prev => ({ ...prev, [fieldId]: value }));
    
    // Validate age on DOB change
    if (fieldId === 'delegate_dob' && value && requiresAgeVerification) {
      validateDelegateAge(value);
    }
  };

  const handleParticipantChange = (participantIndex: number, fieldId: string, value: any) => {
    const newParticipants = [...participantsData];
    newParticipants[participantIndex] = {
      ...newParticipants[participantIndex],
      [fieldId]: value
    };
    setParticipantsData(newParticipants);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate delegate age if required
    if (requiresAgeVerification && delegateData.delegate_dob) {
      if (!validateDelegateAge(delegateData.delegate_dob)) {
        return;
      }
    }
    
    onSubmit({
      delegate: delegateData,
      participants: participantsData,
      numParticipants
    });
  };

  const renderDelegateField = (field: DelegateField) => {
    const fieldId = field.id;
    
    return (
      <div key={fieldId} className="space-y-2">
        <Label htmlFor={fieldId} className="text-sm">
          {field.label}
          {field.required && <span className="text-destructive ml-1">*</span>}
        </Label>
        
        {field.type === 'select' && field.options ? (
          <Select
            value={delegateData[fieldId] || ''}
            onValueChange={(value) => handleDelegateChange(fieldId, value)}
            required={field.required}
          >
            <SelectTrigger id={fieldId} className="h-9">
              <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : field.type === 'textarea' ? (
          <Textarea
            id={fieldId}
            required={field.required}
            value={delegateData[fieldId] || ''}
            onChange={(e) => handleDelegateChange(fieldId, e.target.value)}
            className="min-h-[80px]"
          />
        ) : (
          <Input
            id={fieldId}
            type={field.type}
            required={field.required}
            value={delegateData[fieldId] || ''}
            onChange={(e) => handleDelegateChange(fieldId, e.target.value)}
            className="h-9"
          />
        )}
        
        {field.helpText && (
          <p className="text-xs text-muted-foreground">{field.helpText}</p>
        )}
      </div>
    );
  };

  const renderParticipantField = (field: ParticipantField, participantIndex: number) => {
    const fieldId = field.id;
    const value = participantsData[participantIndex]?.[fieldId] || '';
    
    return (
      <div key={`${participantIndex}-${fieldId}`} className="space-y-2">
        <Label htmlFor={`${participantIndex}-${fieldId}`} className="text-sm">
          {field.label}
          {field.required && <span className="text-destructive ml-1">*</span>}
        </Label>
        
        {field.type === 'textarea' ? (
          <Textarea
            id={`${participantIndex}-${fieldId}`}
            required={field.required}
            value={value}
            onChange={(e) => handleParticipantChange(participantIndex, fieldId, e.target.value)}
            className="min-h-[60px]"
          />
        ) : (
          <Input
            id={`${participantIndex}-${fieldId}`}
            type={field.type}
            required={field.required}
            min={field.min}
            max={field.max}
            value={value}
            onChange={(e) => handleParticipantChange(participantIndex, fieldId, e.target.value)}
            className="h-9"
          />
        )}
      </div>
    );
  };

  // Show error if schema is missing required fields
  if (!delegateFields.length || !participantFields.length) {
    return (
      <Card className="mt-3 border-destructive/50 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Form Configuration Error</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">The registration form schema is not properly configured. Please sync the provider data.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-3 border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Registration Form: {programTitle}</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          As the Responsible Delegate, you authorize SignupAssist to register the participant(s) below on your behalf.
        </p>
      </CardHeader>
      
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-6">
          {/* Section 1: Responsible Delegate Information */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-primary/10">Section 1</Badge>
              <h3 className="font-semibold text-sm">Your Information (Responsible Delegate)</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              We collect this to verify you are authorized to register participants.
            </p>
            
            {delegateFields.map(field => renderDelegateField(field))}
            
            {ageVerificationError && (
              <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                <AlertCircle className="w-4 h-4 text-destructive mt-0.5" />
                <p className="text-sm text-destructive">{ageVerificationError}</p>
              </div>
            )}
          </div>
          
          <Separator />
          
          {/* Section 2: Number of Participants */}
          <div className="space-y-3">
            <Label htmlFor="numParticipants" className="text-sm font-semibold">
              How many participants are you registering?
            </Label>
            <Input
              id="numParticipants"
              type="number"
              min={1}
              max={maxParticipants}
              required
              value={numParticipants}
              onChange={(e) => setNumParticipants(parseInt(e.target.value) || 1)}
              className="h-9 w-32"
            />
          </div>
          
          <Separator />
          
          {/* Section 3+: Dynamic Participant Sections */}
          {participantsData.map((_, participantIndex) => (
            <div key={participantIndex} className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-secondary">
                  Participant {participantIndex + 1}
                </Badge>
                <h3 className="font-semibold text-sm">
                  {numParticipants === 1 ? "Participant Details" : `Participant ${participantIndex + 1} Details`}
                </h3>
              </div>
              
              {participantFields.map(field => renderParticipantField(field, participantIndex))}
              
              {participantIndex < participantsData.length - 1 && <Separator className="mt-4" />}
            </div>
          ))}
        </CardContent>
        
        <CardFooter className="flex-col gap-2">
          <Button type="submit" size="sm" className="w-full">
            Continue to Payment Authorization
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            📋 <strong>SignupAssist acts as your Responsible Delegate:</strong> We only proceed with your explicit consent, log every action for your review, and charge only upon successful registration.
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
