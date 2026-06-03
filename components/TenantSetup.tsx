/**
 * TenantSetup.tsx
 * Super Admin panel to onboard new shops.
 * Accessible at /?setup=true with the SUPER_ADMIN_KEY.
 *
 * Each shop gets:
 *  - Unique tenantId
 *  - Isolated data in shared DB (tenant_id column on every table)
 *  - Admin user auto-created
 *  - JWT-based sessions — data never leaks between shops
 */

import React, { useState } from 'react';
import { store } from '../store';

const INR = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

interface TenantRecord {
  id: string; name: string; slug: string; owner_email: string;
  owner_phone: string; plan: string; status: string; created_at: number;
}

const TenantSetup: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [superKey, setSuperKey]         = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [tenants, setTenants]           = useState<TenantRecord[]>([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');
  const [success, setSuccess]           = useState('');
  const [activeTab, setActiveTab]       = useState<'list'|'add'>('list');

  const [form, setForm] = useState({
    shopName: '', ownerEmail: '', password: '', phone: '',
    address: '', gst: '', plan: 'standard',
  });
  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const base = store.getApiUrl('');

  const authenticate = async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`${base}/api/superadmin/tenants`, {
        headers: { 'x-super-admin-key': superKey }
      });
      if (!res.ok) { setError('Invalid Super Admin Key'); return; }
      const data = await res.json();
      setTenants(data.tenants || []);
      setAuthenticated(true);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const loadTenants = async () => {
    const res = await fetch(`${base}/api/superadmin/tenants`, { headers: { 'x-super-admin-key': superKey } });
    const data = await res.json();
    setTenants(data.tenants || []);
  };

  const createTenant = async () => {
    if (!form.shopName || !form.ownerEmail || !form.password) {
      setError('Shop name, email and password are required'); return;
    }
    setLoading(true); setError(''); setSuccess('');
    try {
      const res = await fetch(`${base}/api/superadmin/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-super-admin-key': superKey },
        body: JSON.stringify({ ...form, superAdminKey: superKey }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed'); return; }
      setSuccess(`✓ "${form.shopName}" created! Login URL: ${data.loginUrl} | Admin: ${form.ownerEmail} / ${form.password}`);
      setForm({ shopName:'', ownerEmail:'', password:'', phone:'', address:'', gst:'', plan:'standard' });
      await loadTenants();
      setActiveTab('list');
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const toggleStatus = async (t: TenantRecord) => {
    const newStatus = t.status === 'active' ? 'suspended' : 'active';
    await fetch(`${base}/api/superadmin/tenants/${t.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-super-admin-key': superKey },
      body: JSON.stringify({ status: newStatus }),
    });
    await loadTenants();
  };

  const inp = "w-full px-4 py-3 bg-white border-2 border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-amber-400 transition-all";
  const lbl = "text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-1.5";

  if (!authenticated) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-[28px] p-8 w-full max-w-sm shadow-2xl space-y-5">
          <div>
            <h2 className="text-2xl font-black text-slate-900">Super Admin</h2>
            <p className="text-[10px] text-slate-400 font-bold mt-1">Enter super admin key to manage shops</p>
          </div>
          <div>
            <label className={lbl}>Super Admin Key</label>
            <input type="password" className={inp} placeholder="Enter key…"
              value={superKey} onChange={e => setSuperKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && authenticate()} />
          </div>
          {error && <div className="text-rose-600 font-bold text-sm">{error}</div>}
          <div className="flex gap-3">
            <button onClick={authenticate} disabled={!superKey || loading}
              className="flex-1 py-3 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase hover:bg-amber-600 transition-all disabled:opacity-40">
              {loading ? 'Verifying…' : 'Enter'}
            </button>
            <button onClick={onClose} className="px-5 py-3 bg-slate-100 text-slate-500 rounded-xl font-black text-[10px] uppercase hover:bg-slate-200">Back</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-sm z-50 overflow-y-auto">
      <div className="min-h-screen p-4 flex items-start justify-center">
        <div className="w-full max-w-5xl bg-white rounded-[28px] shadow-2xl overflow-hidden my-6">
          {/* Header */}
          <div className="bg-slate-900 text-white px-6 py-5 flex justify-between items-center">
            <div>
              <h2 className="text-xl font-black">Royal ERP — Shop Management</h2>
              <p className="text-[9px] text-slate-400 font-bold mt-0.5">{tenants.length} shops registered · Secure multi-tenant mode</p>
            </div>
            <button onClick={onClose} className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center hover:bg-white/20">
              <i className="fas fa-times"></i>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-200">
            {[{id:'list',label:'All Shops'},{id:'add',label:'+ Add New Shop'}].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id as any)}
                className={`px-6 py-3 font-black text-[10px] uppercase tracking-widest transition-all border-b-2 ${activeTab === t.id ? 'border-amber-600 text-amber-700' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-6">
            {success && (
              <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-4 font-bold text-emerald-700 text-sm break-all">
                {success}
              </div>
            )}
            {error && <div className="mb-4 bg-rose-50 border border-rose-200 rounded-2xl px-5 py-4 font-bold text-rose-600 text-sm">{error}</div>}

            {/* ── Shop List ── */}
            {activeTab === 'list' && (
              <div className="space-y-3">
                {tenants.length === 0 ? (
                  <div className="text-center py-16 text-slate-300 font-black uppercase">
                    No shops yet. Add your first shop →
                  </div>
                ) : tenants.map(t => (
                  <div key={t.id} className={`border rounded-2xl p-4 flex items-center justify-between gap-4 ${t.status === 'active' ? 'border-slate-100 bg-white' : 'border-rose-100 bg-rose-50/50 opacity-60'}`}>
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-lg ${t.status === 'active' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-400'}`}>
                        {t.name[0]}
                      </div>
                      <div className="min-w-0">
                        <div className="font-black text-slate-900">{t.name}</div>
                        <div className="text-[9px] text-slate-400 font-bold flex gap-3 flex-wrap">
                          <span>🆔 {t.id}</span>
                          <span>📧 {t.owner_email}</span>
                          {t.owner_phone && <span>📞 {t.owner_phone}</span>}
                          <span>📋 {t.plan}</span>
                          <span>📅 {new Date(t.created_at).toLocaleDateString('en-IN')}</span>
                        </div>
                        <div className="mt-1">
                          <code className="text-[8px] bg-slate-100 px-2 py-0.5 rounded font-mono text-slate-600">
                            Login slug: {t.slug} · URL: /?tenant={t.slug}
                          </code>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${t.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}>
                        {t.status}
                      </span>
                      <button onClick={() => toggleStatus(t)}
                        className={`px-4 py-2 rounded-xl font-black text-[9px] uppercase transition-all ${t.status === 'active' ? 'bg-rose-50 text-rose-600 hover:bg-rose-100' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}>
                        {t.status === 'active' ? 'Suspend' : 'Activate'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Add New Shop ── */}
            {activeTab === 'add' && (
              <div className="max-w-xl space-y-5">
                <div className="bg-amber-50 border border-amber-100 rounded-2xl px-5 py-4 text-[10px] font-bold text-amber-700 space-y-1">
                  <div className="font-black text-sm">Adding a new shop creates:</div>
                  <div>✓ Isolated data space (all records tagged with unique shop ID)</div>
                  <div>✓ Admin user account for the shop owner</div>
                  <div>✓ Default product categories and settings</div>
                  <div>✓ Login URL: <code>your-domain.com/?tenant=shop-slug</code></div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className={lbl}>Shop / Showroom Name *</label>
                    <input className={inp} placeholder="e.g. Royal Tiles & Granites, Kadapa"
                      value={form.shopName} onChange={e => setF('shopName', e.target.value)} />
                  </div>
                  <div>
                    <label className={lbl}>Admin Email *</label>
                    <input type="email" className={inp} placeholder="admin@shop.com"
                      value={form.ownerEmail} onChange={e => setF('ownerEmail', e.target.value)} />
                  </div>
                  <div>
                    <label className={lbl}>Admin Password *</label>
                    <input type="text" className={inp} placeholder="Set a strong password"
                      value={form.password} onChange={e => setF('password', e.target.value)} />
                  </div>
                  <div>
                    <label className={lbl}>Phone</label>
                    <input className={inp} placeholder="9876543210"
                      value={form.phone} onChange={e => setF('phone', e.target.value)} />
                  </div>
                  <div>
                    <label className={lbl}>GST Number</label>
                    <input className={inp} placeholder="29XXXXX1234Z1Z5"
                      value={form.gst} onChange={e => setF('gst', e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <label className={lbl}>Shop Address</label>
                    <input className={inp} placeholder="Full address"
                      value={form.address} onChange={e => setF('address', e.target.value)} />
                  </div>
                  <div>
                    <label className={lbl}>Plan</label>
                    <select className={inp} value={form.plan} onChange={e => setF('plan', e.target.value)}>
                      <option value="standard">Standard</option>
                      <option value="premium">Premium</option>
                      <option value="trial">Trial (30 days)</option>
                    </select>
                  </div>
                </div>

                <button onClick={createTenant} disabled={loading || !form.shopName || !form.ownerEmail || !form.password}
                  className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase hover:bg-amber-600 transition-all active:scale-95 disabled:opacity-40">
                  {loading ? 'Creating Shop…' : `Create "${form.shopName || 'New Shop'}"`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TenantSetup;
