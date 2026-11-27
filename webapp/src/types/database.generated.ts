// Generated from the migrated database by `npm run db:generate`
// (scripts/db-types/generate.mjs, RFC-024 §4.6). Do not edit: CI regenerates
// it from init.sql and every migration and fails on any difference.
// Hand-written additions belong in src/types/database.ts.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      assistant_action_requests: {
        Row: {
          client_name: string
          created_at: string
          data: Json
          decided_at: string | null
          decided_by_device_id: string | null
          decided_by_trust: boolean
          domain: string | null
          entity_id: string | null
          entity_name: string | null
          expires_at: string
          family_id: string
          id: string
          kind: "home" | "pocket_money" | "reward_decision"
          result: Json | null
          service: string | null
          status: "pending" | "approved" | "denied" | "expired" | "failed" | "done"
          token_id: string | null
        }
        Insert: {
          client_name: string
          created_at?: string
          data?: Json
          decided_at?: string | null
          decided_by_device_id?: string | null
          decided_by_trust?: boolean
          domain?: string | null
          entity_id?: string | null
          entity_name?: string | null
          expires_at: string
          family_id: string
          id?: string
          kind?: "home" | "pocket_money" | "reward_decision"
          result?: Json | null
          service?: string | null
          status?: "pending" | "approved" | "denied" | "expired" | "failed" | "done"
          token_id?: string | null
        }
        Update: {
          client_name?: string
          created_at?: string
          data?: Json
          decided_at?: string | null
          decided_by_device_id?: string | null
          decided_by_trust?: boolean
          domain?: string | null
          entity_id?: string | null
          entity_name?: string | null
          expires_at?: string
          family_id?: string
          id?: string
          kind?: "home" | "pocket_money" | "reward_decision"
          result?: Json | null
          service?: string | null
          status?: "pending" | "approved" | "denied" | "expired" | "failed" | "done"
          token_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assistant_action_requests_decided_by_device_id_fkey"
            columns: ["decided_by_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_action_requests_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_action_requests_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "integration_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      attention_items: {
        Row: {
          acted_at: string | null
          acted_by: string | null
          context: string | null
          created_at: string
          detail: string | null
          evidence: Json
          family_id: string
          first_seen_at: string
          id: string
          item_key: string
          last_seen_at: string
          message_key: string | null
          params: Json
          priority: number
          resolved_at: string | null
          rule_id: string
          snoozed_until: string | null
          state: "active" | "acknowledged" | "snoozed" | "dismissed"
          subject_id: string | null
          subject_type: string | null
          title: string
        }
        Insert: {
          acted_at?: string | null
          acted_by?: string | null
          context?: string | null
          created_at?: string
          detail?: string | null
          evidence?: Json
          family_id: string
          first_seen_at?: string
          id?: string
          item_key: string
          last_seen_at?: string
          message_key?: string | null
          params?: Json
          priority?: number
          resolved_at?: string | null
          rule_id: string
          snoozed_until?: string | null
          state?: "active" | "acknowledged" | "snoozed" | "dismissed"
          subject_id?: string | null
          subject_type?: string | null
          title: string
        }
        Update: {
          acted_at?: string | null
          acted_by?: string | null
          context?: string | null
          created_at?: string
          detail?: string | null
          evidence?: Json
          family_id?: string
          first_seen_at?: string
          id?: string
          item_key?: string
          last_seen_at?: string
          message_key?: string | null
          params?: Json
          priority?: number
          resolved_at?: string | null
          rule_id?: string
          snoozed_until?: string | null
          state?: "active" | "acknowledged" | "snoozed" | "dismissed"
          subject_id?: string | null
          subject_type?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "attention_items_acted_by_fkey"
            columns: ["acted_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attention_items_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      birthday_gift_ideas: {
        Row: {
          birthday_id: string
          bought: boolean
          created_at: string | null
          deleted_at: string | null
          family_id: string
          id: string
          text: string
        }
        Insert: {
          birthday_id: string
          bought?: boolean
          created_at?: string | null
          deleted_at?: string | null
          family_id: string
          id?: string
          text: string
        }
        Update: {
          birthday_id?: string
          bought?: boolean
          created_at?: string | null
          deleted_at?: string | null
          family_id?: string
          id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "birthday_gift_ideas_birthday_id_fkey"
            columns: ["birthday_id"]
            isOneToOne: false
            referencedRelation: "birthdays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "birthday_gift_ideas_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      birthdays: {
        Row: {
          created_at: string | null
          date: string
          deleted_at: string | null
          family_id: string
          id: string
          image_url: string | null
          name: string
          notify_days_before: number | null
          person_id: string | null
        }
        Insert: {
          created_at?: string | null
          date: string
          deleted_at?: string | null
          family_id: string
          id?: string
          image_url?: string | null
          name: string
          notify_days_before?: number | null
          person_id?: string | null
        }
        Update: {
          created_at?: string | null
          date?: string
          deleted_at?: string | null
          family_id?: string
          id?: string
          image_url?: string | null
          name?: string
          notify_days_before?: number | null
          person_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "birthdays_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "birthdays_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      bring_removals: {
        Row: {
          bring_item_id: string
          bring_list_id: string | null
          deleted_at: string
          family_id: string
          id: number
        }
        Insert: {
          bring_item_id: string
          bring_list_id?: string | null
          deleted_at?: string
          family_id: string
          id?: number
        }
        Update: {
          bring_item_id?: string
          bring_list_id?: string | null
          deleted_at?: string
          family_id?: string
          id?: number
        }
        Relationships: [
          {
            foreignKeyName: "bring_removals_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      calendars: {
        Row: {
          caldav_ctag: string | null
          caldav_last_error: string | null
          caldav_read_only: boolean
          caldav_server_url: string | null
          caldav_url: string | null
          color: string
          created_at: string | null
          family_id: string
          google_calendar_id: string | null
          ics_etag: string | null
          ics_url: string | null
          id: string
          is_holidays: boolean | null
          is_waste_collection: boolean | null
          last_synced_at: string | null
          name: string
          person_id: string | null
          sync_enabled: boolean | null
          updated_at: string | null
        }
        Insert: {
          caldav_ctag?: string | null
          caldav_last_error?: string | null
          caldav_read_only?: boolean
          caldav_server_url?: string | null
          caldav_url?: string | null
          color?: string
          created_at?: string | null
          family_id: string
          google_calendar_id?: string | null
          ics_etag?: string | null
          ics_url?: string | null
          id?: string
          is_holidays?: boolean | null
          is_waste_collection?: boolean | null
          last_synced_at?: string | null
          name: string
          person_id?: string | null
          sync_enabled?: boolean | null
          updated_at?: string | null
        }
        Update: {
          caldav_ctag?: string | null
          caldav_last_error?: string | null
          caldav_read_only?: boolean
          caldav_server_url?: string | null
          caldav_url?: string | null
          color?: string
          created_at?: string | null
          family_id?: string
          google_calendar_id?: string | null
          ics_etag?: string | null
          ics_url?: string | null
          id?: string
          is_holidays?: boolean | null
          is_waste_collection?: boolean | null
          last_synced_at?: string | null
          name?: string
          person_id?: string | null
          sync_enabled?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendars_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendars_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      camera_takeovers: {
        Row: {
          camera_id: string
          device_ids: string[]
          ends_at: string
          family_id: string
          started_at: string
        }
        Insert: {
          camera_id: string
          device_ids?: string[]
          ends_at: string
          family_id: string
          started_at?: string
        }
        Update: {
          camera_id?: string
          device_ids?: string[]
          ends_at?: string
          family_id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "camera_takeovers_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: true
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      catalogue_items: {
        Row: {
          builtin_key: string | null
          created_at: string
          entity_id: string | null
          family_id: string
          id: string
          image_url: string | null
          kind: "ha_entity" | "builtin"
          name: string
          position: number
          room: string | null
          room_id: string | null
          updated_at: string
        }
        Insert: {
          builtin_key?: string | null
          created_at?: string
          entity_id?: string | null
          family_id: string
          id?: string
          image_url?: string | null
          kind: "ha_entity" | "builtin"
          name: string
          position?: number
          room?: string | null
          room_id?: string | null
          updated_at?: string
        }
        Update: {
          builtin_key?: string | null
          created_at?: string
          entity_id?: string | null
          family_id?: string
          id?: string
          image_url?: string | null
          kind?: "ha_entity" | "builtin"
          name?: string
          position?: number
          room?: string | null
          room_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalogue_items_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalogue_items_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      context_rules: {
        Row: {
          config: Json
          enabled: boolean
          family_id: string
          rule_id: string
          updated_at: string
        }
        Insert: {
          config?: Json
          enabled?: boolean
          family_id: string
          rule_id: string
          updated_at?: string
        }
        Update: {
          config?: Json
          enabled?: boolean
          family_id?: string
          rule_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "context_rules_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      creatures: {
        Row: {
          best_tier: number
          created_at: string
          enabled: boolean
          family_id: string
          grows_with: "points" | "money"
          last_seen_tier: number
          look: Json
          person_id: string
          shop_enabled: boolean
          species: string
          style: "classic" | "gumdrop" | "sticker" | "storybook"
          updated_at: string
        }
        Insert: {
          best_tier?: number
          created_at?: string
          enabled?: boolean
          family_id: string
          grows_with?: "points" | "money"
          last_seen_tier?: number
          look?: Json
          person_id: string
          shop_enabled?: boolean
          species?: string
          style?: "classic" | "gumdrop" | "sticker" | "storybook"
          updated_at?: string
        }
        Update: {
          best_tier?: number
          created_at?: string
          enabled?: boolean
          family_id?: string
          grows_with?: "points" | "money"
          last_seen_tier?: number
          look?: Json
          person_id?: string
          shop_enabled?: boolean
          species?: string
          style?: "classic" | "gumdrop" | "sticker" | "storybook"
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "creatures_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creatures_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      device_sessions: {
        Row: {
          created_at: string
          device_id: string
          expires_at: string
          family_id: string
          id: string
          last_used_at: string | null
          revoked_at: string | null
          settings_unlocked_until: string | null
          token_hash: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          device_id: string
          expires_at: string
          family_id: string
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          settings_unlocked_until?: string | null
          token_hash: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          device_id?: string
          expires_at?: string
          family_id?: string
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          settings_unlocked_until?: string | null
          token_hash?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_sessions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_sessions_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          created_at: string | null
          family_id: string
          fingerprint: string | null
          fingerprint_history: string[]
          hardware_id: string | null
          has_presence_sensor: boolean | null
          id: string
          is_kiosk: boolean | null
          last_seen: string | null
          layout_id: string | null
          name: string
          person_id: string | null
          screen: Json | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string | null
          family_id: string
          fingerprint?: string | null
          fingerprint_history?: string[]
          hardware_id?: string | null
          has_presence_sensor?: boolean | null
          id?: string
          is_kiosk?: boolean | null
          last_seen?: string | null
          layout_id?: string | null
          name: string
          person_id?: string | null
          screen?: Json | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string | null
          family_id?: string
          fingerprint?: string | null
          fingerprint_history?: string[]
          hardware_id?: string | null
          has_presence_sensor?: boolean | null
          id?: string
          is_kiosk?: boolean | null
          last_seen?: string | null
          layout_id?: string | null
          name?: string
          person_id?: string | null
          screen?: Json | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "devices_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "layouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_events: {
        Row: {
          actor_id: string | null
          event_type: string
          family_id: string
          id: number
          occurred_at: string
          payload: Json
          payload_version: number
          source: string
        }
        Insert: {
          actor_id?: string | null
          event_type: string
          family_id: string
          id?: number
          occurred_at?: string
          payload?: Json
          payload_version?: number
          source?: string
        }
        Update: {
          actor_id?: string | null
          event_type?: string
          family_id?: string
          id?: number
          occurred_at?: string
          payload?: Json
          payload_version?: number
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "domain_events_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      event_series: {
        Row: {
          all_day: boolean
          calendar_id: string
          created_at: string
          description: string | null
          extend_on: string | null
          family_id: string
          first_end_at: string
          first_start_at: string
          generated_through: string
          id: string
          location: string | null
          person_id: string | null
          revision: number
          rule: string
          skipped_days: string[]
          time_zone: string
          title: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          calendar_id: string
          created_at?: string
          description?: string | null
          extend_on?: string | null
          family_id: string
          first_end_at: string
          first_start_at: string
          generated_through: string
          id?: string
          location?: string | null
          person_id?: string | null
          revision?: number
          rule: string
          skipped_days?: string[]
          time_zone: string
          title: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          calendar_id?: string
          created_at?: string
          description?: string | null
          extend_on?: string | null
          family_id?: string
          first_end_at?: string
          first_start_at?: string
          generated_through?: string
          id?: string
          location?: string | null
          person_id?: string | null
          revision?: number
          rule?: string
          skipped_days?: string[]
          time_zone?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_series_calendar_id_fkey"
            columns: ["calendar_id"]
            isOneToOne: false
            referencedRelation: "calendars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_series_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_series_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          all_day: boolean | null
          caldav_etag: string | null
          caldav_href: string | null
          calendar_id: string
          created_at: string | null
          description: string | null
          end_at: string
          google_event_id: string | null
          id: string
          location: string | null
          person_id: string | null
          recurrence_rule: string | null
          series_day: string | null
          series_exception: boolean
          series_id: string | null
          start_at: string
          title: string
          updated_at: string | null
        }
        Insert: {
          all_day?: boolean | null
          caldav_etag?: string | null
          caldav_href?: string | null
          calendar_id: string
          created_at?: string | null
          description?: string | null
          end_at: string
          google_event_id?: string | null
          id?: string
          location?: string | null
          person_id?: string | null
          recurrence_rule?: string | null
          series_day?: string | null
          series_exception?: boolean
          series_id?: string | null
          start_at: string
          title: string
          updated_at?: string | null
        }
        Update: {
          all_day?: boolean | null
          caldav_etag?: string | null
          caldav_href?: string | null
          calendar_id?: string
          created_at?: string | null
          description?: string | null
          end_at?: string
          google_event_id?: string | null
          id?: string
          location?: string | null
          person_id?: string | null
          recurrence_rule?: string | null
          series_day?: string | null
          series_exception?: boolean
          series_id?: string | null
          start_at?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_calendar_id_fkey"
            columns: ["calendar_id"]
            isOneToOne: false
            referencedRelation: "calendars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_series_fkey"
            columns: ["series_id", "calendar_id"]
            isOneToOne: false
            referencedRelation: "event_series"
            referencedColumns: ["id", "calendar_id"]
          },
        ]
      }
      families: {
        Row: {
          created_at: string | null
          id: string
          join_code: string
          join_code_expires_at: string | null
          name: string
          rooms_reconciled_at: string | null
          setup_completed: boolean
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          join_code: string
          join_code_expires_at?: string | null
          name: string
          rooms_reconciled_at?: string | null
          setup_completed?: boolean
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          join_code?: string
          join_code_expires_at?: string | null
          name?: string
          rooms_reconciled_at?: string | null
          setup_completed?: boolean
          updated_at?: string | null
        }
        Relationships: []
      }
      family_photos: {
        Row: {
          byte_size: number
          created_at: string
          family_id: string
          height: number | null
          id: string
          mime_type: string
          storage_path: string
          taken_at: string | null
          thumbnail_path: string | null
          updated_at: string
          uploaded_at: string
          width: number | null
        }
        Insert: {
          byte_size: number
          created_at?: string
          family_id: string
          height?: number | null
          id?: string
          mime_type: string
          storage_path: string
          taken_at?: string | null
          thumbnail_path?: string | null
          updated_at?: string
          uploaded_at?: string
          width?: number | null
        }
        Update: {
          byte_size?: number
          created_at?: string
          family_id?: string
          height?: number | null
          id?: string
          mime_type?: string
          storage_path?: string
          taken_at?: string | null
          thumbnail_path?: string | null
          updated_at?: string
          uploaded_at?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "family_photos_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      instance_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      integration_clients: {
        Row: {
          capabilities: Json
          client_type: string
          client_version: string | null
          family_id: string
          id: string
          last_seen_at: string
          token_id: string | null
        }
        Insert: {
          capabilities?: Json
          client_type: string
          client_version?: string | null
          family_id: string
          id?: string
          last_seen_at?: string
          token_id?: string | null
        }
        Update: {
          capabilities?: Json
          client_type?: string
          client_version?: string | null
          family_id?: string
          id?: string
          last_seen_at?: string
          token_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_clients_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_clients_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "integration_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_idempotency: {
        Row: {
          created_at: string
          family_id: string
          idempotency_key: string
          request_hash: string
          response: Json
          service: string
          status: number
        }
        Insert: {
          created_at?: string
          family_id: string
          idempotency_key: string
          request_hash: string
          response: Json
          service: string
          status: number
        }
        Update: {
          created_at?: string
          family_id?: string
          idempotency_key?: string
          request_hash?: string
          response?: Json
          service?: string
          status?: number
        }
        Relationships: [
          {
            foreignKeyName: "integration_idempotency_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_secrets: {
        Row: {
          family_id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          family_id: string
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          family_id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "integration_secrets_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_tokens: {
        Row: {
          created_at: string
          expires_at: string | null
          family_id: string
          id: string
          last_used_at: string | null
          name: string
          oauth_client_id: string | null
          oauth_request_id: string | null
          refresh_expires_at: string | null
          refresh_token_hash: string | null
          resource: string | null
          revoked_at: string | null
          scopes: string[]
          token_hash: string
          trusted_at: string | null
          trusted_by_device_id: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          family_id: string
          id?: string
          last_used_at?: string | null
          name: string
          oauth_client_id?: string | null
          oauth_request_id?: string | null
          refresh_expires_at?: string | null
          refresh_token_hash?: string | null
          resource?: string | null
          revoked_at?: string | null
          scopes?: string[]
          token_hash: string
          trusted_at?: string | null
          trusted_by_device_id?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          family_id?: string
          id?: string
          last_used_at?: string | null
          name?: string
          oauth_client_id?: string | null
          oauth_request_id?: string | null
          refresh_expires_at?: string | null
          refresh_token_hash?: string | null
          resource?: string | null
          revoked_at?: string | null
          scopes?: string[]
          token_hash?: string
          trusted_at?: string | null
          trusted_by_device_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_tokens_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_tokens_trusted_by_device_id_fkey"
            columns: ["trusted_by_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      item_catalog: {
        Row: {
          barcode: string | null
          category: string | null
          created_at: string | null
          default_quantity: number | null
          default_unit: string | null
          family_id: string | null
          id: string
          image_url: string | null
          name: string
          name_normalized: string
          nutrition_json: Json | null
          popularity: number | null
          source: string | null
          thumbnail_url: string | null
        }
        Insert: {
          barcode?: string | null
          category?: string | null
          created_at?: string | null
          default_quantity?: number | null
          default_unit?: string | null
          family_id?: string | null
          id?: string
          image_url?: string | null
          name: string
          name_normalized: string
          nutrition_json?: Json | null
          popularity?: number | null
          source?: string | null
          thumbnail_url?: string | null
        }
        Update: {
          barcode?: string | null
          category?: string | null
          created_at?: string | null
          default_quantity?: number | null
          default_unit?: string | null
          family_id?: string | null
          id?: string
          image_url?: string | null
          name?: string
          name_normalized?: string
          nutrition_json?: Json | null
          popularity?: number | null
          source?: string | null
          thumbnail_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_catalog_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      kept_images: {
        Row: {
          created_at: string
          family_id: string
          id: number
          local_url: string
          source_url: string
        }
        Insert: {
          created_at?: string
          family_id: string
          id?: never
          local_url: string
          source_url: string
        }
        Update: {
          created_at?: string
          family_id?: string
          id?: never
          local_url?: string
          source_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "kept_images_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      layouts: {
        Row: {
          created_at: string
          family_id: string
          grid: number
          height: number
          home: Json
          id: string
          name: string
          screensaver: Json
          updated_at: string
          width: number
        }
        Insert: {
          created_at?: string
          family_id: string
          grid?: number
          height: number
          home?: Json
          id?: string
          name: string
          screensaver?: Json
          updated_at?: string
          width: number
        }
        Update: {
          created_at?: string
          family_id?: string
          grid?: number
          height?: number
          home?: Json
          id?: string
          name?: string
          screensaver?: Json
          updated_at?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "layouts_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      meal_plan_entries: {
        Row: {
          attendees: string[] | null
          created_at: string | null
          date: string
          deleted_at: string | null
          id: string
          meal_plan_id: string
          meal_type: "breakfast" | "lunch" | "dinner" | "snack"
          note: string | null
          recipe_id: string | null
          servings: number | null
          updated_at: string | null
        }
        Insert: {
          attendees?: string[] | null
          created_at?: string | null
          date: string
          deleted_at?: string | null
          id?: string
          meal_plan_id: string
          meal_type: "breakfast" | "lunch" | "dinner" | "snack"
          note?: string | null
          recipe_id?: string | null
          servings?: number | null
          updated_at?: string | null
        }
        Update: {
          attendees?: string[] | null
          created_at?: string | null
          date?: string
          deleted_at?: string | null
          id?: string
          meal_plan_id?: string
          meal_type?: "breakfast" | "lunch" | "dinner" | "snack"
          note?: string | null
          recipe_id?: string | null
          servings?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meal_plan_entries_meal_plan_id_fkey"
            columns: ["meal_plan_id"]
            isOneToOne: false
            referencedRelation: "meal_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meal_plan_entries_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      meal_plans: {
        Row: {
          created_at: string | null
          family_id: string
          id: string
          notes: string | null
          updated_at: string | null
          week_start: string
        }
        Insert: {
          created_at?: string | null
          family_id: string
          id?: string
          notes?: string | null
          updated_at?: string | null
          week_start: string
        }
        Update: {
          created_at?: string | null
          family_id?: string
          id?: string
          notes?: string | null
          updated_at?: string | null
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "meal_plans_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      media_players: {
        Row: {
          config: Json
          created_at: string
          driver: "home_assistant"
          family_id: string
          id: string
          nickname: string
          position: number
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          driver: "home_assistant"
          family_id: string
          id?: string
          nickname: string
          position?: number
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          driver?: "home_assistant"
          family_id?: string
          id?: string
          nickname?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_players_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by_device_id: string | null
          action_request_id: string | null
          body: string
          created_at: string
          family_id: string
          id: string
          sender_device_id: string | null
          sender_label: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by_device_id?: string | null
          action_request_id?: string | null
          body: string
          created_at?: string
          family_id: string
          id?: string
          sender_device_id?: string | null
          sender_label?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by_device_id?: string | null
          action_request_id?: string | null
          body?: string
          created_at?: string
          family_id?: string
          id?: string
          sender_device_id?: string | null
          sender_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_acknowledged_by_device_id_fkey"
            columns: ["acknowledged_by_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_action_request_id_fkey"
            columns: ["action_request_id"]
            isOneToOne: false
            referencedRelation: "assistant_action_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_device_id_fkey"
            columns: ["sender_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          content: string
          created_at: string | null
          deleted_at: string | null
          family_id: string
          id: string
          person_id: string | null
          pinned: boolean | null
          updated_at: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          deleted_at?: string | null
          family_id: string
          id?: string
          person_id?: string | null
          pinned?: boolean | null
          updated_at?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          deleted_at?: string | null
          family_id?: string
          id?: string
          person_id?: string | null
          pinned?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notes_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_logs: {
        Row: {
          body: string | null
          clicked_at: string | null
          created_at: string | null
          data: Json | null
          device_id: string | null
          error_message: string | null
          family_id: string
          id: string
          notification_type: string
          sent_at: string | null
          status: string
          title: string
        }
        Insert: {
          body?: string | null
          clicked_at?: string | null
          created_at?: string | null
          data?: Json | null
          device_id?: string | null
          error_message?: string | null
          family_id: string
          id?: string
          notification_type: string
          sent_at?: string | null
          status?: string
          title: string
        }
        Update: {
          body?: string | null
          clicked_at?: string | null
          created_at?: string | null
          data?: Json | null
          device_id?: string | null
          error_message?: string | null
          family_id?: string
          id?: string
          notification_type?: string
          sent_at?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_logs_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_logs_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          birthday_reminders: boolean | null
          calendar_reminders: boolean | null
          created_at: string | null
          default_event_reminder_minutes: number | null
          device_id: string | null
          family_id: string
          id: string
          meal_prep_advance_minutes: number | null
          meal_prep_reminders: boolean | null
          quiet_hours_enabled: boolean | null
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          reward_requests: boolean | null
          shopping_collaborative: boolean | null
          shopping_reminders: boolean | null
          todo_collaborative: boolean | null
          todo_reminders: boolean | null
          updated_at: string | null
        }
        Insert: {
          birthday_reminders?: boolean | null
          calendar_reminders?: boolean | null
          created_at?: string | null
          default_event_reminder_minutes?: number | null
          device_id?: string | null
          family_id: string
          id?: string
          meal_prep_advance_minutes?: number | null
          meal_prep_reminders?: boolean | null
          quiet_hours_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          reward_requests?: boolean | null
          shopping_collaborative?: boolean | null
          shopping_reminders?: boolean | null
          todo_collaborative?: boolean | null
          todo_reminders?: boolean | null
          updated_at?: string | null
        }
        Update: {
          birthday_reminders?: boolean | null
          calendar_reminders?: boolean | null
          created_at?: string | null
          default_event_reminder_minutes?: number | null
          device_id?: string | null
          family_id?: string
          id?: string
          meal_prep_advance_minutes?: number | null
          meal_prep_reminders?: boolean | null
          quiet_hours_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          reward_requests?: boolean | null
          shopping_collaborative?: boolean | null
          shopping_reminders?: boolean | null
          todo_collaborative?: boolean | null
          todo_reminders?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_preferences_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_authorization_requests: {
        Row: {
          client_id: string
          client_name: string
          code_challenge: string
          code_expires_at: string | null
          code_hash: string | null
          created_at: string
          expires_at: string
          family_id: string | null
          grant_id: string | null
          granted_scopes: string[] | null
          id: string
          redirect_uri: string
          replayed_at: string | null
          resource: string
          scopes: string[]
          state: string | null
          used_at: string | null
        }
        Insert: {
          client_id: string
          client_name: string
          code_challenge: string
          code_expires_at?: string | null
          code_hash?: string | null
          created_at?: string
          expires_at: string
          family_id?: string | null
          grant_id?: string | null
          granted_scopes?: string[] | null
          id?: string
          redirect_uri: string
          replayed_at?: string | null
          resource: string
          scopes: string[]
          state?: string | null
          used_at?: string | null
        }
        Update: {
          client_id?: string
          client_name?: string
          code_challenge?: string
          code_expires_at?: string | null
          code_hash?: string | null
          created_at?: string
          expires_at?: string
          family_id?: string | null
          grant_id?: string | null
          granted_scopes?: string[] | null
          id?: string
          redirect_uri?: string
          replayed_at?: string | null
          resource?: string
          scopes?: string[]
          state?: string | null
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oauth_authorization_requests_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_authorization_requests_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "integration_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_clients: {
        Row: {
          client_id: string
          client_name: string
          created_at: string
          redirect_uris: string[]
        }
        Insert: {
          client_id: string
          client_name: string
          created_at?: string
          redirect_uris: string[]
        }
        Update: {
          client_id?: string
          client_name?: string
          created_at?: string
          redirect_uris?: string[]
        }
        Relationships: []
      }
      oauth_credentials: {
        Row: {
          created_at: string | null
          encrypted_access_token: string | null
          encrypted_refresh_token: string
          family_id: string
          id: string
          provider: string
          token_expires_at: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          encrypted_access_token?: string | null
          encrypted_refresh_token: string
          family_id: string
          id?: string
          provider: string
          token_expires_at?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          encrypted_access_token?: string | null
          encrypted_refresh_token?: string
          family_id?: string
          id?: string
          provider?: string
          token_expires_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oauth_credentials_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          avatar_url: string | null
          birth_date: string | null
          color: string
          created_at: string | null
          deleted_at: string | null
          family_id: string
          id: string
          is_child: boolean | null
          name: string
        }
        Insert: {
          avatar_url?: string | null
          birth_date?: string | null
          color?: string
          created_at?: string | null
          deleted_at?: string | null
          family_id: string
          id?: string
          is_child?: boolean | null
          name: string
        }
        Update: {
          avatar_url?: string | null
          birth_date?: string | null
          color?: string
          created_at?: string | null
          deleted_at?: string | null
          family_id?: string
          id?: string
          is_child?: boolean | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "people_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      pocket_money_accounts: {
        Row: {
          allowance_day_of_week: number
          allowance_interval_days: number
          apr_bps: number
          avatar_look: Json
          avatar_species: string
          avatar_style: "classic" | "gumdrop" | "sticker" | "storybook"
          balance_cents: number
          best_tier: number
          created_at: string
          currency: string
          family_id: string
          id: string
          interest_committed_at: string | null
          interest_committed_day_of_week: number
          last_accrued_date: string | null
          last_allowance_at: string | null
          last_seen_tier: number
          lifetime_saved_cents: number
          max_balance_eligible_cents: number
          pending_interest_cents: number
          pending_interest_micros: number
          person_id: string
          reward_mode: "money" | "points"
          updated_at: string
          weekly_allowance_cents: number
        }
        Insert: {
          allowance_day_of_week?: number
          allowance_interval_days?: number
          apr_bps?: number
          avatar_look?: Json
          avatar_species?: string
          avatar_style?: "classic" | "gumdrop" | "sticker" | "storybook"
          balance_cents?: number
          best_tier?: number
          created_at?: string
          currency?: string
          family_id: string
          id?: string
          interest_committed_at?: string | null
          interest_committed_day_of_week?: number
          last_accrued_date?: string | null
          last_allowance_at?: string | null
          last_seen_tier?: number
          lifetime_saved_cents?: number
          max_balance_eligible_cents?: number
          pending_interest_cents?: number
          pending_interest_micros?: number
          person_id: string
          reward_mode?: "money" | "points"
          updated_at?: string
          weekly_allowance_cents?: number
        }
        Update: {
          allowance_day_of_week?: number
          allowance_interval_days?: number
          apr_bps?: number
          avatar_look?: Json
          avatar_species?: string
          avatar_style?: "classic" | "gumdrop" | "sticker" | "storybook"
          balance_cents?: number
          best_tier?: number
          created_at?: string
          currency?: string
          family_id?: string
          id?: string
          interest_committed_at?: string | null
          interest_committed_day_of_week?: number
          last_accrued_date?: string | null
          last_allowance_at?: string | null
          last_seen_tier?: number
          lifetime_saved_cents?: number
          max_balance_eligible_cents?: number
          pending_interest_cents?: number
          pending_interest_micros?: number
          person_id?: string
          reward_mode?: "money" | "points"
          updated_at?: string
          weekly_allowance_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "pocket_money_accounts_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pocket_money_accounts_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      pocket_money_goals: {
        Row: {
          account_id: string
          created_at: string
          deleted_at: string | null
          id: string
          image_source: "catalog" | "upload" | "url"
          image_url: string | null
          is_primary: boolean
          name: string
          parent_confirmed_at: string | null
          position: number
          status: "active" | "ready_to_buy" | "bought" | "abandoned"
          target_amount_cents: number
          target_reached_at: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          image_source?: "catalog" | "upload" | "url"
          image_url?: string | null
          is_primary?: boolean
          name: string
          parent_confirmed_at?: string | null
          position?: number
          status?: "active" | "ready_to_buy" | "bought" | "abandoned"
          target_amount_cents: number
          target_reached_at?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          image_source?: "catalog" | "upload" | "url"
          image_url?: string | null
          is_primary?: boolean
          name?: string
          parent_confirmed_at?: string | null
          position?: number
          status?: "active" | "ready_to_buy" | "bought" | "abandoned"
          target_amount_cents?: number
          target_reached_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pocket_money_goals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "pocket_money_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      pocket_money_transactions: {
        Row: {
          account_id: string
          amount_cents: number
          created_at: string
          created_by_person_id: string | null
          id: string
          note: string | null
          related_goal_id: string | null
          type: "allowance" | "manual_deposit" | "interest" | "withdrawal" | "adjustment"
        }
        Insert: {
          account_id: string
          amount_cents: number
          created_at?: string
          created_by_person_id?: string | null
          id?: string
          note?: string | null
          related_goal_id?: string | null
          type: "allowance" | "manual_deposit" | "interest" | "withdrawal" | "adjustment"
        }
        Update: {
          account_id?: string
          amount_cents?: number
          created_at?: string
          created_by_person_id?: string | null
          id?: string
          note?: string | null
          related_goal_id?: string | null
          type?: "allowance" | "manual_deposit" | "interest" | "withdrawal" | "adjustment"
        }
        Relationships: [
          {
            foreignKeyName: "pocket_money_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "pocket_money_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pocket_money_transactions_created_by_person_id_fkey"
            columns: ["created_by_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pocket_money_transactions_related_goal_id_fkey"
            columns: ["related_goal_id"]
            isOneToOne: false
            referencedRelation: "pocket_money_goals"
            referencedColumns: ["id"]
          },
        ]
      }
      pocket_money_withdrawal_requests: {
        Row: {
          account_id: string
          amount_cents: number
          created_at: string
          id: string
          parent_decided_at: string | null
          parent_decided_by_person_id: string | null
          reason: string
          related_goal_id: string | null
          status: "pending" | "approved" | "denied"
        }
        Insert: {
          account_id: string
          amount_cents: number
          created_at?: string
          id?: string
          parent_decided_at?: string | null
          parent_decided_by_person_id?: string | null
          reason?: string
          related_goal_id?: string | null
          status?: "pending" | "approved" | "denied"
        }
        Update: {
          account_id?: string
          amount_cents?: number
          created_at?: string
          id?: string
          parent_decided_at?: string | null
          parent_decided_by_person_id?: string | null
          reason?: string
          related_goal_id?: string | null
          status?: "pending" | "approved" | "denied"
        }
        Relationships: [
          {
            foreignKeyName: "pocket_money_withdrawal_reques_parent_decided_by_person_id_fkey"
            columns: ["parent_decided_by_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pocket_money_withdrawal_requests_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "pocket_money_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pocket_money_withdrawal_requests_related_goal_id_fkey"
            columns: ["related_goal_id"]
            isOneToOne: false
            referencedRelation: "pocket_money_goals"
            referencedColumns: ["id"]
          },
        ]
      }
      point_purchases: {
        Row: {
          cost: number
          created_at: string
          family_id: string
          id: string
          item_id: string
          person_id: string
        }
        Insert: {
          cost: number
          created_at?: string
          family_id: string
          id?: string
          item_id: string
          person_id: string
        }
        Update: {
          cost?: number
          created_at?: string
          family_id?: string
          id?: string
          item_id?: string
          person_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "point_purchases_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_purchases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      point_redemptions: {
        Row: {
          account_id: string | null
          cost_points: number
          created_at: string
          decided_at: string | null
          decided_by_device_id: string | null
          family_id: string
          icon: string | null
          id: string
          person_id: string
          requested_by_device_id: string | null
          reward_id: string | null
          status: "pending" | "approved" | "denied"
          title: string
        }
        Insert: {
          account_id?: string | null
          cost_points: number
          created_at?: string
          decided_at?: string | null
          decided_by_device_id?: string | null
          family_id: string
          icon?: string | null
          id?: string
          person_id: string
          requested_by_device_id?: string | null
          reward_id?: string | null
          status?: "pending" | "approved" | "denied"
          title: string
        }
        Update: {
          account_id?: string | null
          cost_points?: number
          created_at?: string
          decided_at?: string | null
          decided_by_device_id?: string | null
          family_id?: string
          icon?: string | null
          id?: string
          person_id?: string
          requested_by_device_id?: string | null
          reward_id?: string | null
          status?: "pending" | "approved" | "denied"
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "point_redemptions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "pocket_money_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_redemptions_decided_by_device_id_fkey"
            columns: ["decided_by_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_redemptions_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_redemptions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_redemptions_requested_by_device_id_fkey"
            columns: ["requested_by_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_redemptions_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "point_rewards"
            referencedColumns: ["id"]
          },
        ]
      }
      point_rewards: {
        Row: {
          active: boolean
          cost_points: number
          created_at: string
          family_id: string
          icon: string | null
          id: string
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          cost_points: number
          created_at?: string
          family_id: string
          icon?: string | null
          id?: string
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          cost_points?: number
          created_at?: string
          family_id?: string
          icon?: string | null
          id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "point_rewards_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string | null
          device_id: string
          endpoint: string
          family_id: string
          id: string
          is_active: boolean | null
          p256dh_key: string
          updated_at: string | null
          user_agent: string | null
          vapid_key_fingerprint: string | null
          vapid_key_retired_at: string | null
        }
        Insert: {
          auth_key: string
          created_at?: string | null
          device_id: string
          endpoint: string
          family_id: string
          id?: string
          is_active?: boolean | null
          p256dh_key: string
          updated_at?: string | null
          user_agent?: string | null
          vapid_key_fingerprint?: string | null
          vapid_key_retired_at?: string | null
        }
        Update: {
          auth_key?: string
          created_at?: string | null
          device_id?: string
          endpoint?: string
          family_id?: string
          id?: string
          is_active?: boolean | null
          p256dh_key?: string
          updated_at?: string | null
          user_agent?: string | null
          vapid_key_fingerprint?: string | null
          vapid_key_retired_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_ingredients: {
        Row: {
          category: string | null
          created_at: string | null
          group_name: string | null
          id: string
          name: string
          notes: string | null
          quantity: number | null
          recipe_id: string
          sort_order: number | null
          unit: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          group_name?: string | null
          id?: string
          name: string
          notes?: string | null
          quantity?: number | null
          recipe_id: string
          sort_order?: number | null
          unit?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          group_name?: string | null
          id?: string
          name?: string
          notes?: string | null
          quantity?: number | null
          recipe_id?: string
          sort_order?: number | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_tag_assignments: {
        Row: {
          recipe_id: string
          tag_id: string
        }
        Insert: {
          recipe_id: string
          tag_id: string
        }
        Update: {
          recipe_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_tag_assignments_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "recipe_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_tags: {
        Row: {
          color: string | null
          created_at: string | null
          family_id: string
          id: string
          name: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          family_id: string
          id?: string
          name: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          family_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_tags_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          cook_time_minutes: number | null
          created_at: string | null
          deleted_at: string | null
          description: string | null
          difficulty: "einfach" | "mittel" | "schwer" | null
          family_id: string
          id: string
          image_url: string | null
          instructions: Json
          is_favorite: boolean | null
          prep_time_minutes: number | null
          servings: number | null
          source_domain: string | null
          source_url: string | null
          title: string
          total_time_minutes: number | null
          updated_at: string | null
        }
        Insert: {
          cook_time_minutes?: number | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          difficulty?: "einfach" | "mittel" | "schwer" | null
          family_id: string
          id?: string
          image_url?: string | null
          instructions?: Json
          is_favorite?: boolean | null
          prep_time_minutes?: number | null
          servings?: number | null
          source_domain?: string | null
          source_url?: string | null
          title: string
          total_time_minutes?: number | null
          updated_at?: string | null
        }
        Update: {
          cook_time_minutes?: number | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          difficulty?: "einfach" | "mittel" | "schwer" | null
          family_id?: string
          id?: string
          image_url?: string | null
          instructions?: Json
          is_favorite?: boolean | null
          prep_time_minutes?: number | null
          servings?: number | null
          source_domain?: string | null
          source_url?: string | null
          title?: string
          total_time_minutes?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recipes_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          color: string | null
          created_at: string
          family_id: string
          icon: string | null
          id: string
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          family_id: string
          icon?: string | null
          id?: string
          name: string
          position?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          family_id?: string
          icon?: string | null
          id?: string
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_notifications: {
        Row: {
          body: string | null
          created_at: string | null
          data: Json | null
          family_id: string
          id: string
          notification_type: string
          processed: boolean | null
          related_entity_id: string | null
          related_entity_type: string | null
          scheduled_for: string
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string | null
          data?: Json | null
          family_id: string
          id?: string
          notification_type: string
          processed?: boolean | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          scheduled_for: string
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string | null
          data?: Json | null
          family_id?: string
          id?: string
          notification_type?: string
          processed?: boolean | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          scheduled_for?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_notifications_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          created_at: string | null
          day_of_week: number
          family_id: string
          id: string
          person_id: string
          time_slots: Json
        }
        Insert: {
          created_at?: string | null
          day_of_week: number
          family_id: string
          id?: string
          person_id: string
          time_slots?: Json
        }
        Update: {
          created_at?: string | null
          day_of_week?: number
          family_id?: string
          id?: string
          person_id?: string
          time_slots?: Json
        }
        Relationships: [
          {
            foreignKeyName: "schedules_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      school_holidays: {
        Row: {
          created_at: string
          ends_on: string
          external_id: string | null
          family_id: string
          hidden: boolean
          id: string
          name: string
          source: "manual" | "openholidays"
          starts_on: string
          synced_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_on: string
          external_id?: string | null
          family_id: string
          hidden?: boolean
          id?: string
          name: string
          source?: "manual" | "openholidays"
          starts_on: string
          synced_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_on?: string
          external_id?: string | null
          family_id?: string
          hidden?: boolean
          id?: string
          name?: string
          source?: "manual" | "openholidays"
          starts_on?: string
          synced_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_holidays_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          created_at: string | null
          family_id: string
          id: string
          key: string
          updated_at: string | null
          value: Json
        }
        Insert: {
          created_at?: string | null
          family_id: string
          id?: string
          key: string
          updated_at?: string | null
          value: Json
        }
        Update: {
          created_at?: string | null
          family_id?: string
          id?: string
          key?: string
          updated_at?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "settings_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      shopping_items: {
        Row: {
          added_by: string | null
          bring_checked: boolean | null
          bring_item_id: string | null
          bring_list_id: string | null
          catalog_item_id: string | null
          category: string | null
          checked: boolean | null
          created_at: string | null
          family_id: string
          id: string
          image_url: string | null
          name: string
          notes: string | null
          quantity: number | null
          recipe_id: string | null
          source_device_id: string | null
          unit: string | null
        }
        Insert: {
          added_by?: string | null
          bring_checked?: boolean | null
          bring_item_id?: string | null
          bring_list_id?: string | null
          catalog_item_id?: string | null
          category?: string | null
          checked?: boolean | null
          created_at?: string | null
          family_id: string
          id?: string
          image_url?: string | null
          name: string
          notes?: string | null
          quantity?: number | null
          recipe_id?: string | null
          source_device_id?: string | null
          unit?: string | null
        }
        Update: {
          added_by?: string | null
          bring_checked?: boolean | null
          bring_item_id?: string | null
          bring_list_id?: string | null
          catalog_item_id?: string | null
          category?: string | null
          checked?: boolean | null
          created_at?: string | null
          family_id?: string
          id?: string
          image_url?: string | null
          name?: string
          notes?: string | null
          quantity?: number | null
          recipe_id?: string | null
          source_device_id?: string | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shopping_items_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_items_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "item_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_items_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_items_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_items_source_device_id_fkey"
            columns: ["source_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          color: string
          created_at: string | null
          deleted_at: string | null
          family_id: string
          icon: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          color?: string
          created_at?: string | null
          deleted_at?: string | null
          family_id: string
          icon?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          color?: string
          created_at?: string | null
          deleted_at?: string | null
          family_id?: string
          icon?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subjects_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      system_heartbeats: {
        Row: {
          job: string
          last_run_at: string
        }
        Insert: {
          job: string
          last_run_at?: string
        }
        Update: {
          job?: string
          last_run_at?: string
        }
        Relationships: []
      }
      tickers: {
        Row: {
          asset_type: "stock" | "etf" | "crypto" | "index" | "forex"
          color: string | null
          created_at: string
          family_id: string
          id: string
          nickname: string | null
          position: number
          symbol: string
          updated_at: string
        }
        Insert: {
          asset_type: "stock" | "etf" | "crypto" | "index" | "forex"
          color?: string | null
          created_at?: string
          family_id: string
          id?: string
          nickname?: string | null
          position?: number
          symbol: string
          updated_at?: string
        }
        Update: {
          asset_type?: "stock" | "etf" | "crypto" | "index" | "forex"
          color?: string | null
          created_at?: string
          family_id?: string
          id?: string
          nickname?: string | null
          position?: number
          symbol?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickers_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      timers: {
        Row: {
          created_at: string
          dismissed_at: string | null
          duration_seconds: number
          family_id: string
          finished_at: string | null
          id: string
          label: string | null
          paused_at: string | null
          paused_seconds: number
          started_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dismissed_at?: string | null
          duration_seconds: number
          family_id: string
          finished_at?: string | null
          id?: string
          label?: string | null
          paused_at?: string | null
          paused_seconds?: number
          started_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dismissed_at?: string | null
          duration_seconds?: number
          family_id?: string
          finished_at?: string | null
          id?: string
          label?: string | null
          paused_at?: string | null
          paused_seconds?: number
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timers_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      todo_events: {
        Row: {
          at: string
          day: string | null
          detail: Json
          device_id: string | null
          family_id: string
          id: string
          kind: "created" | "edited" | "completed" | "uncompleted" | "deleted" | "restored"
          person_id: string | null
          todo_id: string | null
        }
        Insert: {
          at?: string
          day?: string | null
          detail?: Json
          device_id?: string | null
          family_id: string
          id?: string
          kind: "created" | "edited" | "completed" | "uncompleted" | "deleted" | "restored"
          person_id?: string | null
          todo_id?: string | null
        }
        Update: {
          at?: string
          day?: string | null
          detail?: Json
          device_id?: string | null
          family_id?: string
          id?: string
          kind?: "created" | "edited" | "completed" | "uncompleted" | "deleted" | "restored"
          person_id?: string | null
          todo_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "todo_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_events_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_events_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_events_todo_id_fkey"
            columns: ["todo_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
        ]
      }
      todo_occurrences: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          day: string
          family_id: string
          id: string
          person_id: string | null
          status: "open" | "done" | "missed"
          todo_id: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          day: string
          family_id: string
          id?: string
          person_id?: string | null
          status: "open" | "done" | "missed"
          todo_id: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          day?: string
          family_id?: string
          id?: string
          person_id?: string | null
          status?: "open" | "done" | "missed"
          todo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "todo_occurrences_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_occurrences_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_occurrences_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_occurrences_todo_id_fkey"
            columns: ["todo_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
        ]
      }
      todo_point_awards: {
        Row: {
          completion_key: string
          created_at: string
          family_id: string
          id: string
          kind: "task" | "adjustment"
          note: string | null
          person_id: string
          points: number
          todo_id: string | null
        }
        Insert: {
          completion_key: string
          created_at?: string
          family_id: string
          id?: string
          kind?: "task" | "adjustment"
          note?: string | null
          person_id: string
          points: number
          todo_id?: string | null
        }
        Update: {
          completion_key?: string
          created_at?: string
          family_id?: string
          id?: string
          kind?: "task" | "adjustment"
          note?: string | null
          person_id?: string
          points?: number
          todo_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "todo_point_awards_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_point_awards_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_point_awards_todo_id_fkey"
            columns: ["todo_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id"]
          },
        ]
      }
      todos: {
        Row: {
          carry_day: string | null
          completed: boolean | null
          created_at: string | null
          deleted_at: string | null
          done_by: string | null
          due_date: string | null
          family_id: string
          icon: string | null
          id: string
          last_completed: string | null
          last_completed_by: string | null
          last_completed_day: string | null
          person_id: string | null
          points: number
          priority: string | null
          recurrence: string | null
          rotation_offset: number
          rotation_person_ids: string[] | null
          schedule_anchor_day: string | null
          schedule_start_day: string | null
          show_in_events: boolean
          source_device_id: string | null
          title: string
          track_completion: boolean
          tracking_started_day: string | null
          updated_at: string | null
        }
        Insert: {
          carry_day?: string | null
          completed?: boolean | null
          created_at?: string | null
          deleted_at?: string | null
          done_by?: string | null
          due_date?: string | null
          family_id: string
          icon?: string | null
          id?: string
          last_completed?: string | null
          last_completed_by?: string | null
          last_completed_day?: string | null
          person_id?: string | null
          points?: number
          priority?: string | null
          recurrence?: string | null
          rotation_offset?: number
          rotation_person_ids?: string[] | null
          schedule_anchor_day?: string | null
          schedule_start_day?: string | null
          show_in_events?: boolean
          source_device_id?: string | null
          title: string
          track_completion?: boolean
          tracking_started_day?: string | null
          updated_at?: string | null
        }
        Update: {
          carry_day?: string | null
          completed?: boolean | null
          created_at?: string | null
          deleted_at?: string | null
          done_by?: string | null
          due_date?: string | null
          family_id?: string
          icon?: string | null
          id?: string
          last_completed?: string | null
          last_completed_by?: string | null
          last_completed_day?: string | null
          person_id?: string | null
          points?: number
          priority?: string | null
          recurrence?: string | null
          rotation_offset?: number
          rotation_person_ids?: string[] | null
          schedule_anchor_day?: string | null
          schedule_start_day?: string | null
          show_in_events?: boolean
          source_device_id?: string | null
          title?: string
          track_completion?: boolean
          tracking_started_day?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "todos_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todos_last_completed_by_fkey"
            columns: ["last_completed_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todos_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todos_source_device_id_fkey"
            columns: ["source_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          color: string | null
          config: Json
          created_at: string
          family_id: string
          id: string
          image_url: string | null
          nickname: string
          position: number
          updated_at: string
          vendor: "tesla" | "generic-ev"
        }
        Insert: {
          color?: string | null
          config?: Json
          created_at?: string
          family_id: string
          id?: string
          image_url?: string | null
          nickname: string
          position?: number
          updated_at?: string
          vendor: "tesla" | "generic-ev"
        }
        Update: {
          color?: string | null
          config?: Json
          created_at?: string
          family_id?: string
          id?: string
          image_url?: string | null
          nickname?: string
          position?: number
          updated_at?: string
          vendor?: "tesla" | "generic-ev"
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      accrue_pocket_money_interest: {
        Args: {
          p_account_id: string
          p_add_cents: number
          p_carry_micros: number
          p_today: string
        }
        Returns: boolean
      }
      adjust_person_points: {
        Args: {
          p_family_id: string
          p_person_id: string
          p_points: number
          p_note?: string
        }
        Returns: Json
      }
      apply_school_holiday_sync: {
        Args: {
          p_family_id: string
          p_rows: Json
          p_window_from: string
          p_window_to: string
          p_replace: boolean
          p_expect_region: string
          p_expect_group: string
          p_synced_at: string
          p_language: string
        }
        Returns: Json
      }
      book_pocket_money: {
        Args: {
          p_family_id: string
          p_account_id: string
          p_amount_cents: number
          p_type: string
          p_note?: string
          p_related_goal_id?: string
          p_created_by_person_id?: string
        }
        Returns: Json
      }
      close_todo_days: {
        Args: {
          p_fallback_tz?: string
        }
        Returns: number
      }
      commit_pocket_money_interest: {
        Args: {
          p_account_id: string
          p_note?: string
        }
        Returns: Json
      }
      creatures_from_accounts: {
        Args: {
          p_family_id?: string
        }
        Returns: number
      }
      current_family_id: {
        Args: never
        Returns: string
      }
      decide_pocket_money_withdrawal: {
        Args: {
          p_family_id: string
          p_request_id: string
          p_decision: string
          p_person_id?: string
        }
        Returns: Json
      }
      decide_point_redemption: {
        Args: {
          p_family_id: string
          p_redemption_id: string
          p_decision: string
          p_device_id?: string
        }
        Returns: Json
      }
      delete_family: {
        Args: {
          p_family_id: string
        }
        Returns: boolean
      }
      emit_domain_event: {
        Args: {
          p_family_id: string
          p_event_type: string
          p_payload?: Json
          p_version?: number
        }
        Returns: number
      }
      event_series_end: {
        Args: {
          p_series_id: string
          p_calendar_id: string
          p_last_day: string
          p_rule: string
          p_occurrence: Json
        }
        Returns: Json
      }
      event_series_write: {
        Args: {
          p_series_id: string
          p_calendar_id: string
          p_revision: number
          p_template: Json
          p_fields: Json
          p_cut_day: string
          p_shift: number
          p_until_day: string
          p_rows: Json
        }
        Returns: Json
      }
      family_time_zone: {
        Args: {
          p_family: string
          p_fallback?: string
        }
        Returns: string
      }
      family_today: {
        Args: {
          p_family: string
          p_fallback?: string
        }
        Returns: string
      }
      generate_join_code: {
        Args: never
        Returns: string
      }
      get_upcoming_birthdays: {
        Args: {
          p_family_id: string
          p_days?: number
        }
        Returns: {
          id: string
          name: string
          date: string
          days_until: number
          age: number
        }[]
      }
      pay_pocket_money_allowance: {
        Args: {
          p_account_id: string
          p_amount_cents: number
          p_note: string
          p_expected_last: string
        }
        Returns: Json
      }
      point_account_totals: {
        Args: {
          p_family_id: string
          p_account_id: string
        }
        Returns: Json
      }
      point_lock_person: {
        Args: {
          p_person_id: string
        }
        Returns: undefined
      }
      point_person_totals: {
        Args: {
          p_family_id: string
          p_person_id: string
        }
        Returns: Json
      }
      purchase_person_point_item: {
        Args: {
          p_family_id: string
          p_person_id: string
          p_item_id: string
          p_cost: number
        }
        Returns: Json
      }
      purge_deleted: {
        Args: {
          p_table: string
          p_id: string
        }
        Returns: number
      }
      purge_domain_events: {
        Args: {
          p_keep_days?: number
        }
        Returns: number
      }
      purge_expired: {
        Args: never
        Returns: number
      }
      purge_integration_idempotency: {
        Args: {
          p_keep_hours?: number
        }
        Returns: number
      }
      purge_todo_events: {
        Args: never
        Returns: number
      }
      record_school_holiday_sync_error: {
        Args: {
          p_family_id: string
          p_at: string
          p_error: string
          p_expect_region: string
          p_expect_group: string
        }
        Returns: boolean
      }
      refund_person_point_purchase: {
        Args: {
          p_family_id: string
          p_purchase_id: string
        }
        Returns: Json
      }
      relative_storage_url: {
        Args: {
          p_url: string
        }
        Returns: string
      }
      remove_person_point_adjustment: {
        Args: {
          p_family_id: string
          p_adjustment_id: string
        }
        Returns: Json
      }
      request_person_point_redemption: {
        Args: {
          p_family_id: string
          p_person_id: string
          p_reward_id: string
          p_device_id?: string
        }
        Returns: Json
      }
      request_point_redemption: {
        Args: {
          p_family_id: string
          p_account_id: string
          p_reward_id: string
          p_device_id?: string
        }
        Returns: Json
      }
      school_holiday_sync_unset_families: {
        Args: never
        Returns: {
          family_id: string
          holiday_region: string
        }[]
      }
      todo_actor: {
        Args: {
          p_family: string
        }
        Returns: {
          device_id: string
          source: string
        }
      }
      todo_clean_rotation: {
        Args: {
          p_family: string
          p_ids: string[]
        }
        Returns: string[]
      }
      todo_close_days: {
        Args: {
          t: Database["public"]["Tables"]["todos"]["Row"]
          p_today: string
        }
        Returns: number
      }
      todo_current_day: {
        Args: {
          t: Database["public"]["Tables"]["todos"]["Row"]
          p_today: string
        }
        Returns: string
      }
      todo_due_index: {
        Args: {
          p_recurrence: string
          p_start: string
          p_day: string
          p_anchor?: string
        }
        Returns: number
      }
      todo_first_due_day: {
        Args: {
          p_recurrence: string
          p_phase: string
          p_from: string
        }
        Returns: string
      }
      todo_interval_days: {
        Args: {
          p_recurrence: string
        }
        Returns: number
      }
      todo_is_due_day: {
        Args: {
          p_recurrence: string
          p_start: string
          p_day: string
          p_anchor?: string
        }
        Returns: boolean
      }
      todo_keeps_schedule: {
        Args: {
          p_recurrence: string
          p_rotation: string[]
          p_track: boolean
        }
        Returns: boolean
      }
      todo_log: {
        Args: {
          t: Database["public"]["Tables"]["todos"]["Row"]
          p_kind: string
          p_person?: string
          p_day?: string
          p_extra?: Json
        }
        Returns: undefined
      }
      todo_month_day: {
        Args: {
          p_anchor: string
          p_k: number
        }
        Returns: string
      }
      todo_months_from: {
        Args: {
          p_anchor: string
          p_day: string
        }
        Returns: number
      }
      todo_next_turn_index: {
        Args: {
          p_old: string[]
          p_new: string[]
          p_last: string
        }
        Returns: number
      }
      todo_prev_due_day: {
        Args: {
          p_recurrence: string
          p_start: string
          p_day: string
          p_anchor?: string
        }
        Returns: string
      }
      todo_turn_person: {
        Args: {
          t: Database["public"]["Tables"]["todos"]["Row"]
          p_day: string
        }
        Returns: string
      }
      todo_weekdays: {
        Args: {
          p_recurrence: string
        }
        Returns: number[]
      }
      uri_decode_or_null: {
        Args: {
          p: string
        }
        Returns: string
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
