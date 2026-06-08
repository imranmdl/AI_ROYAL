/**
 * TwoFactorSetup.tsx
 * Setup and management of TOTP 2FA using Google Authenticator.
 *
 * Flow:
 *  Enable:  Generate secret → Show QR → User scans → Enter OTP → Verify → Save
 *  Disable: Enter current OTP → Verify → Remove secret
 */

import React, { useState, useEffect } from 'react';
import { store } from '../store';

const BASE = window.location.origin;

interface Props {
  onClose: () => void;
}

const TwoFactorSetup: React.FC<Props> = ({ onClose }) => {
  const user = store.currentUser as any;
  const is2FAEnabled = !!user?.twoFactorEnabled;

  // Setup flow state
  const [step,      setStep]      = useState<'idle'|'setup'|'verify'|'disable'|'done'>('idle');
  const [secret,    setSecret]    = useState('');
  const [otpUrl,    setOtpUrl]    = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [otp,       setOtp]       = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [msg,       setMsg]       = useState('');

  // Generate QR code using Google Charts API (no library needed)
  const makeQR = (url: string) =>
    `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`;

  const startSetup = async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`${BASE}/api/auth/2fa/setup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.email }),
      });
      const d = await r.json();
      setSecret(d.secret);
      setOtpUrl(d.otpauthUrl);
      setQrDataUrl(makeQR(d.otpauthUrl));
      setStep('setup');
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const verifyAndEnable = async () => {
    if (otp.length !== 6) { setError('Enter the 6-digit code from your authenticator app'); return; }
    setLoading(true); setError('');
    try {
      const r = await fetch(`${BASE}/api/auth/2fa/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, secret, token: otp }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error); return; }
      if (store.currentUser) {
        (store.currentUser as any).twoFactorEnabled = true;
        (store.currentUser as any).totpSecret = secret;
        store.save();
      }
      setMsg('✓ Two-factor authentication is now active on your account');
      setStep('done');
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const disableConfirm = async () => {
    if (otp.length !== 6) { setError('Enter the 6-digit code to confirm'); return; }
    setLoading(true); setError('');
    try {
      const r = await fetch(`${BASE}/api/auth/2fa/disable`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, token: otp }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error); return; }
      if (store.currentUser) {
        (store.currentUser as any).twoFactorEnabled = false;
        (store.currentUser as any).totpSecret = '';
        store.save();
      }
      setMsg('Two-factor authentication has been disabled');
      setStep('done');
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const inp = "w-full px-4 py-3 bg-white border-2 border-slate-200 rounded-xl font-mono text-2xl text-center tracking-[0.4em] outline-none focus:border-amber-400 transition-all";

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[28px] w-full max-w-md shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white px-6 py-5 flex items-center justify-between">
          <div>
            <div className="font-black text-lg flex items-center gap-2">
              <i className="fas fa-shield-alt text-amber-400"></i>
              Two-Factor Authentication
            </div>
            <div className="text-slate-400 font-bold text-[10px] mt-0.5">Google Authenticator · TOTP</div>
          </div>
          <button onClick={onClose} className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center hover:bg-white/20">✕</button>
        </div>

        <div className="p-6 space-y-5">

          {/* Current status */}
          {step === 'idle' && (
            <>
              <div className={`flex items-center gap-4 p-4 rounded-2xl border-2 ${is2FAEnabled ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${is2FAEnabled ? 'bg-emerald-100' : 'bg-slate-200'}`}>
                  {is2FAEnabled ? '🔐' : '🔓'}
                </div>
                <div>
                  <div className={`font-black text-sm ${is2FAEnabled ? 'text-emerald-700' : 'text-slate-600'}`}>
                    {is2FAEnabled ? '2FA is ACTIVE' : '2FA is not set up'}
                  </div>
                  <div className="text-[10px] font-bold text-slate-500 mt-0.5">
                    {is2FAEnabled ? 'Your account is protected with OTP verification' : 'Add an extra layer of security to your login'}
                  </div>
                </div>
              </div>

              {is2FAEnabled ? (
                <button onClick={() => { setStep('disable'); setOtp(''); setError(''); }}
                  className="w-full py-3.5 bg-rose-50 text-rose-700 border-2 border-rose-200 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-rose-100 transition-all">
                  <i className="fas fa-times-circle mr-2"></i>Disable 2FA
                </button>
              ) : (
                <button onClick={startSetup} disabled={loading}
                  className="w-full py-3.5 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-amber-600 transition-all disabled:opacity-40">
                  {loading ? <><i className="fas fa-spinner fa-spin mr-2"></i>Generating…</> : <><i className="fas fa-shield-alt mr-2"></i>Enable 2FA with Google Authenticator</>}
                </button>
              )}
            </>
          )}

          {/* Step 1: QR Code */}
          {step === 'setup' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-1.5">
                <div className="font-black text-blue-800 text-sm">Step 1 — Scan with Google Authenticator</div>
                <div className="text-[10px] font-bold text-blue-600 space-y-1">
                  <div>1. Open <b>Google Authenticator</b> on your phone</div>
                  <div>2. Tap <b>+</b> → <b>Scan a QR code</b></div>
                  <div>3. Point your camera at the QR code below</div>
                  <div>4. A 6-digit code will appear — enter it below</div>
                </div>
              </div>

              {/* QR Code */}
              <div className="flex flex-col items-center gap-3">
                <div className="bg-white border-4 border-slate-900 rounded-2xl p-3 shadow-lg">
                  <img src={qrDataUrl} alt="QR Code" className="w-52 h-52 rounded-xl"/>
                </div>
                <div className="text-center">
                  <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Or enter manually in authenticator app</div>
                  <div className="font-mono text-sm font-black text-slate-700 bg-slate-100 px-3 py-1.5 rounded-xl mt-1 tracking-widest break-all">{secret}</div>
                </div>
              </div>

              {/* OTP input */}
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Step 2 — Enter the 6-digit code from your app</label>
                <input type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoFocus
                  className={inp} placeholder="000000"
                  value={otp} onChange={e => { setOtp(e.target.value.replace(/\D/g,'')); setError(''); }}
                  onKeyDown={e => e.key === 'Enter' && verifyAndEnable()} />
              </div>

              {error && <div className="text-rose-600 font-bold text-sm bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5">{error}</div>}

              <div className="flex gap-3">
                <button onClick={verifyAndEnable} disabled={loading || otp.length !== 6}
                  className="flex-1 py-3.5 bg-emerald-700 text-white rounded-xl font-black text-[10px] uppercase hover:bg-emerald-800 transition-all disabled:opacity-40">
                  {loading ? 'Verifying…' : '✓ Verify & Activate 2FA'}
                </button>
                <button onClick={() => { setStep('idle'); setOtp(''); setError(''); }}
                  className="px-5 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-black text-[10px] uppercase hover:bg-slate-200">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Disable flow */}
          {step === 'disable' && (
            <div className="space-y-4">
              <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4">
                <div className="font-black text-rose-800 text-sm">Confirm disable 2FA</div>
                <div className="text-[10px] font-bold text-rose-600 mt-1">Enter the current 6-digit code from Google Authenticator to confirm</div>
              </div>
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Current OTP code</label>
                <input type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoFocus
                  className={inp} placeholder="000000"
                  value={otp} onChange={e => { setOtp(e.target.value.replace(/\D/g,'')); setError(''); }}
                  onKeyDown={e => e.key === 'Enter' && disableConfirm()} />
              </div>
              {error && <div className="text-rose-600 font-bold text-sm bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5">{error}</div>}
              <div className="flex gap-3">
                <button onClick={disableConfirm} disabled={loading || otp.length !== 6}
                  className="flex-1 py-3.5 bg-rose-600 text-white rounded-xl font-black text-[10px] uppercase hover:bg-rose-700 transition-all disabled:opacity-40">
                  {loading ? 'Verifying…' : 'Disable 2FA'}
                </button>
                <button onClick={() => { setStep('idle'); setOtp(''); setError(''); }}
                  className="px-5 py-3.5 bg-slate-100 text-slate-500 rounded-xl font-black text-[10px] uppercase hover:bg-slate-200">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Done */}
          {step === 'done' && (
            <div className="text-center py-6 space-y-4">
              <div className="text-5xl">{msg.startsWith('✓') ? '🔐' : '🔓'}</div>
              <div className="font-black text-slate-800 text-base">{msg}</div>
              <button onClick={onClose} className="px-8 py-3 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase hover:bg-amber-600 transition-all">Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TwoFactorSetup;
