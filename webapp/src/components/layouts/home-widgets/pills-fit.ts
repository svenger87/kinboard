// The today strip's arithmetic, without React, so a spec can run it.

/**
 * How many whole pills fit `rows` rows of `width`, each row wrapping as
 * flex-wrap does, with the "+n" chip after the last when not all fit.
 */
export function pillsThatFit(widths: number[], moreW: number, width: number, rows: number, gap: number): number {
  const fits = (n: number, reserve: number) => {
    let row = 1;
    let x = 0;
    const place = (w: number) => {
      const ww = Math.min(w, width);
      if (x > 0 && x + gap + ww > width) {
        row++;
        x = ww;
      } else {
        x += (x > 0 ? gap : 0) + ww;
      }
      return row <= rows;
    };
    for (let i = 0; i < n; i++) if (!place(widths[i])) return false;
    return reserve > 0 ? place(reserve) : true;
  };
  if (fits(widths.length, 0)) return widths.length;
  let n = widths.length - 1;
  while (n > 0 && !fits(n, moreW)) n--;
  return n;
}
