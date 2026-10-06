/**
 * Moodle printouts give "pictures" that are really page chrome: slivers of the light-blue
 * question panel, screenshots of other answered questions, near-empty strips. `rgba` is a
 * downsampled copy of the crop (any size); `w`/`h` are the crop's real proportions.
 */
export function isJunkPicture(rgba: ArrayLike<number>, w: number, h: number): boolean {
  let white = 0, panel = 0, colorful = 0, n = 0;
  for (let i = 0; i + 2 < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    n++;
    if (r > 244 && g > 244 && b > 244) white++;
    else if (b >= 228 && g >= 222 && r >= 195 && r <= 238 && b - r >= 10) panel++;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 40) colorful++;
  }
  if (!n) return false;
  const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h));
  if (panel / n >= 0.05) return true;
  if (colorful / n >= 0.05) return false;
  if (white / n >= 0.99) return true;
  // Tall near-empty columns are screenshots of the text column; wide data tables are kept.
  if (white / n >= 0.9 && h > w * 2) return true;
  return aspect > 8;
}

/**
 * A crop is blank when almost every cell of its 32×32 grayscale fingerprint (hex, 16 levels)
 * sits at the dominant shade — e.g. a slide region whose only content was a caption we masked out.
 */
export function isBlankFingerprint(fine: string): boolean {
  if (!fine) return false;
  const counts = new Array(16).fill(0);
  const levels = [...fine].map((ch) => parseInt(ch, 16));
  for (const l of levels) counts[l]++;
  const dominant = counts.indexOf(Math.max(...counts));
  const differing = levels.filter((l) => Math.abs(l - dominant) >= 2).length;
  return differing / levels.length < 0.006;
}
