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
  public: {
    Tables: {
      // Added for the Leads mobile app (migration 20260703140000_add_app_leads.sql).
      // Not present in the web app's copy of this file — keep in sync manually.
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
      // Added for admin-managed global masters (migration
      // 20260707120000_add_global_masters_and_mobile_access.sql). Org-wide, admin-
      // writable, all-readable. The mobile app reads this read-only.
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
      // Added for the mobile app (migration 20260703120000_add_app_mobile_core.sql).
      // Not present in the web app's copy of this file — keep in sync manually.
      app_devices: {
        Row: {
          app_version: string | null
          created_at: string
          device_id: string
          id: string
          last_seen_at: string
          model: string | null
          platform: string | null
          push_token: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          device_id: string
          id?: string
          last_seen_at?: string
          model?: string | null
          platform?: string | null
          push_token?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          device_id?: string
          id?: string
          last_seen_at?: string
          model?: string | null
          platform?: string | null
          push_token?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
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
          id: string
          lr_no: string | null
          pi_id: string
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
          id?: string
          lr_no?: string | null
          pi_id: string
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
          id?: string
          lr_no?: string | null
          pi_id?: string
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
          gate_register_no: string | null
          id: string
          note: string | null
          pi_id: string | null
          po_id: string
          received_by: string | null
        }
        Insert: {
          condition?: string
          created_at?: string
          gate_register_no?: string | null
          id?: string
          note?: string | null
          pi_id?: string | null
          po_id: string
          received_by?: string | null
        }
        Update: {
          condition?: string
          created_at?: string
          gate_register_no?: string | null
          id?: string
          note?: string | null
          pi_id?: string | null
          po_id?: string
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
          id: string
          kind: string
          paid_on: string
          pi_id: string | null
          po_id: string
          utr_ref: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          paid_on?: string
          pi_id?: string | null
          po_id: string
          utr_ref?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          paid_on?: string
          pi_id?: string | null
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
      fms_purchase_po_items: {
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
          company_id: string
          created_at: string
          created_by: string | null
          current_stage: string
          document_name: string | null
          document_path: string | null
          id: string
          po_no: string
          share_remarks: string | null
          status: string
          tally_po_no: string | null
          total_value: number
          updated_at: string
          vendor_id: string
        }
        Insert: {
          advance_paid?: number
          company_id: string
          created_at?: string
          created_by?: string | null
          current_stage?: string
          document_name?: string | null
          document_path?: string | null
          id?: string
          po_no: string
          share_remarks?: string | null
          status?: string
          tally_po_no?: string | null
          total_value?: number
          updated_at?: string
          vendor_id: string
        }
        Update: {
          advance_paid?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          current_stage?: string
          document_name?: string | null
          document_path?: string | null
          id?: string
          po_no?: string
          share_remarks?: string | null
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
          approver_id: string | null
          assigned_approver_id: string | null
          cancel_reason: string | null
          created_at: string
          final_qty: number | null
          final_rate: number | null
          final_vendor_id: string | null
          gst_pct: number | null
          id: string
          item_id: string
          line_remark: string | null
          line_value: number | null
          quantity: number
          reject_reason: string | null
          request_id: string
          sourcing_reason: string | null
          status: string
          unit: string
          updated_at: string
        }
        Insert: {
          approval_tier?: string | null
          approver_id?: string | null
          assigned_approver_id?: string | null
          cancel_reason?: string | null
          created_at?: string
          final_qty?: number | null
          final_rate?: number | null
          final_vendor_id?: string | null
          gst_pct?: number | null
          id?: string
          item_id: string
          line_remark?: string | null
          line_value?: number | null
          quantity: number
          reject_reason?: string | null
          request_id: string
          sourcing_reason?: string | null
          status?: string
          unit?: string
          updated_at?: string
        }
        Update: {
          approval_tier?: string | null
          approver_id?: string | null
          assigned_approver_id?: string | null
          cancel_reason?: string | null
          created_at?: string
          final_qty?: number | null
          final_rate?: number | null
          final_vendor_id?: string | null
          gst_pct?: number | null
          id?: string
          item_id?: string
          line_remark?: string | null
          line_value?: number | null
          quantity?: number
          reject_reason?: string | null
          request_id?: string
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
      fms_purchase_requests: {
        Row: {
          category_id: string
          company_id: string
          created_at: string
          id: string
          note: string | null
          request_no: string
          requester_id: string | null
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
          designation_id: string | null
          employee_ids: string[]
          id: string
          step_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          designation_id?: string | null
          employee_ids?: string[]
          id?: string
          step_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string | null
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
      app_mobile_has_access: { Args: Record<PropertyKey, never>; Returns: boolean }
      fms_complete_stage: {
        Args: {
          p_entry_id: string
          p_next_planned_date?: string
          p_values?: Json
        }
        Returns: number
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
      fms_purchase_decide_approval: {
        Args: {
          p_decision: string
          p_override_vendor_id?: string
          p_reason?: string
          p_request_item_id: string
        }
        Returns: undefined
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
          p_pi_id: string
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
          p_pi_id?: string
          p_po_id: string
        }
        Returns: string
      }
      fms_purchase_record_payment: {
        Args: {
          p_amount: number
          p_kind: string
          p_paid_on?: string
          p_pi_id?: string
          p_po_id: string
          p_utr?: string
        }
        Returns: string
      }
      fms_purchase_refresh_po: { Args: { p_po_id: string }; Returns: undefined }
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
      fms_purchase_share_po: {
        Args: {
          p_document_name?: string
          p_document_path?: string
          p_po_id: string
          p_remarks?: string
          p_tally_po_no?: string
        }
        Returns: undefined
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
