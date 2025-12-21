/**
 * ChatGPT Apps SDK Global Type Definitions
 * These types define the window.openai API available to widgets
 */

export interface OpenAIWidgetState {
  step: 'browse' | 'form_guardian' | 'form_participant' | 'review' | 'payment' | 'complete';
  guardianData: Record<string, any>;
  participantData: Record<string, any>[];
  selectedProgram: any | null;
  numParticipants: number;
}

export interface ToolOutput {
  message?: string;
  metadata?: {
    componentType?: 'program_list' | 'fullscreen_form' | 'payment_setup' | 'confirmation' | 'form_step';
    step?: number;
    totalSteps?: number;
    stepTitle?: string;
    fields?: string[];
    formSchema?: any;
    program?: any;
    savedChildren?: SavedChild[];
    delegateProfile?: DelegateProfile;
    summary?: any;
  };
  programs?: any[];
  ui_payload?: any;
  [key: string]: any;
}

export interface SavedChild {
  id: string;
  first_name: string;
  last_name: string;
  dob?: string;
}

export interface DelegateProfile {
  delegate_dob?: string;
  delegate_relationship?: string;
  delegate_phone?: string;
  delegate_firstName?: string;
  delegate_lastName?: string;
  delegate_email?: string;
}

export interface OpenAIGlobals {
  toolOutput: ToolOutput | null;
  toolInput: any;
  widgetState: OpenAIWidgetState;
}

declare global {
  interface Window {
    openai: {
      // Read-only globals
      toolOutput: ToolOutput | null;
      toolInput: any;
      
      // Widget state management
      getWidgetState: <T = OpenAIWidgetState>() => T;
      setWidgetState: <T = OpenAIWidgetState>(state: Partial<T>) => void;
      
      // Tool calling
      callTool: (toolName: string, args: Record<string, any>) => Promise<any>;
      
      // Send follow-up message to the assistant
      sendFollowUpMessage: (message: string) => void;
      
      // Request fullscreen mode
      requestFullscreen: () => void;
      exitFullscreen: () => void;
    };
  }
}

export {};
