// Calculate a CSS color from a light's color temperature in Kelvin.
// Warm (2700K) #FF9F43 → neutral (4000K) #FFEAA7 → cool (6500K) #74B9FF.
export function getColorTempColor(kelvin: number, minK: number, maxK: number): string {
  const normalized = Math.max(0, Math.min(1, (kelvin - minK) / (maxK - minK)));

  if (normalized < 0.5) {
    const t = normalized * 2;
    const r = Math.round(255);
    const g = Math.round(159 + (234 - 159) * t);
    const b = Math.round(67 + (167 - 67) * t);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const t = (normalized - 0.5) * 2;
    const r = Math.round(255 - (255 - 116) * t);
    const g = Math.round(234 - (234 - 185) * t);
    const b = Math.round(167 + (255 - 167) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }
}
