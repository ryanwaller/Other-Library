# Style Audit: Other Library (`apps/web/src`)

This audit documents visual patterns, implementation details, and inconsistencies found in the `apps/web/src` codebase.

## 1. Typography

**Implementation:** CSS Variables in `globals.css` assigned to standard HTML elements and utility classes.
**Font Family:** `OMBauerFolio` (Custom font, 500 weight for regular and italic).

| Pattern Name | Usage | Implementation | Notes |
| :--- | :--- | :--- | :--- |
| **Body Text** | Default text | `font-size: var(--text-size-1)` (16px), `line-height: var(--text-line)` (1.4) | Defined on `html, body`. Consistent. |
| **Book Title** | Book card titles | `.om-book-title` (16px, opacity 1) | Matches body size but explicit class. |
| **Section Title** | Section headers | `.section-title` (16px, opacity 1) | Same as book title. |
| **Muted Text** | Secondary metadata | `.muted` class (color: var(--muted)) | Used extensively for authors, counts, and secondary info. |
| **Links** | Interactive text | `a`, `button.muted`, `.om-filter-link` | Inherits color (often muted), underlines on hover/focus. |
| **Input Text** | Form fields | `input`, `textarea`, `select` | Inherits font family/size. `16px` enforced on mobile to prevent zoom. |

**Inconsistencies:**
- `font-weight: 500` is used globally for "regular" text due to the custom font.
- Mobile overrides: `.container *` forced to `13.5px` and `500` weight in `globals.css`.

## 2. Color Palette

**Implementation:** CSS Variables in `globals.css` with light/dark mode support.

| Token | Value (Light / Dark) | Usage |
| :--- | :--- | :--- |
| `--bg` | `#fff` / `#0b0b0c` | Page background, modal background. |
| `--fg` | `#111` / `#e8e8ea` | Primary text, input borders on focus. |
| `--muted` | `#666` / `#a8a8ad` | Secondary text, placeholders, inactive icons. |
| `--border` | `#ddd` / `#2e2e33` | Dividers, input underlines, card borders. |
| `--card-bg` | `#fff` / `#101014` | Autocomplete dropdowns (not main cards). |
| `--border-avatar` | `#e0e0e0` / `#2a2a2e` | Avatar borders. |
| `--placeholder-bg` | `#e8e8e8` / `#1a1a1a` | Image placeholders. |
| `--tone-strong` | `1` | Opacity for primary text. |
| `--tone-medium` | `0.72` | Opacity for secondary text. |
| `--tone-light` | `0.55` | Opacity for tertiary text/placeholders. |

**Inconsistencies:**
- `text-primary`, `text-secondary`, `text-tertiary` classes exist but seem underused compared to `.muted`.
- Some inline styles use hardcoded colors (e.g., `#0b6b2e` for approved events).

## 3. Spacing

**Implementation:** CSS Variables (`--space-sm`, `--space-md`, `--page-pad`) and inline styles.

| Token | Value | Usage |
| :--- | :--- | :--- |
| `--page-pad` | `16px` (Desktop) / `12px` (Mobile) | Container padding. |
| `--space-sm` | `6px` | Small gaps (e.g., tags). |
| `--space-md` | `12px` | Standard gaps (rows, grids). |
| `gap: 10px` | Inline style | Frequent in toolbars and headers. |
| `gap: 12px` | Inline style | Frequent in lists and grids. |
| `marginTop: 14px` | Inline style | Common between sections. |

**Inconsistencies:**
- Heavy reliance on inline `style={{ gap: ... }}` rather than utility classes.
- Gap values vary slightly (10px vs 12px) across similar contexts.

## 4. Interactive States

| Element | State | Visual Treatment | Implementation |
| :--- | :--- | :--- | :--- |
| **Links / Muted Buttons** | Hover | Color changes to `--fg` (white/black), underline appears. | `a:hover`, `button.muted:hover` in `globals.css`. |
| **Inputs** | Focus | Bottom border color changes to `--fg`. Outline removed. | `input:focus` in `globals.css`. |
| **Filter Controls** | Open/Focus | Border color changes to `--fg`. | `.om-filter-control:focus`. |
| **Book Cards** | Hover | Cover image brightness increases (1.03). | `.om-book-card:hover .om-cover-slot`. |

**Inconsistencies:**
- Some buttons use `textDecoration: "underline"` inline, others rely on global CSS.

## 5. Layout Patterns

| Pattern | Implementation | Notes |
| :--- | :--- | :--- |
| **Container** | `.container` class | Max-width 880px, centered, padded. Used on almost every page. |
| **Flex Row** | `.row` class | `display: flex`, `align-items: center`, `gap: 12px`. Ubiquitous for toolbars and headers. |
| **Grid (Books)** | `display: grid` (Inline) | Responsive columns (1/2 mobile, 2/4/8 desktop). Logic often in page components. |
| **Card (Block)** | `.card` class | No border/bg by default, just padding `12px 0`. Used for grouping content. |
| **Baseline Alignment** | `.om-row-baseline` | `align-items: baseline`. Critical for text-heavy rows (metadata). |

**Inconsistencies:**
- Grid column logic is repeated in `AppShell`, `PublicBookList`, and `LibraryBlock`.

## 6. Component Patterns

| Component | Selector / File | Visual Style | Notes |
| :--- | :--- | :--- | :--- |
| **Inline Inputs** | `.om-inline-control` | Transparent, borderless, matching text size. | Used for "edit in place" metadata. |
| **Filter Dropdowns** | `.om-filter-control` | Bordered, caret icon background. | Used for view/sort options. |
| **Avatars** | `.om-avatar-img` | Circular, bordered. | Sizes defined by `--avatar-size` (24px) or overrides (48px). |
| **Cover Image** | `CoverImage.tsx` | Aspect ratio handling, cropping support. | styling via `.om-cover-slot`. |
| **Tags/Pills** | `.om-token` | Text only, no background. "x" to remove. | minimalist "pill" style. |
| **Active Filters** | `ActiveFilterDisplay.tsx` | Grey label, white value, "clear" link. | Standardized component. |

**Inconsistencies:**
- "Add to Library" button has its own distinct styles (rounded, bordered) compared to text-only buttons.

## 7. Page-Level Patterns

| Page Type | Key Structure |
| :--- | :--- |
| **Personal Homepage** | `AppShell` > `BulkBar` > List of `LibraryBlock`s. Toolbar with Search/Add/Filter. |
| **Public Profile** | Header (Avatar + Bio) > `PublicBookList` (Grid/List). |
| **Book Detail** | Header (Owner info) > `om-book-detail-grid` (Cover + Metadata column). |
| **Facet Browse** | Header (Counts + Filter) > List of grouped books. |

**Observations:**
- **Navigation:** `GlobalNav.tsx` provides the top bar (Logo + User Menu).
- **Transitions:** `template.tsx` handles fade-in animations on navigation.
- **Mobile:** Significant logic to switch views (List vs Grid) and hide elements (Scan button).

## Summary of Findings

- **Design Philosophy:** Minimalist, text-centric, relying heavily on typography hierarchy (opacity) rather than distinct backgrounds or borders.
- **Implementation Style:** Hybrid approach. Global CSS for base elements and common patterns (`.row`, `.card`), but extensive use of inline styles (`style={{ ... }}`) for specific layout tweaks and dynamic values.
- **Consistency:** High consistency in typography and core layout structures. Some variation in spacing values (10px vs 12px).
- **Recent Standardizations:** Active filters and edit-mode inputs have been recently normalized to ensure visual consistency.
