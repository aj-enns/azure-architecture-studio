export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg'] as const;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const DEFAULT_MAX_DIM = 1600;

export function isAcceptedImage(file: File): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read the image file.'));
    reader.readAsDataURL(file);
  });
}

// Large screenshots waste tokens and can exceed the request limit; shrink first.
function downscaleDataUrl(dataUrl: string, maxDim: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      if (scale >= 1) {
        resolve(dataUrl);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** Validates and reads an image file into a (possibly downscaled) data URL. */
export async function readImageAsDataUrl(file: File, maxDim = DEFAULT_MAX_DIM): Promise<string> {
  if (!isAcceptedImage(file)) throw new Error('Please choose a PNG or JPEG image.');
  if (file.size > MAX_FILE_BYTES) throw new Error('Image is too large (max 12 MB).');
  const dataUrl = await fileToDataUrl(file);
  return downscaleDataUrl(dataUrl, maxDim);
}
