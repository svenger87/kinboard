/**
 * Retail barcodes (GTIN: EAN-13, EAN-8, UPC-A, UPC-E as printed digits).
 * Shared by the scanner in the browser and the lookup on the server.
 */

/** Digits only, UPC-A widened to its 13-digit GTIN so a product has one key everywhere. */
export function normalizeBarcode(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 12 ? `0${digits}` : digits;
}

/**
 * Whether the digits make a valid GTIN-8, -12, -13 or -14: the right length
 * and the check digit adding up. A camera's misread almost always fails the
 * check digit, and so does a typo in the manual field.
 */
export function isValidGtin(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  // From the right, the digit next to the check digit weighs 3, the next 1, and so on.
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * A UPC-E code (8 digits, the short US form) widened to the GTIN-13 it stands
 * for. Its check digit belongs to the long form, so it can only be checked
 * once expanded. Null when it isn't a UPC-E code (number system 0 or 1).
 */
export function expandUpcE(code: string): string | null {
  const d = code.replace(/\D/g, "");
  if (d.length !== 8 || (d[0] !== "0" && d[0] !== "1")) return null;
  const [n, s1, s2, s3, s4, s5, s6, c] = d.split("");
  let body: string;
  if (s6 === "0" || s6 === "1" || s6 === "2") body = `${s1}${s2}${s6}0000${s3}${s4}${s5}`;
  else if (s6 === "3") body = `${s1}${s2}${s3}00000${s4}${s5}`;
  else if (s6 === "4") body = `${s1}${s2}${s3}${s4}00000${s5}`;
  else body = `${s1}${s2}${s3}${s4}${s5}0000${s6}`;
  const gtin = `0${n}${body}${c}`;
  return isValidGtin(gtin) ? gtin : null;
}

/**
 * A barcode as typed or sent, made into the one key a product is known by:
 * a valid GTIN (UPC-A widened to 13 digits), or an 8-digit UPC-E expanded.
 * Null when the digits don't make a valid code.
 */
export function parseBarcode(raw: string): string | null {
  const code = normalizeBarcode(raw);
  if (isValidGtin(code)) return code;
  return code.length === 8 ? expandUpcE(code) : null;
}

/**
 * Every product key typed digits could stand for. Eight digits can be an
 * EAN-8 and a UPC-E at once (01234565 is both), and only the barcode's
 * pattern tells them apart, which typing loses; so both are tried, EAN-8
 * first. A scan knows its format and needs only parseBarcode or expandUpcE.
 */
export function barcodeCandidates(raw: string): string[] {
  const first = parseBarcode(raw);
  if (!first) return [];
  const upcE = first.length === 8 ? expandUpcE(first) : null;
  return upcE && upcE !== first ? [first, upcE] : [first];
}
