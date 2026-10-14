# Weylume Frontend Design System

## Product identity

Weylume is the user-facing community product identity. `intelligent-social-network`
remains the repository and technical project identifier. The abstract W symbol
uses intersecting ribbon strokes to suggest belonging and shared interests; it
is an original project asset, not a claim of legal trademark or domain clearance.

Use the wordmark with the compact mark in navigation and authentication. Keep
clear space at least half the mark width, preserve the supplied colors on light
surfaces, and do not skew, outline, recolor, or combine the mark with unrelated
icons. The compact mark is used for favicon and touch icon. Use Lucide for UI
icons; do not use the brand mark as a generic control icon.

## Voice and content

- Write in natural, welcoming Vietnamese; keep Weylume in its approved English
  spelling.
- Speak confidently about the product's purpose without implying feeds,
  friendships, recommendations, active-user counts, testimonials, moderation
  guarantees, or other unavailable functionality. Authenticated profile and
  discovery copy may describe only the implemented display name, bio, optional
  location, and member directory; do not imply avatar upload.
- Product positioning should not be framed as technical progress or API health.
- Every link and button has a real route, a section target, or an action.

## Token architecture

`apps/web/src/app/styles/tokens.css` is the sole runtime token source. It has
three layers:

1. **Primitive:** palette and measured base values.
2. **Semantic:** canvas, surface, text, action, focus and feedback purposes.
3. **Component:** button, input and card roles only where they avoid repetition.

Use semantic variables in page/component CSS. Do not add per-page hex values for
colors already represented by tokens or create a second generated token source.

### Foundations

- Core teal: `#0F766E`; hover `#115E59`; pressed `#134E4A`.
- Canvas `#FAFAF7`; surface `#FFFFFF`; text `#172B2A`; muted `#526461`;
  divider `#D8E2DF`.
- Be Vietnam Pro is self-hosted in WOFF2 with the Vietnamese and Latin subsets;
  its SIL Open Font License is retained at `apps/web/public/fonts/OFL.txt`.
  `font-display: swap` and system fallbacks are configured.
- Spacing follows a 4px base; layout uses mobile-first composition and a 1200px
  maximum content width. Use existing breakpoints as composition needs dictate.
- Controls use approximately 10px radius, cards 16px, panels 24px. Elevation is
  reserved for meaningful surfaces.
- Interface icons use `lucide-react`, outline style, consistent 2px strokes and
  16/20/24px sizing. Decorative icons are hidden from assistive technology;
  icon-only controls need an accessible name.

### Accessibility and interaction

- Target WCAG 2.2 AA: 4.5:1 for normal text; 3:1 for large text and meaningful
  control boundaries/indicators. Measure actual rendered foreground/background
  pairs, including states; color is never the only state cue.
- The subtle divider token is for card/section separation; input and outlined
  button boundaries use the darker control-border token (at least 3:1 against
  the white surface).
- Use semantic controls, labels, linked field hints/errors, visible keyboard
  focus and practical 44×44 CSS-pixel pointer targets. Skip links move focus to
  their content/form destination and retain a visible focus indicator there.
- Respect `prefers-reduced-motion`; do not hide content until animation runs.
- Check Vietnamese text at narrow widths and browser zoom/reflow; avoid clipped
  email addresses and password truncation.

## Shared UI and layout

Reusable UI belongs in `apps/web/src/shared/ui/`, brand elements in
`shared/brand/`, and layout primitives in `shared/layout/` when used by multiple
routes. Shared controls do not depend on authentication context or services.

Current primitives include Button (`primary`, `secondary`, `ghost`, pending),
Alert (`error`, `success`, `info`) and PasswordField (label, autocomplete,
visibility toggle, hint/error association). Use semantic links styled as buttons
for navigation. Page-level layout remains with its owning page or feature UI.
Add variants only for real repeated use; do not create unused feed, profile,
friend, avatar, recommendation or dialog abstractions.

## Motion

Use CSS transitions for interaction states (generally 80–180ms), subtle one-shot
entrance (under 240ms), and visible text-backed loading feedback. Avoid continuous
decoration, parallax and scroll hijacking. Reduced-motion users receive the same
content and final visual state without movement.

## Profile and discovery adoption

The authenticated Profile and Discovery features reuse semantic tokens, buttons,
fields, cards, typography, containers and focus/feedback rules. Their domain state
stays in the owning features, and their loading, empty and error states follow the
documented API contract. Future friendships, feeds and recommendations remain
planned; their design should reuse these shared rules without implying they are
implemented.
