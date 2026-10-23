# Focal Dither

Upload an image and a WebGL2 shader breaks it into squares around a focal point. The squares
are largest at the focus and halve in size outward until the original image shows through.
Blur, noise, ordered dither and ASCII can each be switched on and dialed from 0 to 1.

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000
```

`npm run build` writes a static site to `out/`, which you can preview with `npx serve out`.

## Deploy to Render

The repo includes a `render.yaml` Blueprint, which sets it up as a static site that builds to `./out`.

1. Push the repo to GitHub or GitLab.
2. In Render, choose **New → Blueprint** and pick the repo.

To set it up by hand instead, create a Static Site with build command `npm ci && npm run build`
and publish directory `out`.

## Using it

- Drag on the image to move the focus from where it is; double-click to put it under the cursor. Drop, paste or upload an image to replace the sample.
- **H** or the **Guide** switch turns off the outline, focus marker and field view to preview the final render.
  Exports never include the guide.
- **Timeline** (under the image) works like After Effects. Click the ◇ next to any setting (or **◇ Animate
  focus**) to animate it: it keys the current value at the playhead and the setting gets its own row in the
  timeline. Scrub on the ruler, change the setting (or drag the focus) and it's keyed there. In a row, ◀ ▶ jump
  between its keys, ◆ adds or removes the key at the playhead, ✕ stops animating it (keeping its current value).
  Drag a key to retime it, Alt-click to delete it. Settings you haven't animated stay global and apply at every
  time. Sliders, the focus and colours blend between keys (Ease or Linear); switches and dropdowns change at the
  key. **Space** plays and pauses, **Clear** stops all animation and keeps the current look. The ASCII character
  set can't be animated. The timeline is saved with the session and with presets.
- **Export MP4** (dimmed unless something animates) renders the timeline when it has two or more keyframes,
  otherwise 5 seconds of the Animate motion, at 30 fps to an H.264 MP4, frame by frame,
  so the clip is smooth however long encoding takes. It needs a browser with WebCodecs (current Chrome,
  Edge, Safari or Firefox).
- Your last settings, focus and image are saved automatically in this browser and come back on reload
  (settings in localStorage, the image in IndexedDB). **Reset** restores the default settings but keeps the image.
- **Presets** save named settings in the browser, or export/import them as JSON.
- **Shape** sets the area of influence: shape, radius, falloff, aspect and rotation.
- **Organic** is off by default, so the area follows the shape strictly. Turn it on for an irregular
  outline, scattered islands of influence past the shape (Reach), and clean holes inside it.
  **Amount** blends between strict and fully noisy.
- **Squares**: Max size goes up to 4096px and squares halve down to Min size. **Scale** under Global
  multiplies every size at once.
  **Scatter** mixes neighbouring sizes and thins the faintest squares; **Spread** scatters every edge
  (shape, islands, holes) so influence disperses instead of stopping at a line. Spread is measured in size
  bands (the width over which one square size wins), so it looks the same at any image size.
- **Drift** (under Global, needs Animate) sets the dispersion in motion: squares near an edge wander in and out
  of the influence, and with Organic on the islands, holes and outline slowly flow.
- **Outside** turns everything the effect doesn't reach into a solid colour (Amount blends from the image).
  Squares sit fully on the colour, and the softer effects fade into it with their strength.
- **ASCII**: pick a character set from the dropdown or type your own. The set is sorted by how much ink
  each glyph draws, and it is scaled so the largest glyph fills its square. Each square is either "plain"
  (coloured glyph on black) or "mosaic" (filled square with a contrasting glyph). Dense glyphs can scramble
  over time.
  **Unicode · all** uses every visible character in Unicode's two main planes (about 82,000). The GPU holds
  at most 2048 glyphs at once, so the first time you pick it the app measures all of them (this takes a few
  seconds) and keeps 2048 spread evenly from lightest to densest, skipping characters with no installed font.
  The selection is cached in the browser after that.

## Code

- `src/lib/shaders.ts`: the fragment shader (field, square sizes, effects, ASCII, guide)
- `src/lib/engine.ts`: WebGL setup, image and glyph textures, uniforms
- `src/lib/params.ts`: every control, its range and default
- `src/components/`: React UI
