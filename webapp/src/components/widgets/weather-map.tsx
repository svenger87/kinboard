"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { useTranslations } from "next-intl";
import "leaflet/dist/leaflet.css";

interface WeatherMapProps {
  center: [number, number];
  zoom: number;
  layerUrl: string;
  layerName: string;
}

/**
 * How many times the weather layer is drawn. Two roughly doubles the
 * visible intensity; three starts to make temperature look posterised,
 * since that layer already covers every pixel.
 */
const WEATHER_LAYER_PASSES = 2;

/**
 * The weather dialog's map, on Leaflet directly.
 *
 * Only ever loaded on the client: the dialog imports it with
 * `next/dynamic` and `ssr: false`, since Leaflet reaches for `window` as
 * soon as it is imported.
 *
 * Three effects, each owning one part of the map: the map itself (made
 * once, removed on unmount), where it looks, and the weather layer.
 */
export default function WeatherMap({ center, zoom, layerUrl, layerName }: WeatherMapProps) {
  const t = useTranslations("weather");
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [lat, lon] = center;

  // The map is made from whatever centre and zoom it is first given; the
  // effect below moves it from there.
  const initial = useRef({ lat, lon, zoom });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Leaflet looks for its marker images next to its stylesheet, which a
    // bundler moves; point it at the published copies instead.
    delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    });

    const start = initial.current;
    const map = L.map(container, {
      center: [start.lat, start.lon],
      zoom: start.zoom,
      zoomControl: true,
      scrollWheelZoom: true,
    });

    // Base map, dimmed so the weather reads on top of it rather than
    // competing with road and label detail.
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
      opacity: 0.55,
    }).addTo(map);

    // Centre marker.
    markerRef.current = L.marker([start.lat, start.lon]).addTo(map);
    mapRef.current = map;
    setReady(true);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // Moves the map when the location or zoom it was given changes.
  //
  // On the two numbers, not the `center` array: the dialog builds a new array
  // on every render, so this ran on every render and threw away whatever the
  // viewer had done. Zoom in on your street, pick "Clouds", and the map jumped
  // back to the city at the starting zoom; the 10-minute weather refresh did
  // the same to a map someone was looking at.
  useEffect(() => {
    if (!ready) return;
    mapRef.current?.setView([lat, lon], zoom);
    markerRef.current?.setLatLng([lat, lon]);
  }, [ready, lat, lon, zoom]);

  // Weather layer, drawn WEATHER_LAYER_PASSES times.
  //
  // OpenWeatherMap's free tiles are faint: measured across a tile, mean alpha
  // is 30% for temperature, 18% for clouds, 14% for wind. We were then
  // multiplying that by opacity 0.7, so clouds reached the screen at about
  // 12% — technically drawn, effectively invisible, which is what made the
  // map look broken.
  //
  // There is no server-side lever: the tiles arrive pre-rendered, and the
  // `opacity` parameter belongs to Maps 2.0, which this key (a free one) gets
  // 401 from. CSS filters can't help either — saturate and contrast act on
  // RGB, and the intensity here is carried in the alpha channel.
  //
  // Drawing the same layer more than once compounds alpha as 1-(1-a)^n,
  // which takes clouds from 18% to 33% and temperature from 30% to 51%. The
  // repeats are the same URL, so they come from the browser's cache rather
  // than the network — and from our own tile proxy, which caches for ten
  // minutes, before that.
  //
  // Added after the base map, so they sit above it in the tile pane; a new
  // layer replaces the old one without touching the view.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const passes = Array.from({ length: WEATHER_LAYER_PASSES }, () =>
      L.tileLayer(layerUrl, { opacity: 1 }).addTo(map),
    );
    return () => {
      for (const layer of passes) layer.remove();
    };
  }, [ready, layerUrl, layerName]);

  return (
    <>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted rounded-lg">
          <span className="text-muted-foreground">{t("mapLoading")}</span>
        </div>
      )}
    </>
  );
}
