"use client";

/**
 * The per-domain controls of the entity detail sheet — RFC-008 §4.1.
 *
 * Split out of `entity-detail-sheet.tsx` because the sheet's job (header,
 * state, history, attributes) is one thing and "what can a household *do* to a
 * cover" is another, and because keeping the whole matrix in the sheet took it
 * past the point where anyone could review it.
 *
 * Two rules run through every component here:
 *
 * 1. **Nothing is offered that the device cannot do.** Every action is gated
 *    on the `supported_features` bit RFC-008 §4.1 names for *that* domain (see
 *    `lib/ha-features.ts`), or — for light brightness and climate's mode list —
 *    on the attribute the matrix names instead. A speaker that cannot skip
 *    grows no skip button.
 * 2. **A domain with nothing to offer renders no section at all**, rather than
 *    an "Actions" heading over empty space. That is why each component decides
 *    for itself and wraps its own {@link ActionsSection}: the emptiness is only
 *    knowable where the gating is.
 *
 * Confirmations for the dangerous rows of RFC-008 §6 (`lock.unlock`,
 * `lock.open`, `alarm_disarm`) are deliberately *not* here — they arrive as one
 * shared dialog across all seven actions in a later step, not as a one-off per
 * domain.
 */

import { useCallback, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Loader2, Play, Pause, Square, SkipBack, SkipForward, Volume2, VolumeX,
  Minus, Plus, ChevronUp, ChevronDown, Home, MapPin, Shuffle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  useCallService, useToggleEntity, useLightControl, useCoverControl,
  useMediaPlayerControl, useVacuumCommand, useLockControl, useFanControl,
  useAlarmControl,
} from "@/hooks";
import {
  ALARM_FEATURE, CLIMATE_FEATURE, COVER_FEATURE, FAN_FEATURE, HUMIDIFIER_FEATURE,
  LIGHT_FEATURE, LOCK_FEATURE, MEDIA_PLAYER_FEATURE, VACUUM_FEATURE,
  optionList, supportsBrightness, supportsColorTemp, supportsFeature,
} from "@/lib/ha-features";
import { classifyEntityState } from "@/lib/ha-entity-display";
import type { HAEntity } from "@/types/home-assistant";

// ── Small shared pieces ───────────────────────────────────────────────────

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Run a service call and say so when it fails.
 *
 * Every control here is fire-and-forget from a tap, so without this the
 * rejection from a call Home Assistant refused would be an unhandled promise
 * and the household would see the button do nothing at all.
 */
function useRunAction() {
  const t = useTranslations("homeAutomation");
  return useCallback(
    (run: () => Promise<unknown>) => {
      void run().catch(() => toast.error(t("controlFailed")));
    },
    [t],
  );
}

/** The `Actions` heading and its separator. Rendered only by a domain that has some. */
function ActionsSection({ busy, children }: { busy?: boolean; children: ReactNode }) {
  const t = useTranslations("homeAutomation.entityDetail");
  return (
    <>
      <Separator />
      <div>
        <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
          {t("actionsHeading")}
          {busy ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
        </h3>
        <div className="flex flex-col gap-4">{children}</div>
      </div>
    </>
  );
}

/**
 * A row of author-defined options — effects, presets, sources, HVAC modes.
 *
 * Buttons rather than a dropdown: this sheet opens on a wall panel, where a
 * select is a fiddly target and its options are hidden until tapped.
 */
function OptionRow({
  label, options, current, onSelect, disabled, translate,
}: {
  label: string;
  options: string[];
  current?: string;
  onSelect: (option: string) => void;
  disabled?: boolean;
  translate?: (option: string) => string;
}) {
  if (options.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={option === current ? "default" : "outline"}
            onClick={() => onSelect(option)}
            disabled={disabled}
          >
            {translate ? translate(option) : option}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** A labelled 0–100 style slider that only fires on release. */
function CommitSlider({
  label, value, display, min = 0, max = 100, step = 1, onCommit, disabled,
}: {
  label: string;
  value: number;
  display: string;
  min?: number;
  max?: number;
  step?: number;
  onCommit: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{display}</span>
      </div>
      <Slider
        value={[Math.min(Math.max(value, min), max)]}
        min={min}
        max={max}
        step={step}
        onValueCommit={(next) => onCommit(next[0])}
        disabled={disabled}
      />
    </div>
  );
}

/** A minus/plus pair around a number — a temperature a thumb can nudge. */
function Stepper({
  label, display, onStep, disabled,
}: {
  label: string;
  display: string;
  onStep: (direction: -1 | 1) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <Button size="icon" variant="outline" onClick={() => onStep(-1)} disabled={disabled}>
          <Minus />
        </Button>
        <span className="min-w-16 text-center text-lg font-semibold tabular-nums">{display}</span>
        <Button size="icon" variant="outline" onClick={() => onStep(1)} disabled={disabled}>
          <Plus />
        </Button>
      </div>
    </div>
  );
}

/** The plain on/off pair, for the domains whose primary control is exactly that. */
function OnOffRow({
  isOn, onTurnOn, onTurnOff, disabled, showOn = true, showOff = true,
}: {
  isOn: boolean;
  onTurnOn: () => void;
  onTurnOff: () => void;
  disabled?: boolean;
  showOn?: boolean;
  showOff?: boolean;
}) {
  const t = useTranslations("homeAutomation.entityDetail");
  if (!showOn && !showOff) return null;
  return (
    <div className="flex gap-2">
      {showOn && (
        <Button
          className="flex-1"
          variant={isOn ? "default" : "outline"}
          onClick={onTurnOn}
          disabled={disabled}
        >
          {t("turnOnButton")}
        </Button>
      )}
      {showOff && (
        <Button
          className="flex-1"
          variant={!isOn ? "default" : "outline"}
          onClick={onTurnOff}
          disabled={disabled}
        >
          {t("turnOffButton")}
        </Button>
      )}
    </div>
  );
}

interface DomainProps {
  entity: HAEntity;
}

// ── light ─────────────────────────────────────────────────────────────────

function LightActions({ entity }: DomainProps) {
  const tAttr = useTranslations("homeAutomation.entityDetail.attributes");
  const run = useRunAction();
  const { turnOn, turnOff, setBrightness, setColorTemp, isPending } = useLightControl();
  const { mutateAsync: callService, isPending: servicePending } = useCallService();
  const busy = isPending || servicePending;

  const id = entity.entity_id;
  const attrs = entity.attributes;
  const isOn = entity.state === "on";

  const brightness = num(attrs.brightness) ?? 0;
  const brightnessPercent = Math.round((brightness / 255) * 100);

  const minKelvin = num(attrs.min_color_temp_kelvin) ?? 2000;
  const maxKelvin = num(attrs.max_color_temp_kelvin) ?? 6500;
  const kelvin = num(attrs.color_temp_kelvin) ?? Math.round((minKelvin + maxKelvin) / 2);

  const effects = optionList(attrs.effect_list);
  const hasEffects = supportsFeature(attrs, LIGHT_FEATURE.EFFECT) && effects.length > 0;

  return (
    <ActionsSection busy={busy}>
      <OnOffRow
        isOn={isOn}
        onTurnOn={() => run(() => turnOn(id))}
        onTurnOff={() => run(() => turnOff(id))}
        disabled={busy}
      />
      {supportsBrightness(attrs) && (
        <CommitSlider
          label={tAttr("brightness")}
          value={brightnessPercent}
          display={`${brightnessPercent}%`}
          step={5}
          onCommit={(percent) => run(() => setBrightness(id, Math.round((percent / 100) * 255)))}
          disabled={busy}
        />
      )}
      {supportsColorTemp(attrs) && (
        <CommitSlider
          label={tAttr("color_temp")}
          value={kelvin}
          display={`${kelvin} K`}
          min={minKelvin}
          max={maxKelvin}
          step={50}
          onCommit={(next) => run(() => setColorTemp(id, next))}
          disabled={busy}
        />
      )}
      {hasEffects && (
        <OptionRow
          label={tAttr("effect")}
          options={effects}
          current={text(attrs.effect)}
          disabled={busy}
          onSelect={(effect) =>
            run(() =>
              callService({
                domain: "light",
                service: "turn_on",
                entity_id: id,
                service_data: { effect },
              }),
            )
          }
        />
      )}
    </ActionsSection>
  );
}

// ── fan ───────────────────────────────────────────────────────────────────

function FanActions({ entity }: DomainProps) {
  const t = useTranslations("homeAutomation.entityDetail");
  const tAttr = useTranslations("homeAutomation.entityDetail.attributes");
  const run = useRunAction();
  const { turnOn, turnOff, setSpeed, setOscillating, setPresetMode, isPending } = useFanControl();
  const { mutateAsync: callService, isPending: servicePending } = useCallService();
  const busy = isPending || servicePending;

  const id = entity.entity_id;
  const attrs = entity.attributes;
  const isOn = entity.state === "on";

  const canTurnOn = supportsFeature(attrs, FAN_FEATURE.TURN_ON);
  const canTurnOff = supportsFeature(attrs, FAN_FEATURE.TURN_OFF);
  const canSetSpeed = supportsFeature(attrs, FAN_FEATURE.SET_SPEED);
  const canOscillate = supportsFeature(attrs, FAN_FEATURE.OSCILLATE);
  const canSetDirection = supportsFeature(attrs, FAN_FEATURE.DIRECTION);
  const presets = optionList(attrs.preset_modes);
  const canPreset = supportsFeature(attrs, FAN_FEATURE.PRESET_MODE) && presets.length > 0;

  const percentage = num(attrs.percentage) ?? 0;
  const rawStep = num(attrs.percentage_step);
  const step = rawStep && rawStep >= 1 ? Math.round(rawStep) : 1;
  const oscillating = attrs.oscillating === true;
  const direction = text(attrs.direction);

  if (
    !canTurnOn && !canTurnOff && !canSetSpeed && !canOscillate && !canSetDirection && !canPreset
  ) {
    return null;
  }

  return (
    <ActionsSection busy={busy}>
      <OnOffRow
        isOn={isOn}
        onTurnOn={() => run(() => turnOn(id))}
        onTurnOff={() => run(() => turnOff(id))}
        disabled={busy}
        showOn={canTurnOn}
        showOff={canTurnOff}
      />
      {canSetSpeed && (
        <CommitSlider
          label={tAttr("percentage")}
          value={percentage}
          display={`${Math.round(percentage)}%`}
          step={step}
          onCommit={(next) => run(() => setSpeed(id, next))}
          disabled={busy}
        />
      )}
      {canPreset && (
        <OptionRow
          label={tAttr("preset_mode")}
          options={presets}
          current={text(attrs.preset_mode)}
          disabled={busy}
          onSelect={(preset) => run(() => setPresetMode(id, preset))}
        />
      )}
      {canOscillate && (
        <Button
          variant={oscillating ? "default" : "outline"}
          onClick={() => run(() => setOscillating(id, !oscillating))}
          disabled={busy}
        >
          {t("oscillate")}
        </Button>
      )}
      {canSetDirection && (
        <OptionRow
          label={tAttr("direction")}
          options={["forward", "reverse"]}
          current={direction}
          disabled={busy}
          translate={(option) =>
            option === "forward" ? t("directionForward") : t("directionReverse")
          }
          onSelect={(next) =>
            run(() =>
              callService({
                domain: "fan",
                service: "set_direction",
                entity_id: id,
                service_data: { direction: next },
              }),
            )
          }
        />
      )}
    </ActionsSection>
  );
}

// ── cover ─────────────────────────────────────────────────────────────────

function CoverActions({ entity }: DomainProps) {
  const t = useTranslations("homeAutomation.entityDetail");
  const tHome = useTranslations("homeAutomation");
  const tAttr = useTranslations("homeAutomation.entityDetail.attributes");
  const run = useRunAction();
  const { open, close, stop, setPosition, isPending } = useCoverControl();
  const { mutateAsync: callService, isPending: servicePending } = useCallService();
  const busy = isPending || servicePending;

  const id = entity.entity_id;
  const attrs = entity.attributes;

  const canOpen = supportsFeature(attrs, COVER_FEATURE.OPEN);
  const canClose = supportsFeature(attrs, COVER_FEATURE.CLOSE);
  const canStop = supportsFeature(attrs, COVER_FEATURE.STOP);
  const canSetPosition = supportsFeature(attrs, COVER_FEATURE.SET_POSITION);
  const canOpenTilt = supportsFeature(attrs, COVER_FEATURE.OPEN_TILT);
  const canCloseTilt = supportsFeature(attrs, COVER_FEATURE.CLOSE_TILT);
  const canStopTilt = supportsFeature(attrs, COVER_FEATURE.STOP_TILT);
  const canSetTilt = supportsFeature(attrs, COVER_FEATURE.SET_TILT_POSITION);

  const position = num(attrs.current_position) ?? 0;
  const tilt = num(attrs.current_tilt_position) ?? 0;

  const anyTilt = canOpenTilt || canCloseTilt || canStopTilt || canSetTilt;
  if (!canOpen && !canClose && !canStop && !canSetPosition && !anyTilt) return null;

  const tiltService = (service: string) =>
    run(() => callService({ domain: "cover", service, entity_id: id }));

  return (
    <ActionsSection busy={busy}>
      {(canOpen || canClose || canStop) && (
        <div className="flex gap-2">
          {canOpen && (
            <Button className="flex-1" variant="outline" onClick={() => run(() => open(id))} disabled={busy}>
              <ChevronUp />
              {tHome("open")}
            </Button>
          )}
          {canStop && (
            <Button className="flex-1" variant="outline" onClick={() => run(() => stop(id))} disabled={busy}>
              <Square />
              {t("stopButton")}
            </Button>
          )}
          {canClose && (
            <Button className="flex-1" variant="outline" onClick={() => run(() => close(id))} disabled={busy}>
              <ChevronDown />
              {tHome("close")}
            </Button>
          )}
        </div>
      )}
      {canSetPosition && (
        <CommitSlider
          label={tAttr("current_position")}
          value={position}
          display={`${Math.round(position)}%`}
          step={5}
          onCommit={(next) => run(() => setPosition(id, next))}
          disabled={busy}
        />
      )}
      {(canOpenTilt || canCloseTilt || canStopTilt) && (
        <div className="flex gap-2">
          {canOpenTilt && (
            <Button className="flex-1" size="sm" variant="outline" onClick={() => tiltService("open_cover_tilt")} disabled={busy}>
              {t("openTilt")}
            </Button>
          )}
          {canStopTilt && (
            <Button className="flex-1" size="sm" variant="outline" onClick={() => tiltService("stop_cover_tilt")} disabled={busy}>
              {t("stopTilt")}
            </Button>
          )}
          {canCloseTilt && (
            <Button className="flex-1" size="sm" variant="outline" onClick={() => tiltService("close_cover_tilt")} disabled={busy}>
              {t("closeTilt")}
            </Button>
          )}
        </div>
      )}
      {canSetTilt && (
        <CommitSlider
          label={tAttr("current_tilt_position")}
          value={tilt}
          display={`${Math.round(tilt)}%`}
          step={5}
          onCommit={(next) =>
            run(() =>
              callService({
                domain: "cover",
                service: "set_cover_tilt_position",
                entity_id: id,
                service_data: { tilt_position: next },
              }),
            )
          }
          disabled={busy}
        />
      )}
    </ActionsSection>
  );
}

// ── lock ──────────────────────────────────────────────────────────────────

function LockActions({ entity }: DomainProps) {
  const t = useTranslations("homeAutomation.entityDetail");
  const tHome = useTranslations("homeAutomation");
  const run = useRunAction();
  const { lock, unlock, isPending } = useLockControl();
  const { mutateAsync: callService, isPending: servicePending } = useCallService();
  const busy = isPending || servicePending;

  const id = entity.entity_id;
  const isLocked = entity.state === "locked";
  // RFC-008 §6 flags `unlock` and `open` for a confirmation step. That dialog
  // is shared across all seven dangerous actions and arrives with them; the
  // services themselves are plain here on purpose.
  const canOpenLatch = supportsFeature(entity.attributes, LOCK_FEATURE.OPEN);

  return (
    <ActionsSection busy={busy}>
      <div className="flex gap-2">
        <Button
          className="flex-1"
          variant={isLocked ? "default" : "outline"}
          onClick={() => run(() => lock(id))}
          disabled={busy}
        >
          {tHome("lock")}
        </Button>
        <Button
          className="flex-1"
          variant={!isLocked ? "default" : "outline"}
          onClick={() => run(() => unlock(id))}
          disabled={busy}
        >
          {tHome("unlock")}
        </Button>
      </div>
      {canOpenLatch && (
        <Button
          variant="outline"
          onClick={() => run(() => callService({ domain: "lock", service: "open", entity_id: id }))}
          disabled={busy}
        >
          {t("openLatch")}
        </Button>
      )}
    </ActionsSection>
  );
}

// ── media_player ──────────────────────────────────────────────────────────

const REPEAT_MODES = ["off", "all", "one"] as const;

function MediaPlayerActions({ entity }: DomainProps) {
  const t = useTranslations("homeAutomation.entityDetail");
  const tAttr = useTranslations("homeAutomation.entityDetail.attributes");
  const run = useRunAction();
  const {
    play, pause, stop, next, previous, setVolume, mute, selectSource, isPending,
  } = useMediaPlayerControl();
  const { mutateAsync: callService, isPending: servicePending } = useCallService();
  const busy = isPending || servicePending;

  const id = entity.entity_id;
  const attrs = entity.attributes;

  const canTurnOn = supportsFeature(attrs, MEDIA_PLAYER_FEATURE.TURN_ON);
  const canTurnOff = supportsFeature(attrs, MEDIA_PLAYER_FEATURE.TURN_OFF);
  const canPlay = supportsFeature(attrs, MEDIA_PLAYER_FEATURE.PLAY);
  const canPause = supportsFeature(attrs, MEDIA_PLAYER_FEATURE.PAUSE);
  const canStop = supportsFeature(attrs, MEDIA_PLAYER_FEATURE.STOP);
  const canPrevious = supportsFeature(attrs, MEDIA_PLAYER_FEATURE.PREVIOUS_TRACK);
  const canNext = supportsFeature(attrs, MEDIA_PLAYER_FEATURE.NEXT_TRACK);
  const canVolume = supportsFeature(attrs, MEDIA_PLAYER_FEATURE.VOLUME_SET);
  const canMute = supportsFeature(attrs, MEDIA_PLAYER_FEATURE.VOLUME_MUTE);
  const sources = optionList(attrs.source_list);
  const canSource = supportsFeature(attrs, MEDIA_PLAYER_FEATURE.SELECT_SOURCE) && sources.length > 0;
  const soundModes = optionList(attrs.sound_mode_list);
  const canSoundMode =
    supportsFeature(attrs, MEDIA_PLAYER_FEATURE.SELECT_SOUND_MODE) && soundModes.length > 0;
  const canShuffle = supportsFeature(attrs, MEDIA_PLAYER_FEATURE.SHUFFLE_SET);
  const canRepeat = supportsFeature(attrs, MEDIA_PLAYER_FEATURE.REPEAT_SET);

  const transport = canPrevious || canPlay || canPause || canStop || canNext;
  if (
    !canTurnOn && !canTurnOff && !transport && !canVolume && !canMute && !canSource &&
    !canSoundMode && !canShuffle && !canRepeat
  ) {
    return null;
  }

  const volumePercent = Math.round((num(attrs.volume_level) ?? 0) * 100);
  const muted = attrs.is_volume_muted === true;
  const shuffling = attrs.shuffle === true;
  const repeatMode = text(attrs.repeat) ?? "off";

  return (
    <ActionsSection busy={busy}>
      <OnOffRow
        isOn={entity.state !== "off"}
        onTurnOn={() =>
          run(() => callService({ domain: "media_player", service: "turn_on", entity_id: id }))
        }
        onTurnOff={() =>
          run(() => callService({ domain: "media_player", service: "turn_off", entity_id: id }))
        }
        disabled={busy}
        showOn={canTurnOn}
        showOff={canTurnOff}
      />
      {transport && (
        <div className="flex gap-2">
          {canPrevious && (
            <Button className="flex-1" variant="outline" onClick={() => run(() => previous(id))} disabled={busy}>
              <SkipBack />
              <span className="sr-only">{t("mediaPrevious")}</span>
            </Button>
          )}
          {canPlay && (
            <Button className="flex-1" variant="outline" onClick={() => run(() => play(id))} disabled={busy}>
              <Play />
              <span className="sr-only">{t("mediaPlay")}</span>
            </Button>
          )}
          {canPause && (
            <Button className="flex-1" variant="outline" onClick={() => run(() => pause(id))} disabled={busy}>
              <Pause />
              <span className="sr-only">{t("mediaPause")}</span>
            </Button>
          )}
          {canStop && (
            <Button className="flex-1" variant="outline" onClick={() => run(() => stop(id))} disabled={busy}>
              <Square />
              <span className="sr-only">{t("stopButton")}</span>
            </Button>
          )}
          {canNext && (
            <Button className="flex-1" variant="outline" onClick={() => run(() => next(id))} disabled={busy}>
              <SkipForward />
              <span className="sr-only">{t("mediaNext")}</span>
            </Button>
          )}
        </div>
      )}
      {canVolume && (
        <CommitSlider
          label={tAttr("volume_level")}
          value={volumePercent}
          display={`${volumePercent}%`}
          step={1}
          onCommit={(percent) => run(() => setVolume(id, percent / 100))}
          disabled={busy}
        />
      )}
      {canMute && (
        <Button
          variant={muted ? "default" : "outline"}
          onClick={() => run(() => mute(id, !muted))}
          disabled={busy}
        >
          {muted ? <VolumeX /> : <Volume2 />}
          {t("mute")}
        </Button>
      )}
      {canSource && (
        <OptionRow
          label={tAttr("source")}
          options={sources}
          current={text(attrs.source)}
          disabled={busy}
          onSelect={(source) => run(() => selectSource(id, source))}
        />
      )}
      {canSoundMode && (
        <OptionRow
          label={tAttr("sound_mode")}
          options={soundModes}
          current={text(attrs.sound_mode)}
          disabled={busy}
          onSelect={(soundMode) =>
            run(() =>
              callService({
                domain: "media_player",
                service: "select_sound_mode",
                entity_id: id,
                service_data: { sound_mode: soundMode },
              }),
            )
          }
        />
      )}
      {canShuffle && (
        <Button
          variant={shuffling ? "default" : "outline"}
          onClick={() =>
            run(() =>
              callService({
                domain: "media_player",
                service: "shuffle_set",
                entity_id: id,
                service_data: { shuffle: !shuffling },
              }),
            )
          }
          disabled={busy}
        >
          <Shuffle />
          {t("shuffle")}
        </Button>
      )}
      {canRepeat && (
        <OptionRow
          label={tAttr("repeat")}
          options={[...REPEAT_MODES]}
          current={repeatMode}
          disabled={busy}
          translate={(mode) =>
            mode === "all" ? t("repeatAll") : mode === "one" ? t("repeatOne") : t("repeatOff")
          }
          onSelect={(repeat) =>
            run(() =>
              callService({
                domain: "media_player",
                service: "repeat_set",
                entity_id: id,
                service_data: { repeat },
              }),
            )
          }
        />
      )}
    </ActionsSection>
  );
}

// ── climate ───────────────────────────────────────────────────────────────

const HVAC_MODE_KEYS: readonly string[] = [
  "auto", "heat", "cool", "heat_cool", "dry", "fan_only", "off",
];

function ClimateActions({ entity }: DomainProps) {
  const tAttr = useTranslations("homeAutomation.entityDetail.attributes");
  const tHvacMode = useTranslations("homeAutomation.hvacMode");
  const run = useRunAction();
  const { mutateAsync: callService, isPending: busy } = useCallService();

  const id = entity.entity_id;
  const attrs = entity.attributes;

  const call = (service: string, service_data?: Record<string, unknown>) =>
    run(() => callService({ domain: "climate", service, entity_id: id, service_data }));

  const modes = optionList(attrs.hvac_modes);
  const canTargetTemp = supportsFeature(attrs, CLIMATE_FEATURE.TARGET_TEMPERATURE);
  const canTargetRange = supportsFeature(attrs, CLIMATE_FEATURE.TARGET_TEMPERATURE_RANGE);
  const canTargetHumidity = supportsFeature(attrs, CLIMATE_FEATURE.TARGET_HUMIDITY);
  const fanModes = optionList(attrs.fan_modes);
  const canFanMode = supportsFeature(attrs, CLIMATE_FEATURE.FAN_MODE) && fanModes.length > 0;
  const presets = optionList(attrs.preset_modes);
  const canPreset = supportsFeature(attrs, CLIMATE_FEATURE.PRESET_MODE) && presets.length > 0;
  const swingModes = optionList(attrs.swing_modes);
  const canSwing = supportsFeature(attrs, CLIMATE_FEATURE.SWING_MODE) && swingModes.length > 0;
  const swingHorizontal = optionList(attrs.swing_horizontal_modes);
  const canSwingHorizontal =
    supportsFeature(attrs, CLIMATE_FEATURE.SWING_HORIZONTAL_MODE) && swingHorizontal.length > 0;
  const canTurnOn = supportsFeature(attrs, CLIMATE_FEATURE.TURN_ON);
  const canTurnOff = supportsFeature(attrs, CLIMATE_FEATURE.TURN_OFF);

  const unit = text(attrs.unit_of_measurement) ?? "°";
  const step = num(attrs.target_temp_step) ?? 0.5;
  const minTemp = num(attrs.min_temp) ?? 7;
  const maxTemp = num(attrs.max_temp) ?? 35;
  const target = num(attrs.temperature);
  const low = num(attrs.target_temp_low);
  const high = num(attrs.target_temp_high);

  const clampTemp = (value: number) =>
    Math.round(Math.min(Math.max(value, minTemp), maxTemp) * 100) / 100;

  const humidity = num(attrs.humidity) ?? 50;
  const minHumidity = num(attrs.min_humidity) ?? 30;
  const maxHumidity = num(attrs.max_humidity) ?? 99;

  if (
    modes.length === 0 && !canTargetTemp && !canTargetRange && !canTargetHumidity &&
    !canFanMode && !canPreset && !canSwing && !canSwingHorizontal && !canTurnOn && !canTurnOff
  ) {
    return null;
  }

  return (
    <ActionsSection busy={busy}>
      <OnOffRow
        isOn={entity.state !== "off"}
        onTurnOn={() => call("turn_on")}
        onTurnOff={() => call("turn_off")}
        disabled={busy}
        showOn={canTurnOn}
        showOff={canTurnOff}
      />
      {/*
        RFC-008 §4.1: the mode list comes from `hvac_modes`, not from a bit —
        the single most common way to ship a thermostat a "Dry" button it
        cannot honour. The labels come from `hvacMode`, so nobody ever reads
        the raw `heat_cool`.
      */}
      <OptionRow
        label={tAttr("hvac_modes")}
        options={modes}
        current={entity.state}
        disabled={busy}
        translate={(mode) => (HVAC_MODE_KEYS.includes(mode) ? tHvacMode(mode) : mode)}
        onSelect={(hvac_mode) => call("set_hvac_mode", { hvac_mode })}
      />
      {canTargetTemp && target !== undefined && (
        <Stepper
          label={tAttr("temperature")}
          display={`${target}${unit}`}
          disabled={busy}
          onStep={(direction) =>
            call("set_temperature", { temperature: clampTemp(target + direction * step) })
          }
        />
      )}
      {canTargetRange && low !== undefined && high !== undefined && (
        <>
          <Stepper
            label={tAttr("target_temp_low")}
            display={`${low}${unit}`}
            disabled={busy}
            onStep={(direction) =>
              call("set_temperature", {
                target_temp_low: clampTemp(low + direction * step),
                target_temp_high: high,
              })
            }
          />
          <Stepper
            label={tAttr("target_temp_high")}
            display={`${high}${unit}`}
            disabled={busy}
            onStep={(direction) =>
              call("set_temperature", {
                target_temp_low: low,
                target_temp_high: clampTemp(high + direction * step),
              })
            }
          />
        </>
      )}
      {canTargetHumidity && (
        <CommitSlider
          label={tAttr("humidity")}
          value={humidity}
          display={`${Math.round(humidity)}%`}
          min={minHumidity}
          max={maxHumidity}
          onCommit={(next) => call("set_humidity", { humidity: next })}
          disabled={busy}
        />
      )}
      {canPreset && (
        <OptionRow
          label={tAttr("preset_mode")}
          options={presets}
          current={text(attrs.preset_mode)}
          disabled={busy}
          onSelect={(preset_mode) => call("set_preset_mode", { preset_mode })}
        />
      )}
      {canFanMode && (
        <OptionRow
          label={tAttr("fan_mode")}
          options={fanModes}
          current={text(attrs.fan_mode)}
          disabled={busy}
          onSelect={(fan_mode) => call("set_fan_mode", { fan_mode })}
        />
      )}
      {canSwing && (
        <OptionRow
          label={tAttr("swing_mode")}
          options={swingModes}
          current={text(attrs.swing_mode)}
          disabled={busy}
          onSelect={(swing_mode) => call("set_swing_mode", { swing_mode })}
        />
      )}
      {canSwingHorizontal && (
        <OptionRow
          label={tAttr("swing_horizontal_mode")}
          options={swingHorizontal}
          current={text(attrs.swing_horizontal_mode)}
          disabled={busy}
          onSelect={(swing_horizontal_mode) =>
            call("set_swing_horizontal_mode", { swing_horizontal_mode })
          }
        />
      )}
    </ActionsSection>
  );
}

// ── vacuum ────────────────────────────────────────────────────────────────

function VacuumActions({ entity }: DomainProps) {
  const t = useTranslations("homeAutomation.entityDetail");
  const tAttr = useTranslations("homeAutomation.entityDetail.attributes");
  const run = useRunAction();
  const { start, pause, stop, returnToBase, setFanSpeed, isPending } = useVacuumCommand();
  const { mutateAsync: callService, isPending: servicePending } = useCallService();
  const busy = isPending || servicePending;

  const id = entity.entity_id;
  const attrs = entity.attributes;

  const canStart = supportsFeature(attrs, VACUUM_FEATURE.START);
  const canPause = supportsFeature(attrs, VACUUM_FEATURE.PAUSE);
  const canStop = supportsFeature(attrs, VACUUM_FEATURE.STOP);
  const canReturn = supportsFeature(attrs, VACUUM_FEATURE.RETURN_HOME);
  const canLocate = supportsFeature(attrs, VACUUM_FEATURE.LOCATE);
  const canCleanSpot = supportsFeature(attrs, VACUUM_FEATURE.CLEAN_SPOT);
  const speeds = optionList(attrs.fan_speed_list);
  const canFanSpeed = supportsFeature(attrs, VACUUM_FEATURE.FAN_SPEED) && speeds.length > 0;

  if (!canStart && !canPause && !canStop && !canReturn && !canLocate && !canCleanSpot && !canFanSpeed) {
    return null;
  }

  return (
    <ActionsSection busy={busy}>
      {(canStart || canPause || canStop) && (
        <div className="flex gap-2">
          {canStart && (
            <Button className="flex-1" variant="outline" onClick={() => run(() => start(id))} disabled={busy}>
              <Play />
              {t("vacuumStart")}
            </Button>
          )}
          {canPause && (
            <Button className="flex-1" variant="outline" onClick={() => run(() => pause(id))} disabled={busy}>
              <Pause />
              {t("vacuumPause")}
            </Button>
          )}
          {canStop && (
            <Button className="flex-1" variant="outline" onClick={() => run(() => stop(id))} disabled={busy}>
              <Square />
              {t("stopButton")}
            </Button>
          )}
        </div>
      )}
      {(canReturn || canLocate || canCleanSpot) && (
        <div className="flex gap-2">
          {canReturn && (
            <Button className="flex-1" variant="outline" onClick={() => run(() => returnToBase(id))} disabled={busy}>
              <Home />
              {t("vacuumReturn")}
            </Button>
          )}
          {canLocate && (
            <Button
              className="flex-1"
              variant="outline"
              onClick={() => run(() => callService({ domain: "vacuum", service: "locate", entity_id: id }))}
              disabled={busy}
            >
              <MapPin />
              {t("locate")}
            </Button>
          )}
          {canCleanSpot && (
            <Button
              className="flex-1"
              variant="outline"
              onClick={() => run(() => callService({ domain: "vacuum", service: "clean_spot", entity_id: id }))}
              disabled={busy}
            >
              {t("cleanSpot")}
            </Button>
          )}
        </div>
      )}
      {canFanSpeed && (
        <OptionRow
          label={tAttr("fan_speed")}
          options={speeds}
          current={text(attrs.fan_speed)}
          disabled={busy}
          onSelect={(speed) => run(() => setFanSpeed(id, speed))}
        />
      )}
    </ActionsSection>
  );
}

// ── alarm_control_panel ───────────────────────────────────────────────────

function AlarmActions({ entity }: DomainProps) {
  const t = useTranslations("homeAutomation.entityDetail");
  const run = useRunAction();
  const { disarm, armHome, armAway, armNight, isPending } = useAlarmControl();
  const { mutateAsync: callService, isPending: servicePending } = useCallService();
  const busy = isPending || servicePending;

  const id = entity.entity_id;
  const attrs = entity.attributes;

  // `alarm_disarm` has no feature bit in Home Assistant — a panel that can be
  // armed can always be disarmed, so it is offered unconditionally.
  const canArmHome = supportsFeature(attrs, ALARM_FEATURE.ARM_HOME);
  const canArmAway = supportsFeature(attrs, ALARM_FEATURE.ARM_AWAY);
  const canArmNight = supportsFeature(attrs, ALARM_FEATURE.ARM_NIGHT);
  const canArmVacation = supportsFeature(attrs, ALARM_FEATURE.ARM_VACATION);
  const canArmCustom = supportsFeature(attrs, ALARM_FEATURE.ARM_CUSTOM_BYPASS);

  const armed = entity.state !== "disarmed";

  return (
    <ActionsSection busy={busy}>
      <Button
        variant={armed ? "outline" : "default"}
        onClick={() => run(() => disarm(id))}
        disabled={busy}
      >
        {t("disarmButton")}
      </Button>
      {(canArmHome || canArmAway || canArmNight || canArmVacation || canArmCustom) && (
        <div className="flex flex-wrap gap-2">
          {canArmHome && (
            <Button
              size="sm"
              variant={entity.state === "armed_home" ? "default" : "outline"}
              onClick={() => run(() => armHome(id))}
              disabled={busy}
            >
              {t("armHomeButton")}
            </Button>
          )}
          {canArmAway && (
            <Button
              size="sm"
              variant={entity.state === "armed_away" ? "default" : "outline"}
              onClick={() => run(() => armAway(id))}
              disabled={busy}
            >
              {t("armAwayButton")}
            </Button>
          )}
          {canArmNight && (
            <Button
              size="sm"
              variant={entity.state === "armed_night" ? "default" : "outline"}
              onClick={() => run(() => armNight(id))}
              disabled={busy}
            >
              {t("armNightButton")}
            </Button>
          )}
          {canArmVacation && (
            <Button
              size="sm"
              variant={entity.state === "armed_vacation" ? "default" : "outline"}
              onClick={() =>
                run(() =>
                  callService({
                    domain: "alarm_control_panel",
                    service: "alarm_arm_vacation",
                    entity_id: id,
                  }),
                )
              }
              disabled={busy}
            >
              {t("armVacationButton")}
            </Button>
          )}
          {canArmCustom && (
            <Button
              size="sm"
              variant={entity.state === "armed_custom_bypass" ? "default" : "outline"}
              onClick={() =>
                run(() =>
                  callService({
                    domain: "alarm_control_panel",
                    service: "alarm_arm_custom_bypass",
                    entity_id: id,
                  }),
                )
              }
              disabled={busy}
            >
              {t("armCustomBypassButton")}
            </Button>
          )}
        </div>
      )}
    </ActionsSection>
  );
}

// ── humidifier ────────────────────────────────────────────────────────────

function HumidifierActions({ entity }: DomainProps) {
  const tAttr = useTranslations("homeAutomation.entityDetail.attributes");
  const run = useRunAction();
  const { mutateAsync: callService, isPending: busy } = useCallService();

  const id = entity.entity_id;
  const attrs = entity.attributes;
  const call = (service: string, service_data?: Record<string, unknown>) =>
    run(() => callService({ domain: "humidifier", service, entity_id: id, service_data }));

  const modes = optionList(attrs.available_modes);
  const canModes = supportsFeature(attrs, HUMIDIFIER_FEATURE.MODES) && modes.length > 0;

  const humidity = num(attrs.humidity) ?? 50;
  const minHumidity = num(attrs.min_humidity) ?? 0;
  const maxHumidity = num(attrs.max_humidity) ?? 100;

  return (
    <ActionsSection busy={busy}>
      <OnOffRow
        isOn={entity.state === "on"}
        onTurnOn={() => call("turn_on")}
        onTurnOff={() => call("turn_off")}
        disabled={busy}
      />
      <CommitSlider
        label={tAttr("humidity")}
        value={humidity}
        display={`${Math.round(humidity)}%`}
        min={minHumidity}
        max={maxHumidity}
        onCommit={(next) => call("set_humidity", { humidity: next })}
        disabled={busy}
      />
      {canModes && (
        <OptionRow
          label={tAttr("mode")}
          options={modes}
          current={text(attrs.mode)}
          disabled={busy}
          onSelect={(mode) => call("set_mode", { mode })}
        />
      )}
    </ActionsSection>
  );
}

// ── switch, input_boolean, scene, script, automation ──────────────────────

function ToggleActions({ entity }: DomainProps) {
  const t = useTranslations("homeAutomation.entityDetail");
  const run = useRunAction();
  const { toggle, isPending: busy } = useToggleEntity();
  const isOn = entity.state === "on";

  return (
    <ActionsSection busy={busy}>
      <Button
        variant={isOn ? "default" : "outline"}
        onClick={() => run(() => toggle(entity.entity_id, entity.state))}
        disabled={busy}
      >
        {isOn ? t("turnOffButton") : t("turnOnButton")}
      </Button>
    </ActionsSection>
  );
}

function SceneActions({ entity }: DomainProps) {
  const t = useTranslations("homeAutomation.entityDetail");
  const run = useRunAction();
  const { mutateAsync: callService, isPending: busy } = useCallService();
  const domain = entity.entity_id.split(".")[0];
  const isRunning = domain === "script" && entity.state === "on";

  return (
    <ActionsSection busy={busy}>
      <div className="flex gap-2">
        <Button
          className="flex-1"
          onClick={() =>
            run(() => callService({ domain, service: "turn_on", entity_id: entity.entity_id }))
          }
          disabled={busy}
        >
          {t("activateButton")}
        </Button>
        {isRunning && (
          <Button
            className="flex-1"
            variant="outline"
            onClick={() =>
              run(() => callService({ domain, service: "turn_off", entity_id: entity.entity_id }))
            }
            disabled={busy}
          >
            {t("stopButton")}
          </Button>
        )}
      </div>
    </ActionsSection>
  );
}

function AutomationActions({ entity }: DomainProps) {
  const t = useTranslations("homeAutomation.entityDetail");
  const run = useRunAction();
  const { toggle, isPending } = useToggleEntity();
  const { mutateAsync: callService, isPending: servicePending } = useCallService();
  const busy = isPending || servicePending;
  const isOn = entity.state === "on";

  return (
    <ActionsSection busy={busy}>
      <div className="flex gap-2">
        <Button
          className="flex-1"
          variant="outline"
          onClick={() =>
            run(() =>
              callService({
                domain: "automation",
                service: "trigger",
                entity_id: entity.entity_id,
                // HA's own default, said out loud: without it a household
                // pressing "Trigger" would silently get a *conditional* run.
                service_data: { skip_condition: true },
              }),
            )
          }
          disabled={busy}
        >
          {t("triggerButton")}
        </Button>
        <Button
          className="flex-1"
          variant={isOn ? "default" : "outline"}
          onClick={() => run(() => toggle(entity.entity_id, entity.state))}
          disabled={busy}
        >
          {isOn ? t("disableButton") : t("enableButton")}
        </Button>
      </div>
    </ActionsSection>
  );
}

// ── the domain nobody wrote a case for ────────────────────────────────────

function FallbackActions({ entity }: DomainProps) {
  const t = useTranslations("homeAutomation.entityDetail");
  const run = useRunAction();
  const { mutateAsync: callService, isPending: busy } = useCallService();

  /*
    RFC-008 §5.3 — the domain is one nobody here has heard of.

    `supported_features` is a bitmask whose meaning comes from that domain's
    own IntFlag, so reading bits without knowing the enum ships buttons that
    do something else entirely. `homeassistant.turn_on` / `turn_off` is the
    one pair Home Assistant guarantees for anything with on/off semantics —
    the same pair `group` uses across mixed members — and an entity that is
    neither on nor off has no such semantics, so it gets nothing rather than a
    button that fails.
  */
  const shape = classifyEntityState(entity.state);
  if (shape.kind !== "toggle") return null;
  const isOn = shape.on;

  return (
    <ActionsSection busy={busy}>
      <Button
        variant={isOn ? "default" : "outline"}
        onClick={() =>
          run(() =>
            callService({
              domain: "homeassistant",
              service: isOn ? "turn_off" : "turn_on",
              entity_id: entity.entity_id,
            }),
          )
        }
        disabled={busy}
      >
        {isOn ? t("turnOffButton") : t("turnOnButton")}
      </Button>
    </ActionsSection>
  );
}

// ── the dispatcher ────────────────────────────────────────────────────────

function UnavailableNotice() {
  const t = useTranslations("homeAutomation.entityDetail");
  return (
    <ActionsSection>
      <p className="text-sm text-muted-foreground text-center py-4">{t("unavailableNotice")}</p>
    </ActionsSection>
  );
}

/**
 * Everything a household can do to this entity, or nothing at all.
 *
 * Returns `null` — no separator, no heading — for a read-only domain and for
 * any entity whose gates all came back false.
 */
export function EntityActions({ entity }: DomainProps) {
  const domain = entity.entity_id.split(".")[0];

  // Task 2's reading gate, unchanged: `unavailable`, `unknown` and an empty
  // state all mean there is nothing to drive. RFC-008 R1 carves out the
  // domains whose *resting* state is `unknown` (`button`, `event`, `date`…),
  // and every one of them is in the later phase.
  if (classifyEntityState(entity.state).kind === "unavailable") {
    return <UnavailableNotice />;
  }

  switch (domain) {
    case "light":
      return <LightActions entity={entity} />;
    case "fan":
      return <FanActions entity={entity} />;
    case "cover":
      return <CoverActions entity={entity} />;
    case "lock":
      return <LockActions entity={entity} />;
    case "media_player":
      return <MediaPlayerActions entity={entity} />;
    case "climate":
      return <ClimateActions entity={entity} />;
    case "vacuum":
      return <VacuumActions entity={entity} />;
    case "alarm_control_panel":
      return <AlarmActions entity={entity} />;
    case "humidifier":
      return <HumidifierActions entity={entity} />;
    case "switch":
    case "input_boolean":
      return <ToggleActions entity={entity} />;
    case "scene":
    case "script":
      return <SceneActions entity={entity} />;
    case "automation":
      return <AutomationActions entity={entity} />;
    // RFC-008 §4.3 — read-only. The value of the sheet here is the reading,
    // the attributes and the graph, not a button.
    case "sensor":
    case "binary_sensor":
      return null;
    default:
      return <FallbackActions entity={entity} />;
  }
}
