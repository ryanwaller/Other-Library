export type DesktopGridDensity = "large" | "medium" | "small";
export type MobileGridCols = 1 | 2;

export const DEFAULT_DESKTOP_GRID_DENSITY: DesktopGridDensity = "medium";
export const DEFAULT_MOBILE_GRID_COLS: MobileGridCols = 2;

export function isDesktopGridDensity(value: unknown): value is DesktopGridDensity {
  return value === "large" || value === "medium" || value === "small";
}

export function isMobileGridCols(value: unknown): value is MobileGridCols {
  return value === 1 || value === 2 || value === "1" || value === "2";
}

export function desktopGridColumnsHint(density: DesktopGridDensity): number {
  if (density === "large") return 4;
  if (density === "small") return 8;
  return 6;
}

export function gridColumnsHint(isMobile: boolean, mobileGridCols: MobileGridCols, desktopGridDensity: DesktopGridDensity): number {
  return isMobile ? mobileGridCols : desktopGridColumnsHint(desktopGridDensity);
}

export function gridTemplateColumns(isMobile: boolean, mobileGridCols: MobileGridCols, desktopGridDensity: DesktopGridDensity): string {
  if (isMobile) {
    return `repeat(${mobileGridCols}, minmax(0, 1fr))`;
  }
  const minWidth =
    desktopGridDensity === "large"
      ? 280
      : desktopGridDensity === "small"
        ? 170
        : 220;
  return `repeat(auto-fill, minmax(min(100%, ${minWidth}px), 1fr))`;
}

export function coverSizesForGrid(isMobile: boolean, mobileGridCols: MobileGridCols, desktopGridDensity: DesktopGridDensity): string {
  if (isMobile) {
    return mobileGridCols === 1 ? "100vw" : "50vw";
  }
  if (desktopGridDensity === "large") {
    return "(max-width: 1100px) 42vw, (max-width: 1500px) 31vw, 23vw";
  }
  if (desktopGridDensity === "small") {
    return "(max-width: 1100px) 26vw, (max-width: 1500px) 19vw, 14vw";
  }
  return "(max-width: 1100px) 34vw, (max-width: 1500px) 24vw, 18vw";
}

export function legacyGridColsToDesktopDensity(value: string | null): DesktopGridDensity | null {
  if (value === "2") return "large";
  if (value === "4") return "medium";
  if (value === "8") return "small";
  return null;
}
