
import React, { useState } from 'react';
import { store } from '../store';
import { UserRole } from '../types';

const ProfileSettings: React.FC = () => {
  const user = store.currentUser;
  const [oldPass, setOldPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [status, setStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null);

  if (!user) return null;

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPass !== confirmPass) {
      setStatus({ type: 'error', msg: 'New passwords do not match.' });
      return;
    }
    if (newPass.length < 4) {
      setStatus({ type: 'error', msg: 'Password must be at least 4 characters.' });
      return;
    }

    const success = await store.updateSelfPassword(oldPass, newPass);
    if (success) {
      setStatus({ type: 'success', msg: 'Security key updated successfully.' });
      setOldPass('');
      setNewPass('');
      setConfirmPass('');
    } else {
      setStatus({ type: 'error', msg: 'Current password verification failed.' });
    }
    setTimeout(() => setStatus(null), 5000);
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-500 pb-20 max-w-4xl mx-auto">
      <header>
        <h1 className="text-4xl font-black text-slate-900 tracking-tighter uppercase leading-none italic">Account Node</h1>
        <p className="text-slate-500 font-bold uppercase text-[10px] tracking-widest mt-2">Personal Identity • Security Keys • Permission Scope</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* User Card */}
        <div className="md:col-span-1 bg-slate-900 p-10 rounded-[50px] text-white flex flex-col items-center text-center shadow-2xl relative overflow-hidden">
           <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 blur-[50px]"></div>
           <div className="w-24 h-24 bg-white/10 border-4 border-white/5 rounded-[35px] flex items-center justify-center text-4xl font-black text-amber-500 mb-6 shadow-2xl">
              {user.name[0]}
           </div>
           <h2 className="text-2xl font-black tracking-tighter uppercase leading-none">{user.name}</h2>
           <p className="text-slate-500 font-bold text-xs mt-2 truncate w-full">{user.email}</p>
           <div className="mt-6 inline-block bg-white/10 px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-400">
             {user.role} Authority
           </div>
        </div>

        {/* Authority Scope */}
        <div className="md:col-span-2 bg-white p-10 rounded-[50px] shadow-sm border border-slate-100">
           <div className="flex justify-between items-center mb-8">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Permission Mapping</h3>
              <i className="fas fa-shield-alt text-slate-200"></i>
           </div>
           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Object.entries(user.permissions).map(([key, enabled]) => (
                <div key={key} className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-50">
                   <div className={`w-3 h-3 rounded-full ${enabled ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]' : 'bg-slate-200'}`}></div>
                   <span className="text-[10px] font-black text-slate-700 uppercase tracking-tighter">
                      {key.replace('can', '').replace(/([A-Z])/g, ' $1').trim()}
                   </span>
                </div>
              ))}
           </div>
        </div>

        {/* Password Reset Section */}
        <div className="md:col-span-3 bg-white p-10 rounded-[50px] shadow-2xl border-2 border-amber-100/50">
           <div className="flex flex-col md:flex-row gap-12">
              <div className="flex-1 space-y-6">
                 <div>
                    <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight italic">Security Vault</h3>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Rotate your unique system access key</p>
                 </div>
                 <div className="bg-amber-50 p-6 rounded-3xl border border-amber-100 text-amber-800 text-[10px] font-bold leading-relaxed uppercase italic">
                   <i className="fas fa-info-circle mr-2"></i> Security Protocol: Passwords must be at least 4 characters. Avoid using obvious dates or common identifiers.
                 </div>
              </div>

              <form onSubmit={handlePasswordChange} className="flex-[2] space-y-6">
                 {status && (
                   <div className={`p-4 rounded-2xl font-black text-[10px] uppercase text-center animate-in slide-in-from-top-2 border ${status.type === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-rose-50 text-rose-700 border-rose-100'}`}>
                     {status.msg}
                   </div>
                 )}
                 <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Current Key</label>
                       <input 
                         type="password" 
                         required
                         className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-black outline-none focus:border-amber-500 transition-all"
                         value={oldPass}
                         onChange={e => setOldPass(e.target.value)}
                       />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">New Key</label>
                       <input 
                         type="password" 
                         required
                         className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-black outline-none focus:border-amber-500 transition-all"
                         value={newPass}
                         onChange={e => setNewPass(e.target.value)}
                       />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Confirm New Key</label>
                       <input 
                         type="password" 
                         required
                         className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-black outline-none focus:border-amber-500 transition-all"
                         value={confirmPass}
                         onChange={e => setConfirmPass(e.target.value)}
                       />
                    </div>
                 </div>
                 <button 
                   type="submit"
                   className="w-full py-5 bg-slate-900 text-white rounded-[30px] font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-all shadow-2xl active:scale-95 flex items-center justify-center gap-3"
                 >
                   Deploy Security Update <i className="fas fa-lock"></i>
                 </button>
              </form>
           </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileSettings;
