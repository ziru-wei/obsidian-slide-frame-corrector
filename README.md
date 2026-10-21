# Slide Frame Corrector (Obsidian plugin)

Straighten photos of projected classroom slides, right inside your notes. Fully local: no network requests, no OCR, no AI API. Originals are never modified.

## Install
Manual: copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/slide-frame-corrector/`, then enable it under Settings → Community plugins. Or add this repo with [BRAT](https://github.com/TfTHacker/obsidian42-brat).

## Use
- **Right-click an image** → *Correct projected slide* (single photo).
- **Right-click the document** (or run the command *Correct all photos*) → *Batch correct slides in note…* opens a dashboard of every photo in the note, one card each, scrolling sideways.
- Commands: *Correct one photo*, *Correct all photos*, *Clean originals*.

### Editing the frame
- Drag the four corners or the four edge handles; a loupe and crosshair help placement.
- Press **1–4** to jump that corner to the next candidate vertex (best edge support first)  Click a yellow candidate ring to apply it.
- *Auto* detects the frame (green ✓ when confident). *Reset* returns to the frame the editor opened with.
- Crop can be switched off to adjust only color/tone.

### Output options (remembered)
Aspect (16:9 / 4:3 / auto), format (JPG / PNG), color correction (off / soft / standard / strong: per-channel auto levels plus an S-curve), tone (color / grayscale / black & white), crop on/off, interface language (English / 中文).

### Batch dashboard
- Select-all checkbox, *Show processed* (hidden by default), *Auto-detect all* (untick to restore the previous frames).
- Photos that would produce something new are tinted with a one-line reason; unchanged ones are skipped on Save.
- Re-editing a processed photo starts from its original and the frame used last time. Frames you drag are remembered even if you don't save.
- File names and paths are in each card's “⋯” menu.

### Clean originals
Settings → *Clean originals* moves originals that have a corrected version and are no longer linked from any note to the trash, after you confirm the list.

## Develop
```bash
npm install
npm run build   # offline bundle -> main.js
npm test
npx tsc --noEmit
```

MIT licensed.
