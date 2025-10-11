export interface PrerequisiteCheck {
  check: string;
  status: 'pass' | 'fail';
  message: string;
}

export interface PrerequisiteResult {
  checks: PrerequisiteCheck[];
  overall_status: 'ready' | 'blocked';
  can_proceed: boolean;
}
