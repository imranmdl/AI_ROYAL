import React, { useState, useEffect, useRef } from 'react';
import { store } from '../store';

interface LoginProps {
  onLoginSuccess: () => void;
  onPublicGallery: () => void;
}

const Login: React.FC<LoginProps> = ({ onLoginSuccess, onPublicGallery }) => {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [status, setStatus]     = useState('');   // progress messages
  const [isLoading, setIsLoading] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [backendUrl, setBackendUrl] = useState(store.settings.backendUrl || '');
  const [connStatus, setConnStatus] = useState({
    online: store.isOnline, db: store.dbConnected, error: store.connectionError,
  });

  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
    const unsub = store.subscribe(() =>
      setConnStatus({ online: store.isOnline, db: store.dbConnected, error: store.connectionError })
    );
    return unsub;
  }, []);

  const branding = store.settings.systemBranding || 'ROYAL ERP';

  const handleUpdateUrl = () => {
    store.updateSettings({ backendUrl });
    setShowConfig(false);
    setError('');
    setStatus('URL updated — reconnecting…');
    setTimeout(() => setStatus(''), 3000);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setIsLoading(true);
    setError('');
    setStatus('Verifying credentials…');

    try {
      // loginAsync: fetches fresh users from server → authenticates → starts background sync
      const user = await store.loginAsync(email.trim(), password);
      if (user) {
        setStatus('Access granted — loading…');
        onLoginSuccess();
      }
    } catch (err: any) {
      const code = err.message || '';

      if (code === 'WRONG_PASSWORD') {
        setError('Incorrect password. Please try again.');
      } else if (code === 'EMAIL_NOT_FOUND') {
        setError('Email not found. Check spelling or contact your administrator.');
      } else if (code === 'ACCOUNT_SUSPENDED') {
        setError('This account has been suspended. Contact your administrator.');
      } else {
        // Generic / network failure
        setError(`Login failed: ${code || 'Unknown error'}. Check your connection and try again.`);
      }
      setStatus('');
    } finally {
      setIsLoading(false);
    }
  };

  const connLabel = connStatus.online
    ? connStatus.db ? 'MySQL Connected' : 'Server Reached (no DB)'
    : 'Server Unreachable';

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background blobs */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-amber-600/20 blur-[150px] -mr-64 -mt-64 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-600/20 blur-[120px] -ml-48 -mb-48 pointer-events-none" />

      <div className="w-full max-w-md z-10 space-y-4">

        {/* Connection badge */}
        <div className={`px-5 py-2.5 rounded-2xl border backdrop-blur-md flex items-center justify-between transition-all ${connStatus.online && connStatus.db ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : connStatus.online ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}>
          <div className="flex items-center gap-2.5">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${connStatus.online ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`} />
            <span className="text-[9px] font-black uppercase tracking-widest">{connLabel}</span>
            {connStatus.error && !connStatus.online && (
              <span className="text-[8px] font-bold opacity-60 truncate max-w-[140px]">{connStatus.error}</span>
            )}
          </div>
          <button onClick={() => { setShowConfig(v => !v); setError(''); }}
            className="text-[9px] font-black uppercase tracking-widest underline opacity-60 hover:opacity-100 flex-shrink-0">
            {showConfig ? 'Close' : 'Config'}
          </button>
        </div>

        {/* Main card */}
        <div className="bg-white/5 backdrop-blur-3xl rounded-[40px] border border-white/10 shadow-2xl overflow-hidden">

          {/* Brand header */}
          <div className="px-10 pt-10 pb-6 text-center space-y-3">
            <div className="bg-amber-600 w-16 h-16 rounded-3xl flex items-center justify-center text-white text-3xl font-black mx-auto shadow-2xl shadow-amber-900/50">
              {branding[0]}
            </div>
            <div>
              <h1 className="text-3xl font-black text-white tracking-tighter uppercase">{branding}</h1>
              <p className="text-slate-500 font-bold uppercase tracking-[0.2em] text-[9px] mt-1">Tiles & Granite Management System</p>
            </div>
          </div>

          <div className="px-8 pb-10 space-y-5">
            {/* URL Config panel */}
            {showConfig && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-5 space-y-3 animate-in slide-in-from-top-2">
                <div className="text-[9px] font-black text-amber-400 uppercase tracking-widest">Backend URL</div>
                <input type="text"
                  className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white font-bold text-sm outline-none focus:border-amber-500 transition-all"
                  placeholder="https://your-backend.com (leave blank for local)"
                  value={backendUrl} onChange={e => setBackendUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleUpdateUrl()} />
                <p className="text-[8px] text-slate-500 leading-relaxed">Set to your deployed server URL. Leave blank if running locally.</p>
                <div className="flex gap-3">
                  <button onClick={() => setShowConfig(false)} className="flex-1 py-2.5 bg-white/5 text-slate-400 rounded-xl font-black text-[9px] uppercase hover:bg-white/10 transition-all">Cancel</button>
                  <button onClick={handleUpdateUrl} className="flex-[2] py-2.5 bg-amber-600 text-white rounded-xl font-black text-[9px] uppercase hover:bg-amber-700 transition-all">Save & Reconnect</button>
                </div>
              </div>
            )}

            {/* Login form */}
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-3">
                <div>
                  <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-2 px-1">Email</label>
                  <input ref={emailRef} type="email" required autoComplete="username"
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-white font-bold outline-none focus:ring-2 focus:ring-amber-600 focus:border-transparent transition-all placeholder:text-white/20"
                    placeholder="admin@royal.com"
                    value={email} onChange={e => { setEmail(e.target.value); setError(''); }} />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-2 px-1">Password</label>
                  <div className="relative">
                    <input type={showPass ? 'text' : 'password'} required autoComplete="current-password"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-white font-bold outline-none focus:ring-2 focus:ring-amber-600 focus:border-transparent transition-all placeholder:text-white/20 pr-12"
                      placeholder="••••••••"
                      value={password} onChange={e => { setPassword(e.target.value); setError(''); }} />
                    <button type="button" onClick={() => setShowPass(v => !v)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                      <i className={`fas fa-eye${showPass ? '-slash' : ''} text-sm`}></i>
                    </button>
                  </div>
                </div>
              </div>

              {/* Status message (progress) */}
              {status && !error && (
                <div className="flex items-center gap-3 px-4 py-3 bg-blue-500/10 border border-blue-500/20 rounded-2xl">
                  <div className="w-4 h-4 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin flex-shrink-0" />
                  <span className="text-[10px] font-black text-blue-300 uppercase tracking-wider">{status}</span>
                </div>
              )}

              {/* Error message */}
              {error && (
                <div className="flex items-start gap-3 px-4 py-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl">
                  <i className="fas fa-exclamation-circle text-rose-400 text-sm mt-0.5 flex-shrink-0"></i>
                  <span className="text-[10px] font-black text-rose-300 uppercase tracking-wider leading-relaxed">{error}</span>
                </div>
              )}

              {/* Submit */}
              <button type="submit" disabled={isLoading || !email || !password}
                className="w-full py-4 bg-amber-600 text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-amber-700 shadow-xl shadow-amber-900/30 transition-all active:scale-95 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed">
                {isLoading ? (
                  <>
                    <div className="w-5 h-5 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Signing in…</span>
                  </>
                ) : (
                  <>
                    <i className="fas fa-sign-in-alt"></i>
                    <span>Sign In</span>
                  </>
                )}
              </button>
            </form>

            {/* Gallery link */}
            <div className="text-center pt-2 border-t border-white/5 space-y-3">
              <button onClick={onPublicGallery}
                className="text-[10px] font-black text-amber-500 uppercase tracking-widest hover:text-amber-400 transition-colors flex items-center gap-2 mx-auto">
                <i className="fas fa-images text-xs"></i> View Public Gallery
              </button>
              <p className="text-slate-700 text-[8px] font-black uppercase tracking-widest">
                v3.2.0 · Direct Auth
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
