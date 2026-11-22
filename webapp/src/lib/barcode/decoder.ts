"use client";

import { expandUpcE, isValidGtin, normalizeBarcode } from "./gtin";

/**
 * Reads a retail barcode from a picture: a frame of the camera, or a photo.
 * The browser's own BarcodeDetector where it has one (Chrome and Edge on
 * Android and desktop: fast, nothing to download); ZXing otherwise (Safari
 * on iPhone and iPad, Firefox), loaded only then.
 */
export interface BarcodeDecoder {
  /** The barcode in this picture, or null. */
  decode(source: HTMLCanvasElement): Promise<string | null>;
}

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;

interface NativeDetector {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string; format?: string }>>;
}
interface NativeDetectorClass {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

/** A usable code from what a reader returned: digits, the check digit right. */
function accept(raw: string | null | undefined, upcE: boolean): string | null {
  if (!raw) return null;
  // UPC-E arrives as 8 digits whose check digit belongs to the long form.
  if (upcE) return expandUpcE(raw);
  const code = normalizeBarcode(raw);
  return isValidGtin(code) ? code : null;
}

async function nativeDecoder(): Promise<BarcodeDecoder | null> {
  const Ctor = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const supported = (await Ctor.getSupportedFormats?.()) ?? [...FORMATS];
    const formats = FORMATS.filter((f) => supported.includes(f));
    if (formats.length === 0) return null;
    const detector = new Ctor({ formats: [...formats] });
    return {
      async decode(source) {
        const found = await detector.detect(source);
        for (const f of found) {
          const code = accept(f.rawValue, f.format === "upc_e");
          if (code) return code;
        }
        return null;
      },
    };
  } catch {
    return null;
  }
}

async function zxingDecoder(): Promise<BarcodeDecoder> {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import("@zxing/browser"),
    import("@zxing/library"),
  ]);
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new BrowserMultiFormatReader(hints);
  return {
    async decode(source) {
      try {
        const result = reader.decodeFromCanvas(source);
        return accept(result.getText(), result.getBarcodeFormat() === BarcodeFormat.UPC_E);
      } catch {
        // NotFoundException and friends: nothing readable in this picture.
        return null;
      }
    },
  };
}

/** The best reader this browser has. */
export async function createBarcodeDecoder(): Promise<BarcodeDecoder> {
  return (await nativeDecoder()) ?? (await zxingDecoder());
}

/**
 * Whether this page may use the camera at all: getUserMedia exists only in a
 * secure context (https, or localhost). On a plain-http LAN address a photo
 * still works (an <input type="file" capture>), and typing the digits.
 */
export function cameraAvailable(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
}

/** Draws a picture into a canvas, scaled down so a 12-megapixel photo stays quick to read. */
export function toCanvas(source: CanvasImageSource, width: number, height: number, max = 1600): HTMLCanvasElement {
  const scale = Math.min(1, max / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext("2d", { willReadFrequently: true })?.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}
