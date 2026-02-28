/** Unit for physical trim dimensions. */
export type TrimUnit = "in" | "mm";

const MM_PER_INCH = 25.4;

/**
 * Returns true when the three trim-size values together represent a valid,
 * usable size: both dimensions are finite positive numbers and the unit is
 * one of the two recognised values.
 */
export function isValidTrimSize(
  width: string | number | null | undefined,
  height: string | number | null | undefined,
  unit: string | null | undefined
): boolean {
  if (unit !== "in" && unit !== "mm") return false;
  const w = typeof width === "string" ? parseFloat(width) : (width ?? NaN);
  const h = typeof height === "string" ? parseFloat(height) : (height ?? NaN);
  return Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0;
}

/**
 * Computes the aspect ratio (width / height) from raw trim values.
 * Falls back to 2/3 when values are not usable.
 */
export function computeTrimAspect(
  width: string | number | null | undefined,
  height: string | number | null | undefined
): number {
  const w = typeof width === "string" ? parseFloat(width) : (width ?? NaN);
  const h = typeof height === "string" ? parseFloat(height) : (height ?? NaN);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 2 / 3;
  return w / h;
}

/**
 * Converts a trim dimension value between inches and millimetres.
 * Returns the converted value rounded to sensible precision:
 *   - Converting to inches  → 2 decimal places
 *   - Converting to mm      → 1 decimal place
 *
 * The raw (full-precision) number is also available via the second return value.
 */
export function convertTrimUnit(
  value: number,
  from: TrimUnit,
  to: TrimUnit
): number {
  if (from === to) return value;
  const raw = from === "in" ? value * MM_PER_INCH : value / MM_PER_INCH;
  const decimals = to === "in" ? 2 : 1;
  return parseFloat(raw.toFixed(decimals));
}

/**
 * Refits a crop box to a new aspect ratio while keeping the crop centre
 * fixed in image coordinates.  Clamps the result to the image bounds.
 *
 * All values are in the same coordinate space (e.g. pixels).
 *
 * @param current    Current crop box { x, y, width, height }
 * @param newAspect  Desired width/height ratio (> 0)
 * @param imgW       Image width  (> 0)
 * @param imgH       Image height (> 0)
 */
export function refitCropBox(
  current: { x: number; y: number; width: number; height: number },
  newAspect: number,
  imgW: number,
  imgH: number
): { x: number; y: number; width: number; height: number } {
  if (!Number.isFinite(newAspect) || newAspect <= 0 || imgW <= 0 || imgH <= 0) {
    return { ...current };
  }

  // Centre of the current crop in image coordinates.
  const cx = current.x + current.width / 2;
  const cy = current.y + current.height / 2;

  // Try to preserve the area by adjusting width/height minimally.
  const area = current.width * current.height;
  let newW = Math.sqrt(area * newAspect);
  let newH = newW / newAspect;

  // Clamp to image bounds.
  if (newW > imgW) {
    newW = imgW;
    newH = newW / newAspect;
  }
  if (newH > imgH) {
    newH = imgH;
    newW = newH * newAspect;
  }

  // Recentre, then clamp origin so box stays inside image.
  let x = cx - newW / 2;
  let y = cy - newH / 2;
  x = Math.max(0, Math.min(x, imgW - newW));
  y = Math.max(0, Math.min(y, imgH - newH));

  return { x, y, width: newW, height: newH };
}
