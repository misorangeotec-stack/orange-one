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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_access: {
        Row: {
          app_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          app_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          app_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_lead_masters: {
        Row: {
          masters: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          masters?: Json
          updated_at: string
          user_id?: string
        }
        Update: {
          masters?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      app_lead_masters_global: {
        Row: {
          id: string
          masters: Json
          updated_at: string
        }
        Insert: {
          id?: string
          masters?: Json
          updated_at?: string
        }
        Update: {
          id?: string
          masters?: Json
          updated_at?: string
        }
        Relationships: []
      }
      app_leads: {
        Row: {
          captured_on: string | null
          company_name: string | null
          created_at: string
          deleted: boolean
          follow_up_action_id: string | null
          google_media: Json
          google_synced_at: string | null
          id: string
          interest_level_id: string | null
          payload: Json
          person_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          captured_on?: string | null
          company_name?: string | null
          created_at?: string
          deleted?: boolean
          follow_up_action_id?: string | null
          google_media?: Json
          google_synced_at?: string | null
          id: string
          interest_level_id?: string | null
          payload?: Json
          person_name?: string | null
          updated_at: string
          user_id?: string
        }
        Update: {
          captured_on?: string | null
          company_name?: string | null
          created_at?: string
          deleted?: boolean
          follow_up_action_id?: string | null
          google_media?: Json
          google_synced_at?: string | null
          id?: string
          interest_level_id?: string | null
          payload?: Json
          person_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      departments: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      designations: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      fms_entries: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          current_step_index: number
          id: string
          status: string
          summary: Json
          updated_at: string
          workflow_id: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          current_step_index?: number
          id?: string
          status?: string
          summary?: Json
          updated_at?: string
          workflow_id: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          current_step_index?: number
          id?: string
          status?: string
          summary?: Json
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_entries_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "fms_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_entry_stages: {
        Row: {
          actual_date: string | null
          completed_by: string | null
          created_at: string
          entry_id: string
          id: string
          planned_date: string | null
          status: string
          step_id: string
          step_index: number
          updated_at: string
          values: Json
        }
        Insert: {
          actual_date?: string | null
          completed_by?: string | null
          created_at?: string
          entry_id: string
          id?: string
          planned_date?: string | null
          status?: string
          step_id: string
          step_index: number
          updated_at?: string
          values?: Json
        }
        Update: {
          actual_date?: string | null
          completed_by?: string | null
          created_at?: string
          entry_id?: string
          id?: string
          planned_date?: string | null
          status?: string
          step_id?: string
          step_index?: number
          updated_at?: string
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "fms_entry_stages_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "fms_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_entry_stages_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "fms_workflow_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_exit_activity: {
        Row: {
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          meta: Json
          note: string | null
          type: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          meta?: Json
          note?: string | null
          type: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          meta?: Json
          note?: string | null
          type?: string
        }
        Relationships: []
      }
      fms_exit_asset_types: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      fms_exit_assets: {
        Row: {
          asset_type_id: string | null
          case_id: string
          condition: string | null
          created_at: string
          file_name: string | null
          file_path: string | null
          id: string
          name: string
          recovery_amount: number | null
          remarks: string | null
          returned_on: string | null
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          asset_type_id?: string | null
          case_id: string
          condition?: string | null
          created_at?: string
          file_name?: string | null
          file_path?: string | null
          id?: string
          name: string
          recovery_amount?: number | null
          remarks?: string | null
          returned_on?: string | null
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          asset_type_id?: string | null
          case_id?: string
          condition?: string | null
          created_at?: string
          file_name?: string | null
          file_path?: string | null
          id?: string
          name?: string
          recovery_amount?: number | null
          remarks?: string | null
          returned_on?: string | null
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_exit_assets_asset_type_id_fkey"
            columns: ["asset_type_id"]
            isOneToOne: false
            referencedRelation: "fms_exit_asset_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_exit_assets_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "fms_exit_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_exit_cases: {
        Row: {
          approval_remarks: string | null
          approved_at: string | null
          approver_id: string | null
          archived_at: string | null
          assets_hod_remarks: string | null
          assets_hod_signed_at: string | null
          assets_hod_signed_by: string | null
          assets_hr_remarks: string | null
          assets_hr_signed_at: string | null
          assets_hr_signed_by: string | null
          assets_returned_at: string | null
          case_type: string
          clearance_completed_at: string | null
          clearance_remarks: string | null
          created_at: string
          current_step: string
          date_of_joining: string | null
          department_id: string
          designation: string | null
          discussed_at: string | null
          documents_issued_at: string | null
          employee_code: string
          employee_name: string
          employee_user_id: string | null
          exit_no: string
          fnf_approved_at: string | null
          fnf_generated_at: string | null
          fnf_paid_at: string | null
          handover_completed_at: string | null
          hold_at: string | null
          hold_reason: string | null
          hr_remarks: string | null
          hr_verified_at: string | null
          hr_verifier_id: string | null
          id: string
          interview_done_at: string | null
          leave_verified_at: string | null
          lwd: string | null
          lwd_confirmed_at: string | null
          manager_recommendation: string | null
          manager_remarks: string | null
          manager_reviewed_at: string | null
          manager_reviewer_id: string | null
          notice_period_days: number | null
          notice_waived: boolean
          payroll_done_at: string | null
          policy_applicable: boolean
          policy_na_reason: string | null
          proposed_lwd: string | null
          raised_by: string | null
          raised_on_behalf: boolean
          reason_id: string | null
          reason_note: string | null
          reject_reason: string | null
          rejected_at: string | null
          reporting_manager_ids: string[]
          reporting_manager_note: string | null
          resignation_letter_name: string | null
          resignation_letter_path: string | null
          status: string
          submitted_at: string
          system_status_changed: boolean
          updated_at: string
          withdraw_reason: string | null
          withdrawn_at: string | null
        }
        Insert: {
          approval_remarks?: string | null
          approved_at?: string | null
          approver_id?: string | null
          archived_at?: string | null
          assets_hod_remarks?: string | null
          assets_hod_signed_at?: string | null
          assets_hod_signed_by?: string | null
          assets_hr_remarks?: string | null
          assets_hr_signed_at?: string | null
          assets_hr_signed_by?: string | null
          assets_returned_at?: string | null
          case_type?: string
          clearance_completed_at?: string | null
          clearance_remarks?: string | null
          created_at?: string
          current_step?: string
          date_of_joining?: string | null
          department_id: string
          designation?: string | null
          discussed_at?: string | null
          documents_issued_at?: string | null
          employee_code: string
          employee_name: string
          employee_user_id?: string | null
          exit_no: string
          fnf_approved_at?: string | null
          fnf_generated_at?: string | null
          fnf_paid_at?: string | null
          handover_completed_at?: string | null
          hold_at?: string | null
          hold_reason?: string | null
          hr_remarks?: string | null
          hr_verified_at?: string | null
          hr_verifier_id?: string | null
          id?: string
          interview_done_at?: string | null
          leave_verified_at?: string | null
          lwd?: string | null
          lwd_confirmed_at?: string | null
          manager_recommendation?: string | null
          manager_remarks?: string | null
          manager_reviewed_at?: string | null
          manager_reviewer_id?: string | null
          notice_period_days?: number | null
          notice_waived?: boolean
          payroll_done_at?: string | null
          policy_applicable?: boolean
          policy_na_reason?: string | null
          proposed_lwd?: string | null
          raised_by?: string | null
          raised_on_behalf?: boolean
          reason_id?: string | null
          reason_note?: string | null
          reject_reason?: string | null
          rejected_at?: string | null
          reporting_manager_ids?: string[]
          reporting_manager_note?: string | null
          resignation_letter_name?: string | null
          resignation_letter_path?: string | null
          status?: string
          submitted_at?: string
          system_status_changed?: boolean
          updated_at?: string
          withdraw_reason?: string | null
          withdrawn_at?: string | null
        }
        Update: {
          approval_remarks?: string | null
          approved_at?: string | null
          approver_id?: string | null
          archived_at?: string | null
          assets_hod_remarks?: string | null
          assets_hod_signed_at?: string | null
          assets_hod_signed_by?: string | null
          assets_hr_remarks?: string | null
          assets_hr_signed_at?: string | null
          assets_hr_signed_by?: string | null
          assets_returned_at?: string | null
          case_type?: string
          clearance_completed_at?: string | null
          clearance_remarks?: string | null
          created_at?: string
          current_step?: string
          date_of_joining?: string | null
          department_id?: string
          designation?: string | null
          discussed_at?: string | null
          documents_issued_at?: string | null
          employee_code?: string
          employee_name?: string
          employee_user_id?: string | null
          exit_no?: string
          fnf_approved_at?: string | null
          fnf_generated_at?: string | null
          fnf_paid_at?: string | null
          handover_completed_at?: string | null
          hold_at?: string | null
          hold_reason?: string | null
          hr_remarks?: string | null
          hr_verified_at?: string | null
          hr_verifier_id?: string | null
          id?: string
          interview_done_at?: string | null
          leave_verified_at?: string | null
          lwd?: string | null
          lwd_confirmed_at?: string | null
          manager_recommendation?: string | null
          manager_remarks?: string | null
          manager_reviewed_at?: string | null
          manager_reviewer_id?: string | null
          notice_period_days?: number | null
          notice_waived?: boolean
          payroll_done_at?: string | null
          policy_applicable?: boolean
          policy_na_reason?: string | null
          proposed_lwd?: string | null
          raised_by?: string | null
          raised_on_behalf?: boolean
          reason_id?: string | null
          reason_note?: string | null
          reject_reason?: string | null
          rejected_at?: string | null
          reporting_manager_ids?: string[]
          reporting_manager_note?: string | null
          resignation_letter_name?: string | null
          resignation_letter_path?: string | null
          status?: string
          submitted_at?: string
          system_status_changed?: boolean
          updated_at?: string
          withdraw_reason?: string | null
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fms_exit_cases_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_exit_cases_reason_id_fkey"
            columns: ["reason_id"]
            isOneToOne: false
            referencedRelation: "fms_exit_reasons"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_exit_clearance_checks: {
        Row: {
          allows_link: boolean
          case_id: string
          created_at: string
          department_label: string
          description: string | null
          done: boolean
          done_at: string | null
          done_by: string | null
          due_days: number
          file_name: string | null
          file_path: string | null
          id: string
          item_id: string | null
          item_key: string
          link_url: string | null
          na_reason: string | null
          name: string
          not_applicable: boolean
          owner_ids: string[]
          owner_is_reporting_manager: boolean
          pending_reason: string | null
          requires_file: boolean
          satisfied_by_step: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          allows_link?: boolean
          case_id: string
          created_at?: string
          department_label: string
          description?: string | null
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          due_days?: number
          file_name?: string | null
          file_path?: string | null
          id?: string
          item_id?: string | null
          item_key: string
          link_url?: string | null
          na_reason?: string | null
          name: string
          not_applicable?: boolean
          owner_ids?: string[]
          owner_is_reporting_manager?: boolean
          pending_reason?: string | null
          requires_file?: boolean
          satisfied_by_step?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          allows_link?: boolean
          case_id?: string
          created_at?: string
          department_label?: string
          description?: string | null
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          due_days?: number
          file_name?: string | null
          file_path?: string | null
          id?: string
          item_id?: string | null
          item_key?: string
          link_url?: string | null
          na_reason?: string | null
          name?: string
          not_applicable?: boolean
          owner_ids?: string[]
          owner_is_reporting_manager?: boolean
          pending_reason?: string | null
          requires_file?: boolean
          satisfied_by_step?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_exit_clearance_checks_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "fms_exit_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_exit_clearance_checks_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "fms_exit_clearance_items"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_exit_clearance_items: {
        Row: {
          active: boolean
          allows_link: boolean
          created_at: string
          department_label: string
          description: string | null
          due_days: number
          id: string
          key: string
          name: string
          owner_ids: string[]
          owner_is_reporting_manager: boolean
          requires_file: boolean
          satisfied_by_step: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          allows_link?: boolean
          created_at?: string
          department_label: string
          description?: string | null
          due_days?: number
          id?: string
          key: string
          name: string
          owner_ids?: string[]
          owner_is_reporting_manager?: boolean
          requires_file?: boolean
          satisfied_by_step?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          allows_link?: boolean
          created_at?: string
          department_label?: string
          description?: string | null
          due_days?: number
          id?: string
          key?: string
          name?: string
          owner_ids?: string[]
          owner_is_reporting_manager?: boolean
          requires_file?: boolean
          satisfied_by_step?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      fms_exit_config: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      fms_exit_counters: {
        Row: {
          last_value: number
          scope: string
          updated_at: string
        }
        Insert: {
          last_value?: number
          scope: string
          updated_at?: string
        }
        Update: {
          last_value?: number
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      fms_exit_document_types: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          requires_file: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          requires_file?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          requires_file?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      fms_exit_documents: {
        Row: {
          ack_signed_name: string | null
          ack_signed_path: string | null
          case_id: string
          created_at: string
          document_type_id: string | null
          file_name: string | null
          file_path: string | null
          handed_over_on: string | null
          id: string
          issued_on: string | null
          name: string
          remarks: string | null
          requires_file: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          ack_signed_name?: string | null
          ack_signed_path?: string | null
          case_id: string
          created_at?: string
          document_type_id?: string | null
          file_name?: string | null
          file_path?: string | null
          handed_over_on?: string | null
          id?: string
          issued_on?: string | null
          name: string
          remarks?: string | null
          requires_file?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          ack_signed_name?: string | null
          ack_signed_path?: string | null
          case_id?: string
          created_at?: string
          document_type_id?: string | null
          file_name?: string | null
          file_path?: string | null
          handed_over_on?: string | null
          id?: string
          issued_on?: string | null
          name?: string
          remarks?: string | null
          requires_file?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_exit_documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "fms_exit_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_exit_documents_document_type_id_fkey"
            columns: ["document_type_id"]
            isOneToOne: false
            referencedRelation: "fms_exit_document_types"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_exit_handover: {
        Row: {
          case_id: string
          created_at: string
          file_name: string | null
          file_path: string | null
          handover_to_name: string | null
          handover_to_user_id: string | null
          hr_confirmed_at: string | null
          hr_confirmed_by: string | null
          hr_remarks: string | null
          kt_done: boolean
          kt_remarks: string | null
          manager_confirmed_at: string | null
          manager_confirmed_by: string | null
          manager_remarks: string | null
          notes: string | null
          updated_at: string
        }
        Insert: {
          case_id: string
          created_at?: string
          file_name?: string | null
          file_path?: string | null
          handover_to_name?: string | null
          handover_to_user_id?: string | null
          hr_confirmed_at?: string | null
          hr_confirmed_by?: string | null
          hr_remarks?: string | null
          kt_done?: boolean
          kt_remarks?: string | null
          manager_confirmed_at?: string | null
          manager_confirmed_by?: string | null
          manager_remarks?: string | null
          notes?: string | null
          updated_at?: string
        }
        Update: {
          case_id?: string
          created_at?: string
          file_name?: string | null
          file_path?: string | null
          handover_to_name?: string | null
          handover_to_user_id?: string | null
          hr_confirmed_at?: string | null
          hr_confirmed_by?: string | null
          hr_remarks?: string | null
          kt_done?: boolean
          kt_remarks?: string | null
          manager_confirmed_at?: string | null
          manager_confirmed_by?: string | null
          manager_remarks?: string | null
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_exit_handover_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "fms_exit_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_exit_interviews: {
        Row: {
          case_id: string
          conducted_by: string | null
          conducted_on: string | null
          created_at: string
          feedback: Json
          file_name: string | null
          file_path: string | null
          portal_feedback_done: boolean
          primary_reason_id: string | null
          remarks: string | null
          updated_at: string
          would_rehire: boolean | null
        }
        Insert: {
          case_id: string
          conducted_by?: string | null
          conducted_on?: string | null
          created_at?: string
          feedback?: Json
          file_name?: string | null
          file_path?: string | null
          portal_feedback_done?: boolean
          primary_reason_id?: string | null
          remarks?: string | null
          updated_at?: string
          would_rehire?: boolean | null
        }
        Update: {
          case_id?: string
          conducted_by?: string | null
          conducted_on?: string | null
          created_at?: string
          feedback?: Json
          file_name?: string | null
          file_path?: string | null
          portal_feedback_done?: boolean
          primary_reason_id?: string | null
          remarks?: string | null
          updated_at?: string
          would_rehire?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "fms_exit_interviews_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "fms_exit_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_exit_interviews_primary_reason_id_fkey"
            columns: ["primary_reason_id"]
            isOneToOne: false
            referencedRelation: "fms_exit_reasons"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_exit_master_managers: {
        Row: {
          created_at: string
          id: string
          manager_user_id: string
          master_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          manager_user_id: string
          master_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          manager_user_id?: string
          master_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      fms_exit_master_requests: {
        Row: {
          created_at: string
          id: string
          master_type: string
          proposed_payload: Json
          requested_by: string | null
          resolved_master_id: string | null
          review_note: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          master_type: string
          proposed_payload?: Json
          requested_by?: string | null
          resolved_master_id?: string | null
          review_note?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          master_type?: string
          proposed_payload?: Json
          requested_by?: string | null
          resolved_master_id?: string | null
          review_note?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      fms_exit_notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          read_at: string | null
          text: string
          type: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          read_at?: string | null
          text: string
          type: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          read_at?: string | null
          text?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      fms_exit_payroll_heads: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          kind: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      fms_exit_payroll_lines: {
        Row: {
          amount: number
          case_id: string
          created_at: string
          head_id: string | null
          head_name: string
          id: string
          kind: string
          remarks: string | null
          sort_order: number
        }
        Insert: {
          amount?: number
          case_id: string
          created_at?: string
          head_id?: string | null
          head_name: string
          id?: string
          kind: string
          remarks?: string | null
          sort_order?: number
        }
        Update: {
          amount?: number
          case_id?: string
          created_at?: string
          head_id?: string | null
          head_name?: string
          id?: string
          kind?: string
          remarks?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "fms_exit_payroll_lines_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "fms_exit_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_exit_payroll_lines_head_id_fkey"
            columns: ["head_id"]
            isOneToOne: false
            referencedRelation: "fms_exit_payroll_heads"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_exit_reasons: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      fms_exit_settlements: {
        Row: {
          case_id: string
          created_at: string
          encashable_days: number | null
          final_fnf_name: string | null
          final_fnf_path: string | null
          fnf_amount: number | null
          fnf_approval_remarks: string | null
          fnf_approved_by_id: string | null
          fnf_file_name: string | null
          fnf_file_path: string | null
          fnf_paid_by_id: string | null
          fnf_paid_on: string | null
          fnf_payment_mode: string | null
          fnf_payment_ref: string | null
          fnf_remarks: string | null
          incentive_amount: number | null
          leave_balance_days: number | null
          leave_remarks: string | null
          loan_recovery_amount: number | null
          lwp_completed: boolean
          lwp_days: number | null
          notice_recovery_amount: number | null
          notice_recovery_days: number | null
          other_deductions: number | null
          payroll_remarks: string | null
          updated_at: string
        }
        Insert: {
          case_id: string
          created_at?: string
          encashable_days?: number | null
          final_fnf_name?: string | null
          final_fnf_path?: string | null
          fnf_amount?: number | null
          fnf_approval_remarks?: string | null
          fnf_approved_by_id?: string | null
          fnf_file_name?: string | null
          fnf_file_path?: string | null
          fnf_paid_by_id?: string | null
          fnf_paid_on?: string | null
          fnf_payment_mode?: string | null
          fnf_payment_ref?: string | null
          fnf_remarks?: string | null
          incentive_amount?: number | null
          leave_balance_days?: number | null
          leave_remarks?: string | null
          loan_recovery_amount?: number | null
          lwp_completed?: boolean
          lwp_days?: number | null
          notice_recovery_amount?: number | null
          notice_recovery_days?: number | null
          other_deductions?: number | null
          payroll_remarks?: string | null
          updated_at?: string
        }
        Update: {
          case_id?: string
          created_at?: string
          encashable_days?: number | null
          final_fnf_name?: string | null
          final_fnf_path?: string | null
          fnf_amount?: number | null
          fnf_approval_remarks?: string | null
          fnf_approved_by_id?: string | null
          fnf_file_name?: string | null
          fnf_file_path?: string | null
          fnf_paid_by_id?: string | null
          fnf_paid_on?: string | null
          fnf_payment_mode?: string | null
          fnf_payment_ref?: string | null
          fnf_remarks?: string | null
          incentive_amount?: number | null
          leave_balance_days?: number | null
          leave_remarks?: string | null
          loan_recovery_amount?: number | null
          lwp_completed?: boolean
          lwp_days?: number | null
          notice_recovery_amount?: number | null
          notice_recovery_days?: number | null
          other_deductions?: number | null
          payroll_remarks?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_exit_settlements_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "fms_exit_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_exit_step_owners: {
        Row: {
          created_at: string
          department_ids: string[]
          designation_id: string | null
          employee_ids: string[]
          id: string
          step_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_ids?: string[]
          designation_id?: string | null
          employee_ids?: string[]
          id?: string
          step_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_ids?: string[]
          designation_id?: string | null
          employee_ids?: string[]
          id?: string
          step_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_exit_step_owners_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "designations"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_exit_step_skips: {
        Row: {
          case_id: string
          reason: string
          skipped_at: string
          skipped_by: string | null
          step_key: string
        }
        Insert: {
          case_id: string
          reason: string
          skipped_at?: string
          skipped_by?: string | null
          step_key: string
        }
        Update: {
          case_id?: string
          reason?: string
          skipped_at?: string
          skipped_by?: string | null
          step_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_exit_step_skips_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "fms_exit_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_field_options: {
        Row: {
          active: boolean
          created_at: string
          id: string
          label: string
          meta: Json
          option_set: string
          sort_order: number
          updated_at: string
          workflow_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          label: string
          meta?: Json
          option_set: string
          sort_order?: number
          updated_at?: string
          workflow_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string
          meta?: Json
          option_set?: string
          sort_order?: number
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_field_options_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "fms_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_hr_activity: {
        Row: {
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          meta: Json
          note: string | null
          type: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          meta?: Json
          note?: string | null
          type: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          meta?: Json
          note?: string | null
          type?: string
        }
        Relationships: []
      }
      fms_hr_candidates: {
        Row: {
          candidate_no: string | null
          created_at: string
          created_by: string | null
          current_company: string | null
          decision_remarks: string | null
          disqualification_note: string | null
          disqualification_reason_id: string | null
          disqualified_at: string | null
          email: string | null
          experience_years: number | null
          final_decision_at: string | null
          finalized_at: string | null
          finalized_by: string | null
          hod_decided_at: string | null
          hod_decided_by: string | null
          hr_shortlisted_at: string | null
          hr_shortlisted_by: string | null
          id: string
          interview1_at: string | null
          interview2_at: string | null
          interview3_at: string | null
          joined_at: string | null
          name: string
          notes: string | null
          offered_ctc: number | null
          parse_status: string
          parsed_json: Json
          phone: string | null
          requisition_id: string
          resume_name: string | null
          resume_path: string | null
          shared_to_hod_at: string | null
          shared_to_hod_by: string | null
          skills: string[]
          source_platform_id: string | null
          stage: string
          telephonic_at: string | null
          updated_at: string
          uploaded_at: string
        }
        Insert: {
          candidate_no?: string | null
          created_at?: string
          created_by?: string | null
          current_company?: string | null
          decision_remarks?: string | null
          disqualification_note?: string | null
          disqualification_reason_id?: string | null
          disqualified_at?: string | null
          email?: string | null
          experience_years?: number | null
          final_decision_at?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          hod_decided_at?: string | null
          hod_decided_by?: string | null
          hr_shortlisted_at?: string | null
          hr_shortlisted_by?: string | null
          id?: string
          interview1_at?: string | null
          interview2_at?: string | null
          interview3_at?: string | null
          joined_at?: string | null
          name: string
          notes?: string | null
          offered_ctc?: number | null
          parse_status?: string
          parsed_json?: Json
          phone?: string | null
          requisition_id: string
          resume_name?: string | null
          resume_path?: string | null
          shared_to_hod_at?: string | null
          shared_to_hod_by?: string | null
          skills?: string[]
          source_platform_id?: string | null
          stage?: string
          telephonic_at?: string | null
          updated_at?: string
          uploaded_at?: string
        }
        Update: {
          candidate_no?: string | null
          created_at?: string
          created_by?: string | null
          current_company?: string | null
          decision_remarks?: string | null
          disqualification_note?: string | null
          disqualification_reason_id?: string | null
          disqualified_at?: string | null
          email?: string | null
          experience_years?: number | null
          final_decision_at?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          hod_decided_at?: string | null
          hod_decided_by?: string | null
          hr_shortlisted_at?: string | null
          hr_shortlisted_by?: string | null
          id?: string
          interview1_at?: string | null
          interview2_at?: string | null
          interview3_at?: string | null
          joined_at?: string | null
          name?: string
          notes?: string | null
          offered_ctc?: number | null
          parse_status?: string
          parsed_json?: Json
          phone?: string | null
          requisition_id?: string
          resume_name?: string | null
          resume_path?: string | null
          shared_to_hod_at?: string | null
          shared_to_hod_by?: string | null
          skills?: string[]
          source_platform_id?: string | null
          stage?: string
          telephonic_at?: string | null
          updated_at?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_hr_candidates_disqualification_reason_id_fkey"
            columns: ["disqualification_reason_id"]
            isOneToOne: false
            referencedRelation: "fms_hr_disqualification_reasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_hr_candidates_requisition_id_fkey"
            columns: ["requisition_id"]
            isOneToOne: false
            referencedRelation: "fms_hr_requisitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_hr_candidates_source_platform_id_fkey"
            columns: ["source_platform_id"]
            isOneToOne: false
            referencedRelation: "fms_hr_job_platforms"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_hr_config: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      fms_hr_counters: {
        Row: {
          last_value: number
          scope: string
          updated_at: string
        }
        Insert: {
          last_value?: number
          scope: string
          updated_at?: string
        }
        Update: {
          last_value?: number
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      fms_hr_disqualification_reasons: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      fms_hr_interviews: {
        Row: {
          candidate_id: string
          created_at: string
          created_by: string | null
          document_name: string | null
          document_path: string | null
          held_at: string | null
          id: string
          interviewer_id: string | null
          interviewer_name: string | null
          remarks: string | null
          round: number
          scheduled_on: string | null
          status: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          candidate_id: string
          created_at?: string
          created_by?: string | null
          document_name?: string | null
          document_path?: string | null
          held_at?: string | null
          id?: string
          interviewer_id?: string | null
          interviewer_name?: string | null
          remarks?: string | null
          round: number
          scheduled_on?: string | null
          status?: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          candidate_id?: string
          created_at?: string
          created_by?: string | null
          document_name?: string | null
          document_path?: string | null
          held_at?: string | null
          id?: string
          interviewer_id?: string | null
          interviewer_name?: string | null
          remarks?: string | null
          round?: number
          scheduled_on?: string | null
          status?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fms_hr_interviews_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "fms_hr_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_hr_job_platforms: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      fms_hr_job_types: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      fms_hr_locations: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      fms_hr_master_managers: {
        Row: {
          created_at: string
          id: string
          manager_user_id: string
          master_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          manager_user_id: string
          master_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          manager_user_id?: string
          master_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      fms_hr_master_requests: {
        Row: {
          created_at: string
          id: string
          master_type: string
          proposed_payload: Json
          requested_by: string | null
          resolved_master_id: string | null
          review_note: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          master_type: string
          proposed_payload?: Json
          requested_by?: string | null
          resolved_master_id?: string | null
          review_note?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          master_type?: string
          proposed_payload?: Json
          requested_by?: string | null
          resolved_master_id?: string | null
          review_note?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      fms_hr_notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          read_at: string | null
          text: string
          type: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          read_at?: string | null
          text: string
          type: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          read_at?: string | null
          text?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      fms_hr_onboarding_checks: {
        Row: {
          allows_link: boolean
          created_at: string
          description: string | null
          done: boolean
          done_at: string | null
          done_by: string | null
          due_days: number
          file_name: string | null
          file_path: string | null
          id: string
          item_id: string | null
          item_key: string
          link_url: string | null
          name: string
          onboarding_id: string
          pending_reason: string | null
          requires_file: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          allows_link?: boolean
          created_at?: string
          description?: string | null
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          due_days?: number
          file_name?: string | null
          file_path?: string | null
          id?: string
          item_id?: string | null
          item_key: string
          link_url?: string | null
          name: string
          onboarding_id: string
          pending_reason?: string | null
          requires_file?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          allows_link?: boolean
          created_at?: string
          description?: string | null
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          due_days?: number
          file_name?: string | null
          file_path?: string | null
          id?: string
          item_id?: string | null
          item_key?: string
          link_url?: string | null
          name?: string
          onboarding_id?: string
          pending_reason?: string | null
          requires_file?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_hr_onboarding_checks_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "fms_hr_onboarding_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_hr_onboarding_checks_onboarding_id_fkey"
            columns: ["onboarding_id"]
            isOneToOne: false
            referencedRelation: "fms_hr_onboardings"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_hr_onboarding_items: {
        Row: {
          active: boolean
          allows_link: boolean
          created_at: string
          description: string | null
          due_days: number
          id: string
          key: string
          name: string
          requires_file: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          allows_link?: boolean
          created_at?: string
          description?: string | null
          due_days?: number
          id?: string
          key: string
          name: string
          requires_file?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          allows_link?: boolean
          created_at?: string
          description?: string | null
          due_days?: number
          id?: string
          key?: string
          name?: string
          requires_file?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      fms_hr_onboardings: {
        Row: {
          candidate_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          employee_code: string | null
          employee_code_at: string | null
          id: string
          joining_date: string | null
          joining_date_set_at: string | null
          offer_decided_at: string | null
          offer_status: string
          offer_status_reason: string | null
          requisition_id: string
          updated_at: string
        }
        Insert: {
          candidate_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          employee_code?: string | null
          employee_code_at?: string | null
          id?: string
          joining_date?: string | null
          joining_date_set_at?: string | null
          offer_decided_at?: string | null
          offer_status?: string
          offer_status_reason?: string | null
          requisition_id: string
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          employee_code?: string | null
          employee_code_at?: string | null
          id?: string
          joining_date?: string | null
          joining_date_set_at?: string | null
          offer_decided_at?: string | null
          offer_status?: string
          offer_status_reason?: string | null
          requisition_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_hr_onboardings_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: true
            referencedRelation: "fms_hr_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_hr_onboardings_requisition_id_fkey"
            columns: ["requisition_id"]
            isOneToOne: false
            referencedRelation: "fms_hr_requisitions"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_hr_probation_reviews: {
        Row: {
          created_at: string
          file_name: string | null
          file_path: string | null
          id: string
          month: number
          probation_id: string
          remarks: string | null
          reviewed_at: string
          reviewer_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          file_path?: string | null
          id?: string
          month: number
          probation_id: string
          remarks?: string | null
          reviewed_at?: string
          reviewer_id?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          file_name?: string | null
          file_path?: string | null
          id?: string
          month?: number
          probation_id?: string
          remarks?: string | null
          reviewed_at?: string
          reviewer_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_hr_probation_reviews_probation_id_fkey"
            columns: ["probation_id"]
            isOneToOne: false
            referencedRelation: "fms_hr_probations"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_hr_probations: {
        Row: {
          candidate_id: string
          created_at: string
          employee_code: string | null
          extension_months: number
          extension_outcome: string | null
          extension_outcome_at: string | null
          extension_outcome_by: string | null
          extension_remarks: string | null
          final_status: string | null
          final_status_at: string | null
          id: string
          joining_date: string
          onboarding_id: string
          opened_at: string
          outcome: string | null
          outcome_at: string | null
          outcome_by: string | null
          outcome_remarks: string | null
          permanent_from: string | null
          requisition_id: string
          updated_at: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          employee_code?: string | null
          extension_months?: number
          extension_outcome?: string | null
          extension_outcome_at?: string | null
          extension_outcome_by?: string | null
          extension_remarks?: string | null
          final_status?: string | null
          final_status_at?: string | null
          id?: string
          joining_date: string
          onboarding_id: string
          opened_at?: string
          outcome?: string | null
          outcome_at?: string | null
          outcome_by?: string | null
          outcome_remarks?: string | null
          permanent_from?: string | null
          requisition_id: string
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          employee_code?: string | null
          extension_months?: number
          extension_outcome?: string | null
          extension_outcome_at?: string | null
          extension_outcome_by?: string | null
          extension_remarks?: string | null
          final_status?: string | null
          final_status_at?: string | null
          id?: string
          joining_date?: string
          onboarding_id?: string
          opened_at?: string
          outcome?: string | null
          outcome_at?: string | null
          outcome_by?: string | null
          outcome_remarks?: string | null
          permanent_from?: string | null
          requisition_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_hr_probations_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "fms_hr_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_hr_probations_onboarding_id_fkey"
            columns: ["onboarding_id"]
            isOneToOne: true
            referencedRelation: "fms_hr_onboardings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_hr_probations_requisition_id_fkey"
            columns: ["requisition_id"]
            isOneToOne: false
            referencedRelation: "fms_hr_requisitions"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_hr_requisition_platforms: {
        Row: {
          platform_id: string
          posted_on: string | null
          requisition_id: string
        }
        Insert: {
          platform_id: string
          posted_on?: string | null
          requisition_id: string
        }
        Update: {
          platform_id?: string
          posted_on?: string | null
          requisition_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_hr_requisition_platforms_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "fms_hr_job_platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_hr_requisition_platforms_requisition_id_fkey"
            columns: ["requisition_id"]
            isOneToOne: false
            referencedRelation: "fms_hr_requisitions"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_hr_requisitions: {
        Row: {
          business_contribution: string | null
          cancel_reason: string | null
          closed_at: string | null
          created_at: string
          current_step: string
          decided_by: string | null
          department_id: string
          expected_start_date: string | null
          hiring_manager_ids: string[]
          hold_at: string | null
          hold_reason: string | null
          hr_approved_at: string | null
          hr_approver_id: string | null
          hr_remarks: string | null
          id: string
          impact_if_unfilled: string | null
          jd_name: string | null
          jd_path: string | null
          job_title: string
          job_type_id: string | null
          key_responsibilities: string | null
          location_id: string | null
          mgmt_approved_at: string | null
          mgmt_approver_id: string | null
          mgmt_remarks: string | null
          mrf_no: string
          position_kind: string
          positions_required: number
          posted_at: string | null
          posted_on: string | null
          preferred_experience: string | null
          previous_employee_name: string | null
          reject_reason: string | null
          rejected_at: string | null
          reporting_to_ids: string[]
          reporting_to_note: string | null
          request_date: string
          requester_id: string | null
          required_skills: string | null
          salary_max: number | null
          salary_min: number | null
          salary_note: string | null
          sent_back_at: string | null
          sent_back_reason: string | null
          status: string
          submitted_at: string
          updated_at: string
          why_needed: string | null
        }
        Insert: {
          business_contribution?: string | null
          cancel_reason?: string | null
          closed_at?: string | null
          created_at?: string
          current_step?: string
          decided_by?: string | null
          department_id: string
          expected_start_date?: string | null
          hiring_manager_ids?: string[]
          hold_at?: string | null
          hold_reason?: string | null
          hr_approved_at?: string | null
          hr_approver_id?: string | null
          hr_remarks?: string | null
          id?: string
          impact_if_unfilled?: string | null
          jd_name?: string | null
          jd_path?: string | null
          job_title: string
          job_type_id?: string | null
          key_responsibilities?: string | null
          location_id?: string | null
          mgmt_approved_at?: string | null
          mgmt_approver_id?: string | null
          mgmt_remarks?: string | null
          mrf_no: string
          position_kind?: string
          positions_required?: number
          posted_at?: string | null
          posted_on?: string | null
          preferred_experience?: string | null
          previous_employee_name?: string | null
          reject_reason?: string | null
          rejected_at?: string | null
          reporting_to_ids?: string[]
          reporting_to_note?: string | null
          request_date?: string
          requester_id?: string | null
          required_skills?: string | null
          salary_max?: number | null
          salary_min?: number | null
          salary_note?: string | null
          sent_back_at?: string | null
          sent_back_reason?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string
          why_needed?: string | null
        }
        Update: {
          business_contribution?: string | null
          cancel_reason?: string | null
          closed_at?: string | null
          created_at?: string
          current_step?: string
          decided_by?: string | null
          department_id?: string
          expected_start_date?: string | null
          hiring_manager_ids?: string[]
          hold_at?: string | null
          hold_reason?: string | null
          hr_approved_at?: string | null
          hr_approver_id?: string | null
          hr_remarks?: string | null
          id?: string
          impact_if_unfilled?: string | null
          jd_name?: string | null
          jd_path?: string | null
          job_title?: string
          job_type_id?: string | null
          key_responsibilities?: string | null
          location_id?: string | null
          mgmt_approved_at?: string | null
          mgmt_approver_id?: string | null
          mgmt_remarks?: string | null
          mrf_no?: string
          position_kind?: string
          positions_required?: number
          posted_at?: string | null
          posted_on?: string | null
          preferred_experience?: string | null
          previous_employee_name?: string | null
          reject_reason?: string | null
          rejected_at?: string | null
          reporting_to_ids?: string[]
          reporting_to_note?: string | null
          request_date?: string
          requester_id?: string | null
          required_skills?: string | null
          salary_max?: number | null
          salary_min?: number | null
          salary_note?: string | null
          sent_back_at?: string | null
          sent_back_reason?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string
          why_needed?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fms_hr_requisitions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_hr_requisitions_job_type_id_fkey"
            columns: ["job_type_id"]
            isOneToOne: false
            referencedRelation: "fms_hr_job_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_hr_requisitions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "fms_hr_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_hr_step_owners: {
        Row: {
          created_at: string
          department_ids: string[]
          designation_id: string | null
          employee_ids: string[]
          id: string
          step_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_ids?: string[]
          designation_id?: string | null
          employee_ids?: string[]
          id?: string
          step_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_ids?: string[]
          designation_id?: string | null
          employee_ids?: string[]
          id?: string
          step_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_hr_step_owners_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "designations"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_import_activity: {
        Row: {
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          meta: Json
          note: string | null
          type: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          meta?: Json
          note?: string | null
          type: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          meta?: Json
          note?: string | null
          type?: string
        }
        Relationships: []
      }
      fms_import_approval_matrix: {
        Row: {
          active: boolean
          approver_user_id: string
          created_at: string
          id: string
          max_amount: number | null
          min_amount: number
          sort_order: number
          tier_label: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          approver_user_id: string
          created_at?: string
          id?: string
          max_amount?: number | null
          min_amount?: number
          sort_order?: number
          tier_label: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          approver_user_id?: string
          created_at?: string
          id?: string
          max_amount?: number | null
          min_amount?: number
          sort_order?: number
          tier_label?: string
          updated_at?: string
        }
        Relationships: []
      }
      fms_import_categories: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      fms_import_companies: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          location: string | null
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          location?: string | null
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          location?: string | null
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      fms_import_config: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      fms_import_counters: {
        Row: {
          last_value: number
          scope: string
          updated_at: string
        }
        Insert: {
          last_value?: number
          scope: string
          updated_at?: string
        }
        Update: {
          last_value?: number
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      fms_import_followups: {
        Row: {
          actual_dispatch_date: string | null
          created_at: string
          created_by: string | null
          dispatch_status: string
          edited_at: string | null
          edited_by: string | null
          id: string
          lr_no: string | null
          pi_id: string | null
          pi_remarks: string | null
          po_id: string
          remarks: string | null
          revised_dispatch_date: string | null
          transport_details: string | null
        }
        Insert: {
          actual_dispatch_date?: string | null
          created_at?: string
          created_by?: string | null
          dispatch_status: string
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          lr_no?: string | null
          pi_id?: string | null
          pi_remarks?: string | null
          po_id: string
          remarks?: string | null
          revised_dispatch_date?: string | null
          transport_details?: string | null
        }
        Update: {
          actual_dispatch_date?: string | null
          created_at?: string
          created_by?: string | null
          dispatch_status?: string
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          lr_no?: string | null
          pi_id?: string | null
          pi_remarks?: string | null
          po_id?: string
          remarks?: string | null
          revised_dispatch_date?: string | null
          transport_details?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fms_import_followups_pi_id_fkey"
            columns: ["pi_id"]
            isOneToOne: false
            referencedRelation: "fms_import_pis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_import_followups_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "fms_import_pos"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_import_grn_items: {
        Row: {
          condition: string
          created_at: string
          grn_id: string
          id: string
          po_item_id: string
          received_qty: number
        }
        Insert: {
          condition?: string
          created_at?: string
          grn_id: string
          id?: string
          po_item_id: string
          received_qty: number
        }
        Update: {
          condition?: string
          created_at?: string
          grn_id?: string
          id?: string
          po_item_id?: string
          received_qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "fms_import_grn_items_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "fms_import_grns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_import_grn_items_po_item_id_fkey"
            columns: ["po_item_id"]
            isOneToOne: false
            referencedRelation: "fms_import_po_items"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_import_grns: {
        Row: {
          condition: string
          created_at: string
          edited_at: string | null
          edited_by: string | null
          gate_register_no: string | null
          id: string
          note: string | null
          photo_name: string | null
          photo_path: string | null
          pi_id: string | null
          pi_ref: string | null
          po_id: string
          po_ref: string | null
          received_by: string | null
        }
        Insert: {
          condition?: string
          created_at?: string
          edited_at?: string | null
          edited_by?: string | null
          gate_register_no?: string | null
          id?: string
          note?: string | null
          photo_name?: string | null
          photo_path?: string | null
          pi_id?: string | null
          pi_ref?: string | null
          po_id: string
          po_ref?: string | null
          received_by?: string | null
        }
        Update: {
          condition?: string
          created_at?: string
          edited_at?: string | null
          edited_by?: string | null
          gate_register_no?: string | null
          id?: string
          note?: string | null
          photo_name?: string | null
          photo_path?: string | null
          pi_id?: string | null
          pi_ref?: string | null
          po_id?: string
          po_ref?: string | null
          received_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fms_import_grns_pi_id_fkey"
            columns: ["pi_id"]
            isOneToOne: false
            referencedRelation: "fms_import_pis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_import_grns_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "fms_import_pos"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_import_item_groups: {
        Row: {
          active: boolean
          category_id: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          category_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          category_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_import_item_groups_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "fms_import_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_import_items: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          item_group_id: string
          name: string
          sort_order: number
          unit: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          item_group_id: string
          name: string
          sort_order?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          item_group_id?: string
          name?: string
          sort_order?: number
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_import_items_item_group_id_fkey"
            columns: ["item_group_id"]
            isOneToOne: false
            referencedRelation: "fms_import_item_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_import_master_managers: {
        Row: {
          created_at: string
          id: string
          manager_user_id: string
          master_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          manager_user_id: string
          master_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          manager_user_id?: string
          master_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      fms_import_master_requests: {
        Row: {
          created_at: string
          id: string
          master_type: string
          proposed_payload: Json
          requested_by: string | null
          resolved_master_id: string | null
          review_note: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          master_type: string
          proposed_payload?: Json
          requested_by?: string | null
          resolved_master_id?: string | null
          review_note?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          master_type?: string
          proposed_payload?: Json
          requested_by?: string | null
          resolved_master_id?: string | null
          review_note?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      fms_import_notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          read_at: string | null
          text: string
          type: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          read_at?: string | null
          text: string
          type: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          read_at?: string | null
          text?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      fms_import_payments: {
        Row: {
          advice_name: string | null
          advice_path: string | null
          amount: number
          amount_fx: number | null
          created_at: string
          created_by: string | null
          currency: string | null
          details: string | null
          edited_at: string | null
          edited_by: string | null
          fx_rate: number | null
          id: string
          inr_amount: number | null
          kind: string
          paid_on: string
          pi_id: string | null
          pi_remarks: string | null
          po_id: string
          utr_ref: string | null
        }
        Insert: {
          advice_name?: string | null
          advice_path?: string | null
          amount: number
          amount_fx?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          details?: string | null
          edited_at?: string | null
          edited_by?: string | null
          fx_rate?: number | null
          id?: string
          inr_amount?: number | null
          kind: string
          paid_on?: string
          pi_id?: string | null
          pi_remarks?: string | null
          po_id: string
          utr_ref?: string | null
        }
        Update: {
          advice_name?: string | null
          advice_path?: string | null
          amount?: number
          amount_fx?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          details?: string | null
          edited_at?: string | null
          edited_by?: string | null
          fx_rate?: number | null
          id?: string
          inr_amount?: number | null
          kind?: string
          paid_on?: string
          pi_id?: string | null
          pi_remarks?: string | null
          po_id?: string
          utr_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fms_import_payments_pi_id_fkey"
            columns: ["pi_id"]
            isOneToOne: false
            referencedRelation: "fms_import_pis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_import_payments_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "fms_import_pos"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_import_pi_items: {
        Row: {
          created_at: string
          id: string
          pi_id: string
          po_item_id: string
          qty: number
        }
        Insert: {
          created_at?: string
          id?: string
          pi_id: string
          po_item_id: string
          qty: number
        }
        Update: {
          created_at?: string
          id?: string
          pi_id?: string
          po_item_id?: string
          qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "fms_import_pi_items_pi_id_fkey"
            columns: ["pi_id"]
            isOneToOne: false
            referencedRelation: "fms_import_pis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_import_pi_items_po_item_id_fkey"
            columns: ["po_item_id"]
            isOneToOne: false
            referencedRelation: "fms_import_po_items"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_import_pis: {
        Row: {
          actual_dispatch_date: string | null
          created_at: string
          created_by: string | null
          dispatch_date: string | null
          dispatch_status: string
          document_name: string | null
          document_path: string | null
          edited_at: string | null
          edited_by: string | null
          id: string
          lr_no: string | null
          payment_terms: string
          pi_value: number
          po_id: string
          revised_dispatch_date: string | null
          status: string
          transport_details: string | null
          updated_at: string
          vendor_pi_no: string
        }
        Insert: {
          actual_dispatch_date?: string | null
          created_at?: string
          created_by?: string | null
          dispatch_date?: string | null
          dispatch_status?: string
          document_name?: string | null
          document_path?: string | null
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          lr_no?: string | null
          payment_terms?: string
          pi_value?: number
          po_id: string
          revised_dispatch_date?: string | null
          status?: string
          transport_details?: string | null
          updated_at?: string
          vendor_pi_no: string
        }
        Update: {
          actual_dispatch_date?: string | null
          created_at?: string
          created_by?: string | null
          dispatch_date?: string | null
          dispatch_status?: string
          document_name?: string | null
          document_path?: string | null
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          lr_no?: string | null
          payment_terms?: string
          pi_value?: number
          po_id?: string
          revised_dispatch_date?: string | null
          status?: string
          transport_details?: string | null
          updated_at?: string
          vendor_pi_no?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_import_pis_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "fms_import_pos"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_import_po_cancel_requests: {
        Row: {
          created_at: string
          id: string
          po_id: string
          reason: string
          requested_by: string | null
          review_note: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          vendor_ref: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          po_id: string
          reason: string
          requested_by?: string | null
          review_note?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          vendor_ref?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          po_id?: string
          reason?: string
          requested_by?: string | null
          review_note?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          vendor_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fms_import_po_cancel_requests_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "fms_import_pos"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_import_po_items: {
        Row: {
          created_at: string
          gst_pct: number | null
          id: string
          line_value: number
          po_id: string
          qty: number
          rate: number
          received_qty: number
          request_item_id: string
        }
        Insert: {
          created_at?: string
          gst_pct?: number | null
          id?: string
          line_value: number
          po_id: string
          qty: number
          rate: number
          received_qty?: number
          request_item_id: string
        }
        Update: {
          created_at?: string
          gst_pct?: number | null
          id?: string
          line_value?: number
          po_id?: string
          qty?: number
          rate?: number
          received_qty?: number
          request_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_import_po_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "fms_import_pos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_import_po_items_request_item_id_fkey"
            columns: ["request_item_id"]
            isOneToOne: true
            referencedRelation: "fms_import_request_items"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_import_pos: {
        Row: {
          advance_paid: number
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          currency: string | null
          current_stage: string
          dispatch_date: string | null
          document_name: string | null
          document_path: string | null
          edited_at: string | null
          edited_by: string | null
          fx_rate: number | null
          fx_rate_at: string | null
          fx_source: string | null
          id: string
          payment_terms: string | null
          po_no: string
          share_remarks: string | null
          shared_at: string | null
          shared_by: string | null
          status: string
          tally_po_no: string | null
          total_value: number
          total_value_fx: number
          updated_at: string
          vendor_id: string
        }
        Insert: {
          advance_paid?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          current_stage?: string
          dispatch_date?: string | null
          document_name?: string | null
          document_path?: string | null
          edited_at?: string | null
          edited_by?: string | null
          fx_rate?: number | null
          fx_rate_at?: string | null
          fx_source?: string | null
          id?: string
          payment_terms?: string | null
          po_no: string
          share_remarks?: string | null
          shared_at?: string | null
          shared_by?: string | null
          status?: string
          tally_po_no?: string | null
          total_value?: number
          total_value_fx?: number
          updated_at?: string
          vendor_id: string
        }
        Update: {
          advance_paid?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          current_stage?: string
          dispatch_date?: string | null
          document_name?: string | null
          document_path?: string | null
          edited_at?: string | null
          edited_by?: string | null
          fx_rate?: number | null
          fx_rate_at?: string | null
          fx_source?: string | null
          id?: string
          payment_terms?: string | null
          po_no?: string
          share_remarks?: string | null
          shared_at?: string | null
          shared_by?: string | null
          status?: string
          tally_po_no?: string | null
          total_value?: number
          total_value_fx?: number
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_import_pos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "fms_import_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_import_pos_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "fms_import_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_import_quotations: {
        Row: {
          created_at: string
          gst_pct: number | null
          id: string
          is_recommended: boolean
          lead_time_days: number | null
          rate: number
          remark: string | null
          request_item_id: string
          vendor_id: string
        }
        Insert: {
          created_at?: string
          gst_pct?: number | null
          id?: string
          is_recommended?: boolean
          lead_time_days?: number | null
          rate: number
          remark?: string | null
          request_item_id: string
          vendor_id: string
        }
        Update: {
          created_at?: string
          gst_pct?: number | null
          id?: string
          is_recommended?: boolean
          lead_time_days?: number | null
          rate?: number
          remark?: string | null
          request_item_id?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_import_quotations_request_item_id_fkey"
            columns: ["request_item_id"]
            isOneToOne: false
            referencedRelation: "fms_import_request_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_import_quotations_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "fms_import_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_import_request_items: {
        Row: {
          approval_tier: string | null
          approved_at: string | null
          approver_id: string | null
          assigned_approver_id: string | null
          cancel_reason: string | null
          created_at: string
          currency: string | null
          edited_at: string | null
          edited_by: string | null
          final_qty: number | null
          final_rate: number | null
          final_vendor_id: string | null
          fx_rate_at_request: number | null
          gst_pct: number | null
          id: string
          item_id: string
          line_remark: string | null
          line_value: number | null
          line_value_fx: number | null
          quantity: number
          reject_reason: string | null
          request_id: string
          sourced_at: string | null
          sourcing_reason: string | null
          status: string
          unit: string
          updated_at: string
        }
        Insert: {
          approval_tier?: string | null
          approved_at?: string | null
          approver_id?: string | null
          assigned_approver_id?: string | null
          cancel_reason?: string | null
          created_at?: string
          currency?: string | null
          edited_at?: string | null
          edited_by?: string | null
          final_qty?: number | null
          final_rate?: number | null
          final_vendor_id?: string | null
          fx_rate_at_request?: number | null
          gst_pct?: number | null
          id?: string
          item_id: string
          line_remark?: string | null
          line_value?: number | null
          line_value_fx?: number | null
          quantity: number
          reject_reason?: string | null
          request_id: string
          sourced_at?: string | null
          sourcing_reason?: string | null
          status?: string
          unit?: string
          updated_at?: string
        }
        Update: {
          approval_tier?: string | null
          approved_at?: string | null
          approver_id?: string | null
          assigned_approver_id?: string | null
          cancel_reason?: string | null
          created_at?: string
          currency?: string | null
          edited_at?: string | null
          edited_by?: string | null
          final_qty?: number | null
          final_rate?: number | null
          final_vendor_id?: string | null
          fx_rate_at_request?: number | null
          gst_pct?: number | null
          id?: string
          item_id?: string
          line_remark?: string | null
          line_value?: number | null
          line_value_fx?: number | null
          quantity?: number
          reject_reason?: string | null
          request_id?: string
          sourced_at?: string | null
          sourcing_reason?: string | null
          status?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_import_request_items_final_vendor_id_fkey"
            columns: ["final_vendor_id"]
            isOneToOne: false
            referencedRelation: "fms_import_vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_import_request_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "fms_import_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_import_request_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "fms_import_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_import_requests: {
        Row: {
          category_id: string
          company_id: string
          created_at: string
          currency: string | null
          id: string
          note: string | null
          request_no: string
          requester_id: string | null
          status: string
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          category_id: string
          company_id: string
          created_at?: string
          currency?: string | null
          id?: string
          note?: string | null
          request_no: string
          requester_id?: string | null
          status?: string
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          category_id?: string
          company_id?: string
          created_at?: string
          currency?: string | null
          id?: string
          note?: string | null
          request_no?: string
          requester_id?: string | null
          status?: string
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fms_import_requests_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "fms_import_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_import_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "fms_import_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_import_requests_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "fms_import_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_import_step_owners: {
        Row: {
          created_at: string
          department_id: string | null
          department_ids: string[]
          designation_id: string | null
          employee_ids: string[]
          id: string
          step_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          department_ids?: string[]
          designation_id?: string | null
          employee_ids?: string[]
          id?: string
          step_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string | null
          department_ids?: string[]
          designation_id?: string | null
          employee_ids?: string[]
          id?: string
          step_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_import_step_owners_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "designations"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_import_tally_bookings: {
        Row: {
          booked_by: string | null
          created_at: string
          document_name: string | null
          document_path: string | null
          edited_at: string | null
          edited_by: string | null
          grn_id: string | null
          id: string
          po_id: string
          remarks: string | null
          tally_pi_no: string
        }
        Insert: {
          booked_by?: string | null
          created_at?: string
          document_name?: string | null
          document_path?: string | null
          edited_at?: string | null
          edited_by?: string | null
          grn_id?: string | null
          id?: string
          po_id: string
          remarks?: string | null
          tally_pi_no: string
        }
        Update: {
          booked_by?: string | null
          created_at?: string
          document_name?: string | null
          document_path?: string | null
          edited_at?: string | null
          edited_by?: string | null
          grn_id?: string | null
          id?: string
          po_id?: string
          remarks?: string | null
          tally_pi_no?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_import_tally_bookings_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "fms_import_grns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_import_tally_bookings_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "fms_import_pos"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_import_vendor_item_prices: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          currency: string
          gst_pct: number | null
          id: string
          item_id: string
          rate: number
          sort_order: number
          updated_at: string
          vendor_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          currency?: string
          gst_pct?: number | null
          id?: string
          item_id: string
          rate: number
          sort_order?: number
          updated_at?: string
          vendor_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          currency?: string
          gst_pct?: number | null
          id?: string
          item_id?: string
          rate?: number
          sort_order?: number
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_import_vendor_item_prices_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "fms_import_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_import_vendor_item_prices_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "fms_import_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_import_vendors: {
        Row: {
          active: boolean
          address: string | null
          contact_name: string | null
          created_at: string
          created_by: string | null
          default_currency: string | null
          email: string | null
          gstin: string | null
          id: string
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          default_currency?: string | null
          email?: string | null
          gstin?: string | null
          id?: string
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          default_currency?: string | null
          email?: string | null
          gstin?: string | null
          id?: string
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      fms_purchase_activity: {
        Row: {
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          meta: Json
          note: string | null
          type: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          meta?: Json
          note?: string | null
          type: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          meta?: Json
          note?: string | null
          type?: string
        }
        Relationships: []
      }
      fms_purchase_approval_matrix: {
        Row: {
          active: boolean
          approver_user_id: string
          approver_user_ids: string[]
          created_at: string
          id: string
          max_amount: number | null
          min_amount: number
          sort_order: number
          tier_label: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          approver_user_id: string
          approver_user_ids?: string[]
          created_at?: string
          id?: string
          max_amount?: number | null
          min_amount?: number
          sort_order?: number
          tier_label: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          approver_user_id?: string
          approver_user_ids?: string[]
          created_at?: string
          id?: string
          max_amount?: number | null
          min_amount?: number
          sort_order?: number
          tier_label?: string
          updated_at?: string
        }
        Relationships: []
      }
      fms_purchase_categories: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      fms_purchase_companies: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          location: string | null
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          location?: string | null
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          location?: string | null
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      fms_purchase_config: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      fms_purchase_counters: {
        Row: {
          last_value: number
          scope: string
          updated_at: string
        }
        Insert: {
          last_value?: number
          scope: string
          updated_at?: string
        }
        Update: {
          last_value?: number
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      fms_purchase_followups: {
        Row: {
          actual_dispatch_date: string | null
          created_at: string
          created_by: string | null
          dispatch_status: string
          edited_at: string | null
          edited_by: string | null
          id: string
          lr_no: string | null
          pi_id: string | null
          pi_remarks: string | null
          po_id: string
          remarks: string | null
          revised_dispatch_date: string | null
          transport_details: string | null
        }
        Insert: {
          actual_dispatch_date?: string | null
          created_at?: string
          created_by?: string | null
          dispatch_status: string
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          lr_no?: string | null
          pi_id?: string | null
          pi_remarks?: string | null
          po_id: string
          remarks?: string | null
          revised_dispatch_date?: string | null
          transport_details?: string | null
        }
        Update: {
          actual_dispatch_date?: string | null
          created_at?: string
          created_by?: string | null
          dispatch_status?: string
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          lr_no?: string | null
          pi_id?: string | null
          pi_remarks?: string | null
          po_id?: string
          remarks?: string | null
          revised_dispatch_date?: string | null
          transport_details?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fms_purchase_followups_pi_id_fkey"
            columns: ["pi_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_pis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_purchase_followups_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_pos"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_purchase_grn_items: {
        Row: {
          condition: string
          created_at: string
          grn_id: string
          id: string
          po_item_id: string
          received_qty: number
        }
        Insert: {
          condition?: string
          created_at?: string
          grn_id: string
          id?: string
          po_item_id: string
          received_qty: number
        }
        Update: {
          condition?: string
          created_at?: string
          grn_id?: string
          id?: string
          po_item_id?: string
          received_qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "fms_purchase_grn_items_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_grns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_purchase_grn_items_po_item_id_fkey"
            columns: ["po_item_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_po_items"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_purchase_grns: {
        Row: {
          condition: string
          created_at: string
          edited_at: string | null
          edited_by: string | null
          gate_register_no: string | null
          id: string
          note: string | null
          photo_name: string | null
          photo_path: string | null
          pi_id: string | null
          pi_ref: string | null
          po_id: string
          po_ref: string | null
          received_by: string | null
        }
        Insert: {
          condition?: string
          created_at?: string
          edited_at?: string | null
          edited_by?: string | null
          gate_register_no?: string | null
          id?: string
          note?: string | null
          photo_name?: string | null
          photo_path?: string | null
          pi_id?: string | null
          pi_ref?: string | null
          po_id: string
          po_ref?: string | null
          received_by?: string | null
        }
        Update: {
          condition?: string
          created_at?: string
          edited_at?: string | null
          edited_by?: string | null
          gate_register_no?: string | null
          id?: string
          note?: string | null
          photo_name?: string | null
          photo_path?: string | null
          pi_id?: string | null
          pi_ref?: string | null
          po_id?: string
          po_ref?: string | null
          received_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fms_purchase_grns_pi_id_fkey"
            columns: ["pi_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_pis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_purchase_grns_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_pos"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_purchase_item_groups: {
        Row: {
          active: boolean
          category_id: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          category_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          category_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_purchase_item_groups_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_purchase_items: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          item_group_id: string
          name: string
          sort_order: number
          unit: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          item_group_id: string
          name: string
          sort_order?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          item_group_id?: string
          name?: string
          sort_order?: number
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_purchase_items_item_group_id_fkey"
            columns: ["item_group_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_item_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_purchase_master_managers: {
        Row: {
          created_at: string
          id: string
          manager_user_id: string
          master_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          manager_user_id: string
          master_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          manager_user_id?: string
          master_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      fms_purchase_master_requests: {
        Row: {
          created_at: string
          id: string
          master_type: string
          proposed_payload: Json
          requested_by: string | null
          resolved_master_id: string | null
          review_note: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          master_type: string
          proposed_payload?: Json
          requested_by?: string | null
          resolved_master_id?: string | null
          review_note?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          master_type?: string
          proposed_payload?: Json
          requested_by?: string | null
          resolved_master_id?: string | null
          review_note?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      fms_purchase_notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          read_at: string | null
          text: string
          type: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          read_at?: string | null
          text: string
          type: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          read_at?: string | null
          text?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      fms_purchase_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          edited_at: string | null
          edited_by: string | null
          id: string
          kind: string
          paid_on: string
          pi_id: string | null
          pi_remarks: string | null
          po_id: string
          utr_ref: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          kind: string
          paid_on?: string
          pi_id?: string | null
          pi_remarks?: string | null
          po_id: string
          utr_ref?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          kind?: string
          paid_on?: string
          pi_id?: string | null
          pi_remarks?: string | null
          po_id?: string
          utr_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fms_purchase_payments_pi_id_fkey"
            columns: ["pi_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_pis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_purchase_payments_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_pos"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_purchase_pi_items: {
        Row: {
          created_at: string
          id: string
          pi_id: string
          po_item_id: string
          qty: number
        }
        Insert: {
          created_at?: string
          id?: string
          pi_id: string
          po_item_id: string
          qty: number
        }
        Update: {
          created_at?: string
          id?: string
          pi_id?: string
          po_item_id?: string
          qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "fms_purchase_pi_items_pi_id_fkey"
            columns: ["pi_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_pis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_purchase_pi_items_po_item_id_fkey"
            columns: ["po_item_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_po_items"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_purchase_pis: {
        Row: {
          actual_dispatch_date: string | null
          created_at: string
          created_by: string | null
          dispatch_date: string | null
          dispatch_status: string
          document_name: string | null
          document_path: string | null
          edited_at: string | null
          edited_by: string | null
          id: string
          lr_no: string | null
          payment_terms: string
          pi_value: number
          po_id: string
          revised_dispatch_date: string | null
          status: string
          transport_details: string | null
          updated_at: string
          vendor_pi_no: string
        }
        Insert: {
          actual_dispatch_date?: string | null
          created_at?: string
          created_by?: string | null
          dispatch_date?: string | null
          dispatch_status?: string
          document_name?: string | null
          document_path?: string | null
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          lr_no?: string | null
          payment_terms?: string
          pi_value?: number
          po_id: string
          revised_dispatch_date?: string | null
          status?: string
          transport_details?: string | null
          updated_at?: string
          vendor_pi_no: string
        }
        Update: {
          actual_dispatch_date?: string | null
          created_at?: string
          created_by?: string | null
          dispatch_date?: string | null
          dispatch_status?: string
          document_name?: string | null
          document_path?: string | null
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          lr_no?: string | null
          payment_terms?: string
          pi_value?: number
          po_id?: string
          revised_dispatch_date?: string | null
          status?: string
          transport_details?: string | null
          updated_at?: string
          vendor_pi_no?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_purchase_pis_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_pos"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_purchase_po_cancel_requests: {
        Row: {
          created_at: string
          id: string
          po_id: string
          reason: string
          requested_by: string | null
          review_note: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          vendor_ref: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          po_id: string
          reason: string
          requested_by?: string | null
          review_note?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          vendor_ref?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          po_id?: string
          reason?: string
          requested_by?: string | null
          review_note?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          vendor_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fms_purchase_po_cancel_requests_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_pos"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_purchase_po_items: {
        Row: {
          created_at: string
          gst_pct: number | null
          id: string
          lead_time_days: number | null
          line_value: number
          po_id: string
          qty: number
          rate: number
          received_qty: number
          request_item_id: string
        }
        Insert: {
          created_at?: string
          gst_pct?: number | null
          id?: string
          lead_time_days?: number | null
          line_value: number
          po_id: string
          qty: number
          rate: number
          received_qty?: number
          request_item_id: string
        }
        Update: {
          created_at?: string
          gst_pct?: number | null
          id?: string
          lead_time_days?: number | null
          line_value?: number
          po_id?: string
          qty?: number
          rate?: number
          received_qty?: number
          request_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_purchase_po_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_pos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_purchase_po_items_request_item_id_fkey"
            columns: ["request_item_id"]
            isOneToOne: true
            referencedRelation: "fms_purchase_request_items"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_purchase_pos: {
        Row: {
          advance_paid: number
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          current_stage: string
          dispatch_date: string | null
          document_name: string | null
          document_path: string | null
          edited_at: string | null
          edited_by: string | null
          id: string
          payment_terms: string | null
          po_no: string
          share_remarks: string | null
          shared_at: string | null
          shared_by: string | null
          status: string
          tally_po_no: string | null
          total_value: number
          updated_at: string
          vendor_id: string
        }
        Insert: {
          advance_paid?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          current_stage?: string
          dispatch_date?: string | null
          document_name?: string | null
          document_path?: string | null
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          payment_terms?: string | null
          po_no: string
          share_remarks?: string | null
          shared_at?: string | null
          shared_by?: string | null
          status?: string
          tally_po_no?: string | null
          total_value?: number
          updated_at?: string
          vendor_id: string
        }
        Update: {
          advance_paid?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          current_stage?: string
          dispatch_date?: string | null
          document_name?: string | null
          document_path?: string | null
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          payment_terms?: string | null
          po_no?: string
          share_remarks?: string | null
          shared_at?: string | null
          shared_by?: string | null
          status?: string
          tally_po_no?: string | null
          total_value?: number
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_purchase_pos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_purchase_pos_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_purchase_quotations: {
        Row: {
          created_at: string
          gst_pct: number | null
          id: string
          is_recommended: boolean
          lead_time_days: number | null
          rate: number
          remark: string | null
          request_item_id: string
          vendor_id: string
        }
        Insert: {
          created_at?: string
          gst_pct?: number | null
          id?: string
          is_recommended?: boolean
          lead_time_days?: number | null
          rate: number
          remark?: string | null
          request_item_id: string
          vendor_id: string
        }
        Update: {
          created_at?: string
          gst_pct?: number | null
          id?: string
          is_recommended?: boolean
          lead_time_days?: number | null
          rate?: number
          remark?: string | null
          request_item_id?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_purchase_quotations_request_item_id_fkey"
            columns: ["request_item_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_request_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_purchase_quotations_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_purchase_request_items: {
        Row: {
          approval_tier: string | null
          approved_at: string | null
          approver_id: string | null
          assigned_approver_id: string | null
          cancel_reason: string | null
          created_at: string
          edited_at: string | null
          edited_by: string | null
          final_qty: number | null
          final_rate: number | null
          final_vendor_id: string | null
          gst_pct: number | null
          id: string
          item_id: string
          lead_time_days: number | null
          line_remark: string | null
          line_value: number | null
          quantity: number
          reject_reason: string | null
          request_id: string
          sourced_at: string | null
          sourced_by: string | null
          sourcing_reason: string | null
          status: string
          unit: string
          updated_at: string
        }
        Insert: {
          approval_tier?: string | null
          approved_at?: string | null
          approver_id?: string | null
          assigned_approver_id?: string | null
          cancel_reason?: string | null
          created_at?: string
          edited_at?: string | null
          edited_by?: string | null
          final_qty?: number | null
          final_rate?: number | null
          final_vendor_id?: string | null
          gst_pct?: number | null
          id?: string
          item_id: string
          lead_time_days?: number | null
          line_remark?: string | null
          line_value?: number | null
          quantity: number
          reject_reason?: string | null
          request_id: string
          sourced_at?: string | null
          sourced_by?: string | null
          sourcing_reason?: string | null
          status?: string
          unit?: string
          updated_at?: string
        }
        Update: {
          approval_tier?: string | null
          approved_at?: string | null
          approver_id?: string | null
          assigned_approver_id?: string | null
          cancel_reason?: string | null
          created_at?: string
          edited_at?: string | null
          edited_by?: string | null
          final_qty?: number | null
          final_rate?: number | null
          final_vendor_id?: string | null
          gst_pct?: number | null
          id?: string
          item_id?: string
          lead_time_days?: number | null
          line_remark?: string | null
          line_value?: number | null
          quantity?: number
          reject_reason?: string | null
          request_id?: string
          sourced_at?: string | null
          sourced_by?: string | null
          sourcing_reason?: string | null
          status?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_purchase_request_items_final_vendor_id_fkey"
            columns: ["final_vendor_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_purchase_request_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_purchase_request_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_purchase_request_vendors: {
        Row: {
          created_at: string
          id: string
          is_recommended: boolean
          remark: string | null
          request_id: string
          sort_order: number
          vendor_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_recommended?: boolean
          remark?: string | null
          request_id: string
          sort_order?: number
          vendor_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_recommended?: boolean
          remark?: string | null
          request_id?: string
          sort_order?: number
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_purchase_request_vendors_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_purchase_request_vendors_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_purchase_requests: {
        Row: {
          category_id: string
          company_id: string
          created_at: string
          id: string
          note: string | null
          request_no: string
          requester_id: string | null
          sourced_at: string | null
          sourced_by: string | null
          sourcing_reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          category_id: string
          company_id: string
          created_at?: string
          id?: string
          note?: string | null
          request_no: string
          requester_id?: string | null
          sourced_at?: string | null
          sourced_by?: string | null
          sourcing_reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          company_id?: string
          created_at?: string
          id?: string
          note?: string | null
          request_no?: string
          requester_id?: string | null
          sourced_at?: string | null
          sourced_by?: string | null
          sourcing_reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_purchase_requests_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_purchase_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_purchase_step_owners: {
        Row: {
          created_at: string
          department_id: string | null
          department_ids: string[]
          designation_id: string | null
          employee_ids: string[]
          id: string
          step_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          department_ids?: string[]
          designation_id?: string | null
          employee_ids?: string[]
          id?: string
          step_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string | null
          department_ids?: string[]
          designation_id?: string | null
          employee_ids?: string[]
          id?: string
          step_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_purchase_step_owners_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "designations"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_purchase_tally_bookings: {
        Row: {
          booked_by: string | null
          created_at: string
          document_name: string | null
          document_path: string | null
          edited_at: string | null
          edited_by: string | null
          grn_id: string | null
          id: string
          po_id: string
          remarks: string | null
          tally_pi_no: string
        }
        Insert: {
          booked_by?: string | null
          created_at?: string
          document_name?: string | null
          document_path?: string | null
          edited_at?: string | null
          edited_by?: string | null
          grn_id?: string | null
          id?: string
          po_id: string
          remarks?: string | null
          tally_pi_no: string
        }
        Update: {
          booked_by?: string | null
          created_at?: string
          document_name?: string | null
          document_path?: string | null
          edited_at?: string | null
          edited_by?: string | null
          grn_id?: string | null
          id?: string
          po_id?: string
          remarks?: string | null
          tally_pi_no?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_purchase_tally_bookings_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_grns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_purchase_tally_bookings_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_pos"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_purchase_vendor_item_prices: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          gst_pct: number | null
          id: string
          item_id: string
          lead_time_days: number | null
          rate: number
          sort_order: number
          updated_at: string
          vendor_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          gst_pct?: number | null
          id?: string
          item_id: string
          lead_time_days?: number | null
          rate: number
          sort_order?: number
          updated_at?: string
          vendor_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          gst_pct?: number | null
          id?: string
          item_id?: string
          lead_time_days?: number | null
          rate?: number
          sort_order?: number
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_purchase_vendor_item_prices_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_purchase_vendor_item_prices_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "fms_purchase_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_purchase_vendors: {
        Row: {
          active: boolean
          address: string | null
          contact_name: string | null
          created_at: string
          created_by: string | null
          email: string | null
          gstin: string | null
          id: string
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          gstin?: string | null
          id?: string
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          gstin?: string | null
          id?: string
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      fms_step_fields: {
        Row: {
          created_at: string
          half: boolean
          id: string
          key: string
          label: string
          option_set: string | null
          options: Json | null
          placeholder: string | null
          required: boolean
          sort_order: number
          step_id: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          half?: boolean
          id?: string
          key: string
          label: string
          option_set?: string | null
          options?: Json | null
          placeholder?: string | null
          required?: boolean
          sort_order?: number
          step_id: string
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          half?: boolean
          id?: string
          key?: string
          label?: string
          option_set?: string | null
          options?: Json | null
          placeholder?: string | null
          required?: boolean
          sort_order?: number
          step_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_step_fields_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "fms_workflow_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_supplies_activity: {
        Row: {
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          meta: Json
          note: string | null
          type: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          meta?: Json
          note?: string | null
          type: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          meta?: Json
          note?: string | null
          type?: string
        }
        Relationships: []
      }
      fms_supplies_categories: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          requires_approval: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          requires_approval?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          requires_approval?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      fms_supplies_companies: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      fms_supplies_config: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      fms_supplies_counters: {
        Row: {
          last_value: number
          scope: string
          updated_at: string
        }
        Insert: {
          last_value?: number
          scope: string
          updated_at?: string
        }
        Update: {
          last_value?: number
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      fms_supplies_departments: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          hod_user_id: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          hod_user_id?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          hod_user_id?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      fms_supplies_items: {
        Row: {
          active: boolean
          category_id: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          sort_order: number
          unit: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          category_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          sort_order?: number
          unit?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          category_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          sort_order?: number
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_supplies_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "fms_supplies_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_supplies_master_managers: {
        Row: {
          created_at: string
          id: string
          manager_user_id: string
          master_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          manager_user_id: string
          master_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          manager_user_id?: string
          master_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      fms_supplies_master_requests: {
        Row: {
          created_at: string
          id: string
          master_type: string
          proposed_payload: Json
          requested_by: string | null
          resolved_master_id: string | null
          review_note: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          master_type: string
          proposed_payload?: Json
          requested_by?: string | null
          resolved_master_id?: string | null
          review_note?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          master_type?: string
          proposed_payload?: Json
          requested_by?: string | null
          resolved_master_id?: string | null
          review_note?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      fms_supplies_notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          read_at: string | null
          text: string
          type: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          read_at?: string | null
          text: string
          type: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          read_at?: string | null
          text?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      fms_supplies_requests: {
        Row: {
          actual_delivery_date: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          category_id: string | null
          company_id: string
          created_at: string
          current_step: string
          delivered_at: string | null
          department_id: string
          edited_at: string | null
          edited_by: string | null
          first_approved_at: string | null
          first_approver_id: string | null
          first_remarks: string | null
          handed_over_at: string | null
          handover_by: string | null
          handover_remarks: string | null
          hold_at: string | null
          hold_reason: string | null
          id: string
          item_name: string | null
          location: string
          quantity: string
          raised_by: string | null
          raised_on_behalf: boolean
          reason: string | null
          reject_reason: string | null
          reject_stage: string | null
          rejected_at: string | null
          req_no: string
          request_type: string
          requested_for_name: string
          requested_for_user_id: string | null
          requires_approval: boolean
          second_approved_at: string | null
          second_approver_id: string | null
          second_remarks: string | null
          service_type_id: string | null
          status: string
          submitted_at: string
          tentative_delivery_date: string | null
          updated_at: string
        }
        Insert: {
          actual_delivery_date?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          category_id?: string | null
          company_id: string
          created_at?: string
          current_step: string
          delivered_at?: string | null
          department_id: string
          edited_at?: string | null
          edited_by?: string | null
          first_approved_at?: string | null
          first_approver_id?: string | null
          first_remarks?: string | null
          handed_over_at?: string | null
          handover_by?: string | null
          handover_remarks?: string | null
          hold_at?: string | null
          hold_reason?: string | null
          id?: string
          item_name?: string | null
          location: string
          quantity: string
          raised_by?: string | null
          raised_on_behalf?: boolean
          reason?: string | null
          reject_reason?: string | null
          reject_stage?: string | null
          rejected_at?: string | null
          req_no: string
          request_type: string
          requested_for_name: string
          requested_for_user_id?: string | null
          requires_approval?: boolean
          second_approved_at?: string | null
          second_approver_id?: string | null
          second_remarks?: string | null
          service_type_id?: string | null
          status: string
          submitted_at?: string
          tentative_delivery_date?: string | null
          updated_at?: string
        }
        Update: {
          actual_delivery_date?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          category_id?: string | null
          company_id?: string
          created_at?: string
          current_step?: string
          delivered_at?: string | null
          department_id?: string
          edited_at?: string | null
          edited_by?: string | null
          first_approved_at?: string | null
          first_approver_id?: string | null
          first_remarks?: string | null
          handed_over_at?: string | null
          handover_by?: string | null
          handover_remarks?: string | null
          hold_at?: string | null
          hold_reason?: string | null
          id?: string
          item_name?: string | null
          location?: string
          quantity?: string
          raised_by?: string | null
          raised_on_behalf?: boolean
          reason?: string | null
          reject_reason?: string | null
          reject_stage?: string | null
          rejected_at?: string | null
          req_no?: string
          request_type?: string
          requested_for_name?: string
          requested_for_user_id?: string | null
          requires_approval?: boolean
          second_approved_at?: string | null
          second_approver_id?: string | null
          second_remarks?: string | null
          service_type_id?: string | null
          status?: string
          submitted_at?: string
          tentative_delivery_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_supplies_requests_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "fms_supplies_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_supplies_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "fms_supplies_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_supplies_requests_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "fms_supplies_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_supplies_requests_service_type_id_fkey"
            columns: ["service_type_id"]
            isOneToOne: false
            referencedRelation: "fms_supplies_service_types"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_supplies_service_types: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      fms_supplies_step_owners: {
        Row: {
          created_at: string
          department_ids: string[]
          designation_id: string | null
          employee_ids: string[]
          id: string
          step_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_ids?: string[]
          designation_id?: string | null
          employee_ids?: string[]
          id?: string
          step_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_ids?: string[]
          designation_id?: string | null
          employee_ids?: string[]
          id?: string
          step_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_supplies_step_owners_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "designations"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_workflow_steps: {
        Row: {
          created_at: string
          department_id: string | null
          designation_id: string | null
          how: string | null
          id: string
          is_origin: boolean
          key: string
          owner_employee_ids: string[]
          owner_employee_names: string[]
          short: string | null
          step_index: number
          title: string
          updated_at: string
          what: string | null
          when_text: string | null
          workflow_id: string
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          designation_id?: string | null
          how?: string | null
          id?: string
          is_origin?: boolean
          key: string
          owner_employee_ids?: string[]
          owner_employee_names?: string[]
          short?: string | null
          step_index: number
          title: string
          updated_at?: string
          what?: string | null
          when_text?: string | null
          workflow_id: string
        }
        Update: {
          created_at?: string
          department_id?: string | null
          designation_id?: string | null
          how?: string | null
          id?: string
          is_origin?: boolean
          key?: string
          owner_employee_ids?: string[]
          owner_employee_names?: string[]
          short?: string | null
          step_index?: number
          title?: string
          updated_at?: string
          what?: string | null
          when_text?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_workflow_steps_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "designations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_workflow_steps_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "fms_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_workflows: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          key: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          key: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      locations: {
        Row: {
          active: boolean
          company: string | null
          created_at: string
          created_by: string | null
          id: string
          is_general: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          company?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_general?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          company?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_general?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          activity_id: string | null
          actor_id: string | null
          created_at: string
          id: string
          read_at: string | null
          task_id: string | null
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          activity_id?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          task_id?: string | null
          type?: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          activity_id?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          task_id?: string | null
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "task_activity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_color: string | null
          created_at: string
          department_id: string | null
          designation: string | null
          email: string | null
          id: string
          last_active_at: string | null
          name: string
          phone: string | null
          receivables_hidden_menus: string[] | null
          receivables_salespersons: string[] | null
          updated_at: string
        }
        Insert: {
          avatar_color?: string | null
          created_at?: string
          department_id?: string | null
          designation?: string | null
          email?: string | null
          id: string
          last_active_at?: string | null
          name?: string
          phone?: string | null
          receivables_hidden_menus?: string[] | null
          receivables_salespersons?: string[] | null
          updated_at?: string
        }
        Update: {
          avatar_color?: string | null
          created_at?: string
          department_id?: string | null
          designation?: string | null
          email?: string | null
          id?: string
          last_active_at?: string | null
          name?: string
          phone?: string | null
          receivables_hidden_menus?: string[] | null
          receivables_salespersons?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      public_holidays: {
        Row: {
          created_at: string
          holiday_date: string
          id: string
          name: string | null
        }
        Insert: {
          created_at?: string
          holiday_date: string
          id?: string
          name?: string | null
        }
        Update: {
          created_at?: string
          holiday_date?: string
          id?: string
          name?: string | null
        }
        Relationships: []
      }
      receivables_due_snapshot: {
        Row: {
          captured_at: string
          captured_by: string | null
          company: string | null
          customer_id: string
          customer_name: string | null
          due_soon: number
          due_upto: number
          id: number
          location: string | null
          month: string
          opening_outstanding: number
          salesperson: string | null
        }
        Insert: {
          captured_at?: string
          captured_by?: string | null
          company?: string | null
          customer_id: string
          customer_name?: string | null
          due_soon?: number
          due_upto?: number
          id?: number
          location?: string | null
          month: string
          opening_outstanding?: number
          salesperson?: string | null
        }
        Update: {
          captured_at?: string
          captured_by?: string | null
          company?: string | null
          customer_id?: string
          customer_name?: string | null
          due_soon?: number
          due_upto?: number
          id?: number
          location?: string | null
          month?: string
          opening_outstanding?: number
          salesperson?: string | null
        }
        Relationships: []
      }
      receivables_followups: {
        Row: {
          created_at: string
          created_by: string
          entity_name: string
          entity_type: string
          id: string
          next_followup_date: string | null
          outcome: string
          outstanding_at_entry: number | null
          overdue_at_entry: number | null
          promised_amount: number | null
          promised_date: string | null
          remarks: string
          salesperson: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          entity_name: string
          entity_type: string
          id?: string
          next_followup_date?: string | null
          outcome: string
          outstanding_at_entry?: number | null
          overdue_at_entry?: number | null
          promised_amount?: number | null
          promised_date?: string | null
          remarks: string
          salesperson?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          entity_name?: string
          entity_type?: string
          id?: string
          next_followup_date?: string | null
          outcome?: string
          outstanding_at_entry?: number | null
          overdue_at_entry?: number | null
          promised_amount?: number | null
          promised_date?: string | null
          remarks?: string
          salesperson?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      recurring_task_locations: {
        Row: {
          created_at: string
          id: string
          location_id: string
          recurring_task_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          location_id: string
          recurring_task_id: string
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string
          recurring_task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_task_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_task_locations_recurring_task_id_fkey"
            columns: ["recurring_task_id"]
            isOneToOne: false
            referencedRelation: "recurring_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_tasks: {
        Row: {
          active: boolean
          assigned_to: string | null
          created_at: string
          created_by: string
          department_id: string | null
          description: string | null
          id: string
          monthly_days: number[]
          monthly_nth: number | null
          monthly_weekday: number | null
          prepone_off_holidays: boolean
          recurrence_type: Database["public"]["Enums"]["recurrence_type"]
          title: string
          updated_at: string
          weekly_days: number[] | null
        }
        Insert: {
          active?: boolean
          assigned_to?: string | null
          created_at?: string
          created_by: string
          department_id?: string | null
          description?: string | null
          id?: string
          monthly_days?: number[]
          monthly_nth?: number | null
          monthly_weekday?: number | null
          prepone_off_holidays?: boolean
          recurrence_type: Database["public"]["Enums"]["recurrence_type"]
          title: string
          updated_at?: string
          weekly_days?: number[] | null
        }
        Update: {
          active?: boolean
          assigned_to?: string | null
          created_at?: string
          created_by?: string
          department_id?: string | null
          description?: string | null
          id?: string
          monthly_days?: number[]
          monthly_nth?: number | null
          monthly_weekday?: number | null
          prepone_off_holidays?: boolean
          recurrence_type?: Database["public"]["Enums"]["recurrence_type"]
          title?: string
          updated_at?: string
          weekly_days?: number[] | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_tasks_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      task_activity: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          note: string | null
          task_id: string
          type: Database["public"]["Enums"]["activity_type"]
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          task_id: string
          type: Database["public"]["Enums"]["activity_type"]
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          task_id?: string
          type?: Database["public"]["Enums"]["activity_type"]
        }
        Relationships: [
          {
            foreignKeyName: "task_activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_locations: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          location_id: string
          na_at: string | null
          na_by: string | null
          task_id: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          location_id: string
          na_at?: string | null
          na_by?: string | null
          task_id: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          location_id?: string
          na_at?: string | null
          na_by?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_locations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_remark_mentions: {
        Row: {
          activity_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          activity_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          activity_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_remark_mentions_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "task_activity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_remark_mentions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          department_id: string | null
          description: string | null
          due_date: string | null
          follow_up_date: string | null
          from_recurring: boolean
          id: string
          is_personal: boolean
          last_remark_at: string | null
          last_revised_at: string | null
          not_applicable: boolean
          not_applicable_at: string | null
          recurring_task_id: string | null
          revision_count: number
          shifted_from_task_id: string | null
          shifted_to_task_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          week_start: string | null
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          department_id?: string | null
          description?: string | null
          due_date?: string | null
          follow_up_date?: string | null
          from_recurring?: boolean
          id?: string
          is_personal?: boolean
          last_remark_at?: string | null
          last_revised_at?: string | null
          not_applicable?: boolean
          not_applicable_at?: string | null
          recurring_task_id?: string | null
          revision_count?: number
          shifted_from_task_id?: string | null
          shifted_to_task_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
          week_start?: string | null
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          department_id?: string | null
          description?: string | null
          due_date?: string | null
          follow_up_date?: string | null
          from_recurring?: boolean
          id?: string
          is_personal?: boolean
          last_remark_at?: string | null
          last_revised_at?: string | null
          not_applicable?: boolean
          not_applicable_at?: string | null
          recurring_task_id?: string | null
          revision_count?: number
          shifted_from_task_id?: string | null
          shifted_to_task_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
          week_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_recurring_task_id_fkey"
            columns: ["recurring_task_id"]
            isOneToOne: false
            referencedRelation: "recurring_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_shifted_from_task_id_fkey"
            columns: ["shifted_from_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_shifted_to_task_id_fkey"
            columns: ["shifted_to_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      user_hods: {
        Row: {
          created_at: string
          employee_id: string
          hod_id: string
          id: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          hod_id: string
          id?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          hod_id?: string
          id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      weekly_plans: {
        Row: {
          created_at: string
          created_by: string
          doer_id: string
          green_pct: number
          id: string
          iso_week: number
          iso_year: number
          red_pct: number
          updated_at: string
          week_end: string
          week_start: string
          yellow_pct: number
        }
        Insert: {
          created_at?: string
          created_by: string
          doer_id: string
          green_pct: number
          id?: string
          iso_week: number
          iso_year: number
          red_pct: number
          updated_at?: string
          week_end: string
          week_start: string
          yellow_pct: number
        }
        Update: {
          created_at?: string
          created_by?: string
          doer_id?: string
          green_pct?: number
          id?: string
          iso_week?: number
          iso_year?: number
          red_pct?: number
          updated_at?: string
          week_end?: string
          week_start?: string
          yellow_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "weekly_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_plans_doer_id_fkey"
            columns: ["doer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_settings: {
        Row: {
          id: boolean
          max_revisions_per_week: number
          updated_at: string
          week_start: Database["public"]["Enums"]["week_start_day"]
          workspace_name: string
        }
        Insert: {
          id?: boolean
          max_revisions_per_week?: number
          updated_at?: string
          week_start?: Database["public"]["Enums"]["week_start_day"]
          workspace_name?: string
        }
        Update: {
          id?: boolean
          max_revisions_per_week?: number
          updated_at?: string
          week_start?: Database["public"]["Enums"]["week_start_day"]
          workspace_name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_task_remark: {
        Args: { p_mentioned?: string[]; p_note: string; p_task_id: string }
        Returns: string
      }
      app_mobile_has_access: { Args: never; Returns: boolean }
      fms_complete_stage: {
        Args: {
          p_entry_id: string
          p_next_planned_date?: string
          p_values?: Json
        }
        Returns: number
      }
      fms_exit_announce: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_meta?: Json
          p_text: string
          p_type: string
          p_user_ids?: string[]
        }
        Returns: undefined
      }
      fms_exit_approve_fnf: {
        Args: { p_approve: boolean; p_case: string; p_remarks?: string }
        Returns: undefined
      }
      fms_exit_archive_blockers: { Args: { p_case: string }; Returns: string[] }
      fms_exit_archive_case: {
        Args: { p?: Json; p_case: string }
        Returns: undefined
      }
      fms_exit_autotick_clearance: {
        Args: { p_case: string; p_step: string }
        Returns: number
      }
      fms_exit_can_act: {
        Args: { p_case: string; p_step_key: string; p_uid: string }
        Returns: boolean
      }
      fms_exit_can_read_case: {
        Args: { p_case: string; p_uid: string }
        Returns: boolean
      }
      fms_exit_can_read_settlement: {
        Args: { p_case: string; p_uid: string }
        Returns: boolean
      }
      fms_exit_can_tick_clearance: {
        Args: { p_check: string; p_uid: string }
        Returns: boolean
      }
      fms_exit_confirm_handover: {
        Args: { p_case: string; p_remarks?: string; p_role: string }
        Returns: undefined
      }
      fms_exit_confirm_lwd: {
        Args: { p_case: string; p_lwd: string }
        Returns: undefined
      }
      fms_exit_decide_case: {
        Args: { p_case: string; p_decision: string; p_remarks?: string }
        Returns: undefined
      }
      fms_exit_fy_code: { Args: { p_d: string }; Returns: string }
      fms_exit_generate_fnf: {
        Args: { p: Json; p_case: string }
        Returns: undefined
      }
      fms_exit_hold_case: {
        Args: { p_case: string; p_hold: boolean; p_reason?: string }
        Returns: undefined
      }
      fms_exit_hr_verify: {
        Args: { p: Json; p_case: string }
        Returns: undefined
      }
      fms_exit_is_coordinator: { Args: { p_uid: string }; Returns: boolean }
      fms_exit_is_exit_staff: { Args: { p_uid: string }; Returns: boolean }
      fms_exit_is_finance_staff: { Args: { p_uid: string }; Returns: boolean }
      fms_exit_is_hr_confidential: { Args: { p_uid: string }; Returns: boolean }
      fms_exit_is_master_manager: {
        Args: { p_master_type: string; p_uid: string }
        Returns: boolean
      }
      fms_exit_is_step_owner: {
        Args: { p_step_key: string; p_uid: string }
        Returns: boolean
      }
      fms_exit_issue_documents: {
        Args: { p: Json; p_case: string }
        Returns: undefined
      }
      fms_exit_manager_review: {
        Args: { p_case: string; p_recommendation: string; p_remarks?: string }
        Returns: undefined
      }
      fms_exit_next_seq: { Args: { p_scope: string }; Returns: number }
      fms_exit_raise_case: { Args: { p: Json }; Returns: string }
      fms_exit_record_ack: {
        Args: { p: Json; p_case: string; p_document: string }
        Returns: undefined
      }
      fms_exit_record_handover: {
        Args: { p: Json; p_case: string }
        Returns: undefined
      }
      fms_exit_record_interview: {
        Args: { p: Json; p_case: string }
        Returns: undefined
      }
      fms_exit_record_payroll_inputs: {
        Args: { p: Json; p_case: string }
        Returns: undefined
      }
      fms_exit_release_fnf_payment: {
        Args: { p: Json; p_case: string }
        Returns: undefined
      }
      fms_exit_resolve_master_request: {
        Args: {
          p_approve: boolean
          p_note?: string
          p_payload?: Json
          p_request_id: string
        }
        Returns: string
      }
      fms_exit_resume_status: { Args: { p_case: string }; Returns: string }
      fms_exit_seed_documents: { Args: { p_case: string }; Returns: number }
      fms_exit_set_clearance_na: {
        Args: { p_check: string; p_reason: string }
        Returns: undefined
      }
      fms_exit_sign_assets: {
        Args: { p_case: string; p_remarks?: string; p_role: string }
        Returns: undefined
      }
      fms_exit_skip_step: {
        Args: { p_case: string; p_reason: string; p_step: string }
        Returns: undefined
      }
      fms_exit_step_done: {
        Args: { p_case: string; p_step: string }
        Returns: boolean
      }
      fms_exit_step_owner_ids: {
        Args: { p_step_key: string }
        Returns: string[]
      }
      fms_exit_toggle_clearance_check: {
        Args: {
          p_check: string
          p_done: boolean
          p_file_name?: string
          p_file_path?: string
          p_link_url?: string
          p_pending_reason?: string
        }
        Returns: undefined
      }
      fms_exit_try_complete_clearance: {
        Args: { p_case: string }
        Returns: undefined
      }
      fms_exit_update_asset: {
        Args: { p: Json; p_asset: string }
        Returns: undefined
      }
      fms_exit_update_case: {
        Args: { p: Json; p_case: string }
        Returns: undefined
      }
      fms_exit_update_head_decision: {
        Args: { p_case: string; p_decision: string; p_remarks?: string }
        Returns: undefined
      }
      fms_exit_update_hr_verify: {
        Args: { p: Json; p_case: string }
        Returns: undefined
      }
      fms_exit_update_manager_review: {
        Args: { p_case: string; p_recommendation: string; p_remarks?: string }
        Returns: undefined
      }
      fms_exit_verify_leave: {
        Args: { p: Json; p_case: string }
        Returns: undefined
      }
      fms_exit_withdraw_case: {
        Args: { p_case: string; p_reason: string }
        Returns: undefined
      }
      fms_hr_add_candidates: {
        Args: { p_candidates: Json; p_req: string }
        Returns: string[]
      }
      fms_hr_add_months: {
        Args: { p_from: string; p_months: number }
        Returns: string
      }
      fms_hr_announce: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_meta?: Json
          p_text: string
          p_type: string
          p_user_ids?: string[]
        }
        Returns: undefined
      }
      fms_hr_can_act: {
        Args: { p_req: string; p_step_key: string; p_uid: string }
        Returns: boolean
      }
      fms_hr_can_read_requisition: {
        Args: { p_req: string; p_uid: string }
        Returns: boolean
      }
      fms_hr_cancel_requisition: {
        Args: { p_reason: string; p_req: string }
        Returns: undefined
      }
      fms_hr_decide_extension: {
        Args: {
          p_decision: string
          p_employee_code?: string
          p_permanent_from?: string
          p_probation: string
          p_remarks?: string
        }
        Returns: undefined
      }
      fms_hr_decide_mrf: {
        Args: {
          p_decision: string
          p_remarks?: string
          p_req: string
          p_stage: string
        }
        Returns: undefined
      }
      fms_hr_decide_probation: {
        Args: {
          p_decision: string
          p_employee_code?: string
          p_permanent_from?: string
          p_probation: string
          p_remarks?: string
        }
        Returns: undefined
      }
      fms_hr_fy_code: { Args: { p_d: string }; Returns: string }
      fms_hr_hod_decide: {
        Args: {
          p_ids: string[]
          p_note?: string
          p_reason_id?: string
          p_selected: boolean
        }
        Returns: undefined
      }
      fms_hr_hold_requisition: {
        Args: { p_hold: boolean; p_reason?: string; p_req: string }
        Returns: undefined
      }
      fms_hr_is_any_step_owner: { Args: { p_uid: string }; Returns: boolean }
      fms_hr_is_coordinator: { Args: { p_uid: string }; Returns: boolean }
      fms_hr_is_master_manager: {
        Args: { p_master_type: string; p_uid: string }
        Returns: boolean
      }
      fms_hr_is_recruitment_staff: { Args: { p_uid: string }; Returns: boolean }
      fms_hr_is_step_owner: {
        Args: { p_step_key: string; p_uid: string }
        Returns: boolean
      }
      fms_hr_move_candidate: {
        Args: { p?: Json; p_id: string; p_to_stage: string }
        Returns: undefined
      }
      fms_hr_next_seq: { Args: { p_scope: string }; Returns: number }
      fms_hr_open_probation: { Args: { p_onb: string }; Returns: undefined }
      fms_hr_pending_step: { Args: { p_stage: string }; Returns: string }
      fms_hr_post_job: {
        Args: { p_platform_ids: string[]; p_posted_on?: string; p_req: string }
        Returns: undefined
      }
      fms_hr_record_interview_result: {
        Args: {
          p_doc_name?: string
          p_doc_path?: string
          p_id: string
          p_next_stage?: string
          p_remarks?: string
          p_round: number
          p_status: string
          p_video_url?: string
        }
        Returns: undefined
      }
      fms_hr_record_probation_review: {
        Args: {
          p_file_name?: string
          p_file_path?: string
          p_month: number
          p_probation: string
          p_remarks?: string
          p_status: string
        }
        Returns: undefined
      }
      fms_hr_resolve_master_request: {
        Args: {
          p_approve: boolean
          p_note?: string
          p_payload?: Json
          p_request_id: string
        }
        Returns: string
      }
      fms_hr_resubmit_mrf: {
        Args: { p: Json; p_req: string }
        Returns: undefined
      }
      fms_hr_schedule_interview: {
        Args: {
          p_id: string
          p_interviewer_id?: string
          p_interviewer_name?: string
          p_round: number
          p_scheduled_on?: string
        }
        Returns: undefined
      }
      fms_hr_seats_joined: { Args: { p_req: string }; Returns: number }
      fms_hr_seats_taken: {
        Args: { p_exclude?: string; p_req: string }
        Returns: number
      }
      fms_hr_set_employee_code: {
        Args: { p_code: string; p_onb: string }
        Returns: undefined
      }
      fms_hr_set_offer_status: {
        Args: { p_onb: string; p_reason?: string; p_status: string }
        Returns: undefined
      }
      fms_hr_set_onboarding_date: {
        Args: { p_date: string; p_onb: string }
        Returns: undefined
      }
      fms_hr_set_requisition_jd: {
        Args: { p_name?: string; p_path?: string; p_req: string }
        Returns: undefined
      }
      fms_hr_share_candidates_with_hod: {
        Args: { p_ids: string[] }
        Returns: undefined
      }
      fms_hr_stage_rank: { Args: { p_stage: string }; Returns: number }
      fms_hr_stage_step: { Args: { p_stage: string }; Returns: string }
      fms_hr_step_owner_ids: { Args: { p_step: string }; Returns: string[] }
      fms_hr_submit_mrf: { Args: { p: Json }; Returns: string }
      fms_hr_sync_requisition_fill: {
        Args: { p_req: string }
        Returns: undefined
      }
      fms_hr_toggle_onboarding_check: {
        Args: {
          p_check: string
          p_done: boolean
          p_file_name?: string
          p_file_path?: string
          p_link_url?: string
          p_pending_reason?: string
        }
        Returns: undefined
      }
      fms_hr_try_complete_onboarding: {
        Args: { p_onb: string }
        Returns: undefined
      }
      fms_hr_update_candidate: {
        Args: { p: Json; p_id: string }
        Returns: undefined
      }
      fms_import_add_pi: {
        Args: {
          p_dispatch_date?: string
          p_document_name?: string
          p_document_path?: string
          p_items: Json
          p_payment_terms?: string
          p_pi_value?: number
          p_po_id: string
          p_vendor_pi_no: string
        }
        Returns: string
      }
      fms_import_announce: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_meta?: Json
          p_text: string
          p_type: string
          p_user_ids?: string[]
        }
        Returns: undefined
      }
      fms_import_approval_editable: {
        Args: { p_line_id: string }
        Returns: boolean
      }
      fms_import_book_tally: {
        Args: {
          p_document_name?: string
          p_document_path?: string
          p_grn_id?: string
          p_po_id: string
          p_remarks?: string
          p_tally_pi_no: string
        }
        Returns: string
      }
      fms_import_can_act_po: { Args: { p_uid: string }; Returns: boolean }
      fms_import_cancel_line: {
        Args: { p_reason: string; p_request_item_id: string }
        Returns: undefined
      }
      fms_import_cancel_po: {
        Args: { p_po_id: string; p_reason: string; p_request_id?: string }
        Returns: undefined
      }
      fms_import_decide_approval: {
        Args: {
          p_decision: string
          p_override_vendor_id?: string
          p_reason?: string
          p_request_item_id: string
        }
        Returns: undefined
      }
      fms_import_decline_po_cancel: {
        Args: { p_note?: string; p_request_id: string }
        Returns: undefined
      }
      fms_import_followup_editable: {
        Args: { p_followup_id: string }
        Returns: boolean
      }
      fms_import_fy_code: { Args: { p_d: string }; Returns: string }
      fms_import_generate_po: {
        Args: {
          p_company_id: string
          p_po_no?: string
          p_request_item_ids: string[]
          p_vendor_id: string
        }
        Returns: string
      }
      fms_import_grn_editable: { Args: { p_grn_id: string }; Returns: boolean }
      fms_import_is_coordinator: { Args: { p_uid: string }; Returns: boolean }
      fms_import_is_master_manager: {
        Args: { p_master_type: string; p_uid: string }
        Returns: boolean
      }
      fms_import_is_step_owner: {
        Args: { p_step_key: string; p_uid: string }
        Returns: boolean
      }
      fms_import_next_seq: { Args: { p_scope: string }; Returns: number }
      fms_import_payment_editable: {
        Args: { p_payment_id: string }
        Returns: boolean
      }
      fms_import_pi_editable: { Args: { p_pi_id: string }; Returns: boolean }
      fms_import_po_editable: { Args: { p_po_id: string }; Returns: boolean }
      fms_import_po_open: { Args: { p_po_id: string }; Returns: boolean }
      fms_import_reassign_line: {
        Args: {
          p_approver_id: string
          p_note?: string
          p_request_item_id: string
        }
        Returns: undefined
      }
      fms_import_record_followup: {
        Args: {
          p_actual_dispatch_date?: string
          p_dispatch_status: string
          p_lr_no?: string
          p_pi_remarks?: string
          p_po_id: string
          p_remarks?: string
          p_revised_dispatch_date?: string
          p_transport?: string
        }
        Returns: undefined
      }
      fms_import_record_grn: {
        Args: {
          p_condition?: string
          p_gate_register_no?: string
          p_items: Json
          p_note?: string
          p_photo_name?: string
          p_photo_path?: string
          p_pi_id?: string
          p_pi_ref?: string
          p_po_id: string
          p_po_ref?: string
        }
        Returns: string
      }
      fms_import_record_payment: {
        Args: {
          p_advice_name?: string
          p_advice_path?: string
          p_amount: number
          p_amount_fx?: number
          p_currency?: string
          p_details?: string
          p_fx_rate?: number
          p_kind: string
          p_paid_on?: string
          p_pi_id?: string
          p_pi_remarks?: string
          p_po_id: string
          p_utr?: string
        }
        Returns: string
      }
      fms_import_refresh_po: { Args: { p_po_id: string }; Returns: undefined }
      fms_import_request_po_cancel: {
        Args: { p_po_id: string; p_reason: string; p_vendor_ref?: string }
        Returns: string
      }
      fms_import_resolve_master_request: {
        Args: {
          p_approve: boolean
          p_note?: string
          p_payload?: Json
          p_request_id: string
        }
        Returns: string
      }
      fms_import_save_sourcing: {
        Args: {
          p_final_qty: number
          p_final_rate: number
          p_gst_pct?: number
          p_quotations: Json
          p_recommended_vendor_id: string
          p_request_item_id: string
          p_sourcing_reason?: string
        }
        Returns: undefined
      }
      fms_import_share_po: {
        Args: {
          p_dispatch_date?: string
          p_document_name?: string
          p_document_path?: string
          p_payment_terms?: string
          p_po_id: string
          p_remarks?: string
          p_tally_po_no?: string
        }
        Returns: undefined
      }
      fms_import_share_po_editable: {
        Args: { p_po_id: string }
        Returns: boolean
      }
      fms_import_submit_request: {
        Args: {
          p_category_id: string
          p_company_id: string
          p_currency: string
          p_fx_rate: number
          p_items: Json
          p_note: string
          p_vendor_id: string
        }
        Returns: string
      }
      fms_import_tally_editable: {
        Args: { p_booking_id: string }
        Returns: boolean
      }
      fms_import_update_approval: {
        Args: {
          p_decision: string
          p_line_id: string
          p_override_vendor_id?: string
          p_reason?: string
        }
        Returns: undefined
      }
      fms_import_update_followup: {
        Args: {
          p_actual_dispatch_date?: string
          p_dispatch_status: string
          p_followup_id: string
          p_lr_no?: string
          p_pi_remarks?: string
          p_remarks?: string
          p_revised_dispatch_date?: string
          p_transport?: string
        }
        Returns: undefined
      }
      fms_import_update_grn: {
        Args: {
          p_condition?: string
          p_gate_register_no?: string
          p_grn_id: string
          p_items: Json
          p_note?: string
          p_photo_name?: string
          p_photo_path?: string
          p_pi_ref?: string
          p_po_ref?: string
        }
        Returns: undefined
      }
      fms_import_update_payment: {
        Args: {
          p_advice_name?: string
          p_advice_path?: string
          p_amount: number
          p_amount_fx?: number
          p_currency?: string
          p_details?: string
          p_fx_rate?: number
          p_paid_on?: string
          p_payment_id: string
          p_pi_remarks?: string
          p_utr?: string
        }
        Returns: undefined
      }
      fms_import_update_pi: {
        Args: {
          p_dispatch_date?: string
          p_document_name?: string
          p_document_path?: string
          p_items: Json
          p_payment_terms?: string
          p_pi_id: string
          p_pi_value?: number
          p_vendor_pi_no: string
        }
        Returns: undefined
      }
      fms_import_update_po_no: {
        Args: { p_po_id: string; p_po_no: string }
        Returns: undefined
      }
      fms_import_update_share_po: {
        Args: {
          p_dispatch_date: string
          p_document_name?: string
          p_document_path?: string
          p_payment_terms: string
          p_po_id: string
          p_remarks?: string
          p_tally_po_no: string
        }
        Returns: undefined
      }
      fms_import_update_tally: {
        Args: {
          p_booking_id: string
          p_document_name?: string
          p_document_path?: string
          p_remarks?: string
          p_tally_pi_no: string
        }
        Returns: undefined
      }
      fms_is_current_owner: {
        Args: { p_entry_id: string; p_uid: string }
        Returns: boolean
      }
      fms_owns_step: {
        Args: { p_step_id: string; p_uid: string }
        Returns: boolean
      }
      fms_purchase_add_pi: {
        Args: {
          p_dispatch_date?: string
          p_document_name?: string
          p_document_path?: string
          p_items: Json
          p_payment_terms?: string
          p_pi_value?: number
          p_po_id: string
          p_vendor_pi_no: string
        }
        Returns: string
      }
      fms_purchase_announce: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_meta?: Json
          p_text: string
          p_type: string
          p_user_ids?: string[]
        }
        Returns: undefined
      }
      fms_purchase_approval_editable: {
        Args: { p_line_id: string }
        Returns: boolean
      }
      fms_purchase_book_tally: {
        Args: {
          p_document_name?: string
          p_document_path?: string
          p_grn_id?: string
          p_po_id: string
          p_remarks?: string
          p_tally_pi_no: string
        }
        Returns: string
      }
      fms_purchase_can_act_po: { Args: { p_uid: string }; Returns: boolean }
      fms_purchase_cancel_line: {
        Args: { p_reason: string; p_request_item_id: string }
        Returns: undefined
      }
      fms_purchase_cancel_request: {
        Args: { p_reason: string; p_request_id: string }
        Returns: undefined
      }
      fms_purchase_request_editable: {
        Args: { p_request_id: string }
        Returns: boolean
      }
      fms_purchase_update_request: {
        Args: { p_items: Json; p_note: string; p_request_id: string }
        Returns: undefined
      }
      fms_purchase_cancel_po: {
        Args: { p_po_id: string; p_reason: string; p_request_id?: string }
        Returns: undefined
      }
      fms_purchase_decide_approval: {
        Args: {
          p_decision: string
          p_override_vendor_id?: string
          p_reason?: string
          p_request_item_id: string
        }
        Returns: undefined
      }
      fms_purchase_decide_approval_request: {
        Args: {
          p_decision: string
          p_override_vendor_id?: string
          p_reason?: string
          p_request_id: string
        }
        Returns: undefined
      }
      fms_purchase_decline_po_cancel: {
        Args: { p_note?: string; p_request_id: string }
        Returns: undefined
      }
      fms_purchase_followup_editable: {
        Args: { p_followup_id: string }
        Returns: boolean
      }
      fms_purchase_fy_code: { Args: { p_d: string }; Returns: string }
      fms_purchase_generate_po: {
        Args: {
          p_company_id: string
          p_po_no?: string
          p_request_item_ids: string[]
          p_vendor_id: string
        }
        Returns: string
      }
      fms_purchase_grn_editable: {
        Args: { p_grn_id: string }
        Returns: boolean
      }
      fms_purchase_is_coordinator: { Args: { p_uid: string }; Returns: boolean }
      fms_purchase_is_master_manager: {
        Args: { p_master_type: string; p_uid: string }
        Returns: boolean
      }
      fms_purchase_is_step_owner: {
        Args: { p_step_key: string; p_uid: string }
        Returns: boolean
      }
      fms_purchase_next_seq: { Args: { p_scope: string }; Returns: number }
      fms_purchase_payment_editable: {
        Args: { p_payment_id: string }
        Returns: boolean
      }
      fms_purchase_pi_editable: { Args: { p_pi_id: string }; Returns: boolean }
      fms_purchase_po_editable: { Args: { p_po_id: string }; Returns: boolean }
      fms_purchase_po_open: { Args: { p_po_id: string }; Returns: boolean }
      fms_purchase_reassign_line: {
        Args: {
          p_approver_id: string
          p_note?: string
          p_request_item_id: string
        }
        Returns: undefined
      }
      fms_purchase_record_followup: {
        Args: {
          p_actual_dispatch_date?: string
          p_dispatch_status: string
          p_lr_no?: string
          p_pi_remarks?: string
          p_po_id: string
          p_remarks?: string
          p_revised_dispatch_date?: string
          p_transport?: string
        }
        Returns: undefined
      }
      fms_purchase_record_grn: {
        Args: {
          p_condition?: string
          p_gate_register_no?: string
          p_items: Json
          p_note?: string
          p_photo_name?: string
          p_photo_path?: string
          p_pi_id?: string
          p_pi_ref?: string
          p_po_id: string
          p_po_ref?: string
        }
        Returns: string
      }
      fms_purchase_record_payment: {
        Args: {
          p_amount: number
          p_kind: string
          p_paid_on?: string
          p_pi_id?: string
          p_pi_remarks?: string
          p_po_id: string
          p_utr?: string
        }
        Returns: string
      }
      fms_purchase_refresh_po: { Args: { p_po_id: string }; Returns: undefined }
      fms_purchase_request_po_cancel: {
        Args: { p_po_id: string; p_reason: string; p_vendor_ref?: string }
        Returns: string
      }
      fms_purchase_resolve_master_request: {
        Args: {
          p_approve: boolean
          p_note?: string
          p_payload?: Json
          p_request_id: string
        }
        Returns: string
      }
      fms_purchase_save_sourcing: {
        Args: {
          p_final_qty: number
          p_final_rate: number
          p_gst_pct?: number
          p_quotations: Json
          p_recommended_vendor_id: string
          p_request_item_id: string
          p_sourcing_reason?: string
        }
        Returns: undefined
      }
      fms_purchase_save_sourcing_request: {
        Args: {
          p_lines: Json
          p_recommended_vendor_id: string
          p_request_id: string
          p_sourcing_reason?: string
          p_vendors: Json
        }
        Returns: undefined
      }
      fms_purchase_share_po: {
        Args: {
          p_dispatch_date?: string
          p_document_name?: string
          p_document_path?: string
          p_payment_terms?: string
          p_po_id: string
          p_remarks?: string
          p_tally_po_no?: string
        }
        Returns: undefined
      }
      fms_purchase_share_po_editable: {
        Args: { p_po_id: string }
        Returns: boolean
      }
      fms_purchase_sourcing_editable: {
        Args: { p_line_id: string }
        Returns: boolean
      }
      fms_purchase_submit_request: {
        Args: {
          p_category_id: string
          p_company_id: string
          p_items: Json
          p_note: string
        }
        Returns: string
      }
      fms_purchase_tally_editable: {
        Args: { p_booking_id: string }
        Returns: boolean
      }
      fms_purchase_update_approval: {
        Args: {
          p_decision: string
          p_line_id: string
          p_override_vendor_id?: string
          p_reason?: string
        }
        Returns: undefined
      }
      fms_purchase_update_approval_request: {
        Args: {
          p_decision: string
          p_override_vendor_id?: string
          p_reason?: string
          p_request_id: string
        }
        Returns: undefined
      }
      fms_purchase_update_followup: {
        Args: {
          p_actual_dispatch_date?: string
          p_dispatch_status: string
          p_followup_id: string
          p_lr_no?: string
          p_pi_remarks?: string
          p_remarks?: string
          p_revised_dispatch_date?: string
          p_transport?: string
        }
        Returns: undefined
      }
      fms_purchase_update_grn: {
        Args: {
          p_condition?: string
          p_gate_register_no?: string
          p_grn_id: string
          p_items: Json
          p_note?: string
          p_photo_name?: string
          p_photo_path?: string
          p_pi_ref?: string
          p_po_ref?: string
        }
        Returns: undefined
      }
      fms_purchase_update_payment: {
        Args: {
          p_amount: number
          p_paid_on?: string
          p_payment_id: string
          p_pi_remarks?: string
          p_utr?: string
        }
        Returns: undefined
      }
      fms_purchase_update_pi: {
        Args: {
          p_dispatch_date?: string
          p_document_name?: string
          p_document_path?: string
          p_items: Json
          p_payment_terms?: string
          p_pi_id: string
          p_pi_value?: number
          p_vendor_pi_no: string
        }
        Returns: undefined
      }
      fms_purchase_update_po_no: {
        Args: { p_po_id: string; p_po_no: string }
        Returns: undefined
      }
      fms_purchase_update_share_po: {
        Args: {
          p_dispatch_date: string
          p_document_name?: string
          p_document_path?: string
          p_payment_terms: string
          p_po_id: string
          p_remarks?: string
          p_tally_po_no: string
        }
        Returns: undefined
      }
      fms_purchase_update_tally: {
        Args: {
          p_booking_id: string
          p_document_name?: string
          p_document_path?: string
          p_remarks?: string
          p_tally_pi_no: string
        }
        Returns: undefined
      }
      fms_supplies_announce: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_meta?: Json
          p_text: string
          p_type: string
          p_user_ids?: string[]
        }
        Returns: undefined
      }
      fms_supplies_can_act: {
        Args: { p_req: string; p_step_key: string; p_uid: string }
        Returns: boolean
      }
      fms_supplies_can_read_request: {
        Args: { p_req: string; p_uid: string }
        Returns: boolean
      }
      fms_supplies_cancel_request: {
        Args: { p_reason: string; p_req: string }
        Returns: undefined
      }
      fms_supplies_decide_first_approval: {
        Args: { p_approve: boolean; p_remarks?: string; p_req: string }
        Returns: undefined
      }
      fms_supplies_decide_second_approval: {
        Args: { p_approve: boolean; p_remarks?: string; p_req: string }
        Returns: undefined
      }
      fms_supplies_first_approval_editable: {
        Args: { p_req: string }
        Returns: boolean
      }
      fms_supplies_fy_code: { Args: { p_d: string }; Returns: string }
      fms_supplies_handover_editable: {
        Args: { p_req: string }
        Returns: boolean
      }
      fms_supplies_hold_request: {
        Args: { p_hold: boolean; p_reason?: string; p_req: string }
        Returns: undefined
      }
      fms_supplies_is_coordinator: { Args: { p_uid: string }; Returns: boolean }
      fms_supplies_is_fulfilment_staff: {
        Args: { p_uid: string }
        Returns: boolean
      }
      fms_supplies_is_master_manager: {
        Args: { p_master_type: string; p_uid: string }
        Returns: boolean
      }
      fms_supplies_is_step_owner: {
        Args: { p_step_key: string; p_uid: string }
        Returns: boolean
      }
      fms_supplies_next_seq: { Args: { p_scope: string }; Returns: number }
      fms_supplies_record_handover: {
        Args: { p: Json; p_req: string }
        Returns: undefined
      }
      fms_supplies_request_hod: { Args: { p_req: string }; Returns: string }
      fms_supplies_resolve_master_request: {
        Args: {
          p_approve: boolean
          p_note?: string
          p_payload?: Json
          p_request_id: string
        }
        Returns: string
      }
      fms_supplies_resume_status: { Args: { p_req: string }; Returns: string }
      fms_supplies_second_approval_editable: {
        Args: { p_req: string }
        Returns: boolean
      }
      fms_supplies_step_owner_ids: {
        Args: { p_step_key: string }
        Returns: string[]
      }
      fms_supplies_submit_request: { Args: { p: Json }; Returns: string }
      fms_supplies_update_request: { Args: { p: Json }; Returns: undefined }
      fms_supplies_request_editable: { Args: { p_req: string }; Returns: boolean }
      fms_supplies_update_first_approval: {
        Args: { p_approve: boolean; p_remarks?: string; p_req: string }
        Returns: undefined
      }
      fms_supplies_update_handover: {
        Args: { p: Json; p_req: string }
        Returns: undefined
      }
      fms_supplies_update_second_approval: {
        Args: { p_approve: boolean; p_remarks?: string; p_req: string }
        Returns: undefined
      }
      generate_recurring_task_now: {
        Args: { p_force?: boolean; p_recurring_id: string }
        Returns: string
      }
      generate_recurring_tasks: { Args: { p_date?: string }; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_hod_of: { Args: { _employee: string; _hod: string }; Returns: boolean }
      is_in_subtree: {
        Args: { _root: string; _target: string }
        Returns: boolean
      }
      lead_master_usage: {
        Args: never
        Returns: {
          master_id: string
          master_type: string
          uses: number
        }[]
      }
      leads_dashboard_can_read: { Args: never; Returns: boolean }
      leads_dashboard_salespeople: {
        Args: never
        Returns: {
          email: string
          id: string
          name: string
        }[]
      }
      list_org_people: {
        Args: never
        Returns: {
          avatar_color: string
          department_id: string
          designation: string
          id: string
          name: string
          role: string
        }[]
      }
      prev_working_day: { Args: { d: string }; Returns: string }
      same_department: { Args: { _a: string; _b: string }; Returns: boolean }
      shift_task_to_week: {
        Args: { p_new_due_date: string; p_task_id: string }
        Returns: string
      }
      touch_last_active: { Args: never; Returns: undefined }
    }
    Enums: {
      activity_type:
        | "created"
        | "assigned"
        | "revised"
        | "followup"
        | "completed"
        | "shifted"
        | "started"
        | "remark"
        | "reopened"
      app_role: "admin" | "hod" | "employee" | "sub_hod"
      notification_type: "mention"
      recurrence_type: "daily" | "weekly" | "monthly" | "when" | "quarterly"
      task_status:
        | "pending"
        | "completed"
        | "revised"
        | "shifted"
        | "in_progress"
      week_start_day: "mon" | "sun"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      activity_type: [
        "created",
        "assigned",
        "revised",
        "followup",
        "completed",
        "shifted",
        "started",
        "remark",
        "reopened",
      ],
      app_role: ["admin", "hod", "employee", "sub_hod"],
      notification_type: ["mention"],
      recurrence_type: ["daily", "weekly", "monthly", "when", "quarterly"],
      task_status: [
        "pending",
        "completed",
        "revised",
        "shifted",
        "in_progress",
      ],
      week_start_day: ["mon", "sun"],
    },
  },
} as const
