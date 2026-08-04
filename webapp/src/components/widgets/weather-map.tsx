"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import { useTranslations } from "next-intl";
import "leaflet/dist/leaflet.css";

interface WeatherMapProps {
  center: [number, number];
  zoom: number;
  layerUrl: string;
  layerName: string;
}

// Component to update map view when props change
function MapUpdater({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();

  useEffect(() => {
    map.setView(center, zoom);
  }, [map, center, zoom]);

  return null;
}

/**
 * How many times the weather layer is drawn. Two roughly doubles the
 * visible intensity; three starts to make temperature look posterised,
 * since that layer already covers every pixel.
 */
const WEATHER_LAYER_PASSES = 2;

export default function WeatherMap({ center, zoom, layerUrl, layerName }: WeatherMapProps) {
  const t = useTranslations("weather");
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    // Fix for default marker icon - must be done client-side
     
    const L = require("leaflet");

    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    });

    setIsClient(true);
  }, []);

  if (!isClient) {
    return (
      <div className="size-full flex items-center justify-center bg-muted rounded-lg">
        <span className="text-muted-foreground">{t("mapLoading")}</span>
      </div>
    );
  }

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      style={{ height: "100%", width: "100%" }}
      zoomControl={true}
      scrollWheelZoom={true}
    >
      {/* Base map, dimmed so the weather reads on top of it rather than
          competing with road and label detail. */}
      <TileLayer
        attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        opacity={0.55}
      />

      {/* Weather layer, drawn WEATHER_LAYER_PASSES times.
          
          OpenWeatherMap's free tiles are faint: measured across a tile,
          mean alpha is 30% for temperature, 18% for clouds, 14% for wind.
          We were then multiplying that by opacity 0.7, so clouds reached
          the screen at about 12% — technically drawn, effectively
          invisible, which is what made the map look broken.
          
          There is no server-side lever: the tiles arrive pre-rendered,
          and the `opacity` parameter belongs to Maps 2.0, which this key
          (a free one) gets 401 from. CSS filters can't help either —
          saturate and contrast act on RGB, and the intensity here is
          carried in the alpha channel.
          
          Drawing the same layer more than once compounds alpha as
          1-(1-a)^n, which takes clouds from 18% to 33% and temperature
          from 30% to 51%. The repeats are the same URL, so they come
          from the browser's cache rather than the network — and from our
          own tile proxy, which caches for ten minutes, before that. */}
      {Array.from({ length: WEATHER_LAYER_PASSES }, (_, pass) => (
        <TileLayer url={layerUrl} opacity={1} key={`${layerName}-${pass}`} />
      ))}

      {/* Center marker */}
      <Marker position={center} />

      {/* Update map when props change */}
      <MapUpdater center={center} zoom={zoom} />
    </MapContainer>
  );
}
