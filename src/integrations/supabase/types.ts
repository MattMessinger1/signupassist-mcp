export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      agentic_checkout_sessions: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          provider_id: string
          state: Json | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id: string
          provider_id: string
          state?: Json | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          provider_id?: string
          state?: Json | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          args_hash: string | null
          args_json: Json | null
          created_at: string
          decision: string | null
          details: Json | null
          event_type: string
          finished_at: string | null
          id: string
          mandate_id: string | null
          org_ref: string | null
          plan_execution_id: string | null
          plan_id: string | null
          provider: string
          result: string | null
          result_hash: string | null
          result_json: Json | null
          started_at: string
          tool: string | null
          user_id: string | null
        }
        Insert: {
          args_hash?: string | null
          args_json?: Json | null
          created_at?: string
          decision?: string | null
          details?: Json | null
          event_type: string
          finished_at?: string | null
          id?: string
          mandate_id?: string | null
          org_ref?: string | null
          plan_execution_id?: string | null
          plan_id?: string | null
          provider: string
          result?: string | null
          result_hash?: string | null
          result_json?: Json | null
          started_at?: string
          tool?: string | null
          user_id?: string | null
        }
        Update: {
          args_hash?: string | null
          args_json?: Json | null
          created_at?: string
          decision?: string | null
          details?: Json | null
          event_type?: string
          finished_at?: string | null
          id?: string
          mandate_id?: string | null
          org_ref?: string | null
          plan_execution_id?: string | null
          plan_id?: string | null
          provider?: string
          result?: string | null
          result_hash?: string | null
          result_json?: Json | null
          started_at?: string
          tool?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_mandate_id_fkey"
            columns: ["mandate_id"]
            isOneToOne: false
            referencedRelation: "mandates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_plan_execution_id_fkey"
            columns: ["plan_execution_id"]
            isOneToOne: false
            referencedRelation: "plan_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      autopilot_runs: {
        Row: {
          allowed_actions: Json
          audit_events: Json
          caps: Json
          child_id: string | null
          confidence: string
          created_at: string
          id: string
          provider_key: string
          provider_name: string
          status: string
          stop_conditions: Json
          target_program: string | null
          target_url: string
          updated_at: string
          user_id: string
        }
        Insert: {
          allowed_actions?: Json
          audit_events?: Json
          caps?: Json
          child_id?: string | null
          confidence?: string
          created_at?: string
          id?: string
          provider_key: string
          provider_name: string
          status?: string
          stop_conditions?: Json
          target_program?: string | null
          target_url: string
          updated_at?: string
          user_id: string
        }
        Update: {
          allowed_actions?: Json
          audit_events?: Json
          caps?: Json
          child_id?: string | null
          confidence?: string
          created_at?: string
          id?: string
          provider_key?: string
          provider_name?: string
          status?: string
          stop_conditions?: Json
          target_program?: string | null
          target_url?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "autopilot_runs_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
        ]
      }
      browser_sessions: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          session_data: Json
          session_key: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: string
          session_data: Json
          session_key: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          session_data?: Json
          session_key?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      cached_programs: {
        Row: {
          cache_key: string
          cached_at: string
          category: string
          created_at: string
          deep_links: Json | null
          earliest_slot_time: string | null
          expires_at: string
          first_available_event_id: string | null
          id: string
          metadata: Json | null
          org_ref: string
          prerequisites_schema: Json | null
          programs_by_theme: Json
          provider: string
          questions_schema: Json | null
          updated_at: string
        }
        Insert: {
          cache_key: string
          cached_at?: string
          category?: string
          created_at?: string
          deep_links?: Json | null
          earliest_slot_time?: string | null
          expires_at: string
          first_available_event_id?: string | null
          id?: string
          metadata?: Json | null
          org_ref: string
          prerequisites_schema?: Json | null
          programs_by_theme?: Json
          provider?: string
          questions_schema?: Json | null
          updated_at?: string
        }
        Update: {
          cache_key?: string
          cached_at?: string
          category?: string
          created_at?: string
          deep_links?: Json | null
          earliest_slot_time?: string | null
          expires_at?: string
          first_available_event_id?: string | null
          id?: string
          metadata?: Json | null
          org_ref?: string
          prerequisites_schema?: Json | null
          programs_by_theme?: Json
          provider?: string
          questions_schema?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      cached_provider_feed: {
        Row: {
          audience: string | null
          cached_at: string | null
          category: string | null
          org_ref: string
          prerequisites: Json | null
          program: Json
          program_ref: string
          signup_form: Json | null
        }
        Insert: {
          audience?: string | null
          cached_at?: string | null
          category?: string | null
          org_ref: string
          prerequisites?: Json | null
          program: Json
          program_ref: string
          signup_form?: Json | null
        }
        Update: {
          audience?: string | null
          cached_at?: string | null
          category?: string | null
          org_ref?: string
          prerequisites?: Json | null
          program?: Json
          program_ref?: string
          signup_form?: Json | null
        }
        Relationships: []
      }
      charges: {
        Row: {
          amount_cents: number | null
          charged_at: string
          id: string
          mandate_id: string | null
          refunded_at: string | null
          status: string
          stripe_payment_intent: string | null
        }
        Insert: {
          amount_cents?: number | null
          charged_at?: string
          id?: string
          mandate_id?: string | null
          refunded_at?: string | null
          status?: string
          stripe_payment_intent?: string | null
        }
        Update: {
          amount_cents?: number | null
          charged_at?: string
          id?: string
          mandate_id?: string | null
          refunded_at?: string | null
          status?: string
          stripe_payment_intent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "charges_mandate_id_fkey"
            columns: ["mandate_id"]
            isOneToOne: false
            referencedRelation: "mandates"
            referencedColumns: ["id"]
          },
        ]
      }
      children: {
        Row: {
          created_at: string
          dob: string | null
          first_name: string
          id: string
          last_name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dob?: string | null
          first_name: string
          id?: string
          last_name: string
          user_id: string
        }
        Update: {
          created_at?: string
          dob?: string | null
          first_name?: string
          id?: string
          last_name?: string
          user_id?: string
        }
        Relationships: []
      }
      delegate_profiles: {
        Row: {
          city: string | null
          created_at: string
          date_of_birth: string | null
          default_relationship: string | null
          email_alias: string | null
          first_name: string | null
          id: string
          last_name: string | null
          phone: string | null
          phone_alias: string | null
          state: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          date_of_birth?: string | null
          default_relationship?: string | null
          email_alias?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          phone_alias?: string | null
          state?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          city?: string | null
          created_at?: string
          date_of_birth?: string | null
          default_relationship?: string | null
          email_alias?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          phone_alias?: string | null
          state?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      discovery_hints: {
        Row: {
          confidence: number
          form_fingerprint: string
          hints: Json
          id: string
          program_key: string
          provider_slug: string
          samples_count: number
          stage: string
          updated_at: string
        }
        Insert: {
          confidence?: number
          form_fingerprint: string
          hints: Json
          id?: string
          program_key: string
          provider_slug: string
          samples_count?: number
          stage: string
          updated_at?: string
        }
        Update: {
          confidence?: number
          form_fingerprint?: string
          hints?: Json
          id?: string
          program_key?: string
          provider_slug?: string
          samples_count?: number
          stage?: string
          updated_at?: string
        }
        Relationships: []
      }
      discovery_jobs: {
        Row: {
          child_name: string | null
          completed_at: string | null
          created_at: string | null
          credential_id: string
          discovered_schema: Json | null
          error_message: string | null
          id: string
          mandate_id: string | null
          metadata: Json | null
          mode: string | null
          prerequisite_checks: Json | null
          program_questions: Json | null
          program_ref: string
          started_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          child_name?: string | null
          completed_at?: string | null
          created_at?: string | null
          credential_id: string
          discovered_schema?: Json | null
          error_message?: string | null
          id?: string
          mandate_id?: string | null
          metadata?: Json | null
          mode?: string | null
          prerequisite_checks?: Json | null
          program_questions?: Json | null
          program_ref: string
          started_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          child_name?: string | null
          completed_at?: string | null
          created_at?: string | null
          credential_id?: string
          discovered_schema?: Json | null
          error_message?: string | null
          id?: string
          mandate_id?: string | null
          metadata?: Json | null
          mode?: string | null
          prerequisite_checks?: Json | null
          program_questions?: Json | null
          program_ref?: string
          started_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "discovery_jobs_mandate_id_fkey"
            columns: ["mandate_id"]
            isOneToOne: false
            referencedRelation: "mandates"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_runs: {
        Row: {
          created_at: string
          errors: Json
          form_fingerprint: string
          id: string
          meta: Json
          program_key: string
          provider_slug: string
          run_confidence: number
          run_id: string
          stage: string
        }
        Insert: {
          created_at?: string
          errors: Json
          form_fingerprint: string
          id?: string
          meta?: Json
          program_key: string
          provider_slug: string
          run_confidence?: number
          run_id: string
          stage: string
        }
        Update: {
          created_at?: string
          errors?: Json
          form_fingerprint?: string
          id?: string
          meta?: Json
          program_key?: string
          provider_slug?: string
          run_confidence?: number
          run_id?: string
          stage?: string
        }
        Relationships: []
      }
      evidence_assets: {
        Row: {
          id: string
          plan_execution_id: string
          sha256: string | null
          ts: string
          type: string
          url: string | null
        }
        Insert: {
          id?: string
          plan_execution_id: string
          sha256?: string | null
          ts?: string
          type: string
          url?: string | null
        }
        Update: {
          id?: string
          plan_execution_id?: string
          sha256?: string | null
          ts?: string
          type?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evidence_assets_plan_execution_id_fkey"
            columns: ["plan_execution_id"]
            isOneToOne: false
            referencedRelation: "plan_executions"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_logs: {
        Row: {
          attempt: number
          correlation_id: string
          created_at: string
          error_message: string | null
          id: string
          mandate_id: string | null
          metadata: Json | null
          plan_execution_id: string | null
          plan_id: string | null
          stage: string
          status: string
          updated_at: string
        }
        Insert: {
          attempt?: number
          correlation_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          mandate_id?: string | null
          metadata?: Json | null
          plan_execution_id?: string | null
          plan_id?: string | null
          stage: string
          status: string
          updated_at?: string
        }
        Update: {
          attempt?: number
          correlation_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          mandate_id?: string | null
          metadata?: Json | null
          plan_execution_id?: string | null
          plan_id?: string | null
          stage?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_logs_mandate_id_fkey"
            columns: ["mandate_id"]
            isOneToOne: false
            referencedRelation: "mandates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_logs_plan_execution_id_fkey"
            columns: ["plan_execution_id"]
            isOneToOne: false
            referencedRelation: "plan_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_logs_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_delegation_mandates: {
        Row: {
          allowed_actions: Json
          autopilot_run_id: string | null
          child_id: string | null
          created_at: string
          expires_at: string
          id: string
          max_total_cents: number
          provider_key: string
          provider_readiness_required: string
          revoked_at: string | null
          signup_intent_id: string | null
          status: string
          stop_conditions: Json
          target_program: string
          user_id: string
        }
        Insert: {
          allowed_actions?: Json
          autopilot_run_id?: string | null
          child_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          max_total_cents: number
          provider_key: string
          provider_readiness_required: string
          revoked_at?: string | null
          signup_intent_id?: string | null
          status?: string
          stop_conditions?: Json
          target_program: string
          user_id: string
        }
        Update: {
          allowed_actions?: Json
          autopilot_run_id?: string | null
          child_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          max_total_cents?: number
          provider_key?: string
          provider_readiness_required?: string
          revoked_at?: string | null
          signup_intent_id?: string | null
          status?: string
          stop_conditions?: Json
          target_program?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_delegation_mandates_autopilot_run_id_fkey"
            columns: ["autopilot_run_id"]
            isOneToOne: false
            referencedRelation: "autopilot_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_delegation_mandates_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_delegation_mandates_signup_intent_id_fkey"
            columns: ["signup_intent_id"]
            isOneToOne: false
            referencedRelation: "signup_intents"
            referencedColumns: ["id"]
          },
        ]
      }
      mandate_audit: {
        Row: {
          action: string
          created_at: string
          credential_id: string | null
          id: string
          metadata: Json | null
          org_ref: string | null
          program_ref: string | null
          provider: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          credential_id?: string | null
          id?: string
          metadata?: Json | null
          org_ref?: string | null
          program_ref?: string | null
          provider?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          credential_id?: string | null
          id?: string
          metadata?: Json | null
          org_ref?: string | null
          program_ref?: string | null
          provider?: string | null
          user_id?: string
        }
        Relationships: []
      }
      parent_action_confirmations: {
        Row: {
          action_summary: Json
          action_type: string
          amount_cents: number | null
          autopilot_run_id: string | null
          confirmed_at: string | null
          consumed_at: string | null
          created_at: string
          exact_program: string | null
          expires_at: string
          id: string
          idempotency_key: string
          mandate_id: string | null
          provider_key: string | null
          provider_readiness_level: string | null
          signup_intent_id: string | null
          target_url: string | null
          user_id: string
        }
        Insert: {
          action_summary?: Json
          action_type: string
          amount_cents?: number | null
          autopilot_run_id?: string | null
          confirmed_at?: string | null
          consumed_at?: string | null
          created_at?: string
          exact_program?: string | null
          expires_at: string
          id?: string
          idempotency_key: string
          mandate_id?: string | null
          provider_key?: string | null
          provider_readiness_level?: string | null
          signup_intent_id?: string | null
          target_url?: string | null
          user_id: string
        }
        Update: {
          action_summary?: Json
          action_type?: string
          amount_cents?: number | null
          autopilot_run_id?: string | null
          confirmed_at?: string | null
          consumed_at?: string | null
          created_at?: string
          exact_program?: string | null
          expires_at?: string
          id?: string
          idempotency_key?: string
          mandate_id?: string | null
          provider_key?: string | null
          provider_readiness_level?: string | null
          signup_intent_id?: string | null
          target_url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parent_action_confirmations_autopilot_run_id_fkey"
            columns: ["autopilot_run_id"]
            isOneToOne: false
            referencedRelation: "autopilot_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_action_confirmations_mandate_id_fkey"
            columns: ["mandate_id"]
            isOneToOne: false
            referencedRelation: "mandates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_action_confirmations_signup_intent_id_fkey"
            columns: ["signup_intent_id"]
            isOneToOne: false
            referencedRelation: "signup_intents"
            referencedColumns: ["id"]
          },
        ]
      }
      mandates: {
        Row: {
          child_id: string | null
          created_at: string
          credential_type: string
          id: string
          jws_compact: string
          max_amount_cents: number | null
          program_ref: string | null
          provider: string
          scope: string[]
          status: string
          user_id: string
          valid_from: string
          valid_until: string
        }
        Insert: {
          child_id?: string | null
          created_at?: string
          credential_type?: string
          id?: string
          jws_compact: string
          max_amount_cents?: number | null
          program_ref?: string | null
          provider: string
          scope: string[]
          status?: string
          user_id: string
          valid_from?: string
          valid_until: string
        }
        Update: {
          child_id?: string | null
          created_at?: string
          credential_type?: string
          id?: string
          jws_compact?: string
          max_amount_cents?: number | null
          program_ref?: string | null
          provider?: string
          scope?: string[]
          status?: string
          user_id?: string
          valid_from?: string
          valid_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "mandates_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_executions: {
        Row: {
          amount_cents: number | null
          confirmation_ref: string | null
          finished_at: string | null
          id: string
          plan_id: string
          result: string | null
          started_at: string
        }
        Insert: {
          amount_cents?: number | null
          confirmation_ref?: string | null
          finished_at?: string | null
          id?: string
          plan_id: string
          result?: string | null
          started_at?: string
        }
        Update: {
          amount_cents?: number | null
          confirmation_ref?: string | null
          finished_at?: string | null
          id?: string
          plan_id?: string
          result?: string | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_executions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          answers: Json | null
          child_id: string | null
          created_at: string
          id: string
          mandate_id: string | null
          meta: Json | null
          opens_at: string
          plan_execution_id: string | null
          program_ref: string
          provider: string
          status: string
          user_id: string
        }
        Insert: {
          answers?: Json | null
          child_id?: string | null
          created_at?: string
          id?: string
          mandate_id?: string | null
          meta?: Json | null
          opens_at: string
          plan_execution_id?: string | null
          program_ref: string
          provider: string
          status?: string
          user_id: string
        }
        Update: {
          answers?: Json | null
          child_id?: string | null
          created_at?: string
          id?: string
          mandate_id?: string | null
          meta?: Json | null
          opens_at?: string
          plan_execution_id?: string | null
          program_ref?: string
          provider?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plans_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_mandate_id_fkey"
            columns: ["mandate_id"]
            isOneToOne: false
            referencedRelation: "mandates"
            referencedColumns: ["id"]
          },
        ]
      }
      program_discovery_status: {
        Row: {
          consecutive_failures: number
          created_at: string
          discovery_status: string
          id: string
          last_attempt_at: string | null
          last_error: string | null
          org_ref: string
          program_ref: string
          provider: string
          updated_at: string
        }
        Insert: {
          consecutive_failures?: number
          created_at?: string
          discovery_status?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          org_ref: string
          program_ref: string
          provider?: string
          updated_at?: string
        }
        Update: {
          consecutive_failures?: number
          created_at?: string
          discovery_status?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          org_ref?: string
          program_ref?: string
          provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      program_fingerprints: {
        Row: {
          form_fingerprint: string
          hit_count: number
          id: string
          last_seen_at: string
          program_key: string
          provider_slug: string
          stage: string
        }
        Insert: {
          form_fingerprint: string
          hit_count?: number
          id?: string
          last_seen_at?: string
          program_key: string
          provider_slug: string
          stage: string
        }
        Update: {
          form_fingerprint?: string
          hit_count?: number
          id?: string
          last_seen_at?: string
          program_key?: string
          provider_slug?: string
          stage?: string
        }
        Relationships: []
      }
      registrations: {
        Row: {
          amount_cents: number
          booking_number: string | null
          charge_id: string | null
          created_at: string | null
          delegate_email: string | null
          delegate_email_alias: string | null
          delegate_name: string
          error_message: string | null
          executed_at: string | null
          id: string
          mandate_id: string | null
          org_ref: string
          participant_names: string[]
          program_name: string
          program_ref: string
          provider: string
          scheduled_for: string | null
          start_date: string | null
          status: string
          success_fee_cents: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          amount_cents?: number
          booking_number?: string | null
          charge_id?: string | null
          created_at?: string | null
          delegate_email?: string | null
          delegate_email_alias?: string | null
          delegate_name: string
          error_message?: string | null
          executed_at?: string | null
          id?: string
          mandate_id?: string | null
          org_ref: string
          participant_names?: string[]
          program_name: string
          program_ref: string
          provider?: string
          scheduled_for?: string | null
          start_date?: string | null
          status?: string
          success_fee_cents?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          amount_cents?: number
          booking_number?: string | null
          charge_id?: string | null
          created_at?: string | null
          delegate_email?: string | null
          delegate_email_alias?: string | null
          delegate_name?: string
          error_message?: string | null
          executed_at?: string | null
          id?: string
          mandate_id?: string | null
          org_ref?: string
          participant_names?: string[]
          program_name?: string
          program_ref?: string
          provider?: string
          scheduled_for?: string | null
          start_date?: string | null
          status?: string
          success_fee_cents?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "registrations_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_mandate_id_fkey"
            columns: ["mandate_id"]
            isOneToOne: false
            referencedRelation: "mandates"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_registrations: {
        Row: {
          booking_number: string | null
          created_at: string | null
          delegate_data: Json
          error_message: string | null
          event_id: string
          executed_at: string | null
          id: string
          mandate_id: string
          org_ref: string
          participant_data: Json
          program_name: string
          program_ref: string
          scheduled_time: string
          status: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          booking_number?: string | null
          created_at?: string | null
          delegate_data: Json
          error_message?: string | null
          event_id: string
          executed_at?: string | null
          id?: string
          mandate_id: string
          org_ref: string
          participant_data: Json
          program_name: string
          program_ref: string
          scheduled_time: string
          status?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          booking_number?: string | null
          created_at?: string | null
          delegate_data?: Json
          error_message?: string | null
          event_id?: string
          executed_at?: string | null
          id?: string
          mandate_id?: string
          org_ref?: string
          participant_data?: Json
          program_name?: string
          program_ref?: string
          scheduled_time?: string
          status?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_registrations_mandate_id_fkey"
            columns: ["mandate_id"]
            isOneToOne: false
            referencedRelation: "mandates"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_intent_events: {
        Row: {
          created_at: string
          event: Json
          event_type: string
          id: string
          signup_intent_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event?: Json
          event_type: string
          id?: string
          signup_intent_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          event?: Json
          event_type?: string
          id?: string
          signup_intent_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signup_intent_events_signup_intent_id_fkey"
            columns: ["signup_intent_id"]
            isOneToOne: false
            referencedRelation: "signup_intents"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_intents: {
        Row: {
          autopilot_run_id: string | null
          confidence: number | null
          created_at: string
          finder_status: string | null
          id: string
          original_query: string | null
          parsed_activity: string | null
          parsed_age_years: number | null
          parsed_city: string | null
          parsed_grade: string | null
          parsed_state: string | null
          parsed_venue: string | null
          provider_key: string | null
          provider_name: string | null
          selected_child_id: string | null
          selected_result: Json
          source: string
          source_freshness: string | null
          status: string
          target_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          autopilot_run_id?: string | null
          confidence?: number | null
          created_at?: string
          finder_status?: string | null
          id?: string
          original_query?: string | null
          parsed_activity?: string | null
          parsed_age_years?: number | null
          parsed_city?: string | null
          parsed_grade?: string | null
          parsed_state?: string | null
          parsed_venue?: string | null
          provider_key?: string | null
          provider_name?: string | null
          selected_child_id?: string | null
          selected_result?: Json
          source?: string
          source_freshness?: string | null
          status?: string
          target_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          autopilot_run_id?: string | null
          confidence?: number | null
          created_at?: string
          finder_status?: string | null
          id?: string
          original_query?: string | null
          parsed_activity?: string | null
          parsed_age_years?: number | null
          parsed_city?: string | null
          parsed_grade?: string | null
          parsed_state?: string | null
          parsed_venue?: string | null
          provider_key?: string | null
          provider_name?: string | null
          selected_child_id?: string | null
          selected_result?: Json
          source?: string
          source_freshness?: string | null
          status?: string
          target_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signup_intents_autopilot_run_id_fkey"
            columns: ["autopilot_run_id"]
            isOneToOne: false
            referencedRelation: "autopilot_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signup_intents_selected_child_id_fkey"
            columns: ["selected_child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
        ]
      }
      stored_credentials: {
        Row: {
          alias: string
          created_at: string
          encrypted_data: string
          id: string
          provider: string
          updated_at: string
          user_id: string
        }
        Insert: {
          alias: string
          created_at?: string
          encrypted_data: string
          id?: string
          provider: string
          updated_at?: string
          user_id: string
        }
        Update: {
          alias?: string
          created_at?: string
          encrypted_data?: string
          id?: string
          provider?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_billing: {
        Row: {
          created_at: string
          default_payment_method_id: string | null
          payment_method_brand: string | null
          payment_method_last4: string | null
          stripe_customer_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_payment_method_id?: string | null
          payment_method_brand?: string | null
          payment_method_last4?: string | null
          stripe_customer_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_payment_method_id?: string | null
          payment_method_brand?: string | null
          payment_method_last4?: string | null
          stripe_customer_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          plan_id: string
          price_cents: number
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          plan_id?: string
          price_cents?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          plan_id?: string
          price_cents?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_prereq_answers: {
        Row: {
          answers: Json
          created_at: string
          id: string
          org_ref: string
          program_ref: string
          updated_at: string
          user_id: string
        }
        Insert: {
          answers?: Json
          created_at?: string
          id?: string
          org_ref: string
          program_ref: string
          updated_at?: string
          user_id: string
        }
        Update: {
          answers?: Json
          created_at?: string
          id?: string
          org_ref?: string
          program_ref?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_expired_checkout_sessions: { Args: never; Returns: undefined }
      cleanup_expired_program_cache: { Args: never; Returns: number }
      cleanup_expired_sessions: { Args: never; Returns: undefined }
      delete_cron_job: { Args: { query: string }; Returns: undefined }
      find_programs_cached:
        | {
            Args: {
              p_category?: string
              p_max_age_hours?: number
              p_org_ref: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_category: string
              p_max_age_hours?: number
              p_org_ref: string
              p_provider?: string
            }
            Returns: Json
          }
      get_best_hints: {
        Args: { p_program: string; p_provider: string; p_stage: string }
        Returns: Json
      }
      get_table_columns: {
        Args: { p_schema_name: string; p_table_name: string }
        Returns: {
          column_name: string
          data_type: string
        }[]
      }
      insert_execution_log: {
        Args: {
          p_attempt?: number
          p_correlation_id: string
          p_error_message?: string
          p_mandate_id?: string
          p_metadata?: Json
          p_plan_execution_id?: string
          p_plan_id: string
          p_stage?: string
          p_status?: string
        }
        Returns: string
      }
      merge_hints: { Args: { existing: Json; newest: Json }; Returns: Json }
      query_cron_jobs: { Args: { query: string }; Returns: Json }
      recompute_confidence: {
        Args: { latest: number; prev: number; samples: number }
        Returns: number
      }
      refresh_best_hints: { Args: never; Returns: undefined }
      sanitize_error_text: { Args: { txt: string }; Returns: string }
      trigger_provider_feed_refresh: { Args: never; Returns: Json }
      upsert_cached_programs: {
        Args: {
          p_category: string
          p_metadata?: Json
          p_org_ref: string
          p_programs_by_theme: Json
          p_ttl_hours?: number
        }
        Returns: string
      }
      upsert_cached_programs_enhanced:
        | {
            Args: {
              p_category: string
              p_deep_links?: Json
              p_metadata?: Json
              p_org_ref: string
              p_prerequisites_schema?: Json
              p_programs_by_theme: Json
              p_questions_schema?: Json
              p_ttl_hours?: number
            }
            Returns: string
          }
        | {
            Args: {
              p_category: string
              p_deep_links?: Json
              p_metadata?: Json
              p_org_ref: string
              p_prerequisites_schema?: Json
              p_programs_by_theme: Json
              p_provider?: string
              p_questions_schema?: Json
              p_ttl_hours?: number
            }
            Returns: string
          }
      upsert_cached_provider_feed: {
        Args: {
          p_category: string
          p_org_ref: string
          p_prereq: Json
          p_program: Json
          p_program_ref: string
          p_signup_form: Json
        }
        Returns: undefined
      }
      upsert_discovery_run: {
        Args: {
          p_errors: Json
          p_fingerprint: string
          p_meta: Json
          p_program: string
          p_provider: string
          p_run_conf: number
          p_run_id: string
          p_stage: string
        }
        Returns: string
      }
      validate_program_url: {
        Args: { org_ref: string; url: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
