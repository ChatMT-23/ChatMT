# Ink Register

*A design philosophy for interfaces that measure colour.*

> Since 31 October 2026 the public page is a simpler composer. The Ink Register language
> described below remains the language of the detailed studio page (`frontend/studio.html`); the
> public page (`frontend/index.html`) applies it in a quieter, single-column form. The final
> section records the public composer's rules.

## The movement

Ink Register treats the screen as a proof sheet, not a dashboard. Paper is the ground; ink is the evidence; colour is a measured fact, never a mood. It refuses the glowing panel, the floating card, the soft gradient that exists only to fill a corner. A page is a sheet, a section is a plate, a value is a specimen. The interface should feel like the table of a master printer at the end of a long day: everything in its place, nothing extra, every hairline drawn twice.

## Space and form

Space is ruled, not filled. A single vertical axis carries the page; horizontal hairlines divide it into registers, and the margin is treated as a working margin — numbered, annotated, never merely empty. Forms are rectilinear and corners are nearly square, because a proof sheet has edges, not pillows. The grid is present as a faint pulse beneath the paper, visible only when the eye looks for it. Nothing touches the trim. Nothing overlaps. Every gap is measured, and the same gap returns elsewhere, so the page reads as one system rather than a sequence of decisions.

## Colour and material

The ground is warm paper, never white: a bone tone with a little age in it. Ink is near-black with a brown bias, so text sits in the sheet rather than on top of it. Chromatic colour appears only where colour is the subject — specimens, control bars, one selected field — and the surrounding page stays achromatic so those moments carry their full weight. A single signal ink, a proofing vermilion, marks the questioned, the active, the exception. A deep green is reserved for the friendly stamp. No gradient decorates the page; every gradient that survives is data.

## Scale and rhythm

Typography does the work of image. A high-contrast display serif speaks once per page, at a scale that would be reckless anywhere else; a neutral grotesque carries the argument at reading size; a monospaced register carries codes, measures, and metadata. Numbers are set as artefacts, not as prose. Rhythm comes from repetition — plate numbers, rules, labels, the same small caps at the same optical weight — and from the discipline of leaving some registers almost empty. The page should reward a second look and a third, because the third look is where the system becomes visible.

## Composition and hierarchy

Hierarchy is declared, not implied. The eye should be able to reconstruct the system after three glances: masthead, specimen, transcript, plates. Each plate announces its number, its title, and its evidentiary note in the same order every time; the reader learns the grammar once and then reads content instead of chrome. Emphasis is earned by position, scale, and ink weight, never by a coloured box. The composition is balanced optically as well as mathematically: a heavy specimen is answered by a quiet margin, a dense register by a breath of paper.

## Craftsmanship

The result must look laboured over. Every hairline is deliberate; every alignment is optical as well as mathematical; every label is set at the size it needs and no larger. The work should appear to have taken countless hours at the top of the field — not because it is ornate, but because nothing is approximate. It must survive inspection at one hundred percent and still read from across the room. Text is sparse and essential, integrated as a visual element, never a paragraph of explanation where a measure, a rule, or a specimen can speak. This is the standard: a sheet that could be pinned to a wall as evidence that an ephemeral thing — a colour, a preference, a reason — was studied with care.

## Implementation notes

The live interface applies the movement with these concrete rules:

- **Palette.** Paper `#F4F1E9`; ink `#17140F`; proofing vermilion `#C0301B`; friendly green
  `#17603F`; amber `#7A5200`.
- **Type.** Gloock for the display line, Instrument Sans for reading, Geist Mono for codes and
  metadata. All three are served locally from `frontend/fonts/` with their OFL licences; no
  remote webfont is requested.
- **Structure.** A 310 px sticky job ticket with four numbered blocks and a proof sheet with eight
  numbered plates; the spectral register in the masthead and the specimen plate are the only
  places where colour is shown at full strength. The chat thread is a short conversational mirror;
  the detail panels remain the source of truth.
- **Responsive rule.** The DOM is main-first at every width; below 960 px the layout becomes one
  column and the main sheet therefore comes before the ticket on screen. The covered palette moves
  from three columns to two to one. Nothing overflows horizontally at 1440, 1024, 768 or 390 px.
- **Motion.** Transitions are short and decorative; `prefers-reduced-motion` removes them, and the
  chat follows the conversation only when it is already on screen.
- **Focus and touch.** Every control keeps a visible `:focus-visible` outline; touch targets are
  at least 44 px on small screens. Form controls keep the ruled underline as their pointer-focus
  treatment, while keyboard focus gets the vermilion outline.
- **State.** A request token discards out-of-order answers, a failed request removes the typing
  indicator, and a new selection clears the stale reason, delay and correction panels.

## The public composer: Blue Ash

The public page reduces the system to one gesture. The proof-sheet language survives in the
typography and the paper card, but the page gives the user only one thing to do: describe the
flyer, optionally attach a photo, press once.

- **Ground.** Blue ash `#ABC0CA`, deepened to `#8FA8B4` at the edges, with a faint paper grain.
  The composer is a warm paper card `#F8F4EA`; the ink is `#13232B`; the action is deep teal
  `#123B49`; the exception is proofing vermilion `#C05B3B`.
- **One composition.** The headline is set once, large, in Gloock; the argument is Instrument
  Sans; the metadata and the hints are Geist Mono. There is no second display type, no badge
  wall, no palette grid. The generated background is the only image on the page.
- **Text first.** The textarea is the largest control and the only required input. The photo is
  an optional attachment, not a step. The create button is the only filled shape on the card.
- **The rules are elsewhere.** The page links to GitHub instead of reproducing the standards.
  The user sees the consequence of a rule (tone, delay, number of backgrounds), not the rule
  table.
- **Generated backgrounds.** The background suggestions are images produced by the model from a
  colour-and-motif prompt, cached on the server. They are shown as cards; choosing one recomposes
  the flyer without storing anything. The gradient fallback is honest about the missing model.
- **Responsive rule.** The DOM is text-first at every width; below 760 px the form stacks, the
  photo and the create button become full-width, and the background grid goes to two columns and
  then one. Nothing overflows horizontally at 1440, 1024 or 390 px.
- **Accessibility.** Visible `:focus-visible` outlines, 44 px touch targets on small screens,
  `prefers-reduced-motion` respected, labelled controls and live regions. No `innerHTML`.
