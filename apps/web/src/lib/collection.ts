export type CollectionState = "owned" | "wanted";
export type LibraryKind = "catalog" | "wishlist";
export type LibraryMode = "catalog" | "wishlist";

export const DEFAULT_COLLECTION_STATE: CollectionState = "owned";
export const DEFAULT_LIBRARY_KIND: LibraryKind = "catalog";
export const WISHLIST_LIBRARY_NAME = "Wishlist";

export function isCollectionState(value: unknown): value is CollectionState {
  return value === "owned" || value === "wanted";
}

export function isLibraryKind(value: unknown): value is LibraryKind {
  return value === "catalog" || value === "wishlist";
}

export function isLibraryMode(value: unknown): value is LibraryMode {
  return value === "catalog" || value === "wishlist";
}

export function collectionStateForMode(mode: LibraryMode): CollectionState {
  return mode === "wishlist" ? "wanted" : "owned";
}

export function libraryKindForMode(mode: LibraryMode): LibraryKind {
  return mode === "wishlist" ? "wishlist" : "catalog";
}

export function parseLibraryMode(value: string | null | undefined): LibraryMode {
  return value === "wishlist" ? "wishlist" : "catalog";
}

export function isWishlistMode(mode: LibraryMode): boolean {
  return mode === "wishlist";
}
