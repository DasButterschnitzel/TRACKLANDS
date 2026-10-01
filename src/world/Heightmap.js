// Height map import for a new game: any image (grey = height; black is sea,
// white the highest peaks) is scaled to the map size and turned into one
// byte per tile. Colour images use their luminance.
export async function readHeightmap(file, n) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0, n, n);
  if (bmp.close) bmp.close();
  const d = x.getImageData(0, 0, n, n).data;
  const out = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) out[i] = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
  return out;
}
