export interface ResolutionPreset {
  label: string;
  width: number;
  height: number;
  category: 'Desktop' | 'Ultrawide' | 'Mobile' | 'Foldable' | 'Tablet';
}

export const RESOLUTIONS: readonly ResolutionPreset[] = [
  { label: 'FHD · 1920×1080', width: 1920, height: 1080, category: 'Desktop' },
  { label: 'QHD · 2560×1440', width: 2560, height: 1440, category: 'Desktop' },
  { label: '4K UHD · 3840×2160', width: 3840, height: 2160, category: 'Desktop' },
  { label: '5K · 5120×2880', width: 5120, height: 2880, category: 'Desktop' },
  { label: '8K UHD · 7680×4320', width: 7680, height: 4320, category: 'Desktop' },
  { label: 'MacBook Pro 16" · 3456×2234', width: 3456, height: 2234, category: 'Desktop' },

  { label: 'UW · 3440×1440', width: 3440, height: 1440, category: 'Ultrawide' },
  { label: 'UW · 2560×1080', width: 2560, height: 1080, category: 'Ultrawide' },
  { label: 'Super UW · 5120×1440', width: 5120, height: 1440, category: 'Ultrawide' },

  { label: 'iPhone 15/16 Pro · 1179×2556', width: 1179, height: 2556, category: 'Mobile' },
  { label: 'iPhone Pro Max · 1290×2796', width: 1290, height: 2796, category: 'Mobile' },
  { label: 'Android FHD+ · 1440×3120', width: 1440, height: 3120, category: 'Mobile' },

  { label: 'Galaxy Z Fold 8 Cover · 1248×1972', width: 1248, height: 1972, category: 'Foldable' },
  { label: 'Galaxy Z Fold 8 Main · 2448×1848', width: 2448, height: 1848, category: 'Foldable' },

  { label: 'iPad Pro 12.9" · 2048×2732', width: 2048, height: 2732, category: 'Tablet' },
  { label: 'iPad Air · 1640×2360', width: 1640, height: 2360, category: 'Tablet' },
];

export const FORMATS = [
  { label: 'PNG', mime: 'image/png', ext: 'png', lossy: false },
  { label: 'JPEG', mime: 'image/jpeg', ext: 'jpg', lossy: true },
  { label: 'WebP', mime: 'image/webp', ext: 'webp', lossy: true },
] as const;

export type Format = (typeof FORMATS)[number];

export function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Encoding the image failed.'))),
      mime,
      quality,
    );
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
