# MyNAS Design System

Status: direction lock for v0.1
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
6. Settings

Mobile navigation exposes Overview, Files, Photos, and More. More opens a sheet containing
Storage, Albums, Settings, and sign-out.

Routes:

| Route | Purpose | Dominant region |
| --- | --- | --- |
| `/setup`, `/login` | Shared setup/login gate selected by service state | Single focused auth panel |
| `/` | Assess safety and resume recent work | Volume health board |
| `/storage` | Manage backends, mirrors, scrub, repair | Backend and mirror controls |
| `/files` | Transfer or delete a known object path | Exact-path transfer panel |
| `/photos` | Browse the chronological photo library | Timeline grid |
| `/albums` | Browse collections created from photo selection | Album list |
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
- Desktop row target: 156px; mobile row target: 112px.
- Native aspect ratio is preserved with `object-fit: cover`.
- Preview loads first; original is only fetched by explicit download.
- Selection is a visible top-left check control, not a hover-only affordance.
- Empty timeline shows one upload action and accepted format.

### Album view

- Album name and photo count are the only persistent header metadata.
- Creation uses a focused dialog with one name field.
- Adding a photo confirms in-place; it does not navigate away.

### Lightbox

- Full viewport surface with dimmed canvas.
- Image uses `object-fit: contain`; metadata appears in a collapsible side panel.
- `Escape` closes, left/right arrows navigate, and focus returns to the originating thumbnail.
- Previous/next controls disable at collection boundaries; navigation never wraps silently.
- Focus is trapped while open.
- Download original is a labeled button, not an icon-only control.
- On mobile, metadata becomes a bottom sheet and controls remain clear of safe areas.

## 7. Interaction and Motion

- Motion duration: 120ms for control feedback, 180ms for drawers/dialogs, 220ms for
  lightbox transitions.
- Easing: `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- No looping decorative animation.
- Respect `prefers-reduced-motion`; transitions become immediate except progress indicators.
- Upload progress is driven by request state. Completion is the exact API response/job state,
  never a timer.
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
