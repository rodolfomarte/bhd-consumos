/* ════════════════════════════════════════════════════════════════════════
   compressImage — reduce una foto a ~1MB antes de subirla, vía <canvas>.
   No requiere librerías externas.
   ════════════════════════════════════════════════════════════════════════ */
async function compressImage(file, { maxBytes = 1_000_000, maxDimension = 1920 } = {}) {
  if (!file.type.startsWith("image/")) return file;

  const bitmap = await loadBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxDimension);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (bitmap.close) bitmap.close();

  let blob = await canvasToBlob(canvas, 0.85);
  const qualities = [0.75, 0.65, 0.55, 0.45, 0.35];
  for (const q of qualities) {
    if (blob.size <= maxBytes) break;
    blob = await canvasToBlob(canvas, q);
  }

  // Si ni con la calidad mínima entra, reduce dimensiones y reintenta una vez.
  if (blob.size > maxBytes && maxDimension > 800) {
    return compressImage(file, { maxBytes, maxDimension: Math.round(maxDimension * 0.7) });
  }

  return new File([blob], renameToJpg(file.name), { type: "image/jpeg" });
}

function loadBitmap(file) {
  if (window.createImageBitmap) {
    return createImageBitmap(file);
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function fitWithin(w, h, maxDimension) {
  const longest = Math.max(w, h);
  if (longest <= maxDimension) return { width: w, height: h };
  const scale = maxDimension / longest;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

function canvasToBlob(canvas, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
}

function renameToJpg(name) {
  return (name || "foto").replace(/\.[^.]+$/, "") + ".jpg";
}
