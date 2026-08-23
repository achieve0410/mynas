# MyNAS Design System

Status: current product and interface contract for v0.4
Product posture: calm, local-first infrastructure with a first-class photo library

## 1. Product Direction

MyNAS should feel like a private appliance rather than a cloud control plane. The interface
must make storage safety legible without making routine use feel like incident response.

- Primary user: the owner of one home or studio NAS.
- Primary jobs: understand health, configure storage, move files, preserve photos, recover
  from a degraded mirror.
- Desired adjectives: calm, trustworthy, technical, tactile, restrained.
- Avoid: generic SaaS cards, neon cyberpunk, glossy gradients, oversized marketing type,
  unexplained acronyms, and decorative charts.
- Visual metaphor: a dark workbench with clear instrument lights.

The hierarchy is always:

1. Current system and mirror safety.
2. The task the owner came to perform.
3. Supporting detail and history.

## 2. Research Inputs

Embedded references:

- Supabase: charcoal layering, compact technical controls, restrained emerald accent.
- Soft-skill: generous focus areas, friendly copy, deliberate whitespace, not playful
  decoration.
- Layout-skill: stable app shell, one dominant region per screen, explicit mobile collapse.
- Designpowers: owner persona, consequence-based critique, accessibility and state inventory.

Viewed Lazyweb product screens:

- Krea gallery: chronological labels and a dense image field work better than wrapping every
  photo in a card. MyNAS adopts the timeline grouping, not Krea's floating desktop chrome.
- Glass portfolio: masonry preserves image character, but its extreme vertical collage is
  unsuitable for scanning. MyNAS uses a regular justified grid with bounded row heights.
- Zoho WorkDrive: a visible storage meter and folder usage create immediate orientation.
  MyNAS keeps the capacity meter but removes the dated three-column dashboard density.
- Google Admin: persistent navigation and clear section titles are dependable. MyNAS uses
  stronger contrast and fewer bordered containers.
- SigNoz: dark infrastructure surfaces make graphs readable, but saturated chart colors and
  dense nested navigation would overstate MyNAS complexity.

Image generation was unavailable in this harness, so no concept image was produced. These
references are directional only; no third-party screen or asset ships with MyNAS.

## 3. Information Architecture

Desktop navigation:

1. Overview
2. Storage
3. Files
4. Photos
5. Albums
6. Protection
7. Activity
8. Guide
9. Settings

Mobile navigation exposes Overview, Files, Photos, and More. More opens a sheet containing
Storage, Albums, Protection, Activity, Guide, Settings, and sign-out.

Routes:

| Route | Purpose | Dominant region |
| --- | --- | --- |
| `/setup`, `/login` | Shared setup/login gate selected by service state | Single focused auth panel |
| `/` | Assess safety and resume recent work | Volume health board |
| `/storage` | Manage backends, mirrors, scrub, repair | Backend and mirror controls |
| `/files` | Browse folders and find, transfer, or recover protected files | Folder browser |
| `/photos` | Find and browse the protected photo library | Adjustable timeline grid |
| `/albums` | Browse collections created from photo selection | Album list |
| `/protection` | Review durable backup and scrub incidents with remediation | Incident ledger |
| `/activity` | Review recent transfer outcomes and failure reasons | Activity timeline |
| `/guide` | Learn each menu's purpose, setup, and verification steps | Guide topics |
| `/settings` | API tokens and service information | Settings sections |

## 4. App Shell

Desktop, at 1024px and wider:

- 232px fixed navigation rail.
- 48px top utility bar within the content region.
- Main content width is fluid, capped at 1440px, with 28px horizontal gutters.
- A 1px divider separates rail and content; no rail drop shadow.
- System status is a compact labeled indicator in the rail footer.

Tablet, 720px to 1023px:

- 72px icon rail with tooltips.
- 24px content gutters.
- Secondary panes become drawers.

Mobile, below 720px:

- No side rail.
- 56px top bar and 64px bottom navigation.
- 16px gutters.
- Tables become stacked rows with aligned labels, never horizontally scrolling by default.
- Fixed controls account for safe-area insets.

At 390x844, the root `scrollWidth` must equal its `clientWidth`; no component may rely on
clipping to hide overflow. Flexible content children must allow `min-width: 0`.

## 5. Visual Tokens

### Color

Dark is the v0.1 default. Colors communicate operational meaning; accent is not decoration.

```css
:root {
  color-scheme: dark;
  --canvas: #070b09;
  --surface-1: #0d1210;
  --surface-2: #121915;
  --surface-3: #18211c;
  --border-subtle: #202b25;
  --border-strong: #34433b;
  --text-primary: #f1f6f3;
  --text-secondary: #a2b0a8;
  --text-tertiary: #718078;
  --accent: #34d399;
  --accent-strong: #10b981;
  --accent-wash: #34d3991a;
  --info: #60a5fa;
  --warning: #fbbf24;
  --danger: #fb7185;
  --focus: #6ee7b7;
}
```

Contrast requirements:

- Body text: at least 4.5:1.
- Large text and graphical controls: at least 3:1.
- Focus outline must remain visible against every surface.
- Health never relies on color alone; every state includes icon, label, and concise reason.

### Typography

- UI and prose: bundled Manrope variable, weights 400, 500, 600, 700.
- Identifiers, paths, checksums, sizes: bundled IBM Plex Mono, weights 400 and 500.
- No external font requests.

Scale:

| Token | Size / line height | Use |
| --- | --- | --- |
| `display` | 36 / 42 | Empty-state or setup headline only |
| `title-1` | 28 / 34 | Page title |
| `title-2` | 20 / 26 | Primary section |
| `title-3` | 16 / 22 | Component heading |
| `body` | 14 / 21 | Default UI copy |
| `small` | 12 / 18 | Labels and metadata |
| `micro` | 11 / 16 | Dense table metadata |

Use sentence case. Do not use all caps except tiny status abbreviations such as S3.

### Spacing and shape

- Base spacing unit: 4px.
- Common steps: 4, 8, 12, 16, 24, 32, 48, 64.
- Control height: 36px desktop, 44px touch.
- Surface radius: 10px; nested control radius: 7px; pill radius: 999px.
- Shadows are reserved for floating layers: `0 16px 48px #0008`.
- Never nest bordered cards inside bordered cards. Use spacing and dividers within a surface.

## 6. Core Components

### Navigation rail

- Wordmark and product name at top.
- One icon, one label, and one selected marker per item.
- Selected state: accent-wash background, primary text, 2px inset accent edge.
- Footer: service version and system state.

### System status strip

A compact horizontal strip appears at the top of Overview and Storage:

- Healthy: "Protected" with both mirror members named.
- Degraded: "Action required" with the unavailable member and writes-disabled explanation.
- Scrubbing: exact current operation and completion state.

Warnings remain visible until the condition changes. They are not dismissible toasts.

### Volume health board

The Overview hero is a single board, not four metric cards:

- Left: protected/degraded state and total volume capacity.
- Center: two member rows with backend kind, identity, health, and last probe.
- Right: last scrub result and one contextual action.
- Mobile: sections stack in that order.

### Data rows

Storage, files, tokens, and jobs share one row grammar:

- 44px minimum height.
- Leading identity, flexible detail, right-aligned state/action.
- Monospace values use tabular numerals.
- Row action menu opens by keyboard and pointer.
- Destructive actions require explicit confirmation with the affected object named.

### Library toolbar

Files and Photos share a compact discovery toolbar directly below the page heading:

- Search is always visible and filters the active library without hiding its label.
- Sort options describe the result order in plain language. Files support name and type;
  Photos support filename, type, and newest/oldest capture time.
- Refresh is a labeled action with idle, refreshing, and complete states.
- Photos add a three-option Small/Medium/Large preview-size control. The selected option uses
  `aria-pressed` and remains available on mobile without horizontal scrolling.
- Folder rows remain visually distinct from files through icon, label, and grouping. Color is
  never the only distinction.

### Transfer queue

- A logical batch exposes aggregate queued/transferring/paused/complete/failed counts. Only active,
  recently paused, and the newest 20 terminal jobs become detail rows; queued work is not mounted
  as thousands of DOM nodes.
- Status is a typed state: queued, uploading/downloading, paused, complete, or failed.
- Byte progress comes from the active request. When total bytes are unavailable, show
  indeterminate progress and the transferred-byte count instead of a fabricated percentage.
- Aggregate completion remains visible until the user clears it. The newest terminal rows keep the
  object name and safe server message; older rows remain represented by the batch counts.
- Download actions expose the same downloading/complete/failed states as uploads.
- A compact live region announces aggregate progress and terminal outcomes; bounded rows provide
  active and recent detail.

### Buttons

- Primary: solid emerald, dark text, one per region.
- Secondary: surface-3 with strong border.
- Quiet: transparent until hover/focus.
- Destructive: danger text or danger fill only inside confirmation.
- Disabled: retains label contrast and includes a reason when writes are refused.

### Forms

- Label above control; helper or validation message below.
- Never use placeholder text as the only label.
- Passwords are never logged or redisplayed.
- Long backend paths and S3 endpoints use monospace and wrap safely.
- Submission errors remain adjacent to the form and move focus to the summary.

### Photo timeline

- Sticky date heading followed by a justified CSS grid.
- Preview density targets: Small 112px, Medium 156px, Large 220px on desktop. Mobile targets
  are Small 88px, Medium 112px, and Large 156px.
- Native aspect ratio is preserved with `object-fit: cover`.
- Preview loads first; original is only fetched by explicit download.
- Mount at most 60 photo tiles initially and append the next 60 near each scroll boundary until
  every matching photo is reachable in one continuous timeline. Previously revealed tiles remain
  in document order. Offscreen tiles use layout/paint containment and shared viewport observation.
  Grid images decode asynchronously; the stored 1280px WebP preview and original bytes are not
  recompressed.
- Selection is a visible top-left check control, not a hover-only affordance.
- Empty timeline shows one upload action and accepted format.
- The native iOS picker remains system-owned. After it returns Files, MyNAS opens an app-owned
  review with New, Checking protection, Already protected, Unsupported, and Over 25 MiB states.
- Successful uploads persist metadata-only local receipts. Receipt matches and filenames already
  present in the protected library are only hashing candidates; automatic skip requires a
  worker-computed SHA-256 that the protected server confirms.
- Review counts include the complete selection while at most 40 item rows are mounted. Confirm
  uploads only New items; exact protected items are skipped or attached to the current album.

### Album view

- Album name and photo count are the only persistent header metadata.
- Creation uses a focused dialog with one name field.
- Adding a photo confirms in-place; it does not navigate away.
- Album detail applies the same append-only 60-tile progressive pages as the photo timeline.

### Lightbox

- Full viewport surface with dimmed canvas.
- Image uses `object-fit: contain`; metadata appears in a collapsible side panel and is closed by
  default.
- `Escape` closes, left/right arrows navigate, and focus returns to the originating thumbnail.
- Keyboard arrows and horizontal swipe navigate without visible previous/next controls; navigation
  never wraps silently.
- Two-pointer pinch zoom is bounded from 50% to 300% and resets when the active photo changes.
  No separate zoom controls are shown.
- A horizontal pointer swipe beyond 64px navigates in the swipe direction. Vertical movement,
  toolbar interaction, shorter drags, and active pinch gestures do not navigate.
- Photo transitions use transform and opacity only. The direction follows the navigation
  direction, and reduced motion removes the translation.
- Focus is trapped while open.
- Save photo is a labeled button, not an icon-only control. On mobile browsers that support sharing
  image files, it opens the native share sheet so the owner can choose Save Image; browsers cannot
  silently write into the system photo library. Unsupported browsers fall back to a file download.
- On mobile, toolbar row one aligns filename plus `width×height (reduced aspect ratio)` opposite
  Close; row two aligns collection position opposite Save photo. Both right-side actions align to
  the toolbar's right content edge. The image follows, then the collapsed metadata sheet with
  imported time, SHA-256, and every album membership.

### Background transfers

- One app-level transfer center survives route changes and presents stable aggregate progress plus
  bounded active/recent rows everywhere.
- Upload and individual-download batches run at most three jobs concurrently; remaining jobs stay
  explicitly queued in the aggregate batch state.
- A background tab does not cancel work. If the mobile OS suspends networking, affected jobs pause
  rather than fail and automatically resume when the document is foregrounded or connectivity
  returns. The web UI never claims bytes continue while iOS has suspended the process.
- Selected files download individually; each selected folder remains one ZIP job. Selected photos
  download their protected originals individually.
- One aggregate batch result is posted after all jobs reach terminal state. Slack upload and
  download targets are separate threads; totals cover the complete batch while at most 100
  sanitized representative details put failures first.
- The newest 20 completed/failed rows remain inspectable until the user clears finished work.
- Close hides the current transfer-center snapshot without cancelling queued or active work. A new
  job or a later status/error change makes the center visible again; Clear finished remains the
  explicit action that removes terminal history.

### Activity timeline

- Events are durable server records, newest first, and survive reloads.
- Each row shows action, success/failure, affected filename or resource, relative/absolute time,
  and a concise failure reason when present.
- Status and action filters are native labeled controls. Refresh has an explicit request state.
- Activity never exposes credentials, raw request bodies, local storage roots, or file contents.
- Routine listings, health polling, and photo preview requests are not activity events.

### Guide topics

- Guide is one navigation destination, not duplicated help panels on every page.
- Topic controls cover Overview, Files, Photos, Albums, Activity, and Settings.
- Every topic has three semantic sections identified by machine-consumed section keys:
  purpose, setup, and verification. Tests assert those keys rather than prose.
- Desktop uses a topic rail and reading pane. Mobile uses a horizontally wrapping segmented
  topic control above one reading pane.

## 7. Interaction and Motion

- Motion duration: 120ms for control feedback, 180ms for drawers/dialogs, 220ms for
  lightbox transitions.
- Easing: `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- No looping decorative animation.
- Respect `prefers-reduced-motion`; transitions become immediate except progress indicators.
- Upload progress is driven by request state. Completion is the exact API response/job state,
  never a timer.
- Download progress is driven by streamed response bytes and terminal response completion.
- Transfer rows adapt the beui.dev file-upload mechanism: stable rows, explicit status changes,
  transform/opacity feedback, and no animation dependency or decorative loop.
- Transfer concurrency is three. Hidden/offline network failures enter `paused`; `online` or
  foreground visibility is the exact resume signal.
- Lightbox swipe uses pointer capture and a 64px horizontal threshold; the image settles over
  220ms. Pinch zoom uses 120ms transform feedback.
- Scrub and repair state is driven by explicit operation responses.

## 8. State Inventory

Every feature must implement:

- Loading: structural skeleton with stable dimensions.
- Empty: explains what belongs here and offers one next action.
- Failure: names the failed object and offers a safe retry or recovery path.
- Offline/service unavailable: persistent banner and disabled mutations.
- Unauthorized: route to login while preserving the intended path.
- Degraded mirror: warning strip, unavailable member, writes disabled.
- Success: in-place state update; toast only for transient confirmation.

Toasts are never the sole carrier of an error or data-loss warning.

## 9. Accessibility Contract

- WCAG 2.2 AA target.
- All routes have one visible `h1` and a skip link.
- Interactive elements are native buttons, links, inputs, and dialogs.
- Keyboard order follows visual order.
- Focus ring: 2px `--focus` with 2px offset.
- Icon-only controls require accessible names and tooltips.
- Dialogs and lightbox restore focus to their triggers.
- Photos use filename-derived alt text until user-authored descriptions exist.
- Live regions announce upload completion, repair result, and authentication errors.
- Search, sort, preview size, refresh, transfer, and navigation controls have persistent labels.
- Progress bars expose `aria-valuenow`, `aria-valuemin`, and `aria-valuemax` when determinate.
- Touch targets are at least 44x44px.

## 10. Responsive Acceptance

Required viewports:

- 1440x900 desktop
- 1024x768 compact desktop
- 768x1024 tablet portrait
- 390x844 mobile

At each viewport:

- No horizontal overflow.
- Primary action remains visible without covering content.
- Navigation remains reachable by keyboard.
- Storage state and recovery action remain above secondary history.
- Photo lightbox opens and closes by keyboard.
- Files and Photos discovery controls wrap without clipping and retain 44px touch targets.
- Activity rows and Guide topics never require horizontal scrolling.
- Lightbox Close and Download remain reachable above the mobile safe area; pinch zoom does not
  require a visible control.

## 11. Implementation Rules

- React with strict TypeScript and Vite under `apps/web`.
- TanStack Query owns server state; local component state owns only transient interaction.
- Zod parses every API response at the client boundary.
- CSS variables in one token layer; CSS Modules or scoped component CSS consumes them.
- Lucide icons only; no emoji icons.
- Bundled fonts and assets only.
- Components render from typed domain states, not scattered boolean combinations.
- Tests assert machine-consumed state and accessibility behavior, never prose wording.

## 12. Review Gate

Before a UI increment is accepted:

1. Run typecheck, unit tests, and production build.
2. Use the real route in a browser at all required viewports.
3. Capture desktop and 390x844 screenshots.
4. Check keyboard-only navigation, focus restoration, and reduced motion.
5. Run accessibility and horizontal-overflow checks.
6. Compare the result to this document and record intentional deviations.
