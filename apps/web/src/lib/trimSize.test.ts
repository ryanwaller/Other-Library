import { isValidTrimSize, computeTrimAspect, convertTrimUnit, refitCropBox } from "./trimSize";

// ---------------------------------------------------------------------------
// isValidTrimSize
// ---------------------------------------------------------------------------
describe("isValidTrimSize", () => {
  it("returns true for positive numeric width/height and a valid unit", () => {
    expect(isValidTrimSize(6, 9, "in")).toBe(true);
    expect(isValidTrimSize("5.5", "8.5", "in")).toBe(true);
    expect(isValidTrimSize(148, 210, "mm")).toBe(true);
    expect(isValidTrimSize("148", "210", "mm")).toBe(true);
  });

  it("returns false when unit is missing or invalid", () => {
    expect(isValidTrimSize(6, 9, null)).toBe(false);
    expect(isValidTrimSize(6, 9, undefined)).toBe(false);
    expect(isValidTrimSize(6, 9, "cm")).toBe(false);
    expect(isValidTrimSize(6, 9, "")).toBe(false);
  });

  it("returns false when width or height is zero or negative", () => {
    expect(isValidTrimSize(0, 9, "in")).toBe(false);
    expect(isValidTrimSize(-1, 9, "in")).toBe(false);
    expect(isValidTrimSize(6, 0, "in")).toBe(false);
    expect(isValidTrimSize(6, -5, "mm")).toBe(false);
  });

  it("returns false when width or height is non-numeric", () => {
    expect(isValidTrimSize("abc", 9, "in")).toBe(false);
    expect(isValidTrimSize(6, null, "in")).toBe(false);
    expect(isValidTrimSize(null, null, "in")).toBe(false);
    expect(isValidTrimSize("", 9, "in")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeTrimAspect
// ---------------------------------------------------------------------------
describe("computeTrimAspect", () => {
  it("returns width/height ratio", () => {
    expect(computeTrimAspect(6, 9)).toBeCloseTo(6 / 9);
    expect(computeTrimAspect("5.5", "8.5")).toBeCloseTo(5.5 / 8.5);
    expect(computeTrimAspect(1, 1)).toBe(1);
    expect(computeTrimAspect(3, 2)).toBeCloseTo(1.5);
  });

  it("falls back to 2/3 for invalid values", () => {
    expect(computeTrimAspect(0, 9)).toBeCloseTo(2 / 3);
    expect(computeTrimAspect(null, null)).toBeCloseTo(2 / 3);
    expect(computeTrimAspect("abc", 9)).toBeCloseTo(2 / 3);
    expect(computeTrimAspect(6, -1)).toBeCloseTo(2 / 3);
  });
});

// ---------------------------------------------------------------------------
// convertTrimUnit
// ---------------------------------------------------------------------------
describe("convertTrimUnit", () => {
  it("converts inches to mm", () => {
    expect(convertTrimUnit(1, "in", "mm")).toBe(25.4);
    expect(convertTrimUnit(6, "in", "mm")).toBe(152.4);
    expect(convertTrimUnit(5.5, "in", "mm")).toBe(139.7);
  });

  it("converts mm to inches", () => {
    expect(convertTrimUnit(25.4, "mm", "in")).toBe(1.0);
    expect(convertTrimUnit(210, "mm", "in")).toBe(8.27); // A4 height
    expect(convertTrimUnit(148, "mm", "in")).toBe(5.83); // A5 width
  });

  it("is a no-op when from === to", () => {
    expect(convertTrimUnit(6, "in", "in")).toBe(6);
    expect(convertTrimUnit(148, "mm", "mm")).toBe(148);
  });

  it("rounds to 2 dp for inches, 1 dp for mm", () => {
    // 1/3 in = 8.4666… mm → 8.5 mm
    expect(convertTrimUnit(1 / 3, "in", "mm")).toBe(8.5);
    // 10 mm = 0.3937… in → 0.39 in
    expect(convertTrimUnit(10, "mm", "in")).toBe(0.39);
  });
});

// ---------------------------------------------------------------------------
// refitCropBox
// ---------------------------------------------------------------------------
describe("refitCropBox", () => {
  const img = { w: 800, h: 1200 };

  it("preserves the crop centre when aspect changes", () => {
    const box = { x: 100, y: 200, width: 400, height: 600 }; // centre 300, 500
    const result = refitCropBox(box, 1, img.w, img.h); // square
    const cx = result.x + result.width / 2;
    const cy = result.y + result.height / 2;
    expect(cx).toBeCloseTo(300);
    expect(cy).toBeCloseTo(500);
    expect(result.width / result.height).toBeCloseTo(1);
  });

  it("keeps the box within image bounds", () => {
    // Box near the edge that would overflow after ratio change.
    const box = { x: 600, y: 0, width: 200, height: 400 };
    const result = refitCropBox(box, 3 / 2, img.w, img.h);
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeGreaterThanOrEqual(0);
    expect(result.x + result.width).toBeLessThanOrEqual(img.w + 0.001);
    expect(result.y + result.height).toBeLessThanOrEqual(img.h + 0.001);
  });

  it("honours the requested aspect ratio", () => {
    const box = { x: 50, y: 50, width: 300, height: 400 };
    const newAspect = 5 / 7;
    const result = refitCropBox(box, newAspect, img.w, img.h);
    expect(result.width / result.height).toBeCloseTo(newAspect, 5);
  });

  it("returns the current box unchanged for invalid aspect", () => {
    const box = { x: 10, y: 10, width: 200, height: 300 };
    expect(refitCropBox(box, 0, img.w, img.h)).toEqual(box);
    expect(refitCropBox(box, -1, img.w, img.h)).toEqual(box);
    expect(refitCropBox(box, NaN, img.w, img.h)).toEqual(box);
  });

  it("clamps when the new box would exceed image width", () => {
    const box = { x: 0, y: 0, width: 800, height: 400 }; // full width
    // Wider aspect → width must stay ≤ imgW
    const result = refitCropBox(box, 2, img.w, img.h);
    expect(result.x + result.width).toBeLessThanOrEqual(img.w + 0.001);
  });

  it("clamps when the new box would exceed image height", () => {
    const box = { x: 0, y: 0, width: 400, height: 1200 }; // full height
    // Taller aspect → height must stay ≤ imgH
    const result = refitCropBox(box, 1 / 3, img.w, img.h);
    expect(result.y + result.height).toBeLessThanOrEqual(img.h + 0.001);
  });
});
