export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      families: {
        Row: {
          id: string;
          name: string;
          join_code: string;
          join_code_expires_at: string | null;
          setup_completed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          join_code: string;
          join_code_expires_at?: string | null;
          setup_completed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          join_code?: string;
          join_code_expires_at?: string | null;
          setup_completed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      devices: {
        Row: {
          id: string;
          family_id: string;
          name: string;
          is_kiosk: boolean;
          has_presence_sensor: boolean;
          last_seen: string;
          created_at: string;
          hardware_id: string | null;
          fingerprint: string | null;
          fingerprint_history: string[];
        };
        Insert: {
          id?: string;
          family_id: string;
          name: string;
          is_kiosk?: boolean;
          has_presence_sensor?: boolean;
          last_seen?: string;
          created_at?: string;
          hardware_id?: string | null;
          fingerprint?: string | null;
        };
        Update: {
          id?: string;
          family_id?: string;
          name?: string;
          is_kiosk?: boolean;
          has_presence_sensor?: boolean;
          last_seen?: string;
          created_at?: string;
          hardware_id?: string | null;
          fingerprint?: string | null;
        };
        Relationships: [];
      };
      people: {
        Row: {
          id: string;
          family_id: string;
          name: string;
          color: string;
          avatar_url: string | null;
          is_child: boolean;
          birth_date: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          name: string;
          color: string;
          avatar_url?: string | null;
          is_child?: boolean;
          birth_date?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          name?: string;
          color?: string;
          avatar_url?: string | null;
          is_child?: boolean;
          birth_date?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      calendars: {
        Row: {
          id: string;
          family_id: string;
          name: string;
          google_calendar_id: string | null;
          person_id: string | null;
          color: string;
          is_holidays: boolean;
          is_waste_collection: boolean;
          created_at: string;
          ics_url: string | null;
          ics_etag: string | null;
          last_synced_at: string | null;
        };
        Insert: {
          id?: string;
          family_id: string;
          name: string;
          google_calendar_id?: string | null;
          person_id?: string | null;
          color: string;
          is_holidays?: boolean;
          is_waste_collection?: boolean;
          created_at?: string;
          ics_url?: string | null;
          ics_etag?: string | null;
          last_synced_at?: string | null;
        };
        Update: {
          id?: string;
          family_id?: string;
          name?: string;
          google_calendar_id?: string | null;
          person_id?: string | null;
          color?: string;
          is_holidays?: boolean;
          is_waste_collection?: boolean;
          created_at?: string;
          ics_url?: string | null;
          ics_etag?: string | null;
          last_synced_at?: string | null;
        };
        Relationships: [];
      };
      events: {
        Row: {
          id: string;
          calendar_id: string;
          google_event_id: string | null;
          title: string;
          description: string | null;
          location: string | null;
          start_at: string;
          end_at: string;
          all_day: boolean;
          person_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          calendar_id: string;
          google_event_id?: string | null;
          title: string;
          description?: string | null;
          location?: string | null;
          start_at: string;
          end_at: string;
          all_day?: boolean;
          person_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          calendar_id?: string;
          google_event_id?: string | null;
          title?: string;
          description?: string | null;
          location?: string | null;
          start_at?: string;
          end_at?: string;
          all_day?: boolean;
          person_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      todos: {
        Row: {
          id: string;
          family_id: string;
          person_id: string | null;
          title: string;
          completed: boolean;
          due_date: string | null;
          priority: string;
          recurrence: string | null;
          last_completed: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          person_id?: string | null;
          title: string;
          completed?: boolean;
          due_date?: string | null;
          priority?: string;
          recurrence?: string | null;
          last_completed?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          person_id?: string | null;
          title?: string;
          completed?: boolean;
          due_date?: string | null;
          priority?: string;
          recurrence?: string | null;
          last_completed?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      shopping_items: {
        Row: {
          id: string;
          family_id: string;
          name: string;
          checked: boolean;
          bring_item_id: string | null;
          category: string | null;
          quantity: number | null;
          unit: string | null;
          notes: string | null;
          image_url: string | null;
          catalog_item_id: string | null;
          recipe_id: string | null;
          added_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          name: string;
          checked?: boolean;
          bring_item_id?: string | null;
          category?: string | null;
          quantity?: number | null;
          unit?: string | null;
          notes?: string | null;
          image_url?: string | null;
          catalog_item_id?: string | null;
          recipe_id?: string | null;
          added_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          name?: string;
          checked?: boolean;
          bring_item_id?: string | null;
          category?: string | null;
          quantity?: number | null;
          unit?: string | null;
          notes?: string | null;
          image_url?: string | null;
          catalog_item_id?: string | null;
          recipe_id?: string | null;
          added_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      subjects: {
        Row: {
          id: string;
          family_id: string;
          name: string;
          color: string;
          icon: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          name: string;
          color?: string;
          icon?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          name?: string;
          color?: string;
          icon?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      schedules: {
        Row: {
          id: string;
          family_id: string;
          person_id: string;
          day_of_week: number;
          time_slots: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          person_id: string;
          day_of_week: number;
          time_slots: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          person_id?: string;
          day_of_week?: number;
          time_slots?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      birthdays: {
        Row: {
          id: string;
          family_id: string;
          name: string;
          date: string;
          person_id: string | null;
          notify_days_before: number;
          image_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          name: string;
          date: string;
          person_id?: string | null;
          notify_days_before?: number;
          image_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          name?: string;
          date?: string;
          person_id?: string | null;
          notify_days_before?: number;
          image_url?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      birthday_gift_ideas: {
        Row: {
          id: string;
          family_id: string;
          birthday_id: string;
          text: string;
          bought: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          birthday_id: string;
          text: string;
          bought?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          birthday_id?: string;
          text?: string;
          bought?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      notes: {
        Row: {
          id: string;
          family_id: string;
          content: string;
          person_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          content: string;
          person_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          content?: string;
          person_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      oauth_credentials: {
        Row: {
          id: string;
          family_id: string;
          provider: string;
          encrypted_refresh_token: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          provider: string;
          encrypted_refresh_token: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          provider?: string;
          encrypted_refresh_token?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          id: string;
          family_id: string;
          key: string;
          value: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          key: string;
          value: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          key?: string;
          value?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      integration_secrets: {
        Row: {
          family_id: string;
          key: string;
          value: Json;
          updated_at: string;
        };
        Insert: {
          family_id: string;
          key: string;
          value?: Json;
          updated_at?: string;
        };
        Update: {
          family_id?: string;
          key?: string;
          value?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      recipes: {
        Row: {
          id: string;
          family_id: string;
          title: string;
          description: string | null;
          source_url: string | null;
          source_domain: string | null;
          image_url: string | null;
          servings: number;
          prep_time_minutes: number | null;
          cook_time_minutes: number | null;
          total_time_minutes: number | null;
          difficulty: "einfach" | "mittel" | "schwer" | null;
          instructions: Json;
          is_favorite: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          title: string;
          description?: string | null;
          source_url?: string | null;
          source_domain?: string | null;
          image_url?: string | null;
          servings?: number;
          prep_time_minutes?: number | null;
          cook_time_minutes?: number | null;
          total_time_minutes?: number | null;
          difficulty?: "einfach" | "mittel" | "schwer" | null;
          instructions?: Json;
          is_favorite?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          title?: string;
          description?: string | null;
          source_url?: string | null;
          source_domain?: string | null;
          image_url?: string | null;
          servings?: number;
          prep_time_minutes?: number | null;
          cook_time_minutes?: number | null;
          total_time_minutes?: number | null;
          difficulty?: "einfach" | "mittel" | "schwer" | null;
          instructions?: Json;
          is_favorite?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      recipe_ingredients: {
        Row: {
          id: string;
          recipe_id: string;
          name: string;
          quantity: number | null;
          unit: string | null;
          group_name: string | null;
          notes: string | null;
          category: string | null;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          recipe_id: string;
          name: string;
          quantity?: number | null;
          unit?: string | null;
          group_name?: string | null;
          notes?: string | null;
          category?: string | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          recipe_id?: string;
          name?: string;
          quantity?: number | null;
          unit?: string | null;
          group_name?: string | null;
          notes?: string | null;
          category?: string | null;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      recipe_tags: {
        Row: {
          id: string;
          family_id: string;
          name: string;
          color: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          name: string;
          color?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          name?: string;
          color?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      meal_plans: {
        Row: {
          id: string;
          family_id: string;
          week_start: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          week_start: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          week_start?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      meal_plan_entries: {
        Row: {
          id: string;
          meal_plan_id: string;
          date: string;
          meal_type: "breakfast" | "lunch" | "dinner" | "snack";
          recipe_id: string | null;
          note: string | null;
          servings: number | null;
          attendees: string[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          meal_plan_id: string;
          date: string;
          meal_type: "breakfast" | "lunch" | "dinner" | "snack";
          recipe_id?: string | null;
          note?: string | null;
          servings?: number | null;
          attendees?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          meal_plan_id?: string;
          date?: string;
          meal_type?: "breakfast" | "lunch" | "dinner" | "snack";
          recipe_id?: string | null;
          note?: string | null;
          servings?: number | null;
          attendees?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      item_catalog: {
        Row: {
          id: string;
          family_id: string | null;
          name: string;
          name_normalized: string;
          barcode: string | null;
          image_url: string | null;
          thumbnail_url: string | null;
          category: string | null;
          default_unit: string | null;
          default_quantity: number | null;
          nutrition_json: Json | null;
          source: string;
          popularity: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          family_id?: string | null;
          name: string;
          name_normalized: string;
          barcode?: string | null;
          image_url?: string | null;
          thumbnail_url?: string | null;
          category?: string | null;
          default_unit?: string | null;
          default_quantity?: number | null;
          nutrition_json?: Json | null;
          source?: string;
          popularity?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string | null;
          name?: string;
          name_normalized?: string;
          barcode?: string | null;
          image_url?: string | null;
          thumbnail_url?: string | null;
          category?: string | null;
          default_unit?: string | null;
          default_quantity?: number | null;
          nutrition_json?: Json | null;
          source?: string;
          popularity?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          device_id: string;
          family_id: string;
          endpoint: string;
          p256dh_key: string;
          auth_key: string;
          user_agent: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          device_id: string;
          family_id: string;
          endpoint: string;
          p256dh_key: string;
          auth_key: string;
          user_agent?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          device_id?: string;
          family_id?: string;
          endpoint?: string;
          p256dh_key?: string;
          auth_key?: string;
          user_agent?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      notification_preferences: {
        Row: {
          id: string;
          family_id: string;
          device_id: string | null;
          shopping_reminders: boolean;
          shopping_collaborative: boolean;
          calendar_reminders: boolean;
          meal_prep_reminders: boolean;
          birthday_reminders: boolean;
          default_event_reminder_minutes: number;
          meal_prep_advance_minutes: number;
          quiet_hours_enabled: boolean;
          quiet_hours_start: string;
          quiet_hours_end: string;
          todo_reminders: boolean;
          todo_collaborative: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          device_id?: string | null;
          shopping_reminders?: boolean;
          shopping_collaborative?: boolean;
          calendar_reminders?: boolean;
          meal_prep_reminders?: boolean;
          birthday_reminders?: boolean;
          default_event_reminder_minutes?: number;
          meal_prep_advance_minutes?: number;
          quiet_hours_enabled?: boolean;
          quiet_hours_start?: string;
          quiet_hours_end?: string;
          todo_reminders?: boolean;
          todo_collaborative?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          device_id?: string | null;
          shopping_reminders?: boolean;
          shopping_collaborative?: boolean;
          calendar_reminders?: boolean;
          meal_prep_reminders?: boolean;
          birthday_reminders?: boolean;
          default_event_reminder_minutes?: number;
          meal_prep_advance_minutes?: number;
          quiet_hours_enabled?: boolean;
          quiet_hours_start?: string;
          quiet_hours_end?: string;
          todo_reminders?: boolean;
          todo_collaborative?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      scheduled_notifications: {
        Row: {
          id: string;
          family_id: string;
          notification_type: string;
          scheduled_for: string;
          title: string;
          body: string | null;
          data: Json | null;
          related_entity_type: string | null;
          related_entity_id: string | null;
          processed: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          notification_type: string;
          scheduled_for: string;
          title: string;
          body?: string | null;
          data?: Json | null;
          related_entity_type?: string | null;
          related_entity_id?: string | null;
          processed?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          notification_type?: string;
          scheduled_for?: string;
          title?: string;
          body?: string | null;
          data?: Json | null;
          related_entity_type?: string | null;
          related_entity_id?: string | null;
          processed?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      notification_logs: {
        Row: {
          id: string;
          family_id: string;
          device_id: string | null;
          notification_type: string;
          title: string;
          body: string | null;
          data: Json | null;
          status: string;
          error_message: string | null;
          sent_at: string | null;
          clicked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          device_id?: string | null;
          notification_type: string;
          title: string;
          body?: string | null;
          data?: Json | null;
          status?: string;
          error_message?: string | null;
          sent_at?: string | null;
          clicked_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          device_id?: string | null;
          notification_type?: string;
          title?: string;
          body?: string | null;
          data?: Json | null;
          status?: string;
          error_message?: string | null;
          sent_at?: string | null;
          clicked_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      vehicles: {
        Row: {
          id: string;
          family_id: string;
          position: number;
          vendor: "tesla" | "generic-ev";
          nickname: string;
          color: string | null;
          config: Json;
          image_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          position?: number;
          vendor: "tesla" | "generic-ev";
          nickname: string;
          color?: string | null;
          config?: Json;
          image_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          position?: number;
          vendor?: "tesla" | "generic-ev";
          nickname?: string;
          color?: string | null;
          config?: Json;
          image_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tickers: {
        Row: {
          id: string;
          family_id: string;
          position: number;
          symbol: string;
          asset_type: "stock" | "etf" | "crypto" | "index" | "forex";
          nickname: string | null;
          color: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          position?: number;
          symbol: string;
          asset_type: "stock" | "etf" | "crypto" | "index" | "forex";
          nickname?: string | null;
          color?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          position?: number;
          symbol?: string;
          asset_type?: "stock" | "etf" | "crypto" | "index" | "forex";
          nickname?: string | null;
          color?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      pocket_money_accounts: {
        Row: {
          id: string;
          family_id: string;
          person_id: string;
          currency: string;
          balance_cents: number;
          apr_bps: number;
          weekly_allowance_cents: number;
          allowance_day_of_week: number;
          allowance_interval_days: number;
          max_balance_eligible_cents: number;
          pending_interest_cents: number;
          interest_committed_day_of_week: number;
          last_accrued_date: string | null;
          last_allowance_at: string | null;
          interest_committed_at: string | null;
          avatar_species: string;
          lifetime_saved_cents: number;
          last_seen_tier: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          family_id: string;
          person_id: string;
          currency?: string;
          balance_cents?: number;
          apr_bps?: number;
          weekly_allowance_cents?: number;
          allowance_day_of_week?: number;
          allowance_interval_days?: number;
          max_balance_eligible_cents?: number;
          pending_interest_cents?: number;
          interest_committed_day_of_week?: number;
          last_accrued_date?: string | null;
          last_allowance_at?: string | null;
          interest_committed_at?: string | null;
          avatar_species?: string;
          lifetime_saved_cents?: number;
          last_seen_tier?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          family_id?: string;
          person_id?: string;
          currency?: string;
          balance_cents?: number;
          apr_bps?: number;
          weekly_allowance_cents?: number;
          allowance_day_of_week?: number;
          allowance_interval_days?: number;
          max_balance_eligible_cents?: number;
          pending_interest_cents?: number;
          interest_committed_day_of_week?: number;
          last_accrued_date?: string | null;
          last_allowance_at?: string | null;
          interest_committed_at?: string | null;
          avatar_species?: string;
          lifetime_saved_cents?: number;
          last_seen_tier?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      pocket_money_transactions: {
        Row: {
          id: string;
          account_id: string;
          amount_cents: number;
          type: "allowance" | "manual_deposit" | "interest" | "withdrawal" | "adjustment";
          note: string | null;
          related_goal_id: string | null;
          created_by_person_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          amount_cents: number;
          type: "allowance" | "manual_deposit" | "interest" | "withdrawal" | "adjustment";
          note?: string | null;
          related_goal_id?: string | null;
          created_by_person_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          amount_cents?: number;
          type?: "allowance" | "manual_deposit" | "interest" | "withdrawal" | "adjustment";
          note?: string | null;
          related_goal_id?: string | null;
          created_by_person_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      pocket_money_goals: {
        Row: {
          id: string;
          account_id: string;
          name: string;
          target_amount_cents: number;
          image_url: string | null;
          image_source: "catalog" | "upload" | "url";
          position: number;
          is_primary: boolean;
          status: "active" | "ready_to_buy" | "bought" | "abandoned";
          target_reached_at: string | null;
          parent_confirmed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          name: string;
          target_amount_cents: number;
          image_url?: string | null;
          image_source?: "catalog" | "upload" | "url";
          position?: number;
          is_primary?: boolean;
          status?: "active" | "ready_to_buy" | "bought" | "abandoned";
          target_reached_at?: string | null;
          parent_confirmed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          name?: string;
          target_amount_cents?: number;
          image_url?: string | null;
          image_source?: "catalog" | "upload" | "url";
          position?: number;
          is_primary?: boolean;
          status?: "active" | "ready_to_buy" | "bought" | "abandoned";
          target_reached_at?: string | null;
          parent_confirmed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      pocket_money_withdrawal_requests: {
        Row: {
          id: string;
          account_id: string;
          amount_cents: number;
          reason: string;
          status: "pending" | "approved" | "denied";
          parent_decided_at: string | null;
          parent_decided_by_person_id: string | null;
          related_goal_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          amount_cents: number;
          reason?: string;
          status?: "pending" | "approved" | "denied";
          parent_decided_at?: string | null;
          parent_decided_by_person_id?: string | null;
          related_goal_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          amount_cents?: number;
          reason?: string;
          status?: "pending" | "approved" | "denied";
          parent_decided_at?: string | null;
          parent_decided_by_person_id?: string | null;
          related_goal_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {};
    Functions: {};
    Enums: {};
  };
}

// Convenience types
export type Family = Database["public"]["Tables"]["families"]["Row"];
export type Device = Database["public"]["Tables"]["devices"]["Row"];
export type Person = Database["public"]["Tables"]["people"]["Row"];
export type Calendar = Database["public"]["Tables"]["calendars"]["Row"];
export type Event = Database["public"]["Tables"]["events"]["Row"];
export type Todo = Database["public"]["Tables"]["todos"]["Row"];
export type ShoppingItem = Database["public"]["Tables"]["shopping_items"]["Row"];
export type Subject = Database["public"]["Tables"]["subjects"]["Row"];
export type Schedule = Database["public"]["Tables"]["schedules"]["Row"];
export type Birthday = Database["public"]["Tables"]["birthdays"]["Row"];
export type BirthdayGiftIdea = Database["public"]["Tables"]["birthday_gift_ideas"]["Row"];
export type Note = Database["public"]["Tables"]["notes"]["Row"];

// Recipe types
export type Recipe = Database["public"]["Tables"]["recipes"]["Row"];
export type RecipeIngredient = Database["public"]["Tables"]["recipe_ingredients"]["Row"];
export type RecipeTag = Database["public"]["Tables"]["recipe_tags"]["Row"];

// Meal planner types
export type MealPlan = Database["public"]["Tables"]["meal_plans"]["Row"];
export type MealPlanEntry = Database["public"]["Tables"]["meal_plan_entries"]["Row"];
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

// Item catalog types
export type ItemCatalog = Database["public"]["Tables"]["item_catalog"]["Row"];

// Notification types
export type PushSubscription = Database["public"]["Tables"]["push_subscriptions"]["Row"];
export type NotificationPreferences = Database["public"]["Tables"]["notification_preferences"]["Row"];
export type ScheduledNotification = Database["public"]["Tables"]["scheduled_notifications"]["Row"];
export type NotificationLog = Database["public"]["Tables"]["notification_logs"]["Row"];

// Vehicle types
export type Vehicle = Database["public"]["Tables"]["vehicles"]["Row"];
export type VehicleInsert = Database["public"]["Tables"]["vehicles"]["Insert"];
export type VehicleUpdate = Database["public"]["Tables"]["vehicles"]["Update"];

// Stonks / ticker types
export type Ticker = Database["public"]["Tables"]["tickers"]["Row"];
export type TickerInsert = Database["public"]["Tables"]["tickers"]["Insert"];
export type TickerUpdate = Database["public"]["Tables"]["tickers"]["Update"];

// Pocket Money (Piggy) types
export type PocketMoneyAccount = Database["public"]["Tables"]["pocket_money_accounts"]["Row"];
export type PocketMoneyAccountInsert = Database["public"]["Tables"]["pocket_money_accounts"]["Insert"];
export type PocketMoneyAccountUpdate = Database["public"]["Tables"]["pocket_money_accounts"]["Update"];
export type PocketMoneyTransaction = Database["public"]["Tables"]["pocket_money_transactions"]["Row"];
export type PocketMoneyTransactionInsert = Database["public"]["Tables"]["pocket_money_transactions"]["Insert"];
export type PocketMoneyGoal = Database["public"]["Tables"]["pocket_money_goals"]["Row"];
export type PocketMoneyGoalInsert = Database["public"]["Tables"]["pocket_money_goals"]["Insert"];
export type PocketMoneyGoalUpdate = Database["public"]["Tables"]["pocket_money_goals"]["Update"];
export type PocketMoneyWithdrawalRequest = Database["public"]["Tables"]["pocket_money_withdrawal_requests"]["Row"];
export type PocketMoneyWithdrawalRequestInsert = Database["public"]["Tables"]["pocket_money_withdrawal_requests"]["Insert"];

// Recipe instruction type
export interface RecipeInstruction {
  step: number;
  text: string;
  image_url?: string;
}

// Recipe with ingredients (joined)
export interface RecipeWithIngredients extends Recipe {
  ingredients: RecipeIngredient[];
  tags?: RecipeTag[];
}

// Meal plan entry with recipe (joined)
export interface MealPlanEntryWithRecipe extends MealPlanEntry {
  recipe: Recipe | null;
}

// Shopping item with recipe name (for display)
export interface ShoppingItemWithRecipe extends ShoppingItem {
  recipe_name?: string;
}
