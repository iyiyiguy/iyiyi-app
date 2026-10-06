# iYiYi — Clear Glass Theme

The redesign direction: clean, professional, "clear glass" — not colorful, not a
photo texture behind the UI. Pale, mostly-white surfaces with real blur, soft
diffuse shadows instead of visible borders, and a restrained accent color used
only for selected/active states. Matches the reference design (soft iOS-style
"Liquid Glass": bright, near-opaque white panels, minimal color, subtle shadow
— not a low-opacity tinted overlay).

All of this lives in `src/theme.js` and `src/components/GlassPanel.js`. Every
screen that already imports `colors`, `type`, `radii` from `theme.js` picks up
the new look automatically — no need to touch each screen individually unless
it hardcodes its own card styling instead of using `GlassPanel`/`UserCard`.

## Palette (`src/theme.js`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `colors.ink` | `#e9ecf2` | `#171225` | Screen background |
| `colors.inkSurface` | `#ffffff` | `#211a33` | Plain (non-glass) surfaces |
| `colors.inkSurfaceRaised` | `#f3f5f9` | `#2b2240` | Raised plain surfaces |
| `colors.hairline` | `#e4e7ee` | `#3a2e52` | Dividers where a glass panel isn't used |
| `colors.text` | `#1c1e24` | `#f2f0f6` | Primary text |
| `colors.textMuted` | `#6b6e79` | `#b0a7c2` | Secondary text |
| `colors.textFaint` | `#9598a3` | `#7d7396` | Tertiary / placeholder text |
| `colors.magenta` | `#e0158b` | same | Accent — selected chips/tabs, links |
| `colors.glassFill` | `rgba(255,255,255,0.7)` | `rgba(43,34,64,0.7)` | Glass panel fill |
| `colors.glassFillStrong` | `rgba(255,255,255,0.85)` | `rgba(43,34,64,0.85)` | Glass panel fill, less see-through (bars, sheets) |
| `colors.glassShadow` | `rgba(30,40,80,0.12)` | same | Soft diffuse drop shadow under a glass panel |

Dark mode is a **dark purple** tint (not plain grey/black) — same clear-glass
treatment, just tinted toward the brand violet, per the user's call.

`gradients.camera` (`['#ff8bd0', '#8b7bff']`) is the one place a colorful
gradient remains — the raised camera button in the tab bar. `gradients.brand`
(the old magenta→violet header gradient) is kept only for backward
compatibility; nothing new should use it.

## Typography

Font: **Manrope** (`@expo-google-fonts/manrope`, loaded in `App.js` via
`useFonts`). Weights used: 500 (body), 600 (labels), 700 (titles), 800
(display/hero numbers). `type.display` / `type.title` / `type.body` /
`type.label` / `type.caption` in `theme.js` already reference the right
weight — just spread them (`{...type.body}`) as before.

## `GlassPanel` — the core building block

```js
import GlassPanel from '../components/GlassPanel'

<GlassPanel radius={radii.lg}>
  <View style={{ padding: 14 }}>…</View>
</GlassPanel>
```

- Real blur behind the panel (`expo-blur`'s `BlurView`, `intensity` prop,
  defaults to 40), not a fake CSS-style blur.
- A light, mostly-opaque fill on top (`colors.glassFill`, or
  `colors.glassFillStrong` via the `strong` prop for bars/sheets that need to
  stay legible over busy content).
- A soft diffuse shadow (`colors.glassShadow`-based), not a border. **Don't
  add a `borderWidth`/`borderColor` to a glass panel** — the reference look
  has no visible border ring; the blur + shadow + rounded corners are what
  read as "glass."
- `radius` controls the corner radius (`radii.lg` for cards, `999` for pills
  and bars).

Used by: `UserCard` (grid + list variants), `TabBar`, and should be the
default for any new card/pill/sheet surface. A photo/avatar placed inside a
`GlassPanel` (as a plain `<Image>`) stays fully solid/opaque — the glass fill
sits behind it, so it never washes out.

## Components already updated

- **`TabBar`** — a floating glass pill (not a bar docked to the screen edge),
  with the selected tab as a small solid dark circle behind its icon. The
  camera stays the one raised, colored (gradient) button.
- **`BrandHeader`** — a dark glass bar (blurred + `rgba(22,22,30,0.55)`), not
  the old magenta/violet gradient. Kept dark-tinted (rather than switching to
  light glass) so every screen's existing white `right`-slot icons stay
  legible without edits.
- **`UserCard`** — grid cards: photo as a rounded thumbnail inside a padded
  glass panel, name/tag below (not overlaid on the photo). List rows: same
  glass panel, horizontal layout.

## Still on the old styling (not yet converted)

Any screen with its own inline `StyleSheet` for cards/bars instead of using
`GlassPanel`/`UserCard` — e.g. custom chip rows, sheets, or screen-specific
cards — still has hardcoded solid backgrounds and hairline borders. Convert
those the same way: swap the container for `GlassPanel`, drop the border,
add a soft shadow instead. Grep for `colors.inkSurface` /
`borderColor: colors.hairline` in a screen file as a quick signal that it's
still due for this pass.

## Motion and lightweight surfaces (Oct 2026)

- `src/lib/motion.js`: iOS-tuned springs (`SPRING`), `Press` (spring press-scale + haptic, use for
  every tappable), `FadeIn` / `PopIn` entrance wrappers with `index` stagger, `animateLayout()`,
  `usePulse`, `useDrift`.
- `src/components/Surface.js`: glass look without a blur view. `GlassPanel lite` renders it. Use
  `lite` for every cell in a list or grid (UserCard, chips, game cards already do); keep real
  Glass for bars, hero panels and sheets.
- `src/components/Avatar.js`: profile photo with an initial-letter gradient fallback (expo-image,
  memory-disk cache). Use instead of a bare `<Image>` for people.
- `src/components/CameraGate.js`: camera permission the App Review way - system prompt first,
  neutral "Camera access is off" + Open Settings when denied. Never add a custom Allow screen.
- `src/lib/cache.js` + `src/lib/location.js`: screens render their last data instantly and use the
  last known position before waiting for a fresh GPS fix.
