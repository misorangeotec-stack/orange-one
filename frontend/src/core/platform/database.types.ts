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
          name: string
          phone: string | null
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
          name?: string
          phone?: string | null
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
          name?: string
          phone?: string | null
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
      recurring_tasks: {
        Row: {
          active: boolean
          assigned_to: string | null
          created_at: string
          created_by: string
          department_id: string | null
          description: string | null
          id: string
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
          id: string
          last_remark_at: string | null
          last_revised_at: string | null
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
          id?: string
          last_remark_at?: string | null
          last_revised_at?: string | null
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
          id?: string
          last_remark_at?: string | null
          last_revised_at?: string | null
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
      recurrence_type: "daily" | "weekly"
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
      recurrence_type: ["daily", "weekly"],
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
