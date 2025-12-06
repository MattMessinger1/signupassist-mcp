import { useState, useEffect } from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertCircle, User, UserPlus } from "lucide-react";
import { TrustCallout } from "@/components/TrustCallout";
import { COPY } from "@/copy/signupassistCopy";

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

interface SavedChild {
  id: string;
  first_name: string;
  last_name: string;
  dob?: string;
}

interface DelegateProfile {
  delegate_dob?: string;
  delegate_relationship?: string;
  delegate_phone?: string;
  delegate_firstName?: string;
  delegate_lastName?: string;
}

interface ResponsibleDelegateFormProps {
  schema: FormSchema | any;
  programTitle: string;
  initialDelegateData?: {
    delegate_firstName?: string;
    delegate_lastName?: string;
    delegate_email?: string;
    delegate_phone?: string;
  };
  initialDelegateProfile?: DelegateProfile;
  savedChildren?: SavedChild[];
  onSubmit: (formData: {
    delegate: Record<string, any>;
    participants: Record<string, any>[];
    numParticipants: number;
    saveNewChildren?: SavedChild[];
    saveDelegateProfile?: boolean;
  }) => void;
}

export function ResponsibleDelegateForm({
  schema,
  programTitle,
  initialDelegateData,
  initialDelegateProfile,
  savedChildren = [],
  onSubmit
}: ResponsibleDelegateFormProps) {
  const delegateFields = schema?.delegate_fields || [];
  const participantFields = schema?.participant_fields || [];
  const maxParticipants = schema?.max_participants || 10;
  const requiresAgeVerification = schema?.requires_age_verification ?? true;
  const minimumDelegateAge = schema?.minimum_delegate_age || 18;
  
  // Merge initial data from auth (name/email) with profile (phone/dob/relationship)
  const mergedInitialData = {
    ...initialDelegateData,
    ...(initialDelegateProfile?.delegate_phone && { delegate_phone: initialDelegateProfile.delegate_phone }),
    ...(initialDelegateProfile?.delegate_dob && { delegate_dob: initialDelegateProfile.delegate_dob }),
    ...(initialDelegateProfile?.delegate_relationship && { delegate_relationship: initialDelegateProfile.delegate_relationship }),
    // Profile can also override name if present
    ...(initialDelegateProfile?.delegate_firstName && { delegate_firstName: initialDelegateProfile.delegate_firstName }),
    ...(initialDelegateProfile?.delegate_lastName && { delegate_lastName: initialDelegateProfile.delegate_lastName }),
  };
  
  const [delegateData, setDelegateData] = useState<Record<string, any>>(mergedInitialData || {});
  const [numParticipants, setNumParticipants] = useState(1);
  const [participantsData, setParticipantsData] = useState<Record<string, any>[]>([{}]);
  const [ageVerificationError, setAgeVerificationError] = useState<string | null>(null);
  const [saveDelegateProfile, setSaveDelegateProfile] = useState(true); // Default to saving profile for convenience
  
  // Track which participants use saved children vs new entries
  const [participantSource, setParticipantSource] = useState<('saved' | 'new')[]>(['new']);
  const [selectedChildIds, setSelectedChildIds] = useState<(string | null)[]>([null]);
  const [saveNewParticipants, setSaveNewParticipants] = useState<boolean[]>([true]); // Default to saving participants for convenience
  
  // Check if profile is already saved (to decide if checkbox should show)
  const hasExistingProfile = !!(initialDelegateProfile?.delegate_dob || initialDelegateProfile?.delegate_phone);

  useEffect(() => {
    const newParticipants = Array(numParticipants).fill(null).map((_, idx) => 
      participantsData[idx] || {}
    );
    setParticipantsData(newParticipants);
    
    // Extend source tracking arrays
    setParticipantSource(prev => {
      const newArr = [...prev];
      while (newArr.length < numParticipants) newArr.push('new');
      return newArr.slice(0, numParticipants);
    });
    setSelectedChildIds(prev => {
      const newArr = [...prev];
      while (newArr.length < numParticipants) newArr.push(null);
      return newArr.slice(0, numParticipants);
    });
    setSaveNewParticipants(prev => {
      const newArr = [...prev];
      while (newArr.length < numParticipants) newArr.push(true); // Default to saving
      return newArr.slice(0, numParticipants);
    });
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

  const handleSelectSavedChild = (participantIndex: number, childId: string) => {
    const child = savedChildren.find(c => c.id === childId);
    if (!child) return;
    
    // Update the participant data with saved child info
    const newParticipants = [...participantsData];
    newParticipants[participantIndex] = {
      ...newParticipants[participantIndex],
      firstName: child.first_name,
      lastName: child.last_name,
      dob: child.dob || ''
    };
    setParticipantsData(newParticipants);
    
    // Update tracking
    const newSelectedIds = [...selectedChildIds];
    newSelectedIds[participantIndex] = childId;
    setSelectedChildIds(newSelectedIds);
    
    const newSource = [...participantSource];
    newSource[participantIndex] = 'saved';
    setParticipantSource(newSource);
  };

  const handleSwitchToNew = (participantIndex: number) => {
    const newParticipants = [...participantsData];
    newParticipants[participantIndex] = {};
    setParticipantsData(newParticipants);
    
    const newSelectedIds = [...selectedChildIds];
    newSelectedIds[participantIndex] = null;
    setSelectedChildIds(newSelectedIds);
    
    const newSource = [...participantSource];
    newSource[participantIndex] = 'new';
    setParticipantSource(newSource);
  };

  const handleSaveCheckbox = (participantIndex: number, checked: boolean) => {
    const newSave = [...saveNewParticipants];
    newSave[participantIndex] = checked;
    setSaveNewParticipants(newSave);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (requiresAgeVerification && delegateData.delegate_dob) {
      if (!validateDelegateAge(delegateData.delegate_dob)) {
        return;
      }
    }
    
    // Collect new children to save
    const saveNewChildren: SavedChild[] = [];
    participantsData.forEach((participant, idx) => {
      if (participantSource[idx] === 'new' && saveNewParticipants[idx] && participant.firstName && participant.lastName) {
        saveNewChildren.push({
          id: '', // Will be assigned by backend
          first_name: participant.firstName,
          last_name: participant.lastName,
          dob: participant.dob
        });
      }
    });
    
    onSubmit({
      delegate: delegateData,
      participants: participantsData,
      numParticipants,
      saveNewChildren: saveNewChildren.length > 0 ? saveNewChildren : undefined,
      saveDelegateProfile: saveDelegateProfile && !hasExistingProfile
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
    const isFromSavedChild = participantSource[participantIndex] === 'saved';
    
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
            disabled={isFromSavedChild && (fieldId === 'firstName' || fieldId === 'lastName' || fieldId === 'dob')}
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
            disabled={isFromSavedChild && (fieldId === 'firstName' || fieldId === 'lastName' || fieldId === 'dob')}
          />
        )}
      </div>
    );
  };

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
            
            {/* Save delegate profile checkbox (only show if no existing profile) */}
            {!hasExistingProfile && (
              <div className="flex items-center space-x-2 pt-2">
                <Checkbox
                  id="save-delegate-profile"
                  checked={saveDelegateProfile}
                  onCheckedChange={(checked) => setSaveDelegateProfile(!!checked)}
                />
                <Label 
                  htmlFor="save-delegate-profile"
                  className="text-sm text-muted-foreground cursor-pointer"
                >
                  Save my information for future registrations
                </Label>
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
              
              {/* Saved Children Selection (only show if user has saved children) */}
              {savedChildren.length > 0 && (
                <div className="space-y-2 p-3 bg-secondary/10 rounded-md border border-secondary/20">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Select from your saved participants
                  </Label>
                  <div className="flex gap-2">
                    <Select
                      value={selectedChildIds[participantIndex] || 'new'}
                      onValueChange={(value) => {
                        if (value === 'new') {
                          handleSwitchToNew(participantIndex);
                        } else {
                          handleSelectSavedChild(participantIndex, value);
                        }
                      }}
                    >
                      <SelectTrigger className="h-9 flex-1">
                        <SelectValue placeholder="Select a child or add new" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">
                          <span className="flex items-center gap-2">
                            <UserPlus className="w-4 h-4" />
                            Add new participant
                          </span>
                        </SelectItem>
                        {savedChildren.map((child) => (
                          <SelectItem key={child.id} value={child.id}>
                            {child.first_name} {child.last_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {participantSource[participantIndex] === 'saved' && (
                    <p className="text-xs text-muted-foreground">
                      ✅ Using saved participant information. Other fields can still be edited.
                    </p>
                  )}
                </div>
              )}
              
              {participantFields.map(field => renderParticipantField(field, participantIndex))}
              
              {/* Save new participant checkbox (only for new entries) */}
              {participantSource[participantIndex] === 'new' && (
                <div className="flex items-center space-x-2 pt-2">
                  <Checkbox
                    id={`save-participant-${participantIndex}`}
                    checked={saveNewParticipants[participantIndex]}
                    onCheckedChange={(checked) => handleSaveCheckbox(participantIndex, !!checked)}
                  />
                  <Label 
                    htmlFor={`save-participant-${participantIndex}`}
                    className="text-sm text-muted-foreground cursor-pointer"
                  >
                    Save this participant for future registrations
                  </Label>
                </div>
              )}
              
              {participantIndex < participantsData.length - 1 && <Separator className="mt-4" />}
            </div>
          ))}
        </CardContent>
        
        <CardFooter className="flex-col gap-3">
          <Button type="submit" size="sm" className="w-full">
            Continue to Payment Authorization
          </Button>
          <TrustCallout
            title={COPY.trust.title}
            bullets={COPY.trust.bullets}
            footer={COPY.trust.payment}
          />
        </CardFooter>
      </form>
    </Card>
  );
}
