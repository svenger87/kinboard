export { useClock } from "./use-clock";
export { useIdleTimeout } from "./use-idle-timeout";
export {
  useWeather,
  useWeatherLocation,
  useWeatherForecast,
  useWeatherMapConfig,
  type WeatherData,
  type WeatherLocation,
  type ForecastData,
  type DailyForecast,
  type HourlyForecast,
  type WeatherMapConfig,
} from "./use-weather";

// Bring! Hooks
export {
  useBringSettings,
  useBringLogin,
  useBringLogout,
  useBringLists,
  useBringItems,
  useBringAddItem,
  useBringRemoveItem,
  useUpdateBringSettings,
  useBringCatalog,
  useBringItemSuggestions,
  getBringItemCategory,
  type BringCredentials,
  type BringList,
  type BringItem,
  type BringSettings,
  type BringCatalog,
  type BringCatalogItem,
} from "./use-bring";

// Realtime Hooks
export { useRealtime, useRealtimeTable, useRealtimeSync } from "./use-realtime";

// Supabase Query Hooks
export {
  queryKeys,
  useFamilyByJoinCode,
  useCreateFamily,
  useRegisterDevice,
  useRestoreDeviceSession,
  useFindDeviceByFingerprint,
  useQuickRejoin,
  useJoinFamily,
  useCreateFamilyWithDevice,
  useDevices,
  useUpdateDevice,
  useDeleteDevice,
  usePeople,
  useCreatePerson,
  useUpdatePerson,
  useDeletePerson,
  useCalendars,
  useCreateCalendar,
  useUpdateCalendar,
  useCreateIcsCalendar,
  useDeleteCalendar,
  useEvents,
  useCreateEvent,
  useUpdateEvent,
  useDeleteEvent,
  useTodos,
  useCreateTodo,
  useUpdateTodo,
  useDeleteTodo,
  useShoppingItems,
  useCreateShoppingItem,
  useUpdateShoppingItem,
  useDeleteShoppingItem,
  useSubjects,
  useCreateSubject,
  useUpdateSubject,
  useDeleteSubject,
  useSchedules,
  useUpsertSchedule,
  useBirthdays,
  useCreateBirthday,
  useUpdateBirthday,
  useDeleteBirthday,
  useNotes,
  useCreateNote,
  useUpdateNote,
  useDeleteNote,
  useSetting,
  useUpdateSetting,
} from "./use-supabase-queries";

// Google Calendar Hooks
export {
  useGoogleConfigured,
  useGoogleCalendarStatus,
  useGoogleCalendars,
  useGoogleEvents,
  useUpdateEnabledCalendars,
  useGoogleCalendarSync,
  useDisconnectGoogleCalendar,
  useUpdateMappingRules,
  useUpdateAutoSync,
  getGoogleAuthUrl,
} from "./use-google-calendar";

// Immich Hooks
export {
  useImmichStatus,
  useImmichAlbums,
  useImmichPhotos,
  useImmichMonthlyPhotos,
  useSaveImmichSettings,
  useTestImmichConnection,
  useDisconnectImmich,
} from "./use-immich";

// Unsplash Hooks
export {
  useUnsplashStatus,
  useUnsplashMonthlyPhotos,
  useSaveUnsplashSettings,
  useTestUnsplashConnection,
  useDisconnectUnsplash,
  type UnsplashSettings,
  type UnsplashPhoto,
} from "./use-unsplash";

// Photo Source Hook (unified Immich/Unsplash)
export {
  usePhotoSource,
  usePhotoSourceSetting,
  type ScreensaverPhoto,
} from "./use-photo-source";

// Keyboard Navigation Hooks
export {
  useKeyboardShortcuts,
  useShortcutsHelp,
} from "./use-keyboard-shortcuts";

// Touch Gesture Hooks
export { useSwipeNavigation } from "./use-swipe-navigation";

// PWA Hooks
export {
  useServiceWorker,
  useInstallPrompt,
  usePWA,
} from "./use-pwa";

// Kiosk Mode Hook
export { useKioskMode } from "./use-kiosk-mode";

// Theme Settings Hook
export {
  useThemeSettings,
  DEFAULT_THEME_SETTINGS,
  type ThemeSettings,
} from "./use-theme-settings";

// News Hook
export { useNews, type NewsItem } from "./use-news";

// Camera Hooks
export {
  useCameraSettings,
  useCameras,
  useSaveCameraSettings,
  useAddCamera,
  useUpdateCamera,
  useDeleteCamera,
  useReorderCameras,
} from "./use-cameras";

// Home Assistant Hooks
export {
  // Connection & Config
  useHomeAssistantStatus,
  useHomeAssistantConfig,
  useTestHomeAssistantConnection,
  useSaveHomeAssistantSettings,
  useDisconnectHomeAssistant,
  // Entity Queries
  useHomeAssistantEntities,
  useHomeAssistantEntityStates,
  // Dashboard Management
  useDashboards,
  useDashboard,
  useCreateDashboard,
  useUpdateDashboard,
  useDeleteDashboard,
  useReorderDashboards,
  // Card Management (for specific dashboard)
  useAddCardToDashboard,
  useRemoveCardFromDashboard,
  useUpdateCardInDashboard,
  useReorderCardsInDashboard,
  // Legacy (backwards-compatible)
  useDashboardCards,
  useAddDashboardCard,
  useRemoveDashboardCard,
  useUpdateDashboardCard,
  useReorderDashboardCards,
  // Energy Config
  useEnergyConfig,
  useSaveEnergyConfig,
  // Tesla Config
  useTeslaConfig,
  useSaveTeslaConfig,
  // History & Statistics
  useEntityHistory,
  useMultiEntityHistory,
  useEntityStatistics,
  useEnergyStatistics,
  useEnergyDailyStats,
  useEnergyPeriodStats,
  type EnergyDailyStats,
  // Service Calls
  useCallService,
  useToggleEntity,
  useVacuumCommand,
  useLightControl,
  useCoverControl,
  useMediaPlayerControl,
  useLockControl,
  useFanControl,
  useAlarmControl,
  useActivateScene,
} from "./use-home-assistant";

// Presence Sensor Hook
export { usePresence } from "./use-presence";

// Screensaver Settings Hook
export {
  useScreensaverSettings,
  useUpdateScreensaverSettings,
  DEFAULT_SCREENSAVER_SETTINGS,
  type ScreensaverSettings,
} from "./use-screensaver-settings";

// Item Catalog Hooks
export {
  catalogQueryKeys,
  useCatalogSearch,
  useBarcodeLookup,
  useSaveToCatalog,
  useItemAutocomplete,
  useParseShoppingInput,
  parseShoppingInput,
  useDebounce,
  type CatalogSearchResult,
  type BarcodeResult,
  type ParsedShoppingItem,
} from "./use-item-catalog";

// Recipe Hooks
export {
  recipeQueryKeys,
  useRecipes,
  useRecipe,
  useRecipeSearch,
  useRecipeTags,
  useCreateRecipe,
  useUpdateRecipe,
  useToggleRecipeFavorite,
  useDeleteRecipe,
  useAddRecipeToShoppingList,
  useImportRecipe,
  useCreateRecipeTag,
  useDeleteRecipeTag,
  useExternalRecipeSearch,
  type CreateRecipeInput,
  type UpdateRecipeInput,
  type ExternalRecipeResult,
} from "./use-recipes";

// Meal Planner Hooks
export {
  mealPlanQueryKeys,
  getWeekStart,
  formatDate,
  getWeekDates,
  MEAL_TYPES,
  useMealPlan,
  useAddMealPlanEntry,
  useUpdateMealPlanEntry,
  useRescheduleMealPlanEntry,
  useDeleteMealPlanEntry,
  useGenerateShoppingFromMealPlan,
  usePostponeMeal,
  type CreateMealPlanEntryInput,
  type UpdateMealPlanEntryInput,
} from "./use-meal-planner";

// Push Notification Hooks
export {
  usePushNotifications,
  sendTestNotification,
  type PushNotificationState,
  type UsePushNotificationsReturn,
} from "./use-push-notifications";

// Shopping Notification Hooks
export {
  useShoppingNotifications,
  useCreateShoppingItemWithNotification,
} from "./use-shopping-notifications";

// Todo Notification Hooks
export { useTodoNotifications } from "./use-todo-notifications";

// Notification Preferences Hooks
export {
  notificationQueryKeys,
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  isWithinQuietHours,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferencesUpdate,
} from "./use-notification-preferences";

// Image Upload Hook
export { useImageUpload } from "./use-image-upload";

// Vehicle Image Upload Hook
export { useVehicleImageUpload } from "./use-vehicle-image-upload";

// Location Search Hook
export {
  useLocationSearch,
  type LocationResult,
} from "./use-location-search";

// Online Status Hooks
export {
  useOnlineStatus,
  useIsOnline,
  useNetworkAvailable,
} from "./use-online-status";

// Offline Queue Hooks
export {
  useOfflineQueue,
  useOfflineQueueStatus,
} from "./use-offline-queue";

// Offline Shopping Hooks
export {
  useOfflineShoppingItems,
  useOfflineCreateShoppingItem,
  useOfflineUpdateShoppingItem,
  useOfflineDeleteShoppingItem,
  useOfflineToggleShoppingItem,
  useOfflineShopping,
  type OfflineShoppingItem,
} from "./use-offline-shopping";

// Offline Cache (generic, any module can use)
export { useOfflineCachedQuery } from "./use-offline-cache";

// Setup Wizard Hooks
export { useSetupState, useMarkSetupCompleted } from "./use-setup-state";
export type { SetupState } from "./use-setup-state";

// Room Management Hooks
export {
  useRoomsConfig,
  useRoom,
  useCreateRoom,
  useUpdateRoom,
  useDeleteRoom,
  useReorderRooms,
  useAddEntityToRoom,
  useRemoveEntityFromRoom,
  useMoveEntityToRoom,
  useReorderRoomEntities,
  useUpdateRoomsSettings,
  useAllRoomEntityIds,
  useRoomEntityIds,
  useRoomEntitiesWithStates,
  useEntityRoom,
  useUnassignedEntities,
} from "./use-rooms";

// Vehicle Hooks
export {
  useVehicles,
  useVehicle,
  useSaveVehicle,
  useDeleteVehicle,
  useVehiclesCount,
} from "./use-vehicles";

// Plugin Enable/Disable Hooks
export {
  useEnabledPlugins,
  useUpdateEnabledPlugins,
  useIsPluginEnabled,
} from "./use-enabled-plugins";
export type { EnabledPluginsMap } from "./use-enabled-plugins";
