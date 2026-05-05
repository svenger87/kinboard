"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  Cloud,
  MapPin,
  Navigation,
  Loader2,
  Check,
  RefreshCw,
  Search,
} from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useWeatherLocation, useWeather, type WeatherLocation } from "@/hooks";
import { useUpdateSetting } from "@/hooks";
import { Weather } from "@/components/widgets/weather";
import { PageHeader } from "@/components/page-header";
import { IntegrationConfigHint } from "@/components/integration-config-hint";

interface CityResult {
  name: string;
  displayName: string;
  lat: number;
  lon: number;
  country: string;
  state?: string;
}

export default function WeatherSettingsPage() {
  const t = useTranslations("settings.weather");
  const { data: savedLocation, isLoading: locationLoading } = useWeatherLocation();
  const { data: weatherData, refetch: refetchWeather } = useWeather();
  // Detect "OPENWEATHERMAP_API_KEY missing" — the hook returns null
  // (not an error) when the API responds with { configured: false }.
  // Loading-state suppresses the hint until the first fetch resolves.
  const weatherUnconfigured = weatherData === null;
  const updateSetting = useUpdateSetting();

  const [locationType, setLocationType] = useState<"city" | "coordinates">("city");
  const [city, setCity] = useState("Hamburg");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // City autocomplete state
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<CityResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load saved settings
  useEffect(() => {
    if (savedLocation) {
      setLocationType(savedLocation.type);
      if (savedLocation.city) {
        setCity(savedLocation.city);
        setSearchQuery(savedLocation.city);
      }
      if (savedLocation.lat) setLat(savedLocation.lat.toString());
      if (savedLocation.lon) setLon(savedLocation.lon.toString());
    }
  }, [savedLocation]);

  // Track changes
  useEffect(() => {
    if (!savedLocation) return;

    const currentLocation: WeatherLocation = {
      type: locationType,
      ...(locationType === "city" ? { city } : { lat: parseFloat(lat), lon: parseFloat(lon) }),
    };

    const isDifferent =
      currentLocation.type !== savedLocation.type ||
      currentLocation.city !== savedLocation.city ||
      currentLocation.lat !== savedLocation.lat ||
      currentLocation.lon !== savedLocation.lon;

    setHasChanges(isDifferent);
    setSaved(false);
  }, [locationType, city, lat, lon, savedLocation]);

  // Debounced city search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (searchQuery.length < 2) {
      setSuggestions([]);
      return;
    }

    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch(`/api/cities?q=${encodeURIComponent(searchQuery)}`);
        if (response.ok) {
          const data = await response.json();
          setSuggestions(data);
        }
      } catch (error) {
        console.error("City search error:", error);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  const handleSave = async () => {
    setIsSaving(true);

    const newLocation: WeatherLocation = {
      type: locationType,
      ...(locationType === "city"
        ? { city }
        : { lat: parseFloat(lat), lon: parseFloat(lon) }
      ),
    };

    try {
      await updateSetting.mutateAsync({
        key: "weather_location",
        value: newLocation,
      });
      setSaved(true);
      setHasChanges(false);
      // Refetch weather with new location
      setTimeout(() => refetchWeather(), 500);
    } finally {
      setIsSaving(false);
    }
  };

  const handleGetLocation = () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocationType("coordinates");
          setLat(position.coords.latitude.toFixed(4));
          setLon(position.coords.longitude.toFixed(4));
        },
        (error) => {
          console.error("Geolocation error:", error);
        }
      );
    }
  };

  const handleSelectCity = (cityResult: CityResult) => {
    setCity(cityResult.name);
    setSearchQuery(cityResult.displayName);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    setCity(value);
    setShowSuggestions(true);
  };

  if (locationLoading) {
    return (
      <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 flex items-center justify-center safe-area-inset">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return (
    <main id="main-content" className="min-h-screen p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto">
        <PageHeader
          icon={Cloud}
          title={t("title")}
          subtitle={t("subtitle")}
          backHref="/settings"
          className="mb-8"
        />

        {weatherUnconfigured && (
          <IntegrationConfigHint
            title={t("notConfiguredTitle")}
            description={t("notConfiguredDescription")}
            envKey="OPENWEATHERMAP_API_KEY"
            docsHref="https://github.com/svenger87/kinboard/wiki/Integration-OpenWeatherMap"
            docsLabel={t("notConfiguredDocsLabel")}
          />
        )}

        {/* Location Type */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-6"
        >
          <h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">
            {t("locationTypeHeading")}
          </h2>
          <GlassCard className="p-4">
            <RadioGroup
              value={locationType}
              onValueChange={(value) => setLocationType(value as "city" | "coordinates")}
              className="flex flex-col gap-3"
            >
              <div className="flex items-center gap-3">
                <RadioGroupItem value="city" id="city" />
                <Label htmlFor="city" className="flex items-center gap-2 cursor-pointer">
                  <MapPin className="size-4" />
                  {t("locationTypeCity")}
                </Label>
              </div>
              <div className="flex items-center gap-3">
                <RadioGroupItem value="coordinates" id="coordinates" />
                <Label htmlFor="coordinates" className="flex items-center gap-2 cursor-pointer">
                  <Navigation className="size-4" />
                  {t("locationTypeCoordinates")}
                </Label>
              </div>
            </RadioGroup>
          </GlassCard>
        </motion.div>

        {/* Location Input */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-6"
        >
          <h2 className="text-sm font-medium text-muted-foreground mb-3 px-1">
            {locationType === "city" ? t("locationCityHeading") : t("locationCoordinatesHeading")}
          </h2>
          <GlassCard className="p-4">
            {locationType === "city" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="city-input">{t("cityInputLabel")}</Label>
                <div className="relative">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      ref={inputRef}
                      id="city-input"
                      value={searchQuery}
                      onChange={handleSearchInputChange}
                      onFocus={() => setShowSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                      placeholder={t("citySearchPlaceholder")}
                      className="pl-10"
                    />
                    {isSearching && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground" />
                    )}
                  </div>

                  {/* Suggestions dropdown */}
                  <AnimatePresence>
                    {showSuggestions && suggestions.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute z-50 w-full mt-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden"
                      >
                        {suggestions.map((result, index) => (
                          <button
                            key={`${result.lat}-${result.lon}-${index}`}
                            onClick={() => handleSelectCity(result)}
                            className="w-full px-4 py-3 text-left hover:bg-muted transition-colors flex items-center gap-3 border-b border-border/50 last:border-b-0"
                          >
                            <MapPin className="size-4 text-muted-foreground shrink-0" />
                            <div>
                              <p className="font-medium">{result.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {result.state ? `${result.state}, ` : ""}{result.country}
                              </p>
                            </div>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("citySearchHint")}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="lat-input">{t("latLabel")}</Label>
                    <Input
                      id="lat-input"
                      type="number"
                      step="0.0001"
                      value={lat}
                      onChange={(e) => setLat(e.target.value)}
                      placeholder="53.5511"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="lon-input">{t("lonLabel")}</Label>
                    <Input
                      id="lon-input"
                      type="number"
                      step="0.0001"
                      value={lon}
                      onChange={(e) => setLon(e.target.value)}
                      placeholder="9.9937"
                    />
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGetLocation}
                  className="w-full"
                >
                  <Navigation className="size-4 mr-2" />
                  {t("useCurrentLocation")}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {t("useCurrentLocationHint")}
                </p>
              </div>
            )}
          </GlassCard>
        </motion.div>

        {/* Save Button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mb-6"
        >
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className="w-full"
          >
            {isSaving ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                {t("savingLabel")}
              </>
            ) : saved ? (
              <>
                <Check className="size-4 mr-2" />
                {t("savedLabel")}
              </>
            ) : (
              t("saveButton")
            )}
          </Button>
        </motion.div>

        {/* Weather Preview */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-sm font-medium text-muted-foreground">
              {t("previewHeading")}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetchWeather()}
              className="h-8"
            >
              <RefreshCw className="size-4 mr-1" />
              {t("refreshButton")}
            </Button>
          </div>
          <Weather />
        </motion.div>
      </div>
    </main>
  );
}
