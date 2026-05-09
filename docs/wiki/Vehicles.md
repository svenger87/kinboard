# Vehicles

The Vehicles page (`/vehicles`) shows battery level, charging status, and range for every car your household has configured via Home Assistant. It supports multiple vehicles — the dashboard widget rotates through them every 8 seconds. Two drivers ship out of the box: **Tesla** (for Tesla Fleet via HA) and **Generic EV** (for any car Home Assistant can reach via its own integrations, including VW We Connect, BMW Connected Drive, Polestar, Hyundai BlueLink, OBD2 dongles, and others).

---

## Migrating from the legacy Tesla page

If you were running Kinboard before v1.0.12, you had a `/tesla` page and a `/settings/tesla` settings page. Both now redirect (HTTP 308) to the new pages. No action is required on your part — your existing Tesla configuration was automatically migrated to the `vehicles` table by `migration_vehicles.sql`, which runs on stack startup. After the upgrade, visit `/settings/vehicles` and you should see your Tesla listed with its existing entity IDs intact.

The `widget_visibility.tesla` flag in your saved dashboard preferences is also auto-migrated at read time: if your blob has `tesla: true` and no `vehicles` key, the dashboard treats it as `vehicles: true` so the widget keeps appearing without you touching `/settings/widgets`.

---

## Adding a vehicle

1. Go to `/settings/vehicles` (or follow the link from the main Settings page under Integrations).
2. Tap **Add vehicle**.
3. Choose a vehicle type (Tesla or Generic EV).
4. Enter a nickname (e.g. "Model Y" or "Mia's e-tron").
5. Pick an accent color — used to tint the vehicle's card on the dashboard.
6. Tap **Add vehicle** to create the row, then configure entity IDs on the next screen.

You can add as many vehicles as you have Home Assistant entities for. The `/vehicles` page tabs through them, and the dashboard widget rotates automatically.

---

## Tesla driver

The Tesla driver reads vehicle data from Home Assistant's Tesla Fleet integration. Before adding a Tesla vehicle, make sure the [Tesla Fleet integration](https://www.home-assistant.io/integrations/tesla_fleet/) is set up in Home Assistant and your vehicle's entities appear in the HA entity registry.

On the vehicle's settings page (`/settings/vehicles/[id]`), map the following entity IDs from your HA instance:

| Field | Example entity | Notes |
|---|---|---|
| Battery level | `sensor.model_y_battery_level` | Percentage, 0–100 |
| Battery range | `sensor.model_y_battery_range` | km or miles |
| Charging rate | `sensor.model_y_charging_rate` | kW; used for charging indicator |
| Charging state | `sensor.model_y_charging_state` | "charging" / "not_charging" |
| Charge limit | `sensor.model_y_charge_limit` | % |
| Time to full charge | `sensor.model_y_time_charge_complete` | minutes |
| Charger power | `sensor.model_y_charger_power` | kW (fallback if charging_rate absent) |
| Charge energy added | `sensor.model_y_charge_energy_added` | kWh, used for session cost calc |
| Inside temperature | `sensor.model_y_inside_temperature` | optional |
| Outside temperature | `sensor.model_y_outside_temperature` | optional |
| Climate state | `climate.model_y` | optional |
| Locked | `lock.model_y` | optional |
| Windows | `binary_sensor.model_y_windows` | optional |
| Doors | `binary_sensor.model_y_doors` | optional |
| Trunk | `binary_sensor.model_y_trunk` | optional |
| Frunk | `binary_sensor.model_y_frunk` | optional |
| Tire pressure FL/FR/RL/RR | `sensor.model_y_tire_pressure_front_left` etc. | optional; bar or psi auto-detected |
| Odometer | `sensor.model_y_odometer` | optional |
| Location | `device_tracker.model_y_location_tracker` | optional; home / not_home / work / school |
| State | `sensor.model_y_state` | "online" / "asleep" / "driving" |

Only **Battery level** is required for the widget to render meaningfully. Everything else is optional and enhances the detail view on `/vehicles`.

The settings page has a live entity search — start typing the entity name or ID and matching entities appear in the dropdown. Tesla entities bubble to the top of the list automatically.

---

## Generic EV driver

The Generic EV driver works with any vehicle that Home Assistant has an integration for. All it needs is five entity IDs:

| Field | Accepts | Notes |
|---|---|---|
| Battery level | Any `sensor` with `device_class: battery` or `unit_of_measurement: %` | Required for meaningful display |
| Charging state | Any `sensor` or `binary_sensor` | "charging" / any truthy value triggers the charging indicator |
| Range | Any `sensor` with distance unit | km or miles |
| Location | Any `device_tracker` | Displays home / away / etc. |
| State | Any `sensor` | Online / offline / driving / etc. |

Home Assistant integrations that feed Generic EV well:

- **VW We Connect** — `volkswagen_we_connect_id` integration (HACS or core)
- **BMW Connected Drive** — `bmw_connected_drive` core integration
- **Polestar** — `polestar_api` (HACS)
- **Hyundai / Kia** — `hyundai_kia_connect` (HACS)
- **OBD2 dongles** — `obd` integration exposes battery voltage; pair with a smart charger integration for charging state
- **Any EV with a custom integration** — as long as it exposes a battery level sensor, Generic EV will display it

If your car's integration exposes more entities than the five slots (e.g. tire pressures, cabin temperature), you can use the Tesla driver instead and leave most fields blank — the Tesla driver renders gracefully when optional fields are absent.

---

## Adding a custom driver

If your car needs entity mappings or a UI that neither Tesla nor Generic EV handles well — say you want a polished Polestar-specific dashboard with frunk-state, charging-cable status, and pre-conditioning controls, all wired to HA's `polestar_api` integration — add a new driver. The pattern is "copy Tesla, change the field list."

### When to add a driver vs. just use Generic EV

- **Use Generic EV** if your car's HA integration exposes battery, charging state, range, location, and overall state, and you don't need a deeper UI than that. No code required — the existing Generic EV driver covers it.
- **Add a new driver** if your car has unique surfaces worth a vendor-specific layout (e.g. Polestar's pre-conditioning, BMW's Efficient Dynamics breakdown, VW's charging-cable lock state) — anything where five fields aren't enough and the Tesla driver's tire-pressure / lock / climate grid would be a forced fit.

### What's in scope for v1.x drivers

All bundled drivers today read data from Home Assistant entities. The `VehicleDriver` contract doesn't *require* this — a driver's `Card` could call any hook, including ones that talk to a vendor API directly — but the supporting infrastructure for that (encrypted credential storage, OAuth flows per vendor, server-side polling for cars that aren't online when the dashboard is open) doesn't exist yet. For now, **build HA-backed drivers**. If you have a use-case that genuinely needs to bypass HA, open a discussion before writing code.

### The copy-Tesla recipe

The Tesla driver at `webapp/src/plugins/vehicles/drivers/tesla.tsx` is the canonical reference. To add a new HA-backed driver — let's call it `polestar` — follow these six steps. Effort: 30–60 minutes for someone comfortable with the codebase, longer if you want a polished vendor-specific UI.

**1. Add `<vendor>` to the `vendor` enum**

In `webapp/docker/migration_vehicles.sql`, the `vendor TEXT NOT NULL CHECK (vendor IN ('tesla', 'generic-ev'))` constraint locks the allowed values. Postgres has no `ADD CONSTRAINT IF NOT EXISTS` for CHECKs, so a new vendor needs a separate idempotent migration. Create `webapp/docker/migration_vehicle_vendor_<id>.sql`:

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE constraint_name = 'vehicles_vendor_polestar_check'
  ) THEN
    ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_vendor_check;
    ALTER TABLE public.vehicles
      ADD CONSTRAINT vehicles_vendor_check
      CHECK (vendor IN ('tesla', 'generic-ev', 'polestar'));
  END IF;
END $$;
```

Then update the TypeScript union in `webapp/src/types/database.ts` — find `vendor: "tesla" | "generic-ev"` (Row, Insert, Update — three places) and add `| "polestar"`.

**2. Define the config shape and driver in a new file**

Create `webapp/src/plugins/vehicles/drivers/polestar.tsx`. Start by copy-pasting `tesla.tsx` into it. Rename:
- `TeslaConfig` interface → `PolestarConfig`
- Keep only the fields your vendor's HA integration actually exposes; remove the Tesla-specific ones (frunk, tire pressures if Polestar doesn't expose them, etc.)
- `TeslaCard` function → `PolestarCard`
- `TeslaConfigForm` function → `PolestarConfigForm`
- `teslaDriver` const → `polestarDriver`, with `id: "polestar"`, `displayNameKey: "polestar"`, your icon (lucide-react has 1500+ — pick one that fits)
- `isConfigured` predicate — the simplest version is `(c) => Boolean(c.battery_level)`

Inside `PolestarCard`'s render, customize the layout to highlight what makes Polestar different — maybe the pre-conditioning state gets its own card, charging-cable status replaces the trunk indicator, etc.

**3. Wire up entity-selector field rows**

In `PolestarConfigForm`, the existing `<EntitySelector>` rows from Tesla map directly to Polestar's HA entity names. The shared `EntitySelector` from `@/components/home-assistant/entity-selector` accepts a `priorityPattern?: string` prop — pass `priorityPattern="polestar"` so Polestar entities float to the top of every dropdown for users who have many integrations configured.

**4. Register the driver**

In `webapp/src/plugins/vehicles/drivers/registry.ts`, add the import and array entry:

```ts
import { polestarDriver } from "./polestar";

export const VEHICLE_DRIVERS: VehicleDriver<unknown>[] = [
  teslaDriver as VehicleDriver<unknown>,
  polestarDriver as VehicleDriver<unknown>,
  genericEvDriver as VehicleDriver<unknown>,
];
```

**5. Add i18n keys**

Both `webapp/messages/en.json` and `webapp/messages/de.json` need:

- `nav.polestar` for the dropdown label (if you decide to surface the brand in nav)
- `vehicles.drivers.polestar.*` for any per-driver strings the Card renders (`haNotConnected`, `notConfigured`, etc. — copy the same keys Tesla uses)
- `settings.vehicles.driver.polestar` for the vendor-picker label
- `settings.vehicles.driverDescription.polestar` for the picker description

The CI `i18n bundles` job fails the PR if any key is in EN but missing from DE — keep them symmetric. If you don't speak German, machine-translate as a starting point and flag in the PR description; a maintainer or DE-speaking reviewer will polish.

**6. Test + open a PR**

- Run `npm run lint` and `npx tsc --noEmit` from `webapp/`. Both must be clean (the four pre-existing `news/api` type errors are unrelated to vehicles work).
- If you have Docker locally: `docker compose build webapp && docker compose up -d webapp`, then visit `/settings/vehicles/new` and confirm Polestar appears in the vendor picker and the create-then-edit flow renders your config form.
- Open a PR against `main` of `github.com/svenger87/kinboard`. Reference the HA integration your driver is built on (with a link). Include a screenshot of the new Card if your UI deviates meaningfully from Tesla's.

### What gets your PR merged

- Driver covers a real HA integration that's available to users (HACS or core; not a paywalled bespoke API)
- Code follows the copy-Tesla shape — no clever new abstractions invented just for one driver
- i18n parity holds (en/de must have the same keys)
- A short note in the PR explaining which Polestar HA integration you tested against
- MIT-compatible (no copy-paste from a vendor's proprietary SDK)

If you want to discuss the approach before writing code — say you're not sure whether your car's case warrants a driver or just better Generic-EV docs — open a [GitHub Discussion](https://github.com/svenger87/kinboard/discussions) first. Faster than writing code that bounces in review.
