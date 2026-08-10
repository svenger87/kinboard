# Cameras (go2rtc)

Live security-camera streams from RTSP / WebRTC / MJPEG sources, displayed on the dashboard or the dedicated `/cameras` page. The bundled stack includes [go2rtc](https://github.com/AlexxIT/go2rtc) as a streaming bridge.

![Cameras grid — multi-stream tile view](images/cameras-grid.png)

## What it does

- Render WebRTC streams (low latency, ~200ms) directly in the browser via `<video>` + RTCPeerConnection
- Bridge RTSP streams (typical IP camera output) → WebRTC via go2rtc
- Render MJPEG streams (legacy IP cameras) as `<img>`
- Show snapshot thumbnails (HTTP image URL) when WebRTC isn't established yet
- Digest + Basic auth for cameras that need credentials

## What it does not

- Doesn't record. go2rtc supports RTSP recording but Kinboard doesn't expose it.
- Doesn't do PTZ control. Plain stream display only.
- Doesn't substitute for a proper NVR. Use Frigate / Scrypted / BlueIris if you need motion detection / object detection / longer retention.

## Setup

### 1. Configure cameras in /settings/cameras

Open Settings → Cameras → **+ Camera**. For each camera:

- **Name** — friendly label
- **Stream type** — `rtsp`, `webrtc`, or `mjpeg`
- **Stream URL** — varies by type (see below)
- **Snapshot URL** (optional) — HTTP image URL for thumbnail
- **Authentication** (optional) — Digest (Hikvision, Amcrest) or Basic, with username/password

<img src="images/settings-cameras.png" alt="Settings — cameras: camera list with stream type, position and edit controls" width="420"/>

### Stream URL formats

#### RTSP (most IP cameras)

```
rtsp://user:pass@192.168.1.100:554/stream1
```

Paste the URL and that is the whole setup — Kinboard hands it to go2rtc, which connects to the camera and returns frames. You do not need an entry in `go2rtc.yaml` for this; that file is for the named streams described under WebRTC below.

Credentials can go either in the URL, as above, or in the **Authentication** fields, in which case Kinboard puts them into the URL before passing it on. If the URL already carries them, the fields are left alone — so a password containing `@` or `%` that you have already percent-encoded is not re-encoded.

**Snapshot URL is optional for RTSP.** It used to be effectively required, because an empty one fell back to the RTSP URL and nothing could open it. Leave it blank unless your camera publishes an HTTP still image you would rather use.

What you see depends on whether WebRTC can connect:

- The tile starts on a still image refreshed every 5 seconds (2 seconds full-screen), which works everywhere. It is requested at the size it will be drawn rather than the camera's own — a 4K camera sends about 44 KB for a tile instead of 700 KB, which matters on a wall display refreshing several of them forever.
- If a WebRTC connection comes up, live video replaces it. That needs `WEBRTC_LAN_IP` set and UDP 8555 reachable — see the WebRTC section below.

So a camera with no WebRTC path still shows a picture rather than a black rectangle, and one with a working path shows live video.

For Hikvision cameras the path is usually `/Streaming/Channels/101` (main) or `/Streaming/Channels/102` (sub). Use the sub-stream for tile thumbnails to save bandwidth.

For Amcrest/Dahua: `/cam/realmonitor?channel=1&subtype=0`.

#### WebRTC (go2rtc native)

```
http://192.168.1.100:8080/webrtc?src=mycamera
```

Used when your go2rtc instance is already configured with named camera entries (in `webapp/docker/go2rtc.yaml`). Stream URL points at the go2rtc API. Within the bundled stack that is `/api/cameras/webrtc?src=<name>`, which proxies to go2rtc over the Docker network.

Most people do not need this: an RTSP camera reaches WebRTC on its own now. Named streams are still worth it when several viewers watch one camera that only allows a single RTSP session, or when you want ffmpeg options such as hardware transcoding on a specific stream.

The shipped go2rtc.yaml has placeholder entries you customize for your hardware:

```yaml
streams:
  hikvision:
    - rtsp://${CAMERA_USER}:${CAMERA_PASS}@${HIKVISION_HOST}:554/Streaming/Channels/101
  amcrest_hd:
    - rtsp://${CAMERA_USER}:${CAMERA_PASS}@${AMCREST_HOST}/cam/realmonitor?channel=1&subtype=0
```

Set `CAMERA_USER`, `CAMERA_PASS`, `HIKVISION_HOST`, `AMCREST_HOST` in `webapp/docker/.env`.

#### MJPEG (legacy)

```
http://192.168.1.100/mjpeg
```

Direct HTTP image stream. Highest bandwidth. Use as fallback for cameras whose RTSP is broken.

## Authentication

If your camera requires HTTP auth on the snapshot URL or the stream:

- **Digest** — most modern IP cameras (Hikvision, Amcrest, Dahua). Kinboard's `/api/cameras` proxy handles digest negotiation.
- **Basic** — older cameras. Less secure but sometimes only option.

Credentials are stored in `settings.cameras[].auth` and only used server-side; the proxy strips them before serving the image to the browser.

## WebRTC + Traefik

If you put go2rtc behind Traefik for public access, the override file `docker-compose.traefik.yml.example` ships a TCP router for port 8555 (WebRTC TCP fallback). Configure a `webrtc` entrypoint in your Traefik static config:

```yaml
# traefik.yml
entryPoints:
  webrtc:
    address: ":8555"
```

For UDP WebRTC (lower latency, the preferred path), the go2rtc container exposes UDP 8555 directly — no Traefik involvement. Make sure your firewall lets it through.

Set `WEBRTC_LAN_IP` and `WEBRTC_PUBLIC_HOST` in `.env` so go2rtc announces correct ICE candidates to clients on the LAN vs WAN.

## The go2rtc console is on loopback

go2rtc has its own web console on port 1984. The bundled compose publishes it as `127.0.0.1:1984`, reachable from the Docker host and nowhere else.

That is because `GET /api/streams` lists every source go2rtc is holding, and it masks only the values it substituted from environment variables into its own config. A camera you added in Kinboard's settings is passed to go2rtc at runtime instead, so it appears there in full — `rtsp://user:pass@…`, password and all. On an all-interfaces binding, anyone on your LAN could read it.

To reach the console from another machine, set `GO2RTC_HTTP_BIND=0.0.0.0` in `.env` and understand what that publishes. Kinboard itself is unaffected either way: it talks to go2rtc as `http://go2rtc:1984` over the Docker network and never uses the published port.

## Performance — hardware-accelerated transcode

go2rtc passes RTSP through to WebRTC unchanged when the camera + browser already speak the same codec (typical H.264 IP cam → modern Chromium = zero transcode, low CPU). If your camera streams **HEVC / H.265** (common on 4K cams) and the browser needs H.264, go2rtc re-encodes — and software re-encode of a 4K HEVC stream will saturate a CPU core fast.

To turn on hardware-accelerated transcode (Intel iGPU / AMD VCN / NVIDIA NVENC):

1. **Mark the stream as hardware-transcoded** in `webapp/docker/go2rtc.yaml` by adding the `#hardware=vaapi` modifier:
   ```yaml
   amcrest_hd:
     - ffmpeg:rtsp://${CAMERA_USER}:${CAMERA_PASS}@${AMCREST_HOST}:554/cam/realmonitor?channel=1&subtype=0#video=h264#hardware=vaapi#audio=opus
   ```

2. **Pass the GPU device into the go2rtc container** via the per-host override file — copy the example:
   ```bash
   cp webapp/docker/docker-compose.override.yml.example webapp/docker/docker-compose.override.yml
   ```
   The shipped example contains the Intel-iGPU stanza (`/dev/dri/renderD128`). Edit if your host has a different render node, or use `runtime: nvidia` for an NVIDIA box.

3. **Verify inside the container** after `./start.sh up`:
   ```bash
   docker exec kinboard-go2rtc ls /dev/dri/        # should show renderD128
   docker exec kinboard-go2rtc ffmpeg -hwaccels    # should list vaapi / qsv / cuda
   ```

If the device isn't present, ffmpeg silently falls back to software encode and the stream may stutter or not load at all — easy to miss because the failure mode is performance-shaped, not error-shaped.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| **Black tile, snapshot works** | WebRTC ICE failure. Check `WEBRTC_LAN_IP` matches your LAN IP, and UDP 8555 isn't blocked by firewall. |
| **Stream lags by 5-15 seconds** | Probably transcoding bottleneck — check go2rtc CPU. Try the sub-stream (lower resolution) or attach a hardware encoder (see Performance section above). |
| **Stream loads in `/api/streams` probe but no video in browser** | WebRTC ICE is failing. Likely cause: the host port mapped to go2rtc's UDP 8555 doesn't match what go2rtc.yaml advertises in `webrtc.candidates`. Both must be `8555` end-to-end on the LAN path, or you need to edit the candidate to match the mapped host port. |
| **HEVC/H.265 stream returns 200 over HTTP but the page tile stays black** | VAAPI hardware-encoder isn't reachable inside the container. `docker exec kinboard-go2rtc ls /dev/dri` should list `renderD128`; if not, the override file isn't loaded — check `docker-compose.override.yml` exists alongside `docker-compose.yml`. |
| **Auth dialog pops in browser** | Stream URL credentials weren't recognized; check digest vs basic. The `/api/cameras` proxy should handle both — verify `auth.type` matches your camera. |
| **Multiple cameras lock up after a few hours** | Some cameras only allow one RTSP session. Use go2rtc named streams (config in `go2rtc.yaml`) so go2rtc dedupes the underlying connection. |
| **RTSP tile says "Snapshot could not be loaded"** | The camera isn't answering go2rtc. Check the webapp log: it distinguishes "empty frame" (go2rtc reached, camera didn't answer — wrong path, wrong port, camera off) from "bridge unavailable" (the go2rtc container isn't running or `GO2RTC_URL` is wrong). Note that go2rtc reports an unreachable camera as an empty 200 rather than an error, so its own log may look untroubled. Before 1.9.0 this message appeared for *every* RTSP camera regardless of the URL — if you are on an older version, that is what you are seeing. |
| **RTSP shows a refreshing still, never live video** | WebRTC never connected. That is the designed fallback, not a fault — but if you want video, set `WEBRTC_LAN_IP` to the host's LAN IP and open UDP 8555. The browser console logs the ICE connection state. |
| **One camera's tile is slower than the others** | Almost always resolution, not a fault. A 4K frame takes roughly three times as long to decode as a 1440p one, every refresh. Kinboard asks go2rtc to scale tiles down, which cuts the transfer sharply but not the decode. If it still lags, point that camera at its sub-stream (`subtype=1` on Amcrest/Dahua, `/Streaming/Channels/102` on Hikvision) — ample for a tile — or give it a named `go2rtc.yaml` entry with `#hardware=vaapi` so the GPU does the decoding. |

## Related

- [Self-hosting](Self-hosting) — Traefik override + WebRTC port handling
- See [`webapp/docker/go2rtc.yaml`](https://github.com/svenger87/kinboard/blob/main/webapp/docker/go2rtc.yaml) for the streaming bridge config
- See [`webapp/src/components/camera-viewer.tsx`](https://github.com/svenger87/kinboard/blob/main/webapp/src/components/camera-viewer.tsx) for the player implementation
