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
 * 3. **Every action states which service it calls**, as the first argument to
 *    `run()` — the descriptor `useCallService` would take anyway. That is not
 *    bookkeeping: it is what lets one gate consult `DANGEROUS_ACTIONS`
 *    (RFC-008 §6) and put a confirmation in front of the calls a wall panel
 *    should not fire on one tap. For a service that table already names, the
 *    confirmation cannot be forgotten — it arrives from the lookup, and the
 *    author of the control does nothing to get it. For a service it does not
 *    name, nothing happens; see the note there before adding a control that
 *    could hurt somebody.
 * 4. **A row of §6 sends the descriptor itself**, with no convenience hook
 *    behind it, so the call that was confirmed and the call that goes out are
 *    the same object. The hooks stay for everything harmless; two statements
 *    of one service is a drift a test can only pin on one side.
 */

import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Loader2, Play, Pause, Square, SkipBack, SkipForward, Volume2, VolumeX,
  Minus, Plus, ChevronUp, ChevronDown, Home, MapPin, Shuffle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDestructive } from "@/components/confirm-destructive";
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
  fanPowerButtons, optionList, supportsBrightness, supportsColorTemp, supportsFeature,
} from "@/lib/ha-features";
import { classifyEntityState } from "@/lib/ha-entity-display";
import { dangerousAction, type DangerousAction } from "@/lib/ha-dangerous-actions";
import { OPTIMISTIC_SETTLE_MS } from "@/lib/home-assistant-optimism";
import type { HAEntity, HAServiceCall } from "@/types/home-assistant";

// ── Small shared pieces ───────────────────────────────────────────────────

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * What a control is about to do: the service call itself, and — for the
 * actions a convenience hook already wraps — how to actually make it.
 *
 * The descriptor is mandatory even when `via` does the work, because it is the
 * only thing that identifies the action. `unlock(id)` says nothing a lookup can
 * use; `{ domain: "lock", service: "unlock" }` says everything.
 */
type RunAction = (call: HAServiceCall, via?: () => Promise<unknown>) => Promise<boolean>;

/**
 * The runner every control in this file uses, supplied by {@link DangerousActionGate}.
 *
 * Context rather than a plain hook so there is exactly one confirmation dialog
 * per sheet, mounted by the dispatcher, rather than one per control — and so
 * that a control physically cannot call a service without going past it.
 */
const RunActionContext = createContext<{ run: RunAction; isPending: boolean } | null>(null);

function useRunAction() {
  const ctx = useContext(RunActionContext);
  if (!ctx) {
    throw new Error("A detail-sheet control must be rendered inside <EntityActions>.");
  }
  return ctx;
}

/**
 * One confirmation step in front of every service `DANGEROUS_ACTIONS` names.
 *
 * The gate wraps whatever the dispatcher chose to render and hands it `run`.
 * A control passes the service it wants; the gate looks that service up in the
 * table (RFC-008 §6) and either fires it or asks first, naming the entity.
 * Nothing about the call changes on the way through: the same hook runs it, a
 * refusal still raises the same toast, and the boolean an optimistic control
 * reads still means "the device took it".
 *
 * Dismissal resolves `false` — the same answer a refused call gives — so a
 * control holding an optimistic guess drops it rather than sitting on a value
 * nobody agreed to. And **nothing is sent**: the promise the control is waiting
 * on never reaches `via`.
 *
 * The dialog is `ConfirmDestructive`, the same component behind the recycle
 * bin's permanent delete and the family delete, so the confirm button is the
 * destructive-coloured one on the far side of the footer and Radix puts focus
 * on Cancel — a stray thumb lands on the harmless half.
 */
function DangerousActionGate({
  entity,
  displayName,
  children,
}: {
  entity: HAEntity;
  displayName?: string;
  children: ReactNode;
}) {
  const t = useTranslations("homeAutomation");
  const { mutateAsync: callService, isPending } = useCallService();

  /*
    The question on screen, and the promise the control is still waiting on.

    Held in a ref as well as in state because the two dialog handlers need the
    record itself, and because whichever of them runs first has to be able to
    take it — Radix closes the dialog after `onConfirm`, which fires
    `onOpenChange(false)` immediately afterwards, and a dismissal handler that
    could not tell those apart would resolve the same promise twice and report
    a confirmed action as cancelled.
  */
  const asked = useRef<{
    action: DangerousAction;
    call: HAServiceCall;
    via?: () => Promise<unknown>;
    settle: (fired: boolean) => void;
  } | null>(null);
  const [pending, setPending] = useState<DangerousAction | null>(null);

  /** Run it for real, say so when Home Assistant refuses, report which it was. */
  const fire = useCallback(
    async (call: HAServiceCall, via?: () => Promise<unknown>): Promise<boolean> => {
      try {
        await (via ? via() : callService(call));
        return true;
      } catch {
        toast.error(t("controlFailed"));
        return false;
      }
    },
    [callService, t],
  );

  const run = useCallback<RunAction>(
    (call, via) => {
      const action = dangerousAction(call);
      if (!action) return fire(call, via);
      return new Promise<boolean>((settle) => {
        asked.current = { action, call, via, settle };
        setPending(action);
      });
    },
    [fire],
  );

  /** Take the pending question, so only one of the two handlers can answer it. */
  const take = useCallback(() => {
    const record = asked.current;
    asked.current = null;
    setPending(null);
    return record;
  }, []);

  // A sheet closed with the question still up leaves a control awaiting an
  // answer that can no longer come. Nothing was sent, so the answer is `false`.
  useEffect(() => () => asked.current?.settle(false), []);

  const name = displayName || entity.name || entity.entity_id;

  return (
    <RunActionContext.Provider value={{ run, isPending }}>
      {children}
      {pending && (
        <ConfirmDestructive
          open
          onOpenChange={(open) => {
            if (open) return;
            take()?.settle(false);
          }}
          title={t(`entityDetail.confirm.${pending.copy}.title`, { name })}
          description={t(`entityDetail.confirm.${pending.copy}.body`, { name })}
          confirmLabel={t(pending.confirmLabelKey)}
          onConfirm={() => {
            const record = take();
            if (record) void fire(record.call, record.via).then(record.settle);
          }}
        />
      )}
    </RunActionContext.Provider>
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

/**
 * A reading the household is about to change, held locally until the real one
 * catches up.
 *
 * Two failures this exists to prevent, both invisible without a live device:
 *
 * 1. **A fully-controlled Radix slider with no `onValueChange` is inert.**
 *    `handleSlideEnd` compares the current value against the one captured at
 *    slide start; with no local state both reads come from the same unchanged
 *    prop, `hasChanged` stays false, and `onValueCommit` never fires. The thumb
 *    does not move and no service call is sent. Only the keyboard path works,
 *    because that commits directly — so a keyboard-driven test passes against
 *    completely broken drag. `settings/pocket-money/page.tsx` carries the same
 *    warning in its own words.
 * 2. **A stepper that reads its base from the entity compounds off stale
 *    state.** `climate.set_temperature` returns long before Home Assistant
 *    reports the new setpoint, so three quick taps of `+` all compute
 *    `20.0 + 0.5` and the room ends up half a degree warmer instead of one and
 *    a half.
 *
 * A pending value has exactly **three** ways to end — the same three
 * `page.tsx`'s tiles have. Fewer than three is a way of being confidently
 * wrong for as long as the panel is on:
 *
 * - **The source moves.** The usual case, and the reason a *successful* value
 *   is not dropped the moment the call returns: the control would snap back to
 *   a one-poll-old reading in the gap before Home Assistant catches up.
 * - **The call fails.** Waiting for the source cannot work here — the light
 *   stayed at 20%, so the poll returns 20% again and the source never moves.
 *   The thumb would sit at the 80% nobody achieved, with the toast that
 *   explained it long gone.
 * - **`OPTIMISTIC_SETTLE_MS` elapses.** The one that is easy to forget: Home
 *   Assistant *accepted* the call and returned 200, and the device did
 *   nothing. A Zigbee bulb that has drifted out of radio range fails exactly
 *   this way — the call resolves true, the reading never moves, and without
 *   the timeout the slider reads 80% for a bulb that is still dim. On a
 *   stepper each tap then compounds off that fiction, so three taps at an
 *   unreachable thermostat leave the panel reading 21.5° against a device
 *   sitting at 20.0°, permanently.
 *
 * Being one poll behind is a different thing from being confidently wrong.
 */
function usePendingNumber<T extends number | undefined>(source: T) {
  const [pending, setPendingState] = useState<number | null>(null);
  const [seen, setSeen] = useState<T>(source);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Set the pending value, or drop it with `null`.
   *
   * Setting one re-arms the settle from scratch, so a household still moving
   * the thumb is not cut off by a timer armed for an earlier position.
   */
  const setPending = useCallback((value: number | null) => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = null;
    setPendingState(value);
    if (value === null) return;
    settle.current = setTimeout(() => {
      settle.current = null;
      setPendingState(null);
    }, OPTIMISTIC_SETTLE_MS);
  }, []);

  // Nothing should keep firing after the sheet is closed.
  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );

  /*
    Adjusting state during render rather than in an effect: this is a
    derivation, and an effect would render the stale value once first. The
    timer is deliberately left running — its callback sets `null` on a value
    that is already `null`, which React bails out of, and touching the ref
    during render would be a side effect in the one place it does not belong.
  */
  if (source !== seen) {
    setSeen(source);
    setPendingState(null);
  }

  const shown = (pending ?? source) as T extends undefined ? number | undefined : number;
  return [shown, setPending] as const;
}

/** A labelled slider that reads live under the thumb and commits on release. */
function CommitSlider({
  label, value, format, min = 0, max = 100, step = 1, onCommit, disabled,
}: {
  label: string;
  value: number;
  format: (value: number) => string;
  min?: number;
  max?: number;
  step?: number;
  /** Resolves false when Home Assistant refused the call. */
  onCommit: (value: number) => Promise<boolean>;
  disabled?: boolean;
}) {
  const [shown, setPending] = usePendingNumber(value);
  const clamped = Math.min(Math.max(shown, min), max);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{format(clamped)}</span>
      </div>
      <Slider
        value={[clamped]}
        min={min}
        max={max}
        step={step}
        onValueChange={(next) => setPending(next[0])}
        onValueCommit={(next) => {
          setPending(next[0]);
          // Back to the last known reading if the call was refused: that is
          // the truth as far as we know it, and one poll of staleness beats
          // an indefinitely wrong thumb.
          void onCommit(next[0]).then((ok) => {
            if (!ok) setPending(null);
          });
        }}
        disabled={disabled}
        className="cursor-pointer"
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
  onStep: (direction: -1 | 1) => void | Promise<void>;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <Button size="icon" variant="outline" onClick={() => void onStep(-1)} disabled={disabled}>
          <Minus />
        </Button>
        <span className="min-w-16 text-center text-lg font-semibold tabular-nums">{display}</span>
        <Button size="icon" variant="outline" onClick={() => void onStep(1)} disabled={disabled}>
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
  const { run, isPending: servicePending } = useRunAction();
  const { turnOn, turnOff, setBrightness, setColorTemp, isPending } = useLightControl();
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
        onTurnOn={() =>
          run({ domain: "light", service: "turn_on", entity_id: id }, () => turnOn(id))
        }
        onTurnOff={() =>
          run({ domain: "light", service: "turn_off", entity_id: id }, () => turnOff(id))
        }
        disabled={busy}
      />
      {supportsBrightness(attrs) && (
        <CommitSlider
          label={tAttr("brightness")}
          value={brightnessPercent}
          format={(percent) => `${Math.round(percent)}%`}
          step={5}
          onCommit={(percent) =>
            run({ domain: "light", service: "turn_on", entity_id: id }, () =>
              setBrightness(id, Math.round((percent / 100) * 255)),
            )
          }
          disabled={busy}
        />
      )}
      {supportsColorTemp(attrs) && (
        <CommitSlider
          label={tAttr("color_temp")}
          value={kelvin}
          format={(next) => `${Math.round(next)} K`}
          min={minKelvin}
          max={maxKelvin}
          step={50}
          onCommit={(next) =>
            run({ domain: "light", service: "turn_on", entity_id: id }, () => setColorTemp(id, next))
          }
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
            run({
              domain: "light",
              service: "turn_on",
              entity_id: id,
              service_data: { effect },
            })
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
  const { run, isPending: servicePending } = useRunAction();
  const { turnOn, turnOff, setSpeed, setOscillating, setPresetMode, isPending } = useFanControl();
  const busy = isPending || servicePending;

  const id = entity.entity_id;
  const attrs = entity.attributes;
  const isOn = entity.state === "on";

  // Not a plain bit test — see `fanPowerButtons`. A fan predating HA 2024.8
  // sets neither TURN_ON nor TURN_OFF and can still be switched off.
  const { on: canTurnOn, off: canTurnOff } = fanPowerButtons(attrs);
  const canSetSpeed = supportsFeature(attrs, FAN_FEATURE.SET_SPEED);
  const canOscillate = supportsFeature(attrs, FAN_FEATURE.OSCILLATE);
  const canSetDirection = supportsFeature(attrs, FAN_FEATURE.DIRECTION);
  const presets = optionList(attrs.preset_modes);
  const canPreset = supportsFeature(attrs, FAN_FEATURE.PRESET_MODE) && presets.length > 0;

  const percentage = num(attrs.percentage) ?? 0;
  /*
    `percentage_step` is not an integer on a stepped fan: three speeds report
    33.333…, and rounding that to 33 caps the slider at 99, so a fan running
    flat out read "99%". Radix takes a fractional step happily. The commit
    floors instead, which is exactly what `fan.set_percentage`'s own
    `vol.Coerce(int)` does to the number on arrival — 66.67 has to reach Home
    Assistant as 66 (speed 2), not as the 67 that rounding would make it
    (speed 3).
  */
  const rawStep = num(attrs.percentage_step);
  const step = rawStep && rawStep > 0 ? rawStep : 1;
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
        onTurnOn={() => run({ domain: "fan", service: "turn_on", entity_id: id }, () => turnOn(id))}
        onTurnOff={() =>
          run({ domain: "fan", service: "turn_off", entity_id: id }, () => turnOff(id))
        }
        disabled={busy}
        showOn={canTurnOn}
        showOff={canTurnOff}
      />
      {canSetSpeed && (
        <CommitSlider
          label={tAttr("percentage")}
          value={percentage}
          format={(next) => `${Math.round(next)}%`}
          step={step}
          onCommit={(next) =>
            run({ domain: "fan", service: "set_percentage", entity_id: id }, () => setSpeed(id, Math.floor(next)))
          }
          disabled={busy}
        />
      )}
      {canPreset && (
        <OptionRow
          label={tAttr("preset_mode")}
          options={presets}
          current={text(attrs.preset_mode)}
          disabled={busy}
          onSelect={(preset) =>
            run({ domain: "fan", service: "set_preset_mode", entity_id: id }, () => setPresetMode(id, preset))
          }
        />
      )}
      {canOscillate && (
        <Button
          variant={oscillating ? "default" : "outline"}
          onClick={() =>
            run({ domain: "fan", service: "oscillate", entity_id: id }, () => setOscillating(id, !oscillating))
          }
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
            run({
              domain: "fan",
              service: "set_direction",
              entity_id: id,
              service_data: { direction: next },
            })
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
  const { run, isPending: servicePending } = useRunAction();
  const { open, close, stop, setPosition, isPending } = useCoverControl();
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
    run({ domain: "cover", service, entity_id: id });

  return (
    <ActionsSection busy={busy}>
      {(canOpen || canClose || canStop) && (
        <div className="flex gap-2">
          {canOpen && (
            <Button
              className="flex-1"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run({ domain: "cover", service: "open_cover", entity_id: id }, () => open(id))
              }
            >
              <ChevronUp />
              {tHome("open")}
            </Button>
          )}
          {canStop && (
            <Button
              className="flex-1"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run({ domain: "cover", service: "stop_cover", entity_id: id }, () => stop(id))
              }
            >
              <Square />
              {t("stopButton")}
            </Button>
          )}
          {canClose && (
            <Button
              className="flex-1"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run({ domain: "cover", service: "close_cover", entity_id: id }, () => close(id))
              }
            >
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
          format={(next) => `${Math.round(next)}%`}
          step={5}
          onCommit={(next) =>
            run({ domain: "cover", service: "set_cover_position", entity_id: id }, () => setPosition(id, next))
          }
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
          format={(next) => `${Math.round(next)}%`}
          step={5}
          onCommit={(next) =>
            run({
              domain: "cover",
              service: "set_cover_tilt_position",
              entity_id: id,
              service_data: { tilt_position: next },
            })
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
  const { run, isPending: servicePending } = useRunAction();
  const { lock, isPending } = useLockControl();
  const busy = isPending || servicePending;

  const id = entity.entity_id;
  const isLocked = entity.state === "locked";
  /*
    Locking is one tap; unlocking and the latch are not.

    Both are in DANGEROUS_ACTIONS, so the confirmation comes from stating the
    service, not from anything written here — which is the point: nothing on
    this button distinguishes it from `lock.lock` above, and it still asks.
    `lock.lock` is deliberately absent from that table, because confirming your
    way to a locked door every time is friction with no safety benefit.

    Which is also why unlocking no longer goes through `useLockControl.unlock`
    while locking still does. The dialog quotes the descriptor and `run` sends
    the descriptor, so the two cannot disagree. Routed through the hook they
    could: retarget `unlock` at `lock.open` and the panel would say "Unlock
    Front door?", show the unlock wording, and throw the latch.
  */
  const canOpenLatch = supportsFeature(entity.attributes, LOCK_FEATURE.OPEN);

  return (
    <ActionsSection busy={busy}>
      <div className="flex gap-2">
        <Button
          className="flex-1"
          variant={isLocked ? "default" : "outline"}
          onClick={() => run({ domain: "lock", service: "lock", entity_id: id }, () => lock(id))}
          disabled={busy}
        >
          {tHome("lock")}
        </Button>
        <Button
          className="flex-1"
          variant={!isLocked ? "default" : "outline"}
          onClick={() =>
            run({ domain: "lock", service: "unlock", entity_id: id })
          }
          disabled={busy}
        >
          {tHome("unlock")}
        </Button>
      </div>
      {canOpenLatch && (
        <Button
          variant="outline"
          onClick={() => run({ domain: "lock", service: "open", entity_id: id })}
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
  const { run, isPending: servicePending } = useRunAction();
  const {
    play, pause, stop, next, previous, setVolume, mute, selectSource, isPending,
  } = useMediaPlayerControl();
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
          run({ domain: "media_player", service: "turn_on", entity_id: id })
        }
        onTurnOff={() =>
          run({ domain: "media_player", service: "turn_off", entity_id: id })
        }
        disabled={busy}
        showOn={canTurnOn}
        showOff={canTurnOff}
      />
      {transport && (
        <div className="flex gap-2">
          {canPrevious && (
            <Button
              className="flex-1"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run({ domain: "media_player", service: "media_previous_track", entity_id: id }, () => previous(id))
              }
            >
              <SkipBack />
              <span className="sr-only">{t("mediaPrevious")}</span>
            </Button>
          )}
          {canPlay && (
            <Button
              className="flex-1"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run({ domain: "media_player", service: "media_play", entity_id: id }, () => play(id))
              }
            >
              <Play />
              <span className="sr-only">{t("mediaPlay")}</span>
            </Button>
          )}
          {canPause && (
            <Button
              className="flex-1"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run({ domain: "media_player", service: "media_pause", entity_id: id }, () => pause(id))
              }
            >
              <Pause />
              <span className="sr-only">{t("mediaPause")}</span>
            </Button>
          )}
          {canStop && (
            <Button
              className="flex-1"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run({ domain: "media_player", service: "media_stop", entity_id: id }, () => stop(id))
              }
            >
              <Square />
              <span className="sr-only">{t("stopButton")}</span>
            </Button>
          )}
          {canNext && (
            <Button
              className="flex-1"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run({ domain: "media_player", service: "media_next_track", entity_id: id }, () => next(id))
              }
            >
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
          format={(percent) => `${Math.round(percent)}%`}
          step={1}
          onCommit={(percent) =>
            run({ domain: "media_player", service: "volume_set", entity_id: id }, () => setVolume(id, percent / 100))
          }
          disabled={busy}
        />
      )}
      {canMute && (
        <Button
          variant={muted ? "default" : "outline"}
          onClick={() =>
            run({ domain: "media_player", service: "volume_mute", entity_id: id }, () => mute(id, !muted))
          }
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
          onSelect={(source) =>
            run({ domain: "media_player", service: "select_source", entity_id: id }, () => selectSource(id, source))
          }
        />
      )}
      {canSoundMode && (
        <OptionRow
          label={tAttr("sound_mode")}
          options={soundModes}
          current={text(attrs.sound_mode)}
          disabled={busy}
          onSelect={(soundMode) =>
            run({
              domain: "media_player",
              service: "select_sound_mode",
              entity_id: id,
              service_data: { sound_mode: soundMode },
            })
          }
        />
      )}
      {canShuffle && (
        <Button
          variant={shuffling ? "default" : "outline"}
          onClick={() =>
            run({
              domain: "media_player",
              service: "shuffle_set",
              entity_id: id,
              service_data: { shuffle: !shuffling },
            })
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
            run({
              domain: "media_player",
              service: "repeat_set",
              entity_id: id,
              service_data: { repeat },
            })
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
  const { run, isPending: busy } = useRunAction();

  const id = entity.entity_id;
  const attrs = entity.attributes;

  const call = (service: string, service_data?: Record<string, unknown>) =>
    run({ domain: "climate", service, entity_id: id, service_data });

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
  /*
    Stepped from a *pending* value, not from the entity.

    `climate.set_temperature` returns as soon as Home Assistant accepts it,
    long before the device reports the new setpoint back, and `busy` clears
    with the POST. Reading `attrs.temperature` on each tap therefore made three
    quick taps of `+` on a 20.0° thermostat send `20.5` three times: the
    display sat at 20°, and the room ended up half a degree warmer instead of
    one and a half.
  */
  const [target, setTarget] = usePendingNumber(num(attrs.temperature));
  const [low, setLow] = usePendingNumber(num(attrs.target_temp_low));
  const [high, setHigh] = usePendingNumber(num(attrs.target_temp_high));

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
          onStep={async (direction) => {
            const next = clampTemp(target + direction * step);
            setTarget(next);
            // Refused: back to the thermostat's own setpoint. Keeping the
            // guess would leave the panel claiming a target the room will
            // never reach, and nothing would ever correct it.
            if (!(await call("set_temperature", { temperature: next }))) setTarget(null);
          }}
        />
      )}
      {canTargetRange && low !== undefined && high !== undefined && (
        <>
          <Stepper
            label={tAttr("target_temp_low")}
            display={`${low}${unit}`}
            disabled={busy}
            onStep={async (direction) => {
              const next = clampTemp(low + direction * step);
              setLow(next);
              const ok = await call("set_temperature", {
                target_temp_low: next,
                target_temp_high: high,
              });
              if (!ok) setLow(null);
            }}
          />
          <Stepper
            label={tAttr("target_temp_high")}
            display={`${high}${unit}`}
            disabled={busy}
            onStep={async (direction) => {
              const next = clampTemp(high + direction * step);
              setHigh(next);
              const ok = await call("set_temperature", {
                target_temp_low: low,
                target_temp_high: next,
              });
              if (!ok) setHigh(null);
            }}
          />
        </>
      )}
      {canTargetHumidity && (
        <CommitSlider
          label={tAttr("humidity")}
          value={humidity}
          format={(next) => `${Math.round(next)}%`}
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
  const { run, isPending: servicePending } = useRunAction();
  const { start, pause, stop, returnToBase, setFanSpeed, isPending } = useVacuumCommand();
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
            <Button
              className="flex-1"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run({ domain: "vacuum", service: "start", entity_id: id }, () => start(id))
              }
            >
              <Play />
              {t("vacuumStart")}
            </Button>
          )}
          {canPause && (
            <Button
              className="flex-1"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run({ domain: "vacuum", service: "pause", entity_id: id }, () => pause(id))
              }
            >
              <Pause />
              {t("vacuumPause")}
            </Button>
          )}
          {canStop && (
            <Button
              className="flex-1"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run({ domain: "vacuum", service: "stop", entity_id: id }, () => stop(id))
              }
            >
              <Square />
              {t("stopButton")}
            </Button>
          )}
        </div>
      )}
      {(canReturn || canLocate || canCleanSpot) && (
        <div className="flex gap-2">
          {canReturn && (
            <Button
              className="flex-1"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run({ domain: "vacuum", service: "return_to_base", entity_id: id }, () => returnToBase(id))
              }
            >
              <Home />
              {t("vacuumReturn")}
            </Button>
          )}
          {canLocate && (
            <Button
              className="flex-1"
              variant="outline"
              onClick={() => run({ domain: "vacuum", service: "locate", entity_id: id })}
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
              onClick={() => run({ domain: "vacuum", service: "clean_spot", entity_id: id })}
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
          onSelect={(speed) =>
            run({ domain: "vacuum", service: "set_fan_speed", entity_id: id }, () => setFanSpeed(id, speed))
          }
        />
      )}
    </ActionsSection>
  );
}

// ── alarm_control_panel ───────────────────────────────────────────────────

function AlarmActions({ entity }: DomainProps) {
  const t = useTranslations("homeAutomation.entityDetail");
  const { run, isPending: servicePending } = useRunAction();
  const { armHome, armAway, armNight, isPending } = useAlarmControl();
  const busy = isPending || servicePending;

  const id = entity.entity_id;
  const attrs = entity.attributes;

  // `alarm_disarm` has no feature bit in Home Assistant — a panel that can be
  // armed can always be disarmed, so it is offered unconditionally. What it is
  // not offered without is the RFC-008 §6 confirmation, which comes from the
  // table rather than from this component. Like unlocking, it sends the
  // descriptor rather than `useAlarmControl.disarm`, so what was confirmed and
  // what goes out are one object. `disarm(id)` sent exactly this: the hook's
  // `code` argument is optional and the sheet never passed one (§4.5 — the
  // alarm code was offered and declined).
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
        onClick={() =>
          run({ domain: "alarm_control_panel", service: "alarm_disarm", entity_id: id })
        }
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
              onClick={() =>
                run({ domain: "alarm_control_panel", service: "alarm_arm_home", entity_id: id }, () => armHome(id))
              }
              disabled={busy}
            >
              {t("armHomeButton")}
            </Button>
          )}
          {canArmAway && (
            <Button
              size="sm"
              variant={entity.state === "armed_away" ? "default" : "outline"}
              onClick={() =>
                run({ domain: "alarm_control_panel", service: "alarm_arm_away", entity_id: id }, () => armAway(id))
              }
              disabled={busy}
            >
              {t("armAwayButton")}
            </Button>
          )}
          {canArmNight && (
            <Button
              size="sm"
              variant={entity.state === "armed_night" ? "default" : "outline"}
              onClick={() =>
                run({ domain: "alarm_control_panel", service: "alarm_arm_night", entity_id: id }, () => armNight(id))
              }
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
                run({
                  domain: "alarm_control_panel",
                  service: "alarm_arm_vacation",
                  entity_id: id,
                })
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
                run({
                  domain: "alarm_control_panel",
                  service: "alarm_arm_custom_bypass",
                  entity_id: id,
                })
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
  const { run, isPending: busy } = useRunAction();

  const id = entity.entity_id;
  const attrs = entity.attributes;
  const call = (service: string, service_data?: Record<string, unknown>) =>
    run({ domain: "humidifier", service, entity_id: id, service_data });

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
        format={(next) => `${Math.round(next)}%`}
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
  const { run } = useRunAction();
  const { toggle, isPending: busy } = useToggleEntity();
  const domain = entity.entity_id.split(".")[0];
  const isOn = entity.state === "on";

  return (
    <ActionsSection busy={busy}>
      <Button
        variant={isOn ? "default" : "outline"}
        onClick={() =>
          run(
            { domain, service: isOn ? "turn_off" : "turn_on", entity_id: entity.entity_id },
            () => toggle(entity.entity_id, entity.state),
          )
        }
        disabled={busy}
      >
        {isOn ? t("turnOffButton") : t("turnOnButton")}
      </Button>
    </ActionsSection>
  );
}

function SceneActions({ entity }: DomainProps) {
  const t = useTranslations("homeAutomation.entityDetail");
  const { run, isPending: busy } = useRunAction();
  const domain = entity.entity_id.split(".")[0];
  const isRunning = domain === "script" && entity.state === "on";

  return (
    <ActionsSection busy={busy}>
      <div className="flex gap-2">
        <Button
          className="flex-1"
          onClick={() =>
            run({ domain, service: "turn_on", entity_id: entity.entity_id })
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
              run({ domain, service: "turn_off", entity_id: entity.entity_id })
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
  const { run, isPending: servicePending } = useRunAction();
  const { toggle, isPending } = useToggleEntity();
  const busy = isPending || servicePending;
  const isOn = entity.state === "on";

  return (
    <ActionsSection busy={busy}>
      <div className="flex gap-2">
        <Button
          className="flex-1"
          variant="outline"
          onClick={() =>
            run({
              domain: "automation",
              service: "trigger",
              entity_id: entity.entity_id,
              // HA's own default, said out loud: without it a household
              // pressing "Trigger" would silently get a *conditional* run.
              service_data: { skip_condition: true },
            })
          }
          disabled={busy}
        >
          {t("triggerButton")}
        </Button>
        <Button
          className="flex-1"
          variant={isOn ? "default" : "outline"}
          onClick={() =>
            run(
              { domain: "automation", service: isOn ? "turn_off" : "turn_on", entity_id: entity.entity_id },
              () => toggle(entity.entity_id, entity.state),
            )
          }
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
  const { run, isPending: busy } = useRunAction();

  /*
    RFC-008 §5.3 — the domain is one nobody here has heard of.

    `supported_features` is a bitmask whose meaning comes from that domain's
    own IntFlag, so reading bits without knowing the enum ships buttons that
    do something else entirely. `homeassistant.turn_on` / `turn_off` is the
    one pair Home Assistant guarantees for anything with on/off semantics —
    the same pair `group` uses across mixed members — and an entity that is
    neither on nor off has no such semantics, so it gets nothing rather than a
    button that fails.

    This is also the branch most §6 domains take today: `siren`, `lawn_mower`
    and the rest have no case of their own until the long-tail branch, so a
    siren in the house arrives here. The descriptor says `homeassistant`, and
    Home Assistant forwards it to `siren.turn_on` — which is why
    `dangerousAction` resolves the entity's own domain as well as the literal
    one. Nothing here opts into that; it happens in the gate, so any future
    caller of the generic pair inherits it.
  */
  const shape = classifyEntityState(entity.state);
  if (shape.kind !== "toggle") return null;
  const isOn = shape.on;

  return (
    <ActionsSection busy={busy}>
      <Button
        variant={isOn ? "default" : "outline"}
        onClick={() =>
          run({
            domain: "homeassistant",
            service: isOn ? "turn_off" : "turn_on",
            entity_id: entity.entity_id,
          })
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
 *
 * Whatever it does render goes inside {@link DangerousActionGate}, which is
 * where the confirmations of RFC-008 §6 live: one dialog, consulted by service
 * name, in front of every control the domain components put on screen.
 */
export function EntityActions({ entity, displayName }: DomainProps & { displayName?: string }) {
  const domain = entity.entity_id.split(".")[0];

  /*
    The reading gate, with RFC-008 R1's one phase-one exception.

    `unavailable`, `unknown` and an empty state normally all mean there is
    nothing here to drive. R1 carves out the domains whose *resting* state is
    legitimately `unknown`, and `scene` is one of them and is in phase one: a
    scene's state is the timestamp it was last activated, Home Assistant does
    not restore it, so after a restart every scene in the house reports
    `unknown`. Gating on that greys out Activate on a perfectly working scene
    until somebody triggers it from somewhere else — which is precisely the
    failure R1 exists to describe.

    `unavailable` still disables everything, for `scene` as for anything else:
    that one really does mean unreachable. The rest of R1's list (`button`,
    `event`, `image`, the date/time family) belongs to the later phase with
    those domains.
  */
  const restingUnknown = domain === "scene" && entity.state !== "unavailable";
  if (!restingUnknown && classifyEntityState(entity.state).kind === "unavailable") {
    return <UnavailableNotice />;
  }

  const controls = domainControls(domain, entity);
  if (controls === null) return null;
  return (
    <DangerousActionGate entity={entity} displayName={displayName}>
      {controls}
    </DangerousActionGate>
  );
}

/**
 * The domain's own controls, before the gate wraps them.
 *
 * Split out so `EntityActions` can return `null` for a read-only domain
 * without mounting a confirmation dialog that has nothing to confirm.
 */
function domainControls(domain: string, entity: HAEntity): ReactNode {
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
