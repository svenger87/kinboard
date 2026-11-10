import { test, expect } from "@playwright/test";
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "../src/app/api/presence/route";

test("presence state requires a family session to read or clear", async () => {
  const url = "http://localhost/api/presence?device_id=test-device";
  expect((await GET(new NextRequest(url))).status).toBe(401);
  expect((await DELETE(new NextRequest(url, { method: "DELETE" }))).status).toBe(401);
});

test("only the configured sensor credential can publish presence", async () => {
  const prior = process.env.PRESENCE_SENSOR_TOKEN;
  process.env.PRESENCE_SENSOR_TOKEN = "test-sensor-secret";
  try {
    const request = (token?: string) => new NextRequest("http://localhost/api/presence", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify({ device_id: "test-device", presence: true }),
    });
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request("wrong-secret"))).status).toBe(401);
    expect((await POST(request("test-sensor-secret"))).status).toBe(200);
  } finally {
    if (prior === undefined) delete process.env.PRESENCE_SENSOR_TOKEN;
    else process.env.PRESENCE_SENSOR_TOKEN = prior;
  }
});
