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
