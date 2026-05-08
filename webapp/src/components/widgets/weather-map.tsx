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
      {/* Base map layer */}
      <TileLayer
        attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        opacity={0.7}
      />

      {/* Weather layer */}
      <TileLayer
        url={layerUrl}
        opacity={0.7}
        key={layerName}
      />

      {/* Center marker */}
      <Marker position={center} />

      {/* Update map when props change */}
      <MapUpdater center={center} zoom={zoom} />
    </MapContainer>
  );
}
