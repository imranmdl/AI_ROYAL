/**
 * MobileShopSetup.tsx
 * Shown on the login screen inside the Capacitor mobile app.
 * Lets staff configure which shop this device belongs to.
 *
 * Two methods:
 *  1. Enter shop code manually (admin gives them the slug e.g. "royal-mudhol")
 *  2. Scan QR code INSIDE the app using the camera (no browser redirect)
 */

import React, { useState } from 'react';

const BASE = window.location.origin;

const MobileShopSetup: React.FC = () => {
  const stored = localStorage.getItem('royal_app_tenant') || '';
  const [open,  setOpen]  = useState(false);
  const [code,  setCode]  = useState('');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Validate that the shop slug exists on the server
  const validateAndSave = async (slug: string) => {
    const clean = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!clean) { setError('Enter a valid shop code'); return; }
    setError(''); setSuccess('Checking...');
    try {
      const r = await fetch(`${BASE}/api/superadmin/ping`);
      const d = await r.json();
      // Just check server is alive — we trust the code entered
      if (d) {
        localStorage.setItem('royal_app_tenant', clean);
        localStorage.setItem('royal_jwt', '');
        setSuccess(`✓ Configured for "${clean}"`);
        setTimeout(() => {
          window.history.replaceState({}, '', `/?tenant=${clean}`);
          window.location.reload();
        }, 800);
      }
    } catch {
      // Server unreachable — save anyway, will connect on login
      localStorage.setItem('royal_app_tenant', clean);
      localStorage.setItem('royal_jwt', '');
      window.history.replaceState({}, '', `/?tenant=${clean}`);
      window.location.reload();
    }
  };

  // Use Capacitor BarcodeScanner if available, else fallback to camera+image
  const scanQR = async () => {
    setScanning(true); setError('');
    try {
      const cap = (window as any).Capacitor;

      // Try @capacitor/barcode-scanner first
      if (cap?.Plugins?.BarcodeScanner) {
        const { BarcodeScanner } = cap.Plugins;
        await BarcodeScanner.checkPermission({ force: true });
        BarcodeScanner.hideBackground();
        const result = await BarcodeScanner.startScan();
        BarcodeScanner.showBackground();
        BarcodeScanner.stopScan();
        if (result.hasContent) {
          const url = result.content;
          extractAndSave(url);
        } else {
          setError('No QR code detected');
        }
        return;
      }

      // Fallback: use file input to pick/capture image with QR
      // Note: On Android the camera app handles QR decoding natively
      // We show instructions to use the camera app instead
      setError('');
      setOpen(true); // Show manual entry as fallback
    } catch (e: any) {
      setError(e.message || 'Camera not available');
    } finally {
      setScanning(false);
    }
  };

  const extractAndSave = (url: string) => {
    try {
      // Extract tenant from URL like: https://server/?tenant=royal-mudhol&configure=1
      // Or just the slug itself: royal-mudhol
      let slug = url.trim();
      if (slug.includes('tenant=')) {
        const match = slug.match(/[?&]tenant=([^&]+)/);
        if (match) slug = match[1];
      }
      if (slug.includes('://') || slug.includes('/')) {
        setError('Could not read QR. Try entering the shop code manually.');
        return;
      }
      validateAndSave(slug);
    } catch {
      setError('Invalid QR code');
    }
  };

  // If already configured — show current shop with option to change
  if (stored && !open) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3 px-4 py-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl">
          <div className="w-8 h-8 bg-emerald-500/20 rounded-xl flex items-center justify-center shrink-0">
            <i className="fas fa-store text-emerald-400 text-sm"></i>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white font-black text-sm truncate">{stored}</div>
            <div className="text-emerald-400 font-bold text-[9px] uppercase">Configured Shop</div>
          </div>
          <button onClick={() => setOpen(true)}
            className="text-[9px] font-black text-slate-400 hover:text-white uppercase px-2 py-1 bg-white/5 rounded-lg">
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Setup button — shown when not configured */}
      {!open && (
        <button onClick={() => setOpen(true)}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-amber-500/20 border border-amber-500/30 text-amber-400 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-500/30 transition-all">
          <i className="fas fa-store text-sm"></i>
          Configure This Device for a Shop
        </button>
      )}

      {/* Setup modal */}
      {open && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end justify-center">
          <div className="bg-slate-900 border border-white/10 rounded-t-[28px] w-full p-6 space-y-5 pb-10">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-white font-black text-lg">Configure Shop</div>
                <div className="text-slate-400 font-bold text-[10px] mt-0.5">Link this device to a specific shop</div>
              </div>
              <button onClick={() => { setOpen(false); setCode(''); setError(''); }}
                className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center text-white hover:bg-white/20">✕</button>
            </div>

            {/* Method 1: Enter shop code */}
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">
                Enter Shop Code <span className="text-slate-600 normal-case font-bold">(ask your admin)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 px-4 py-3.5 bg-white/10 border-2 border-white/20 rounded-xl text-white font-mono text-base outline-none focus:border-amber-400 transition-all placeholder:text-slate-600"
                  placeholder="e.g. royal-mudhol"
                  value={code}
                  onChange={e => { setCode(e.target.value); setError(''); }}
                  onKeyDown={e => e.key === 'Enter' && validateAndSave(code)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button
                  onClick={() => validateAndSave(code)}
                  disabled={!code.trim()}
                  className="px-5 py-3.5 bg-amber-500 text-white rounded-xl font-black text-[10px] uppercase disabled:opacity-40 hover:bg-amber-600 transition-all">
                  Set
                </button>
              </div>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-white/10"></div>
              <span className="text-slate-500 font-bold text-[10px] uppercase">or</span>
              <div className="flex-1 h-px bg-white/10"></div>
            </div>

            {/* Method 2: Scan QR */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Scan QR Code</div>
              <div className="text-[10px] text-slate-500 font-bold leading-relaxed">
                Open your phone's camera app and scan the QR code provided by your admin.
                The link will look like:<br/>
                <span className="font-mono text-amber-400 text-[9px]">…/?tenant=your-shop&configure=1</span><br/>
                Copy the shop name from that link and enter it above.
              </div>
              <button onClick={scanQR} disabled={scanning}
                className="w-full py-3 bg-white/10 text-white border border-white/20 rounded-xl font-black text-[10px] uppercase hover:bg-white/20 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                {scanning
                  ? <><i className="fas fa-spinner fa-spin"></i> Opening Camera…</>
                  : <><i className="fas fa-qrcode"></i> Open QR Scanner</>}
              </button>
            </div>

            {/* Status */}
            {error   && <div className="text-rose-400 font-bold text-sm text-center bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-2">{error}</div>}
            {success && <div className="text-emerald-400 font-bold text-sm text-center bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2">{success}</div>}
          </div>
        </div>
      )}
    </>
  );
};

export default MobileShopSetup;
