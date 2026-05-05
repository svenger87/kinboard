// Mock OpenWeatherMap (data/2.5) — minimum viable so the weather widget +
// modal render with believable data, no real OWM key needed.
//
// Endpoints implemented (the only ones webapp/src/app/api/weather/*
// routes hit):
//   GET /weather       — current conditions
//   GET /forecast      — 5-day / 3-hour list
//
// Coordinates / city are accepted but ignored — we always return Berlin.

import http from "node:http";

const PORT = parseInt(process.env.PORT || "8125", 10);

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body));
}

const NOW = () => Math.floor(Date.now() / 1000);
const TZ_OFFSET_SEC = 7200; // CEST

const current = {
  coord: { lon: 13.405, lat: 52.52 },
  weather: [
    { id: 802, main: "Clouds", description: "scattered clouds", icon: "03d" },
  ],
  base: "stations",
  main: {
    temp: 14.5,
    feels_like: 13.8,
    temp_min: 12.1,
    temp_max: 16.2,
    pressure: 1015,
    humidity: 62,
  },
  visibility: 10000,
  wind: { speed: 3.6, deg: 230 },
  clouds: { all: 40 },
  dt: NOW(),
  sys: {
    country: "DE",
    sunrise: Math.floor(new Date().setUTCHours(4, 12, 0, 0) / 1000),
    sunset: Math.floor(new Date().setUTCHours(18, 56, 0, 0) / 1000),
  },
  timezone: TZ_OFFSET_SEC,
  id: 2950159,
  name: "Berlin",
  cod: 200,
};

// 40 forecast entries (5 days × 8 per day at 3-hour cadence).
function buildForecast() {
  const list = [];
  const start = NOW();
  const conditions = [
    { id: 800, main: "Clear",  description: "clear sky",       icon: "01d" },
    { id: 802, main: "Clouds", description: "scattered clouds", icon: "03d" },
    { id: 803, main: "Clouds", description: "broken clouds",   icon: "04d" },
    { id: 500, main: "Rain",   description: "light rain",      icon: "10d" },
    { id: 600, main: "Snow",   description: "light snow",      icon: "13d" },
  ];
  for (let i = 0; i < 40; i++) {
    const dt = start + i * 10800; // every 3h
    const hour = new Date(dt * 1000).getUTCHours();
    const dayWaveTemp = 12 + 6 * Math.sin(((hour - 6) / 24) * Math.PI);
    const cond = conditions[Math.floor(Math.random() * conditions.length)];
    const dayNight = hour >= 6 && hour <= 18 ? "d" : "n";
    list.push({
      dt,
      main: {
        temp: parseFloat(dayWaveTemp.toFixed(1)),
        feels_like: parseFloat((dayWaveTemp - 0.5).toFixed(1)),
        temp_min: parseFloat((dayWaveTemp - 1).toFixed(1)),
        temp_max: parseFloat((dayWaveTemp + 1).toFixed(1)),
        pressure: 1015,
        humidity: 60 + Math.floor(Math.random() * 20),
      },
      weather: [{ ...cond, icon: cond.icon.replace(/[dn]$/, dayNight) }],
      clouds: { all: 30 + Math.floor(Math.random() * 50) },
      wind: { speed: 2 + Math.random() * 4, deg: Math.floor(Math.random() * 360) },
      visibility: 10000,
      pop: Math.random() * 0.6,
      sys: { pod: dayNight },
      dt_txt: new Date(dt * 1000).toISOString().slice(0, 19).replace("T", " "),
    });
  }
  return {
    cod: "200",
    message: 0,
    cnt: 40,
    list,
    city: {
      id: 2950159,
      name: "Berlin",
      coord: { lat: 52.52, lon: 13.405 },
      country: "DE",
      population: 3645000,
      timezone: TZ_OFFSET_SEC,
      sunrise: current.sys.sunrise,
      sunset: current.sys.sunset,
    },
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // Refresh dt on every call so timestamps stay current for the demo
  current.dt = NOW();

  if (path === "/weather") return send(res, 200, current);
  if (path === "/forecast") return send(res, 200, buildForecast());

  send(res, 404, { cod: 404, message: `Mock OWM: not implemented: ${path}` });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mock OpenWeatherMap listening on :${PORT}`);
});
