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

If your car needs entity mappings or a UI that neither Tesla nor Generic EV handles well, you can add a new driver. See [Plugin-Architecture.md](Plugin-Architecture.md) for the `VehicleDriver<TConfig>` contract and the step-by-step guide. The short version: create a file under `webapp/src/plugins/vehicles/drivers/`, implement `Card`, `ConfigForm`, `isConfigured`, and `defaultConfig`, then register it in `webapp/src/plugins/vehicles/drivers/registry.ts`. A PR with a new driver that covers a real HA integration will be reviewed and merged.
