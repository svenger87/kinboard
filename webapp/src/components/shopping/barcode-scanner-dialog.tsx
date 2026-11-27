"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Camera, ExternalLink, Loader2, Plus, ScanBarcode } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lookupBarcode, useSaveToCatalog, type BarcodeResult } from "@/hooks/use-item-catalog";
import { useFamilyStore } from "@/stores/family-store";
import { detectCategory } from "@/lib/shopping-categories";
import { parseBarcode } from "@/lib/barcode/gtin";
import { cameraAvailable, cameraNeedsHttps, createBarcodeDecoder, toCanvas, type BarcodeDecoder } from "@/lib/barcode/decoder";
import { HttpsGuideLink } from "@/components/https-guide-link";

/** What the scanner hands the list to add. */
export interface ScannedItem {
  name: string;
  category: string;
  image_url: string | null;
  notes: string | null;
  catalog_item_id: string | null;
}

interface BarcodeScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Adds it to the list; throws when that failed. */
  onAdd: (item: ScannedItem) => Promise<void>;
}

type Phase =
  | { kind: "scanning" }
  | { kind: "looking"; code: string }
  | { kind: "found"; product: BarcodeResult }
  | { kind: "unknown"; code: string }
  | { kind: "failed"; code: string };

/** How often a camera frame is read. Quick enough to feel instant, light enough for an old phone. */
const FRAME_MS = 250;
/** The same code again this soon is the same package still in front of the camera. */
const REPEAT_MS = 4000;

/**
 * Add to the shopping list by barcode: the camera reads it (https or
 * localhost only, where the browser allows a camera), or a photo of it (works
 * everywhere, a plain-http LAN address included), or its digits typed in.
 * The product comes from the family's own catalog or Open Food Facts; one
 * nobody knows is named once and remembered for the family. After each add
 * the scanner is ready for the next package.
 */
export function BarcodeScannerDialog({ open, onOpenChange, onAdd }: BarcodeScannerDialogProps) {
  const t = useTranslations("components.barcodeScanner");
  const locale = useLocale();
  const { family } = useFamilyStore();
  const saveToCatalog = useSaveToCatalog();

  const [phase, setPhase] = useState<Phase>({ kind: "scanning" });
  // "blocked": the person or the browser refused it; "missing": this device has no usable camera.
  const [cameraState, setCameraState] = useState<"off" | "starting" | "on" | "blocked" | "missing">("off");
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState(false);
  const [photoMissed, setPhotoMissed] = useState(false);
  const [unknownName, setUnknownName] = useState("");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const decoderRef = useRef<Promise<BarcodeDecoder> | null>(null);
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  const lastCode = useRef<{ code: string; at: number } | null>(null);

  const decoder = useCallback(() => (decoderRef.current ??= createBarcodeDecoder()), []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraState((s) => (s === "blocked" || s === "missing" ? s : "off"));
  }, []);

  const lookUp = useCallback(
    async (code: string) => {
      if (!family?.id) return;
      setPhase({ kind: "looking", code });
      setAdded(null);
      try {
        const result = await lookupBarcode(family.id, code, locale.slice(0, 2));
        if (result.status === "found") setPhase({ kind: "found", product: result.product });
        else {
          setUnknownName("");
          setPhase({ kind: "unknown", code });
        }
      } catch {
        setPhase({ kind: "failed", code });
      }
    },
    [family?.id, locale],
  );

  const onCode = useCallback(
    (code: string) => {
      const now = Date.now();
      if (lastCode.current && lastCode.current.code === code && now - lastCode.current.at < REPEAT_MS) return;
      lastCode.current = { code, at: now };
      navigator.vibrate?.(40);
      void lookUp(code);
    },
    [lookUp],
  );

  // The camera, while the dialog is open and the browser allows one.
  useEffect(() => {
    if (!open || !cameraAvailable()) return;
    let cancelled = false;
    setCameraState("starting");
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(async (stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setCameraState("on");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Refused (NotAllowedError, SecurityError) is something to change in the
        // browser; no camera (NotFoundError, a wall screen or a desktop) or one
        // in use elsewhere is not, and saying "not allowed" sent people looking.
        const name = err instanceof DOMException ? err.name : "";
        setCameraState(name === "NotAllowedError" || name === "SecurityError" ? "blocked" : "missing");
      });
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, stopCamera]);

  // Reading the camera's frames, while there is nothing else on screen.
  useEffect(() => {
    if (!open || cameraState !== "on") return;
    let busy = false;
    const timer = window.setInterval(async () => {
      const video = videoRef.current;
      if (busy || !video || video.readyState < 2 || phaseRef.current.kind !== "scanning") return;
      busy = true;
      try {
        const frame = toCanvas(video, video.videoWidth, video.videoHeight, 1000);
        const code = await (await decoder()).decode(frame);
        if (code && phaseRef.current.kind === "scanning") onCode(code);
      } finally {
        busy = false;
      }
    }, FRAME_MS);
    return () => window.clearInterval(timer);
  }, [open, cameraState, decoder, onCode]);

  // A fresh start each time it opens.
  useEffect(() => {
    if (!open) return;
    setPhase({ kind: "scanning" });
    setManual("");
    setManualError(false);
    setPhotoMissed(false);
    setAdded(null);
    lastCode.current = null;
  }, [open]);

  const readPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoMissed(false);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = toCanvas(bitmap, bitmap.width, bitmap.height);
      bitmap.close();
      const code = await (await decoder()).decode(canvas);
      if (code) onCode(code);
      else setPhotoMissed(true);
    } catch {
      setPhotoMissed(true);
    }
  };

  const submitManual = () => {
    const code = parseBarcode(manual);
    if (!code) {
      setManualError(true);
      return;
    }
    setManualError(false);
    lastCode.current = null;
    void lookUp(code);
  };

  const add = async (item: ScannedItem, remember?: { barcode: string }) => {
    setAdding(true);
    try {
      await onAdd(item);
      if (remember) {
        // Known from now on: the next scan of it finds the family's own name.
        saveToCatalog.mutate({ name: item.name, barcode: remember.barcode, category: item.category, source: "custom" });
      }
      setAdded(item.name);
      setManual("");
      setPhase({ kind: "scanning" });
    } catch {
      // The list said no (offline, say): stay on the product, so it can be tried again.
    } finally {
      setAdding(false);
    }
  };

  const addFound = (p: BarcodeResult) => {
    const notes = [p.brand, p.quantity].filter(Boolean).join(" · ");
    void add({
      name: p.name,
      category: p.category ?? detectCategory(p.name),
      image_url: p.thumbnail_url ?? p.image_url,
      notes: notes || null,
      catalog_item_id: p.id,
    });
  };

  const addUnknown = (code: string) => {
    const name = unknownName.trim();
    if (!name) return;
    void add({ name, category: detectCategory(name), image_url: null, notes: null, catalog_item_id: null }, { barcode: code });
  };

  const scanning = phase.kind === "scanning";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="barcode-scanner">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanBarcode className="size-5" strokeWidth={1.75} />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {added && scanning && (
          <p className="rounded-md bg-primary/10 px-3 py-2 text-sm" role="status" data-testid="barcode-added">
            {t("added", { name: added })}
          </p>
        )}

        {/* The camera stays mounted while the dialog is open, so a found product doesn't restart it. */}
        {cameraState !== "blocked" && cameraState !== "missing" && cameraAvailable() && (
          <div className={`relative overflow-hidden rounded-lg bg-black ${scanning ? "" : "hidden"}`}>
            <video ref={videoRef} playsInline muted className="aspect-video w-full object-cover" data-testid="barcode-video" />
            {/* The aiming line. */}
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
            {cameraState === "starting" && (
              <div className="absolute inset-0 flex items-center justify-center text-white/80">
                <Loader2 className="size-6 animate-spin" />
              </div>
            )}
          </div>
        )}

        {scanning && (!cameraAvailable() || cameraState === "blocked" || cameraState === "missing") && (
          <p className="text-xs text-muted-foreground" data-testid="barcode-no-camera">
            {/* On plain http the camera never starts (cameraState stays "off"): say why, and where HTTPS comes from. */}
            {cameraNeedsHttps() ? (
              <>
                {t("cameraNeedsHttps")}{" "}
                <HttpsGuideLink testId="barcode-https-guide" />
              </>
            ) : cameraState === "blocked" ? (
              t("cameraBlocked")
            ) : (
              t("cameraMissing")
            )}
          </p>
        )}

        {scanning && (
          <div className="space-y-3">
            <label className="flex">
              <span className="sr-only">{t("photo")}</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                data-testid="barcode-photo"
                onChange={(e) => {
                  void readPhoto(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <span className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
                <Camera className="size-4" strokeWidth={1.75} />
                {t("photo")}
              </span>
            </label>
            {photoMissed && <p className="text-xs text-destructive">{t("photoMissed")}</p>}

            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                submitManual();
              }}
            >
              <Input
                value={manual}
                onChange={(e) => {
                  setManual(e.target.value);
                  setManualError(false);
                }}
                inputMode="numeric"
                autoComplete="off"
                placeholder={t("manualPlaceholder")}
                aria-label={t("manualPlaceholder")}
                data-testid="barcode-manual"
              />
              <Button type="submit" variant="outline" disabled={!manual.trim()}>
                {t("lookUp")}
              </Button>
            </form>
            {manualError && <p className="text-xs text-destructive">{t("manualInvalid")}</p>}
          </div>
        )}

        {phase.kind === "looking" && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("looking", { code: phase.code })}
          </div>
        )}

        {phase.kind === "found" && (
          <div className="space-y-4" data-testid="barcode-found">
            <div className="flex items-center gap-3">
              {phase.product.thumbnail_url || phase.product.image_url ? (
                 
                <img
                  src={phase.product.thumbnail_url ?? phase.product.image_url ?? ""}
                  alt=""
                  className="size-16 shrink-0 rounded-md bg-white object-contain"
                />
              ) : (
                <div className="flex size-16 shrink-0 items-center justify-center rounded-md bg-muted">
                  <ScanBarcode className="size-6 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0">
                <p className="font-medium" data-testid="barcode-product-name">{phase.product.name}</p>
                <p className="text-xs text-muted-foreground">
                  {[phase.product.brand, phase.product.quantity].filter(Boolean).join(" · ")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {phase.product.source === "local" ? t("sourceFamily") : t("sourceOpenFoodFacts")}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => addFound(phase.product)} disabled={adding} data-testid="barcode-add">
                {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                <span className="ml-1">{t("add")}</span>
              </Button>
              <Button variant="outline" onClick={() => setPhase({ kind: "scanning" })} disabled={adding}>
                {t("scanAnother")}
              </Button>
            </div>
          </div>
        )}

        {phase.kind === "unknown" && (
          <form
            className="space-y-3"
            data-testid="barcode-unknown"
            onSubmit={(e) => {
              e.preventDefault();
              addUnknown(phase.code);
            }}
          >
            <p className="text-sm">{t("unknown", { code: phase.code })}</p>
            <Input
              value={unknownName}
              onChange={(e) => setUnknownName(e.target.value)}
              placeholder={t("unknownNamePlaceholder")}
              aria-label={t("unknownNamePlaceholder")}
              autoFocus
              data-testid="barcode-unknown-name"
            />
            <p className="text-xs text-muted-foreground">{t("unknownRemembered")}</p>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={adding || !unknownName.trim()}>
                {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                <span className="ml-1">{t("add")}</span>
              </Button>
              <Button type="button" variant="outline" onClick={() => setPhase({ kind: "scanning" })} disabled={adding}>
                {t("scanAnother")}
              </Button>
            </div>
            <a
              href={`https://world.openfoodfacts.org/product/${phase.code}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {t("contribute")}
              <ExternalLink className="size-3" />
            </a>
          </form>
        )}

        {phase.kind === "failed" && (
          <div className="space-y-3">
            <p className="text-sm text-destructive">{t("lookupFailed")}</p>
            <div className="flex gap-2">
              <Button onClick={() => void lookUp(phase.code)}>{t("retry")}</Button>
              <Button variant="outline" onClick={() => setPhase({ kind: "scanning" })}>
                {t("scanAnother")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
