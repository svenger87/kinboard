import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFamilyStore } from "@/stores/family-store";
import { safeRandomUUID } from "@/lib/uuid";
import type {
  HomeAssistantSettings,
  HAEntity,
  DashboardCard,
  Dashboard,
  HAServiceCall,
  EnergyConfig,
  TeslaConfig,
  EntityHistory,
  StatisticsPeriod,
} from "@/types/home-assistant";

// ============================================================================
// Connection & Status Hooks
// ============================================================================

// Hook to get Home Assistant connection status and settings
export function useHomeAssistantStatus() {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["home-assistant-status", family?.id],
    queryFn: async (): Promise<HomeAssistantSettings | null> => {
      if (!family?.id) return null;

      try {
        const response = await fetch(`/api/settings?family_id=${family.id}&key=home_assistant`);
        if (!response.ok) {
          if (response.status === 404) return null;
          throw new Error("Failed to fetch Home Assistant status");
        }
        const data = await response.json();
        const settings = data.value as HomeAssistantSettings | null;

        // Migrate legacy dashboard_cards to dashboards if needed
        if (settings && !settings.dashboards && settings.dashboard_cards?.length) {
          settings.dashboards = [{
            id: "default",
            name: "Dashboard",
            type: "custom",
            cards: settings.dashboard_cards,
            position: 0,
            created_at: new Date().toISOString(),
          }];
        } else if (settings && !settings.dashboards) {
          settings.dashboards = [];
        }

        return settings;
      } catch (error) {
        console.warn("[HomeAssistant] Status fetch error:", error);
        return null;
      }
    },
    enabled: !!family?.id,
    retry: false,
    staleTime: 30000,
  });
}

// Hook to get Home Assistant config (tests connection)
export function useHomeAssistantConfig(isConnected?: boolean) {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["home-assistant-config", family?.id],
    queryFn: async () => {
      if (!family?.id) return null;

      try {
        const response = await fetch(`/api/homeassistant?family_id=${family.id}`);
        if (!response.ok) {
          if (response.status === 401) return null;
          throw new Error("Failed to fetch Home Assistant config");
        }
        return response.json();
      } catch (error) {
        console.warn("[HomeAssistant] Config fetch error:", error);
        return null;
      }
    },
    enabled: !!family?.id && isConnected !== false,
    retry: false,
    staleTime: 60000,
  });
}

// Hook to test Home Assistant connection before saving
export function useTestHomeAssistantConnection() {
  return useMutation({
    mutationFn: async (settings: { url: string; access_token: string }) => {
      const response = await fetch("/api/homeassistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Connection failed");
      }

      return response.json();
    },
  });
}

// Hook to save Home Assistant settings
export function useSaveHomeAssistantSettings() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (settings: Partial<HomeAssistantSettings>) => {
      if (!family?.id) throw new Error("No family");

      // Get existing settings first
      const existingResponse = await fetch(`/api/settings?family_id=${family.id}&key=home_assistant`);
      let existingSettings: HomeAssistantSettings = {
        url: "",
        access_token: "",
        dashboards: [],
      };

      if (existingResponse.ok) {
        const data = await existingResponse.json();
        if (data.value) {
          existingSettings = data.value;
          // Ensure dashboards array exists
          if (!existingSettings.dashboards) {
            existingSettings.dashboards = [];
          }
        }
      }

      // Merge with new settings
      const newSettings: HomeAssistantSettings = {
        ...existingSettings,
        ...settings,
        last_connected: new Date().toISOString(),
      };

      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_id: family.id,
          key: "home_assistant",
          value: newSettings,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save Home Assistant settings");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["home-assistant-status", family?.id] });
      queryClient.invalidateQueries({ queryKey: ["home-assistant-config", family?.id] });
      queryClient.invalidateQueries({ queryKey: ["home-assistant-entities", family?.id] });
    },
  });
}

// Hook to disconnect Home Assistant
export function useDisconnectHomeAssistant() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async () => {
      if (!family?.id) throw new Error("No family");

      const response = await fetch("/api/settings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_id: family.id,
          key: "home_assistant",
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to disconnect");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["home-assistant-status", family?.id] });
      queryClient.invalidateQueries({ queryKey: ["home-assistant-config", family?.id] });
      queryClient.invalidateQueries({ queryKey: ["home-assistant-entities", family?.id] });
    },
  });
}

// ============================================================================
// Entity Hooks
// ============================================================================

// Hook to fetch Home Assistant entities
export function useHomeAssistantEntities(domain?: string, isConnected?: boolean) {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["home-assistant-entities", family?.id, domain],
    queryFn: async (): Promise<HAEntity[]> => {
      if (!family?.id) return [];

      try {
        const params = new URLSearchParams({ family_id: family.id });
        if (domain) params.append("domain", domain);

        const response = await fetch(`/api/homeassistant/states?${params}`);
        if (!response.ok) {
          if (response.status === 401) return [];
          throw new Error("Failed to fetch entities");
        }
        const data = await response.json();
        return data.entities;
      } catch (error) {
        console.warn("[HomeAssistant] Entities fetch error:", error);
        return [];
      }
    },
    enabled: !!family?.id && isConnected !== false,
    retry: false,
    staleTime: 30000,
    refetchInterval: isConnected ? 60000 : false, // 60 seconds - reduced for performance
  });
}

// Hook to fetch specific entities by ID
export function useHomeAssistantEntityStates(entityIds: string[], isConnected?: boolean) {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["home-assistant-entity-states", family?.id, entityIds],
    queryFn: async (): Promise<HAEntity[]> => {
      if (!family?.id || entityIds.length === 0) return [];

      try {
        const params = new URLSearchParams({
          family_id: family.id,
          entity_ids: entityIds.join(","),
        });

        const response = await fetch(`/api/homeassistant/states?${params}`);
        if (!response.ok) {
          if (response.status === 401) return [];
          throw new Error("Failed to fetch entity states");
        }
        const data = await response.json();
        return data.entities;
      } catch (error) {
        console.warn("[HomeAssistant] Entity states fetch error:", error);
        return [];
      }
    },
    enabled: !!family?.id && entityIds.length > 0 && isConnected !== false,
    retry: false,
    staleTime: 15000,
    refetchInterval: isConnected ? 30000 : false, // 30 seconds - reduced for performance
  });
}

// ============================================================================
// Dashboard Management Hooks
// ============================================================================

// Hook to get all dashboards
export function useDashboards() {
  const { data: status, isLoading } = useHomeAssistantStatus();
  return {
    data: status?.dashboards || [],
    isLoading,
  };
}

// Hook to get a specific dashboard by ID
export function useDashboard(dashboardId: string | undefined) {
  const { data: dashboards } = useDashboards();
  return dashboards.find((d) => d.id === dashboardId);
}

// Hook to create a new dashboard
export function useCreateDashboard() {
  const { family } = useFamilyStore();
  const { mutateAsync: saveSettings } = useSaveHomeAssistantSettings();

  return useMutation({
    mutationFn: async (dashboard: Omit<Dashboard, "id" | "position" | "created_at" | "cards">) => {
      const statusResponse = await fetch(`/api/settings?family_id=${family?.id}&key=home_assistant`);
      let settings: HomeAssistantSettings = {
        url: "",
        access_token: "",
        dashboards: [],
      };

      if (statusResponse.ok) {
        const data = await statusResponse.json();
        if (data.value) {
          settings = data.value;
          if (!settings.dashboards) settings.dashboards = [];
        }
      }

      const newDashboard: Dashboard = {
        ...dashboard,
        id: safeRandomUUID(),
        cards: [],
        position: settings.dashboards.length,
        created_at: new Date().toISOString(),
      };

      await saveSettings({
        dashboards: [...settings.dashboards, newDashboard],
      });

      return newDashboard;
    },
  });
}

// Hook to update a dashboard
export function useUpdateDashboard() {
  const { family } = useFamilyStore();
  const { mutateAsync: saveSettings } = useSaveHomeAssistantSettings();

  return useMutation({
    mutationFn: async ({ dashboardId, updates }: { dashboardId: string; updates: Partial<Dashboard> }) => {
      const statusResponse = await fetch(`/api/settings?family_id=${family?.id}&key=home_assistant`);
      if (!statusResponse.ok) throw new Error("Failed to get settings");

      const data = await statusResponse.json();
      const settings = data.value as HomeAssistantSettings;
      if (!settings.dashboards) settings.dashboards = [];

      const updatedDashboards = settings.dashboards.map((d) =>
        d.id === dashboardId ? { ...d, ...updates } : d
      );

      await saveSettings({ dashboards: updatedDashboards });
    },
  });
}

// Hook to delete a dashboard
export function useDeleteDashboard() {
  const { family } = useFamilyStore();
  const { mutateAsync: saveSettings } = useSaveHomeAssistantSettings();

  return useMutation({
    mutationFn: async (dashboardId: string) => {
      const statusResponse = await fetch(`/api/settings?family_id=${family?.id}&key=home_assistant`);
      if (!statusResponse.ok) throw new Error("Failed to get settings");

      const data = await statusResponse.json();
      const settings = data.value as HomeAssistantSettings;
      if (!settings.dashboards) settings.dashboards = [];

      const updatedDashboards = settings.dashboards
        .filter((d) => d.id !== dashboardId)
        .map((d, index) => ({ ...d, position: index }));

      await saveSettings({ dashboards: updatedDashboards });
    },
  });
}

// Hook to reorder dashboards
export function useReorderDashboards() {
  const { family } = useFamilyStore();
  const { mutateAsync: saveSettings } = useSaveHomeAssistantSettings();

  return useMutation({
    mutationFn: async (dashboardIds: string[]) => {
      const statusResponse = await fetch(`/api/settings?family_id=${family?.id}&key=home_assistant`);
      if (!statusResponse.ok) throw new Error("Failed to get settings");

      const data = await statusResponse.json();
      const settings = data.value as HomeAssistantSettings;
      if (!settings.dashboards) settings.dashboards = [];

      const dashboardMap = new Map(settings.dashboards.map((d) => [d.id, d]));
      const reorderedDashboards = dashboardIds
        .map((id, index) => {
          const dashboard = dashboardMap.get(id);
          return dashboard ? { ...dashboard, position: index } : null;
        })
        .filter((d): d is Dashboard => d !== null);

      await saveSettings({ dashboards: reorderedDashboards });
    },
  });
}

// ============================================================================
// Dashboard Card Hooks (for specific dashboard)
// ============================================================================

// Hook to add a card to a specific dashboard
export function useAddCardToDashboard() {
  const { family } = useFamilyStore();
  const { mutateAsync: saveSettings } = useSaveHomeAssistantSettings();

  return useMutation({
    mutationFn: async ({ dashboardId, card }: { dashboardId: string; card: Omit<DashboardCard, "id" | "position"> }) => {
      const statusResponse = await fetch(`/api/settings?family_id=${family?.id}&key=home_assistant`);
      if (!statusResponse.ok) throw new Error("Failed to get settings");

      const data = await statusResponse.json();
      const settings = data.value as HomeAssistantSettings;
      if (!settings.dashboards) settings.dashboards = [];

      const dashboard = settings.dashboards.find((d) => d.id === dashboardId);
      if (!dashboard) throw new Error("Dashboard not found");

      // Check if entity already exists in this dashboard
      if (dashboard.cards.some((c) => c.entity_id === card.entity_id)) {
        throw new Error("Entity already on dashboard");
      }

      const newCard: DashboardCard = {
        ...card,
        id: safeRandomUUID(),
        position: dashboard.cards.length,
      };

      const updatedDashboards = settings.dashboards.map((d) =>
        d.id === dashboardId ? { ...d, cards: [...d.cards, newCard] } : d
      );

      await saveSettings({ dashboards: updatedDashboards });
      return newCard;
    },
  });
}

// Hook to remove a card from a dashboard
export function useRemoveCardFromDashboard() {
  const { family } = useFamilyStore();
  const { mutateAsync: saveSettings } = useSaveHomeAssistantSettings();

  return useMutation({
    mutationFn: async ({ dashboardId, cardId }: { dashboardId: string; cardId: string }) => {
      const statusResponse = await fetch(`/api/settings?family_id=${family?.id}&key=home_assistant`);
      if (!statusResponse.ok) throw new Error("Failed to get settings");

      const data = await statusResponse.json();
      const settings = data.value as HomeAssistantSettings;
      if (!settings.dashboards) settings.dashboards = [];

      const updatedDashboards = settings.dashboards.map((d) => {
        if (d.id !== dashboardId) return d;
        const updatedCards = d.cards
          .filter((c) => c.id !== cardId)
          .map((c, index) => ({ ...c, position: index }));
        return { ...d, cards: updatedCards };
      });

      await saveSettings({ dashboards: updatedDashboards });
    },
  });
}

// Hook to update a card in a dashboard
export function useUpdateCardInDashboard() {
  const { family } = useFamilyStore();
  const { mutateAsync: saveSettings } = useSaveHomeAssistantSettings();

  return useMutation({
    mutationFn: async ({
      dashboardId,
      cardId,
      updates,
    }: {
      dashboardId: string;
      cardId: string;
      updates: Partial<DashboardCard>;
    }) => {
      const statusResponse = await fetch(`/api/settings?family_id=${family?.id}&key=home_assistant`);
      if (!statusResponse.ok) throw new Error("Failed to get settings");

      const data = await statusResponse.json();
      const settings = data.value as HomeAssistantSettings;
      if (!settings.dashboards) settings.dashboards = [];

      const updatedDashboards = settings.dashboards.map((d) => {
        if (d.id !== dashboardId) return d;
        const updatedCards = d.cards.map((c) =>
          c.id === cardId ? { ...c, ...updates } : c
        );
        return { ...d, cards: updatedCards };
      });

      await saveSettings({ dashboards: updatedDashboards });
    },
  });
}

// Hook to reorder cards in a dashboard
export function useReorderCardsInDashboard() {
  const { family } = useFamilyStore();
  const { mutateAsync: saveSettings } = useSaveHomeAssistantSettings();

  return useMutation({
    mutationFn: async ({ dashboardId, cardIds }: { dashboardId: string; cardIds: string[] }) => {
      const statusResponse = await fetch(`/api/settings?family_id=${family?.id}&key=home_assistant`);
      if (!statusResponse.ok) throw new Error("Failed to get settings");

      const data = await statusResponse.json();
      const settings = data.value as HomeAssistantSettings;
      if (!settings.dashboards) settings.dashboards = [];

      const updatedDashboards = settings.dashboards.map((d) => {
        if (d.id !== dashboardId) return d;
        const cardMap = new Map(d.cards.map((c) => [c.id, c]));
        const reorderedCards = cardIds
          .map((id, index) => {
            const card = cardMap.get(id);
            return card ? { ...card, position: index } : null;
          })
          .filter((c): c is DashboardCard => c !== null);
        return { ...d, cards: reorderedCards };
      });

      await saveSettings({ dashboards: updatedDashboards });
    },
  });
}

// ============================================================================
// Legacy Dashboard Card Hooks (for backwards compatibility)
// ============================================================================

// Hook to get dashboard cards (from first dashboard or legacy)
export function useDashboardCards() {
  const { data: status } = useHomeAssistantStatus();
  // Return cards from first dashboard or legacy dashboard_cards
  if (status?.dashboards?.length) {
    return status.dashboards[0].cards;
  }
  return status?.dashboard_cards || [];
}

// Legacy hook to add a card (adds to first dashboard)
export function useAddDashboardCard() {
  const addCard = useAddCardToDashboard();
  const { data: status } = useHomeAssistantStatus();
  const createDashboard = useCreateDashboard();

  return useMutation({
    mutationFn: async (card: Omit<DashboardCard, "id" | "position">) => {
      let dashboardId = status?.dashboards?.[0]?.id;

      // Create default dashboard if none exists
      if (!dashboardId) {
        const newDashboard = await createDashboard.mutateAsync({
          name: "Dashboard",
          type: "custom",
        });
        dashboardId = newDashboard.id;
      }

      return addCard.mutateAsync({ dashboardId, card });
    },
  });
}

// Legacy hook to remove a card (removes from first dashboard)
export function useRemoveDashboardCard() {
  const removeCard = useRemoveCardFromDashboard();
  const { data: status } = useHomeAssistantStatus();

  return useMutation({
    mutationFn: async (cardId: string) => {
      const dashboardId = status?.dashboards?.[0]?.id;
      if (!dashboardId) throw new Error("No dashboard found");
      return removeCard.mutateAsync({ dashboardId, cardId });
    },
  });
}

// Legacy hook to update a card
export function useUpdateDashboardCard() {
  const updateCard = useUpdateCardInDashboard();
  const { data: status } = useHomeAssistantStatus();

  return useMutation({
    mutationFn: async ({ cardId, updates }: { cardId: string; updates: Partial<DashboardCard> }) => {
      const dashboardId = status?.dashboards?.[0]?.id;
      if (!dashboardId) throw new Error("No dashboard found");
      return updateCard.mutateAsync({ dashboardId, cardId, updates });
    },
  });
}

// Legacy hook to reorder cards
export function useReorderDashboardCards() {
  const reorderCards = useReorderCardsInDashboard();
  const { data: status } = useHomeAssistantStatus();

  return useMutation({
    mutationFn: async (cardIds: string[]) => {
      const dashboardId = status?.dashboards?.[0]?.id;
      if (!dashboardId) throw new Error("No dashboard found");
      return reorderCards.mutateAsync({ dashboardId, cardIds });
    },
  });
}

// ============================================================================
// Energy Configuration Hooks
// ============================================================================

// Hook to get energy configuration
export function useEnergyConfig() {
  const { data: status } = useHomeAssistantStatus();
  return status?.energy_config;
}

// Hook to save energy configuration
export function useSaveEnergyConfig() {
  const { mutateAsync: saveSettings } = useSaveHomeAssistantSettings();

  return useMutation({
    mutationFn: async (config: EnergyConfig) => {
      await saveSettings({ energy_config: config });
    },
  });
}

// ============================================================================
// Tesla Configuration Hooks
// ============================================================================

// Hook to get Tesla configuration
export function useTeslaConfig() {
  const { data: status } = useHomeAssistantStatus();
  return status?.tesla_config;
}

// Hook to save Tesla configuration
export function useSaveTeslaConfig() {
  const { mutateAsync: saveSettings } = useSaveHomeAssistantSettings();

  return useMutation({
    mutationFn: async (config: TeslaConfig) => {
      await saveSettings({ tesla_config: config });
    },
  });
}

// ============================================================================
// History & Statistics Hooks
// ============================================================================

// Hook to fetch history for a single entity
export function useEntityHistory(
  entityId: string | undefined,
  startTime: string,
  endTime?: string,
  options?: { enabled?: boolean }
) {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["home-assistant-history", family?.id, entityId, startTime, endTime],
    queryFn: async (): Promise<EntityHistory | null> => {
      if (!family?.id || !entityId) return null;

      const params = new URLSearchParams({
        family_id: family.id,
        entity_ids: entityId,
        start_time: startTime,
      });
      if (endTime) params.append("end_time", endTime);

      const response = await fetch(`/api/homeassistant/history?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch history");
      }

      const data = await response.json();
      return data.histories?.[0] || null;
    },
    enabled: !!family?.id && !!entityId && options?.enabled !== false,
    staleTime: 60000, // 1 minute
    retry: false,
  });
}

// Hook to fetch history for multiple entities
export function useMultiEntityHistory(
  entityIds: string[],
  startTime: string,
  endTime?: string,
  options?: { enabled?: boolean; significantChangesOnly?: boolean }
) {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["home-assistant-history-multi", family?.id, entityIds, startTime, endTime, options?.significantChangesOnly],
    queryFn: async (): Promise<EntityHistory[]> => {
      if (!family?.id || entityIds.length === 0) return [];

      const params = new URLSearchParams({
        family_id: family.id,
        entity_ids: entityIds.join(","),
        start_time: startTime,
      });
      if (endTime) params.append("end_time", endTime);
      if (options?.significantChangesOnly) params.append("significant_changes_only", "true");

      const response = await fetch(`/api/homeassistant/history?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch history");
      }

      const data = await response.json();
      return data.histories || [];
    },
    enabled: !!family?.id && entityIds.length > 0 && options?.enabled !== false,
    staleTime: 60000,
    refetchInterval: 60000, // Refetch every minute
    retry: false,
  });
}

// Hook to fetch statistics for an entity
export function useEntityStatistics(
  entityId: string | undefined,
  period: "5minute" | "hour" | "day" | "week" | "month",
  startTime: string,
  endTime?: string,
  options?: { enabled?: boolean }
) {
  const { family } = useFamilyStore();

  return useQuery({
    queryKey: ["home-assistant-statistics", family?.id, entityId, period, startTime, endTime],
    queryFn: async (): Promise<StatisticsPeriod[] | null> => {
      if (!family?.id || !entityId) return null;

      const params = new URLSearchParams({
        family_id: family.id,
        statistic_ids: entityId,
        period,
        start_time: startTime,
      });
      if (endTime) params.append("end_time", endTime);

      const response = await fetch(`/api/homeassistant/statistics?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch statistics");
      }

      const data = await response.json();
      return data.statistics?.[entityId] || [];
    },
    enabled: !!family?.id && !!entityId && options?.enabled !== false,
    staleTime: 300000, // 5 minutes
    retry: false,
  });
}

// Hook to fetch energy statistics (multiple entities at once)
export function useEnergyStatistics(
  config: EnergyConfig | undefined,
  period: "5minute" | "hour" | "day" | "week" | "month",
  startTime: string,
  endTime?: string
) {
  const { family } = useFamilyStore();

  // Collect all configured entity IDs
  const entityIds = config
    ? [
        config.solar_power,
        config.solar_energy_today,
        config.battery_power,
        config.battery_soc,
        config.battery_energy_in,
        config.battery_energy_out,
        config.grid_power,
        config.grid_import,
        config.grid_export,
        config.home_consumption,
      ].filter((id): id is string => !!id)
    : [];

  return useQuery({
    queryKey: ["home-assistant-energy-statistics", family?.id, entityIds, period, startTime, endTime],
    queryFn: async (): Promise<Record<string, StatisticsPeriod[]>> => {
      if (!family?.id || entityIds.length === 0) return {};

      const params = new URLSearchParams({
        family_id: family.id,
        statistic_ids: entityIds.join(","),
        period,
        start_time: startTime,
      });
      if (endTime) params.append("end_time", endTime);

      const response = await fetch(`/api/homeassistant/statistics?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch energy statistics");
      }

      const data = await response.json();
      return data.statistics || {};
    },
    enabled: !!family?.id && entityIds.length > 0 && !!config,
    staleTime: 300000,
    retry: false,
  });
}

// ============================================================================
// Service Call Hooks
// ============================================================================

// Hook to call Home Assistant service
export function useCallService() {
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (serviceCall: HAServiceCall) => {
      if (!family?.id) throw new Error("No family");

      const response = await fetch("/api/homeassistant/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_id: family.id,
          ...serviceCall,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Service call failed");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["home-assistant-entities", family?.id] });
      queryClient.invalidateQueries({ queryKey: ["home-assistant-entity-states", family?.id] });
    },
  });
}

// Convenience hook to toggle a switch/light
export function useToggleEntity() {
  const { mutateAsync: callService, isPending } = useCallService();

  const toggle = async (entityId: string, currentState: string) => {
    const domain = entityId.split(".")[0];
    const service = currentState === "on" ? "turn_off" : "turn_on";

    await callService({
      domain,
      service,
      entity_id: entityId,
    });
  };

  return { toggle, isPending };
}

// Convenience hook for vacuum commands
export function useVacuumCommand() {
  const { mutateAsync: callService, isPending } = useCallService();

  const start = async (entityId: string) => {
    await callService({ domain: "vacuum", service: "start", entity_id: entityId });
  };

  const pause = async (entityId: string) => {
    await callService({ domain: "vacuum", service: "pause", entity_id: entityId });
  };

  const stop = async (entityId: string) => {
    await callService({ domain: "vacuum", service: "stop", entity_id: entityId });
  };

  const returnToBase = async (entityId: string) => {
    await callService({ domain: "vacuum", service: "return_to_base", entity_id: entityId });
  };

  const setFanSpeed = async (entityId: string, fanSpeed: string) => {
    await callService({
      domain: "vacuum",
      service: "set_fan_speed",
      entity_id: entityId,
      service_data: { fan_speed: fanSpeed },
    });
  };

  return { start, pause, stop, returnToBase, setFanSpeed, isPending };
}

// Convenience hook for light control
export function useLightControl() {
  const { mutateAsync: callService, isPending } = useCallService();

  const turnOn = async (entityId: string, options?: { brightness?: number; color_temp?: number }) => {
    await callService({
      domain: "light",
      service: "turn_on",
      entity_id: entityId,
      service_data: options,
    });
  };

  const turnOff = async (entityId: string) => {
    await callService({ domain: "light", service: "turn_off", entity_id: entityId });
  };

  const setBrightness = async (entityId: string, brightness: number) => {
    await callService({
      domain: "light",
      service: "turn_on",
      entity_id: entityId,
      service_data: { brightness },
    });
  };

  const setColorTemp = async (entityId: string, colorTempKelvin: number) => {
    await callService({
      domain: "light",
      service: "turn_on",
      entity_id: entityId,
      service_data: { color_temp_kelvin: colorTempKelvin },
    });
  };

  return { turnOn, turnOff, setBrightness, setColorTemp, isPending };
}

// Convenience hook for cover control
export function useCoverControl() {
  const { mutateAsync: callService, isPending } = useCallService();

  const open = async (entityId: string) => {
    await callService({ domain: "cover", service: "open_cover", entity_id: entityId });
  };

  const close = async (entityId: string) => {
    await callService({ domain: "cover", service: "close_cover", entity_id: entityId });
  };

  const stop = async (entityId: string) => {
    await callService({ domain: "cover", service: "stop_cover", entity_id: entityId });
  };

  const setPosition = async (entityId: string, position: number) => {
    await callService({
      domain: "cover",
      service: "set_cover_position",
      entity_id: entityId,
      service_data: { position },
    });
  };

  return { open, close, stop, setPosition, isPending };
}

// Convenience hook for media player control
export function useMediaPlayerControl() {
  const { mutateAsync: callService, isPending } = useCallService();

  const play = async (entityId: string) => {
    await callService({ domain: "media_player", service: "media_play", entity_id: entityId });
  };

  const pause = async (entityId: string) => {
    await callService({ domain: "media_player", service: "media_pause", entity_id: entityId });
  };

  const stop = async (entityId: string) => {
    await callService({ domain: "media_player", service: "media_stop", entity_id: entityId });
  };

  const next = async (entityId: string) => {
    await callService({ domain: "media_player", service: "media_next_track", entity_id: entityId });
  };

  const previous = async (entityId: string) => {
    await callService({ domain: "media_player", service: "media_previous_track", entity_id: entityId });
  };

  const setVolume = async (entityId: string, volume: number) => {
    await callService({
      domain: "media_player",
      service: "volume_set",
      entity_id: entityId,
      service_data: { volume_level: volume },
    });
  };

  const mute = async (entityId: string, mute: boolean) => {
    await callService({
      domain: "media_player",
      service: "volume_mute",
      entity_id: entityId,
      service_data: { is_volume_muted: mute },
    });
  };

  const selectSource = async (entityId: string, source: string) => {
    await callService({
      domain: "media_player",
      service: "select_source",
      entity_id: entityId,
      service_data: { source },
    });
  };

  return { play, pause, stop, next, previous, setVolume, mute, selectSource, isPending };
}

// Convenience hook for lock control
export function useLockControl() {
  const { mutateAsync: callService, isPending } = useCallService();

  const lock = async (entityId: string) => {
    await callService({ domain: "lock", service: "lock", entity_id: entityId });
  };

  const unlock = async (entityId: string) => {
    await callService({ domain: "lock", service: "unlock", entity_id: entityId });
  };

  return { lock, unlock, isPending };
}

// Convenience hook for fan control
export function useFanControl() {
  const { mutateAsync: callService, isPending } = useCallService();

  const turnOn = async (entityId: string) => {
    await callService({ domain: "fan", service: "turn_on", entity_id: entityId });
  };

  const turnOff = async (entityId: string) => {
    await callService({ domain: "fan", service: "turn_off", entity_id: entityId });
  };

  const setSpeed = async (entityId: string, percentage: number) => {
    await callService({
      domain: "fan",
      service: "set_percentage",
      entity_id: entityId,
      service_data: { percentage },
    });
  };

  const setOscillating = async (entityId: string, oscillating: boolean) => {
    await callService({
      domain: "fan",
      service: "oscillate",
      entity_id: entityId,
      service_data: { oscillating },
    });
  };

  const setPresetMode = async (entityId: string, presetMode: string) => {
    await callService({
      domain: "fan",
      service: "set_preset_mode",
      entity_id: entityId,
      service_data: { preset_mode: presetMode },
    });
  };

  return { turnOn, turnOff, setSpeed, setOscillating, setPresetMode, isPending };
}

// Convenience hook for alarm panel control
export function useAlarmControl() {
  const { mutateAsync: callService, isPending } = useCallService();

  const disarm = async (entityId: string, code?: string) => {
    await callService({
      domain: "alarm_control_panel",
      service: "alarm_disarm",
      entity_id: entityId,
      service_data: code ? { code } : undefined,
    });
  };

  const armHome = async (entityId: string, code?: string) => {
    await callService({
      domain: "alarm_control_panel",
      service: "alarm_arm_home",
      entity_id: entityId,
      service_data: code ? { code } : undefined,
    });
  };

  const armAway = async (entityId: string, code?: string) => {
    await callService({
      domain: "alarm_control_panel",
      service: "alarm_arm_away",
      entity_id: entityId,
      service_data: code ? { code } : undefined,
    });
  };

  const armNight = async (entityId: string, code?: string) => {
    await callService({
      domain: "alarm_control_panel",
      service: "alarm_arm_night",
      entity_id: entityId,
      service_data: code ? { code } : undefined,
    });
  };

  return { disarm, armHome, armAway, armNight, isPending };
}

// Hook to activate a scene or script
export function useActivateScene() {
  const { mutateAsync: callService, isPending } = useCallService();

  const activate = async (entityId: string) => {
    const domain = entityId.split(".")[0];
    await callService({
      domain,
      service: "turn_on",
      entity_id: entityId,
    });
  };

  return { activate, isPending };
}

// ============================================================================
// Energy Daily Statistics Hook
// ============================================================================

export interface EnergyDailyStats {
  solarToday: number;
  gridImport: number;
  gridExport: number;
  batteryIn: number;
  batteryOut: number;
  gridToBattery: number;  // Energy loaded into battery from grid (kWh)
  isLoading: boolean;
  error: Error | null;
}

// Hook to get energy values for a specific period (today, week, month)
export function useEnergyPeriodStats(
  config: EnergyConfig | undefined,
  period: "today" | "week" | "month" = "today"
): EnergyDailyStats {
  const { family } = useFamilyStore();

  // Track current date so stats reset at midnight
  const [currentDay, setCurrentDay] = useState(() => new Date().toDateString());
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date().toDateString();
      if (now !== currentDay) setCurrentDay(now);
    }, 60000);
    return () => clearInterval(interval);
  }, [currentDay]);

  // Calculate start time based on period
  const startTime = useMemo(() => {
    // currentDay dependency ensures recomputation at midnight
    const now = new Date(currentDay);
    switch (period) {
      case "today":
        return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      case "week":
        // Start from Monday of the current week (German week starts on Monday)
        const startOfWeek = new Date(now);
        const dayOfWeek = startOfWeek.getDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        startOfWeek.setDate(startOfWeek.getDate() - daysToMonday);
        startOfWeek.setHours(0, 0, 0, 0);
        return startOfWeek.toISOString();
      case "month":
        // Start from the 1st of the current month
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        startOfMonth.setHours(0, 0, 0, 0);
        return startOfMonth.toISOString();
    }
  }, [period, currentDay]);

  // Collect energy entity IDs
  const entityIds = config
    ? [
        config.solar_energy_today,
        config.grid_import,
        config.grid_export,
        config.battery_energy_in,
        config.battery_energy_out,
        config.grid_to_battery_energy,
      ].filter((id): id is string => !!id)
    : [];

  const { data, isLoading, error } = useQuery({
    queryKey: ["home-assistant-energy-period-stats", family?.id, entityIds, period, startTime],
    queryFn: async (): Promise<Record<string, number>> => {
      if (!family?.id || entityIds.length === 0) return {};

      const params = new URLSearchParams({
        family_id: family.id,
        statistic_ids: entityIds.join(","),
        period: "day",
        start_time: startTime,
      });

      const response = await fetch(`/api/homeassistant/statistics?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch energy statistics");
      }

      const responseData = await response.json();
      const statistics: Record<string, StatisticsPeriod[]> = responseData.statistics || {};

      // Sum up changes across all periods for each entity
      const totals: Record<string, number> = {};
      for (const [entityId, periods] of Object.entries(statistics)) {
        let total = 0;
        for (const p of periods) {
          if (p.change !== undefined) {
            total += p.change;
          }
        }
        totals[entityId] = total;
      }

      return totals;
    },
    enabled: !!family?.id && entityIds.length > 0 && !!config,
    staleTime: 60000,
    refetchInterval: 60000,
    retry: 1,
  });

  return {
    solarToday: config?.solar_energy_today && data ? (data[config.solar_energy_today] ?? 0) : 0,
    gridImport: config?.grid_import && data ? (data[config.grid_import] ?? 0) : 0,
    gridExport: config?.grid_export && data ? (data[config.grid_export] ?? 0) : 0,
    batteryIn: config?.battery_energy_in && data ? (data[config.battery_energy_in] ?? 0) : 0,
    batteryOut: config?.battery_energy_out && data ? (data[config.battery_energy_out] ?? 0) : 0,
    gridToBattery: config?.grid_to_battery_energy && data ? (data[config.grid_to_battery_energy] ?? 0) : 0,
    isLoading,
    error: error as Error | null,
  };
}

// Hook to get today's daily energy values (calculates change from cumulative sensors)
export function useEnergyDailyStats(config: EnergyConfig | undefined): EnergyDailyStats {
  const { family } = useFamilyStore();

  // Track current date so stats reset at midnight
  const [currentDay, setCurrentDay] = useState(() => new Date().toDateString());
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date().toDateString();
      if (now !== currentDay) setCurrentDay(now);
    }, 60000);
    return () => clearInterval(interval);
  }, [currentDay]);

  // Get start of today in ISO format
  const startTime = useMemo(() => {
    // Derive from currentDay so the dep is actually used
    const startOfToday = new Date(currentDay);
    startOfToday.setHours(0, 0, 0, 0);
    return startOfToday.toISOString();
  }, [currentDay]);

  // Collect energy entity IDs (kWh sensors that need daily change calculation)
  const entityIds = config
    ? [
        config.solar_energy_today,
        config.grid_import,
        config.grid_export,
        config.battery_energy_in,
        config.battery_energy_out,
        config.grid_to_battery_energy,
      ].filter((id): id is string => !!id)
    : [];

  const { data, isLoading, error } = useQuery({
    queryKey: ["home-assistant-energy-daily-stats", family?.id, entityIds, startTime],
    queryFn: async (): Promise<Record<string, number>> => {
      if (!family?.id || entityIds.length === 0) return {};

      const params = new URLSearchParams({
        family_id: family.id,
        statistic_ids: entityIds.join(","),
        period: "day",
        start_time: startTime,
      });

      const response = await fetch(`/api/homeassistant/statistics?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch energy statistics");
      }

      const responseData = await response.json();
      const statistics: Record<string, StatisticsPeriod[]> = responseData.statistics || {};

      // Extract the change value for each entity
      const changes: Record<string, number> = {};
      for (const [entityId, periods] of Object.entries(statistics)) {
        if (periods.length > 0 && periods[0].change !== undefined) {
          changes[entityId] = periods[0].change;
        }
      }

      return changes;
    },
    enabled: !!family?.id && entityIds.length > 0 && !!config,
    staleTime: 60000, // 1 minute
    refetchInterval: 60000, // Refetch every minute
    retry: 1,
  });

  // Map the changes to named properties
  return {
    solarToday: config?.solar_energy_today && data ? (data[config.solar_energy_today] ?? 0) : 0,
    gridImport: config?.grid_import && data ? (data[config.grid_import] ?? 0) : 0,
    gridExport: config?.grid_export && data ? (data[config.grid_export] ?? 0) : 0,
    batteryIn: config?.battery_energy_in && data ? (data[config.battery_energy_in] ?? 0) : 0,
    batteryOut: config?.battery_energy_out && data ? (data[config.battery_energy_out] ?? 0) : 0,
    gridToBattery: config?.grid_to_battery_energy && data ? (data[config.grid_to_battery_energy] ?? 0) : 0,
    isLoading,
    error: error as Error | null,
  };
}
