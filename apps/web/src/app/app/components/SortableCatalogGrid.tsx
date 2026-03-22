"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  defaultAnimateLayoutChanges,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "motion/react";
import type { CatalogGroup } from "../../../lib/types";
import { effectiveSecondaryLineFor } from "../../../lib/book";
import BookCard, { type BookCardViewMode } from "./BookCard";

function formatAddedDate(timestamp: number): string | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  }
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months} ${months === 1 ? "month" : "months"} ago`;
  }
  const years = Math.floor(diffDays / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

type DeleteState = { busy: boolean; error: string | null; message: string | null } | undefined;

type SortableCatalogGridProps = {
  libraryId: number;
  groups: CatalogGroup[];
  limit: number;
  effectiveViewMode: BookCardViewMode;
  gridColumnsHint: number;
  gridTemplateColumns?: string;
  onMeasuredColumnsChange?: (count: number) => void;
  showBookSkeleton: boolean;
  isRearranging: boolean;
  bulkMode: boolean;
  viewMode: BookCardViewMode;
  bulkSelectedKeys: Record<string, boolean | undefined>;
  deleteStateByBookId: Record<number, DeleteState>;
  onToggleSelected: (key: string) => void;
  onDeleteCopy: (bookId: number) => void;
  onStoreBookNavContext: (libraryId: number, orderedBookIds: number[]) => void;
  onReorderStart: (activeKey: string, libraryId: number) => void;
  onReorderPreview: (activeKey: string, overKey: string, libraryId: number) => void;
  onReorderCommit: (libraryId: number) => Promise<void>;
  onReorderCancel: (libraryId: number) => void;
  showWishlistMatchSummary?: boolean;
};

type SortableCatalogCardProps = {
  group: CatalogGroup;
  libraryId: number;
  viewMode: BookCardViewMode;
  bulkMode: boolean;
  gridColumnsHint: number;
  selected: boolean;
  deleteState: DeleteState;
  isRearranging: boolean;
  orderedBookIds: number[];
  onToggleSelected: () => void;
  onDeleteCopy: () => void;
  onStoreBookNavContext: () => void;
  showWishlistMatchSummary?: boolean;
};

function renderCard({
  group,
  viewMode,
  bulkMode,
  gridColumnsHint,
  selected,
  deleteState,
  isRearranging,
  orderedBookIds,
  onToggleSelected,
  onDeleteCopy,
  onStoreBookNavContext,
  showWishlistMatchSummary = true
}: Omit<SortableCatalogCardProps, "libraryId"> & { showWishlistMatchSummary?: boolean }) {
  const resolvedCoverUrl =
    typeof group.primary.resolved_cover_url === "string" && group.primary.resolved_cover_url.trim()
      ? group.primary.resolved_cover_url
      : null;

  return (
    <BookCard
      viewMode={viewMode}
      bulkMode={bulkMode || isRearranging}
      selected={selected}
      onToggleSelected={onToggleSelected}
      title={group.title}
      authors={effectiveSecondaryLineFor(group.primary).values}
      isbn13={group.primary.edition?.isbn13 ?? null}
      tags={group.tagNames}
      copiesCount={group.copiesCount}
      href={isRearranging ? "" : `/app/books/${group.primary.id}`}
      coverUrl={resolvedCoverUrl}
      originalSrc={resolvedCoverUrl}
      onOpen={() => onStoreBookNavContext()}
      cropData={group.primary.cover_crop}
      onDeleteCopy={onDeleteCopy}
      deleteState={deleteState}
      gridCols={gridColumnsHint}
      secondaryMode={effectiveSecondaryLineFor(group.primary).mode}
      roundedCover={String(group.primary.collection_state ?? "").trim().toLowerCase() === "wanted"}
      item={group.primary as any}
      utilityLabel={formatAddedDate(group.latestCreatedAt)}
      wishlistMatchSummary={group.primary.wishlist_match_summary ?? null}
      showWishlistMatchSummary={showWishlistMatchSummary}
    />
  );
}

function SortableCatalogCard({
  group,
  libraryId,
  viewMode,
  bulkMode,
  gridColumnsHint,
  selected,
  deleteState,
  isRearranging,
  orderedBookIds,
  onToggleSelected,
  onDeleteCopy,
  onStoreBookNavContext,
  showWishlistMatchSummary = true
}: SortableCatalogCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: group.key,
    disabled: !isRearranging,
    animateLayoutChanges: (args) => defaultAnimateLayoutChanges({ ...args, wasDragging: true }),
    transition: {
      duration: 220,
      easing: "cubic-bezier(0.2, 0, 0, 1)"
    }
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? "transform 180ms cubic-bezier(0.2, 0, 0, 1)"
  };

  const card = renderCard({
    group,
    viewMode,
    bulkMode,
    gridColumnsHint,
    selected,
    deleteState,
    isRearranging,
    orderedBookIds,
    onToggleSelected,
    onDeleteCopy,
    onStoreBookNavContext,
    showWishlistMatchSummary
  });

  return (
    <div
      ref={setNodeRef}
      data-reorder-key={group.key}
      data-reorder-lib-id={libraryId}
      style={{ ...style, position: "relative", zIndex: isDragging ? 2 : 1 }}
    >
      <motion.div
        animate={{
          opacity: isDragging ? 0.18 : 1,
          scale: isDragging ? 0.985 : 1
        }}
        transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
        style={{ pointerEvents: isDragging ? "none" : "auto", transformOrigin: "center center" }}
      >
        {card}
      </motion.div>
      {isRearranging ? (
        <button
          type="button"
          aria-label={`Reorder ${group.title}`}
          {...attributes}
          {...listeners}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 10,
            cursor: isDragging ? "grabbing" : "grab",
            background: "transparent",
            border: 0,
            outline: "none",
            padding: 0,
            touchAction: "none"
          }}
        />
      ) : null}
    </div>
  );
}

const SortableCatalogGrid = memo(function SortableCatalogGrid({
  libraryId,
  groups,
  limit,
  effectiveViewMode,
  gridColumnsHint,
  gridTemplateColumns,
  onMeasuredColumnsChange,
  showBookSkeleton,
  isRearranging,
  bulkMode,
  viewMode,
  bulkSelectedKeys,
  deleteStateByBookId,
  onToggleSelected,
  onDeleteCopy,
  onStoreBookNavContext,
  onReorderStart,
  onReorderPreview,
  onReorderCommit,
  onReorderCancel,
  showWishlistMatchSummary = true
}: SortableCatalogGridProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const orderedBookIds = useMemo(
    () => groups.map((group) => Number(group.primary.id)).filter((id) => Number.isFinite(id) && id > 0),
    [groups]
  );
  const visibleGroups = useMemo(() => (isRearranging ? groups : groups.slice(0, limit)), [groups, isRearranging, limit]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const activeGroup = useMemo(
    () => (activeKey ? groups.find((group) => group.key === activeKey) ?? null : null),
    [activeKey, groups]
  );
  const gridRef = useRef<HTMLDivElement | null>(null);

  const strategy = effectiveViewMode === "grid" ? rectSortingStrategy : verticalListSortingStrategy;

  useEffect(() => {
    if (effectiveViewMode !== "grid") {
      onMeasuredColumnsChange?.(1);
      return;
    }
    if (!gridRef.current || typeof window === "undefined") return;
    const node = gridRef.current;
    const measure = () => {
      const styles = window.getComputedStyle(node);
      const template = styles.gridTemplateColumns;
      if (!template || template === "none") {
        onMeasuredColumnsChange?.(Math.max(1, gridColumnsHint));
        return;
      }
      const count = template
        .split(" ")
        .map((part) => part.trim())
        .filter(Boolean).length;
      onMeasuredColumnsChange?.(Math.max(1, count));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [effectiveViewMode, gridColumnsHint, gridTemplateColumns, onMeasuredColumnsChange]);

  const grid = (
    <div
      ref={gridRef}
      style={{
        display: effectiveViewMode === "grid" ? "grid" : "flex",
        flexDirection: effectiveViewMode === "list" ? "column" : undefined,
        gridTemplateColumns: effectiveViewMode === "grid" ? gridTemplateColumns ?? `repeat(${gridColumnsHint}, minmax(0, 1fr))` : undefined,
        gap: effectiveViewMode === "grid" ? "var(--space-md)" : 0
      }}
    >
      {showBookSkeleton
        ? Array.from({ length: Math.min(6, Math.max(1, gridColumnsHint)) }).map((_, i) => (
            <div key={`skeleton-${libraryId}-${i}`} className="om-cover-placeholder" style={{ width: "100%", aspectRatio: "3/4" }} />
          ))
        : null}
      {visibleGroups.map((group) => (
        <SortableCatalogCard
          key={group.key}
          group={group}
          libraryId={libraryId}
          viewMode={viewMode}
          bulkMode={bulkMode}
          gridColumnsHint={gridColumnsHint}
          selected={!!bulkSelectedKeys[group.key]}
          deleteState={deleteStateByBookId[group.primary.id]}
          isRearranging={isRearranging}
          orderedBookIds={orderedBookIds}
          onToggleSelected={() => onToggleSelected(group.key)}
          onDeleteCopy={() => onDeleteCopy(group.primary.id)}
          onStoreBookNavContext={() => onStoreBookNavContext(libraryId, orderedBookIds)}
          showWishlistMatchSummary={showWishlistMatchSummary}
        />
      ))}
    </div>
  );

  if (!isRearranging) return grid;

  function handleDragStart(event: DragStartEvent) {
    const nextActiveKey = String(event.active.id);
    setActiveKey(nextActiveKey);
    onReorderStart(nextActiveKey, libraryId);
  }

  function handleDragOver(event: DragOverEvent) {
    const overId = event.over?.id;
    if (!overId || !activeKey) return;
    const overKey = String(overId);
    if (overKey === activeKey) return;
    onReorderPreview(activeKey, overKey, libraryId);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const overId = event.over?.id;
    const shouldCommit = Boolean(activeKey && overId);
    setActiveKey(null);
    if (!shouldCommit) {
      onReorderCancel(libraryId);
      return;
    }
    await onReorderCommit(libraryId);
  }

  function handleDragCancel(_event: DragCancelEvent) {
    setActiveKey(null);
    onReorderCancel(libraryId);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext items={visibleGroups.map((group) => group.key)} strategy={strategy}>
        {grid}
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
        {activeGroup ? (
          <motion.div
            initial={{ scale: 1, boxShadow: "0 0 0 rgba(0,0,0,0)" }}
            animate={{ scale: 1.025, boxShadow: "0 16px 28px rgba(0,0,0,0.16)" }}
            transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
            style={{ transformOrigin: "center center" }}
          >
            {renderCard({
              group: activeGroup,
              viewMode,
              bulkMode: false,
              gridColumnsHint,
              selected: false,
              deleteState: deleteStateByBookId[activeGroup.primary.id],
              isRearranging: false,
              orderedBookIds,
              onToggleSelected: () => {},
              onDeleteCopy: () => {},
              onStoreBookNavContext: () => {},
              showWishlistMatchSummary
            })}
          </motion.div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
});

export default SortableCatalogGrid;
