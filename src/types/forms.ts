export interface ProgramAnswer {
  [key: string]: string | string[] | Date | boolean | null;
}

export interface RegistrationFormData {
  programRef: string;
  childId: string;
  answers: ProgramAnswer;
  opensAt: Date | string;
  maxAmountCents?: number;
  contactPhone?: string;
  prereqComplete?: boolean;
}
