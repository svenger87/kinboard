"use client";

import { useMemo, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RoomConfig,
  RoomsConfig,
  RoomEntity,
  RoomIcon,
  DEFAULT_ROOMS_CONFIG,
  generateRoomId,
  HAEntity,
  HomeAssistantSettings,
} from "@/types/home-assistant";
import {
  useHomeAssistantStatus,
  useSaveHomeAssistantSettings,
  useHomeAssistantEntityStates,
} from "./use-home-assistant";
import { useFamilyStore } from "@/stores/family-store";

/**
 * Hook to get the rooms configuration
 */
export function useRoomsConfig(): RoomsConfig {
  const { data: haStatus } = useHomeAssistantStatus();
  return haStatus?.rooms_config ?? DEFAULT_ROOMS_CONFIG;
}

/**
 * Hook to get a specific room by ID
 */
export function useRoom(roomId: string | undefined): RoomConfig | undefined {
  const roomsConfig = useRoomsConfig();
  return useMemo(
    () => roomsConfig.rooms.find((r) => r.id === roomId),
    [roomsConfig.rooms, roomId]
  );
}

/**
 * Hook to create a new room
 */
export function useCreateRoom() {
  const saveSettings = useSaveHomeAssistantSettings();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (room: Omit<RoomConfig, "id" | "created_at" | "position">) => {
      // Fetch fresh data from query client to avoid stale state
      const haStatus = queryClient.getQueryData<HomeAssistantSettings>(["home-assistant-status", family?.id]);
      if (!haStatus) throw new Error("Home Assistant not configured");

      const currentConfig = haStatus.rooms_config ?? DEFAULT_ROOMS_CONFIG;
      const newRoom: RoomConfig = {
        ...room,
        id: generateRoomId(),
        position: currentConfig.rooms.length,
        created_at: new Date().toISOString(),
      };

      const updatedConfig: RoomsConfig = {
        ...currentConfig,
        rooms: [...currentConfig.rooms, newRoom],
      };

      await saveSettings.mutateAsync({
        ...haStatus,
        rooms_config: updatedConfig,
      });

      return newRoom;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["home-assistant-status", family?.id],
      });
    },
  });
}

/**
 * Hook to update a room
 */
export function useUpdateRoom() {
  const saveSettings = useSaveHomeAssistantSettings();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      roomId,
      updates,
    }: {
      roomId: string;
      updates: Partial<Omit<RoomConfig, "id" | "created_at">>;
    }) => {
      // Fetch fresh data from query client to avoid stale state
      const haStatus = queryClient.getQueryData<HomeAssistantSettings>(["home-assistant-status", family?.id]);
      if (!haStatus) throw new Error("Home Assistant not configured");

      const currentConfig = haStatus.rooms_config ?? DEFAULT_ROOMS_CONFIG;
      const updatedRooms = currentConfig.rooms.map((room) =>
        room.id === roomId ? { ...room, ...updates } : room
      );

      const updatedConfig: RoomsConfig = {
        ...currentConfig,
        rooms: updatedRooms,
      };

      await saveSettings.mutateAsync({
        ...haStatus,
        rooms_config: updatedConfig,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["home-assistant-status", family?.id],
      });
    },
  });
}

/**
 * Hook to delete a room
 */
export function useDeleteRoom() {
  const saveSettings = useSaveHomeAssistantSettings();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (roomId: string) => {
      // Fetch fresh data from query client to avoid stale state
      const haStatus = queryClient.getQueryData<HomeAssistantSettings>(["home-assistant-status", family?.id]);
      if (!haStatus) throw new Error("Home Assistant not configured");

      const currentConfig = haStatus.rooms_config ?? DEFAULT_ROOMS_CONFIG;
      const updatedRooms = currentConfig.rooms
        .filter((room) => room.id !== roomId)
        .map((room, index) => ({ ...room, position: index }));

      const updatedConfig: RoomsConfig = {
        ...currentConfig,
        rooms: updatedRooms,
        // Clear default_room_id if deleted room was default
        default_room_id:
          currentConfig.default_room_id === roomId
            ? undefined
            : currentConfig.default_room_id,
      };

      await saveSettings.mutateAsync({
        ...haStatus,
        rooms_config: updatedConfig,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["home-assistant-status", family?.id],
      });
    },
  });
}

/**
 * Hook to reorder rooms
 */
export function useReorderRooms() {
  const saveSettings = useSaveHomeAssistantSettings();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (roomIds: string[]) => {
      // Fetch fresh data from query client to avoid stale state
      const haStatus = queryClient.getQueryData<HomeAssistantSettings>(["home-assistant-status", family?.id]);
      if (!haStatus) throw new Error("Home Assistant not configured");

      const currentConfig = haStatus.rooms_config ?? DEFAULT_ROOMS_CONFIG;
      const roomMap = new Map(currentConfig.rooms.map((r) => [r.id, r]));

      const reorderedRooms = roomIds
        .map((id, index) => {
          const room = roomMap.get(id);
          return room ? { ...room, position: index } : null;
        })
        .filter((r): r is RoomConfig => r !== null);

      const updatedConfig: RoomsConfig = {
        ...currentConfig,
        rooms: reorderedRooms,
      };

      await saveSettings.mutateAsync({
        ...haStatus,
        rooms_config: updatedConfig,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["home-assistant-status", family?.id],
      });
    },
  });
}

/**
 * Hook to add an entity to a room
 */
export function useAddEntityToRoom() {
  const saveSettings = useSaveHomeAssistantSettings();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      roomId,
      entityId,
      displayName,
    }: {
      roomId: string;
      entityId: string;
      displayName?: string;
    }) => {
      // Fetch fresh data from query client to avoid stale state
      const haStatus = queryClient.getQueryData<HomeAssistantSettings>(["home-assistant-status", family?.id]);
      if (!haStatus) throw new Error("Home Assistant not configured");

      const currentConfig = haStatus.rooms_config ?? DEFAULT_ROOMS_CONFIG;
      const room = currentConfig.rooms.find((r) => r.id === roomId);
      if (!room) throw new Error("Room not found");

      // Check if entity already in room
      if (room.entities.some((e) => e.entity_id === entityId)) {
        return; // Already exists
      }

      const newEntity: RoomEntity = {
        entity_id: entityId,
        display_name: displayName,
        position: room.entities.length,
      };

      const updatedRooms = currentConfig.rooms.map((r) =>
        r.id === roomId
          ? { ...r, entities: [...r.entities, newEntity] }
          : r
      );

      const updatedConfig: RoomsConfig = {
        ...currentConfig,
        rooms: updatedRooms,
      };

      await saveSettings.mutateAsync({
        ...haStatus,
        rooms_config: updatedConfig,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["home-assistant-status", family?.id],
      });
    },
  });
}

/**
 * Hook to remove an entity from a room
 */
export function useRemoveEntityFromRoom() {
  const saveSettings = useSaveHomeAssistantSettings();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      roomId,
      entityId,
    }: {
      roomId: string;
      entityId: string;
    }) => {
      // Fetch fresh data from query client to avoid stale state
      const haStatus = queryClient.getQueryData<HomeAssistantSettings>(["home-assistant-status", family?.id]);
      if (!haStatus) throw new Error("Home Assistant not configured");

      const currentConfig = haStatus.rooms_config ?? DEFAULT_ROOMS_CONFIG;

      const updatedRooms = currentConfig.rooms.map((room) => {
        if (room.id !== roomId) return room;

        const updatedEntities = room.entities
          .filter((e) => e.entity_id !== entityId)
          .map((e, index) => ({ ...e, position: index }));

        return { ...room, entities: updatedEntities };
      });

      const updatedConfig: RoomsConfig = {
        ...currentConfig,
        rooms: updatedRooms,
      };

      await saveSettings.mutateAsync({
        ...haStatus,
        rooms_config: updatedConfig,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["home-assistant-status", family?.id],
      });
    },
  });
}

/**
 * Hook to move an entity to a different room
 */
export function useMoveEntityToRoom() {
  const saveSettings = useSaveHomeAssistantSettings();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      entityId,
      fromRoomId,
      toRoomId,
    }: {
      entityId: string;
      fromRoomId: string;
      toRoomId: string;
    }) => {
      if (fromRoomId === toRoomId) return;

      // Fetch fresh data from query client to avoid stale state
      const haStatus = queryClient.getQueryData<HomeAssistantSettings>(["home-assistant-status", family?.id]);
      if (!haStatus) throw new Error("Home Assistant not configured");

      const currentConfig = haStatus.rooms_config ?? DEFAULT_ROOMS_CONFIG;

      // Find the entity in the source room
      const fromRoom = currentConfig.rooms.find((r) => r.id === fromRoomId);
      const entity = fromRoom?.entities.find((e) => e.entity_id === entityId);
      if (!entity) throw new Error("Entity not found in source room");

      const updatedRooms = currentConfig.rooms.map((room) => {
        if (room.id === fromRoomId) {
          // Remove from source
          const updatedEntities = room.entities
            .filter((e) => e.entity_id !== entityId)
            .map((e, index) => ({ ...e, position: index }));
          return { ...room, entities: updatedEntities };
        }
        if (room.id === toRoomId) {
          // Add to destination
          const newEntity: RoomEntity = {
            ...entity,
            position: room.entities.length,
          };
          return { ...room, entities: [...room.entities, newEntity] };
        }
        return room;
      });

      const updatedConfig: RoomsConfig = {
        ...currentConfig,
        rooms: updatedRooms,
      };

      await saveSettings.mutateAsync({
        ...haStatus,
        rooms_config: updatedConfig,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["home-assistant-status", family?.id],
      });
    },
  });
}

/**
 * Hook to reorder entities within a room
 */
export function useReorderRoomEntities() {
  const saveSettings = useSaveHomeAssistantSettings();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async ({
      roomId,
      entityIds,
    }: {
      roomId: string;
      entityIds: string[];
    }) => {
      // Fetch fresh data from query client to avoid stale state
      const haStatus = queryClient.getQueryData<HomeAssistantSettings>(["home-assistant-status", family?.id]);
      if (!haStatus) throw new Error("Home Assistant not configured");

      const currentConfig = haStatus.rooms_config ?? DEFAULT_ROOMS_CONFIG;
      const room = currentConfig.rooms.find((r) => r.id === roomId);
      if (!room) throw new Error("Room not found");

      const entityMap = new Map(room.entities.map((e) => [e.entity_id, e]));
      const reorderedEntities = entityIds
        .map((id, index) => {
          const entity = entityMap.get(id);
          return entity ? { ...entity, position: index } : null;
        })
        .filter((e): e is RoomEntity => e !== null);

      const updatedRooms = currentConfig.rooms.map((r) =>
        r.id === roomId ? { ...r, entities: reorderedEntities } : r
      );

      const updatedConfig: RoomsConfig = {
        ...currentConfig,
        rooms: updatedRooms,
      };

      await saveSettings.mutateAsync({
        ...haStatus,
        rooms_config: updatedConfig,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["home-assistant-status", family?.id],
      });
    },
  });
}

/**
 * Hook to update rooms config settings (show_unassigned, default_room_id)
 */
export function useUpdateRoomsSettings() {
  const saveSettings = useSaveHomeAssistantSettings();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  return useMutation({
    mutationFn: async (
      updates: Partial<Pick<RoomsConfig, "show_unassigned" | "default_room_id">>
    ) => {
      // Fetch fresh data from query client to avoid stale state
      const haStatus = queryClient.getQueryData<HomeAssistantSettings>(["home-assistant-status", family?.id]);
      if (!haStatus) throw new Error("Home Assistant not configured");

      const currentConfig = haStatus.rooms_config ?? DEFAULT_ROOMS_CONFIG;
      const updatedConfig: RoomsConfig = {
        ...currentConfig,
        ...updates,
      };

      await saveSettings.mutateAsync({
        ...haStatus,
        rooms_config: updatedConfig,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["home-assistant-status", family?.id],
      });
    },
  });
}

/**
 * Hook to get all entity IDs from all rooms
 */
export function useAllRoomEntityIds(): string[] {
  const roomsConfig = useRoomsConfig();

  return useMemo(() => {
    const ids = new Set<string>();
    for (const room of roomsConfig.rooms) {
      for (const entity of room.entities) {
        ids.add(entity.entity_id);
      }
    }
    return Array.from(ids);
  }, [roomsConfig.rooms]);
}

/**
 * Hook to get entity IDs for a specific room
 */
export function useRoomEntityIds(roomId: string | undefined): string[] {
  const room = useRoom(roomId);
  return useMemo(
    () => room?.entities.map((e) => e.entity_id).sort((a, b) => {
      const entityA = room.entities.find((e) => e.entity_id === a);
      const entityB = room.entities.find((e) => e.entity_id === b);
      return (entityA?.position ?? 0) - (entityB?.position ?? 0);
    }) ?? [],
    [room]
  );
}

/**
 * Hook to get entities with their states for a room
 */
export function useRoomEntitiesWithStates(roomId: string | undefined): {
  entities: Array<RoomEntity & { state: HAEntity | undefined }>;
  isLoading: boolean;
  lightsOn: number;
  switchesOn: number;
} {
  const room = useRoom(roomId);
  const entityIds = useRoomEntityIds(roomId);
  const { data: haStatus } = useHomeAssistantStatus();
  const isConnected = !!haStatus?.url;

  const { data: entityStates = [], isLoading } = useHomeAssistantEntityStates(
    entityIds,
    isConnected
  );

  const stateMap = useMemo(
    () => new Map(entityStates.map((e) => [e.entity_id, e])),
    [entityStates]
  );

  const entities = useMemo(() => {
    if (!room) return [];

    return room.entities
      .sort((a, b) => a.position - b.position)
      .map((entity) => ({
        ...entity,
        state: stateMap.get(entity.entity_id),
      }));
  }, [room, stateMap]);

  const lightsOn = useMemo(
    () =>
      entities.filter(
        (e) =>
          e.state?.domain === "light" && e.state?.state === "on"
      ).length,
    [entities]
  );

  const switchesOn = useMemo(
    () =>
      entities.filter(
        (e) =>
          (e.state?.domain === "switch" || e.state?.domain === "input_boolean") &&
          e.state?.state === "on"
      ).length,
    [entities]
  );

  return { entities, isLoading, lightsOn, switchesOn };
}

/**
 * Hook to check which room an entity belongs to
 */
export function useEntityRoom(entityId: string): RoomConfig | undefined {
  const roomsConfig = useRoomsConfig();

  return useMemo(() => {
    for (const room of roomsConfig.rooms) {
      if (room.entities.some((e) => e.entity_id === entityId)) {
        return room;
      }
    }
    return undefined;
  }, [roomsConfig.rooms, entityId]);
}

/**
 * Hook to get unassigned entities (entities in dashboards but not in any room)
 */
export function useUnassignedEntities(): string[] {
  const { data: haStatus } = useHomeAssistantStatus();
  const roomsConfig = useRoomsConfig();

  return useMemo(() => {
    if (!haStatus?.dashboards) return [];

    // Collect all entity IDs from dashboards
    const dashboardEntityIds = new Set<string>();
    for (const dashboard of haStatus.dashboards) {
      for (const card of dashboard.cards) {
        // Only include controllable entities (lights, switches, sensors)
        const domain = card.entity_id.split(".")[0];
        if (["light", "switch", "input_boolean", "sensor", "binary_sensor"].includes(domain)) {
          dashboardEntityIds.add(card.entity_id);
        }
      }
    }

    // Collect all entity IDs from rooms
    const roomEntityIds = new Set<string>();
    for (const room of roomsConfig.rooms) {
      for (const entity of room.entities) {
        roomEntityIds.add(entity.entity_id);
      }
    }

    // Return entities that are in dashboards but not in any room
    return Array.from(dashboardEntityIds).filter(
      (id) => !roomEntityIds.has(id)
    );
  }, [haStatus?.dashboards, roomsConfig.rooms]);
}
