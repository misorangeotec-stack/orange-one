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
            foreignKeyName: "fms_workflow_steps_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "fms_workflows"
            referencedColumns: ["id"]
          },
        ]
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_task_remark: {
        Args: { p_mentioned?: string[]; p_note: string; p_task_id: string }
        Returns: string
      }
      generate_recurring_task_now: {
        Args: { p_recurring_id: string; p_force?: boolean }
        Returns: string
      }
      generate_recurring_tasks: { Args: { p_date?: string }; Returns: number }
      fms_complete_stage: {
        Args: {
          p_entry_id: string
          p_values?: Json
          p_next_planned_date?: string
        }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      touch_last_active: { Args: Record<PropertyKey, never>; Returns: undefined }
      is_hod_of: { Args: { _employee: string; _hod: string }; Returns: boolean }
      is_in_subtree: {
        Args: { _root: string; _target: string }
        Returns: boolean
      }
      same_department: { Args: { _a: string; _b: string }; Returns: boolean }
      shift_task_to_week: {
        Args: { p_new_due_date: string; p_task_id: string }
        Returns: string
      }
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
