/**
 * useCamera.ts
 * Unified photo capture/picker for Capacitor mobile + browser.
 *
 * Mobile (Android/iOS):
 *   Uses Capacitor Camera plugin → opens native camera or photo library
 *
 * Browser:
 *   Uses <input type="file" accept="image/*" capture="environment"> 
 *   → opens camera on mobile browsers, file picker on desktop
 */

import { useState } from 'react';

const isCapacitor = () =>
  !!(window as any).Capacitor ||
  navigator.userAgent.includes('RoyalERP-Android') ||
  navigator.userAgent.includes('RoyalERP-iOS');

export interface PhotoResult {
  dataUrl: string;   // base64 data URL  image/jpeg
  mimeType: string;
}

export function useCamera() {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  /**
   * takePhoto — opens native camera or file picker
   * Returns a base64 data URL or null if cancelled
   */
  const takePhoto = async (source: 'camera' | 'gallery' = 'camera'): Promise<PhotoResult | null> => {
    setLoading(true); setError('');
    try {
      // ── Capacitor path ────────────────────────────────────────────────────
      if (isCapacitor() && (window as any).Capacitor?.Plugins?.Camera) {
        const { Camera } = (window as any).Capacitor.Plugins;
        const photo = await Camera.getPhoto({
          quality:          85,
          allowEditing:     false,
          resultType:       'base64',      // returns base64 string
          source:           source === 'camera' ? 'CAMERA' : 'PHOTOS',
          correctOrientation: true,
          saveToGallery:    false,
        });
        const dataUrl = `data:image/jpeg;base64,${photo.base64String}`;
        return { dataUrl, mimeType: 'image/jpeg' };
      }

      // ── Browser / PWA path ────────────────────────────────────────────────
      return await new Promise((resolve) => {
        const input = document.createElement('input');
        input.type    = 'file';
        input.accept  = 'image/*';
        if (source === 'camera') input.capture = 'environment';  // rear camera
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) { resolve(null); return; }
          // Compress + convert to data URL
          const reader = new FileReader();
          reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
              const canvas = document.createElement('canvas');
              const MAX = 1024;
              const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
              canvas.width  = img.width  * ratio;
              canvas.height = img.height * ratio;
              canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
              const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
              resolve({ dataUrl, mimeType: 'image/jpeg' });
            };
            img.src = e.target!.result as string;
          };
          reader.readAsDataURL(file);
        };
        input.oncancel = () => resolve(null);
        document.body.appendChild(input);
        input.click();
        setTimeout(() => document.body.removeChild(input), 60000);
      });

    } catch (e: any) {
      if (e.message?.includes('cancelled') || e.message?.includes('canceled')) return null;
      setError(e.message || 'Camera error');
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { takePhoto, loading, error };
}
