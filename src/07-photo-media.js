// ===== Вспомогательные функции для работы с фото =====

// Создание миниатюры (Canvas, ~256px по длинной стороне)
async function createThumbnail(img, maxDim = 256) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  const scale = Math.min(maxDim / w, maxDim / h, 1);
  const tw = Math.round(w * scale);
  const th = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, tw, th);
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), 'image/webp', 0.82);
  });
}

// Доступен ли canvas для кодирования миниатюр (в песочнице тестов — нет).
function canDraw() {
  try {
    const cv = document.createElement('canvas');
    return !!(cv && cv.getContext && cv.getContext('2d'));
  } catch (e) {
    return false;
  }
}

// WebP-миниатюра из data-URL (Image + canvas). null, если браузер не умеет
// рисовать (canvas/Image недоступны) или картинка не загрузилась за 3 c.
async function makeThumbBlob(dataUrl, maxDim = 256) {
  if (!canDraw() || typeof Image === 'undefined') return null;
  return new Promise(resolve => {
    const img = new Image();
    let settled = false;
    const finish = b => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(b || null);
      }
    };
    const timer = setTimeout(() => finish(null), 3000);
    img.onload = () => {
      createThumbnail(img, maxDim)
        .then(finish)
        .catch(() => finish(null));
    };
    img.onerror = () => finish(null);
    img.src = dataUrl;
  });
}

// Простой EXIF-парсер (DateTimeOriginal / CreateDate)
async function extractExifDate(file) {
  const buf = await file.slice(0, 65536).arrayBuffer();
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0xff || u8[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < u8.length - 8) {
    if (u8[offset] !== 0xff) break;
    const marker = u8[offset + 1];
    if (marker === 0xe1) {
      const exifHeader = String.fromCharCode(...u8.slice(offset + 4, offset + 10));
      if (exifHeader === 'Exif\x00\x00') {
        const tiffStart = offset + 10;
        const isLE = u8[tiffStart] === 0x49;
        const read16 = off => (isLE ? u8[off] | (u8[off + 1] << 8) : (u8[off] << 8) | u8[off + 1]);
        const read32 = off => (isLE ? u8[off] | (u8[off + 1] << 8) | (u8[off + 2] << 16) | (u8[off + 3] << 24) : (u8[off] << 24) | (u8[off + 1] << 16) | (u8[off + 2] << 8) | u8[off + 3]);
        const ifd0Off = tiffStart + 4 + read32(tiffStart + 4);
        const numEntries = read16(ifd0Off);
        for (let i = 0; i < numEntries; i++) {
          const entryOff = ifd0Off + 2 + i * 12;
          const tag = read16(entryOff);
          if (tag === 0x9003 || tag === 0x9004) {
            const valOff = read32(entryOff + 8) + tiffStart + 4;
            const dateStr = String.fromCharCode(...u8.slice(valOff, valOff + 19));
            const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(dateStr);
            if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
          }
        }
      }
      break;
    }
    if (marker >= 0xe0 && marker <= 0xef) {
      const segLen = (u8[offset + 2] << 8) | u8[offset + 3];
      offset += 2 + segLen;
    } else break;
  }
  return null;
}

// Blob → data URL
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
