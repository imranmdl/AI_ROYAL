
import React, { useState, useMemo } from 'react';
import { store } from '../store';
import { User, UserRole, UserStatus, UserPermissions, ActivityLog } from '../types';

const UserManagement: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showEditUser, setShowEditUser] = useState(false);
  const [activeTab, setActiveTab] = useState<'users' | 'audit'>('users');

  const [formUser, setFormUser] = useState<Partial<User>>({
    name: '',
    email: '',
    password: '',
    role: UserRole.SALES_EXECUTIVE,
    status: 'Active',
    baseSalary: 15000,
    permissions: {
      canViewDashboard: true,
      canManageInventory: false,
      canManageSales: true,
      canViewReports: false,
      canManageUsers: false,
      canViewCredits: true,
      canManageCustomers: true,
      canManageReturns: false,
      canManageGallery: false
    }
  });

  const filteredUsers = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return store.users.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [searchQuery, store.users]);

  const applyPreset = (role: UserRole) => {
    let perms: UserPermissions;
    switch (role) {
      case UserRole.ADMIN:
        perms = { canViewDashboard: true, canManageInventory: true, canManageSales: true, canViewReports: true, canManageUsers: true, canViewCredits: true, canManageCustomers: true, canManageReturns: true, canManageGallery: true };
        break;
      case UserRole.MANAGER:
        perms = { canViewDashboard: true, canManageInventory: true, canManageSales: true, canViewReports: true, canManageUsers: false, canViewCredits: true, canManageCustomers: true, canManageReturns: true, canManageGallery: true };
        break;
      case UserRole.SALES_EXECUTIVE:
        perms = { canViewDashboard: true, canManageInventory: false, canManageSales: true, canViewReports: false, canManageUsers: false, canViewCredits: true, canManageCustomers: true, canManageReturns: false, canManageGallery: false };
        break;
      case UserRole.SUPERVISOR:
        perms = { canViewDashboard: true, canManageInventory: true, canManageSales: false, canViewReports: false, canManageUsers: false, canViewCredits: false, canManageCustomers: false, canManageReturns: true, canManageGallery: false };
        break;
      default:
        perms = { canViewDashboard: true, canManageInventory: false, canManageSales: false, canViewReports: false, canManageUsers: false, canViewCredits: false, canManageCustomers: false, canManageReturns: false, canManageGallery: false };
    }
    setFormUser(prev => ({ ...prev, role, permissions: perms }));
  };

  const handleSaveUser = async () => {
    if (!formUser.name || !formUser.email) return;
    if (showEditUser && selectedUser) {
      await store.updateUser(selectedUser.id, formUser);
      setSelectedUser({ ...selectedUser, ...formUser } as User);
    } else {
      const user: User = { 
        ...formUser, 
        id: Date.now().toString(),
        baseSalary: formUser.baseSalary || 15000,
        permissions: formUser.permissions || { canViewDashboard: true, canManageInventory: false, canManageSales: false, canViewReports: false, canManageUsers: false, canViewCredits: false, canManageCustomers: false, canManageReturns: false, canManageGallery: false }
      } as User;
      await store.createUser(user);
    }
    setShowAddUser(false);
    setShowEditUser(false);
    setFormUser({ name: '', email: '', password: '', role: UserRole.SALES_EXECUTIVE, baseSalary: 15000 });
  };

  const togglePermission = async (userId: string, key: keyof UserPermissions) => {
    const user = store.users.find(u => u.id === userId);
    if (!user) return;
    const newPerms = { ...user.permissions, [key]: !user.permissions[key] };
    await store.updatePermissions(userId, newPerms);
    setSelectedUser({ ...user, permissions: newPerms });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      <header className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter uppercase leading-none italic">Staff Governance</h1>
          <p className="text-slate-500 font-bold uppercase text-[10px] tracking-widest mt-2">Node Provisioning • Payroll Config • Security Audit</p>
        </div>
        <div className="flex bg-white p-1.5 rounded-2xl border shadow-sm self-stretch lg:self-auto">
          <button onClick={() => setActiveTab('users')} className={`flex-1 lg:px-8 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${activeTab === 'users' ? 'bg-slate-900 text-white shadow-xl' : 'text-slate-400'}`}>Staff List</button>
          <button onClick={() => setActiveTab('audit')} className={`flex-1 lg:px-8 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${activeTab === 'audit' ? 'bg-slate-900 text-white shadow-xl' : 'text-slate-400'}`}>Activity Log</button>
        </div>
      </header>

      {activeTab === 'users' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          {/* User List Sidebar */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 flex items-center gap-4">
              <i className="fas fa-search text-slate-300 ml-2"></i>
              <input 
                type="text" 
                placeholder="Search staff..."
                className="flex-1 py-2 font-bold outline-none text-slate-600 placeholder:text-slate-200"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button 
                onClick={() => { setFormUser({ name: '', email: '', password: '', role: UserRole.SALES_EXECUTIVE, status: 'Active', baseSalary: 15000 }); applyPreset(UserRole.SALES_EXECUTIVE); setShowAddUser(true); }} 
                className="w-10 h-10 bg-slate-900 text-white rounded-xl flex items-center justify-center hover:scale-110 transition-transform shadow-xl"
              >
                <i className="fas fa-plus"></i>
              </button>
            </div>

            <div className="bg-white rounded-[40px] shadow-sm border border-slate-100 overflow-hidden">
              <div className="divide-y divide-slate-100 max-h-[700px] overflow-y-auto scrollbar-hide">
                {filteredUsers.map(u => (
                  <button 
                    key={u.id} 
                    onClick={() => setSelectedUser(u)}
                    className={`w-full text-left p-6 transition-all flex justify-between items-center group ${selectedUser?.id === u.id ? 'bg-slate-900 text-white' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black ${selectedUser?.id === u.id ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-400'}`}>
                        {u.name[0]}
                      </div>
                      <div>
                        <div className="font-black text-sm uppercase tracking-tight">{u.name}</div>
                        <div className={`text-[9px] font-bold uppercase tracking-widest mt-1 ${selectedUser?.id === u.id ? 'text-slate-400' : 'text-slate-400'}`}>{u.role}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* User Detail View */}
          <div className="lg:col-span-2">
            {!selectedUser ? (
              <div className="bg-white rounded-[50px] border-2 border-dashed border-slate-100 h-full min-h-[500px] flex flex-col items-center justify-center text-slate-400 p-10 text-center">
                 <div className="w-24 h-24 bg-slate-50 text-slate-200 rounded-full flex items-center justify-center text-4xl mb-6"><i className="fas fa-user-shield"></i></div>
                 <h3 className="text-xl font-black text-slate-600 uppercase tracking-tight">Select Node</h3>
                 <p className="font-medium max-w-xs mt-3 text-sm text-slate-400 leading-relaxed">Choose an identity from the staff list to manage authority and payroll settings.</p>
              </div>
            ) : (
              <div className="animate-in slide-in-from-right-10 duration-500 space-y-8">
                <div className="bg-slate-900 p-10 rounded-[50px] text-white flex flex-col md:flex-row justify-between items-center shadow-2xl gap-10 relative overflow-hidden">
                   <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/10 blur-[120px] pointer-events-none"></div>
                   <div className="flex items-center gap-8 z-10">
                      <div className="w-24 h-24 bg-white/10 border-4 border-white/5 rounded-[30px] flex items-center justify-center text-4xl font-black text-amber-500 shadow-2xl">
                         {selectedUser.name[0]}
                      </div>
                      <div>
                         <h2 className="text-4xl font-black tracking-tighter uppercase italic leading-none">{selectedUser.name}</h2>
                         <p className="text-slate-500 font-bold text-sm tracking-tight mt-2">{selectedUser.email}</p>
                         <div className="flex gap-2 mt-4">
                            <span className="bg-white/10 px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-400">Monthly Salary: ₹{selectedUser.baseSalary.toLocaleString()}</span>
                         </div>
                      </div>
                   </div>
                   <div className="flex flex-col gap-3 z-10 w-full md:w-64">
                      <button onClick={() => { setFormUser(selectedUser); setShowEditUser(true); }} className="w-full py-3.5 bg-white text-slate-900 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all shadow-xl">Modify Policy</button>
                   </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="bg-white rounded-[50px] shadow-sm border border-slate-100 p-10">
                     <div className="flex justify-between items-center mb-10">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Authority Matrix</h3>
                        <i className="fas fa-lock-open text-slate-200"></i>
                     </div>
                     <div className="space-y-4">
                        {Object.keys(selectedUser.permissions).map((key) => (
                          <div key={key} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-50">
                             <span className="text-[10px] font-black text-slate-700 uppercase tracking-tighter">
                                {key.replace('can', '').replace(/([A-Z])/g, ' $1').trim()}
                             </span>
                             <button 
                                onClick={() => togglePermission(selectedUser.id, key as keyof UserPermissions)}
                                className={`w-12 h-6 rounded-full relative transition-all shadow-inner ${selectedUser.permissions[key as keyof UserPermissions] ? 'bg-emerald-500' : 'bg-slate-300'}`}
                             >
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-lg transition-all ${selectedUser.permissions[key as keyof UserPermissions] ? 'left-7' : 'left-1'}`}></div>
                             </button>
                          </div>
                        ))}
                     </div>
                  </div>

                  <div className="bg-white rounded-[50px] shadow-sm border border-slate-100 p-10 flex flex-col">
                     <div className="flex justify-between items-center mb-8">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Recent Activity</h3>
                        <i className="fas fa-history text-slate-200"></i>
                     </div>
                     <div className="space-y-4 flex-1 overflow-y-auto max-h-[400px] scrollbar-hide">
                        {store.activityLogs.filter(l => l.userId === selectedUser.id).slice(0, 10).map(l => (
                           <div key={l.id} className="p-4 bg-slate-50 rounded-2xl border-l-4 border-slate-900">
                              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{l.timestamp}</div>
                              <div className="text-xs font-black text-slate-800 mt-1">{l.action}</div>
                              <div className="text-[9px] text-slate-500 mt-0.5 line-clamp-1 italic">{l.details}</div>
                           </div>
                        ))}
                     </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-[50px] shadow-sm border border-slate-100 overflow-hidden">
           <table className="w-full text-left">
              <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                 <tr>
                    <th className="px-8 py-6">Staff Member</th>
                    <th className="px-8 py-6">Module</th>
                    <th className="px-8 py-6">Action Recorded</th>
                    <th className="px-8 py-6">Timestamp</th>
                 </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                 {store.activityLogs.map(l => (
                    <tr key={l.id} className="hover:bg-slate-50 transition-colors">
                       <td className="px-8 py-6 font-black text-slate-800 text-xs uppercase">{l.userName}</td>
                       <td className="px-8 py-6">
                          <span className="bg-slate-100 px-3 py-1 rounded-lg font-black text-[9px] uppercase tracking-widest border">{l.module}</span>
                       </td>
                       <td className="px-8 py-6 font-black text-slate-900 text-xs italic">{l.action}</td>
                       <td className="px-8 py-6 text-slate-400 font-bold text-[10px] uppercase">{l.timestamp}</td>
                    </tr>
                 ))}
              </tbody>
           </table>
        </div>
      )}

      {/* Provisioning Modal */}
      {(showAddUser || showEditUser) && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[200] flex items-center justify-center p-4">
           <div className="bg-white rounded-[50px] shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200 border-t-8 border-slate-900 flex flex-col max-h-[90vh]">
              <div className="p-10 bg-slate-50 border-b flex justify-between items-center">
                 <div>
                    <h2 className="text-3xl font-black tracking-tighter uppercase italic leading-none">{showEditUser ? 'Modify Node' : 'Provision User'}</h2>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">Remuneration & Privilege Policy</p>
                 </div>
                 <button onClick={() => { setShowAddUser(false); setShowEditUser(false); }} className="w-12 h-12 rounded-full bg-white border shadow-sm text-slate-400 hover:text-slate-900 transition-all flex items-center justify-center"><i className="fas fa-times text-xl"></i></button>
              </div>
              <div className="p-10 space-y-10 overflow-y-auto scrollbar-hide flex-1">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <input type="text" placeholder="Full Name" className="w-full px-6 py-4 bg-slate-50 border-2 rounded-2xl font-black outline-none focus:border-slate-900" value={formUser.name} onChange={e => setFormUser({...formUser, name: e.target.value})} />
                    <input type="email" placeholder="Email Address" className="w-full px-6 py-4 bg-slate-50 border-2 rounded-2xl font-black outline-none focus:border-slate-900" value={formUser.email} onChange={e => setFormUser({...formUser, email: e.target.value})} />
                    <input type="password" placeholder="System Key (Password)" className="w-full px-6 py-4 bg-slate-50 border-2 rounded-2xl font-black outline-none focus:border-slate-900" value={formUser.password} onChange={e => setFormUser({...formUser, password: e.target.value})} />
                    <select className="w-full px-6 py-4 bg-slate-50 border-2 rounded-2xl font-black outline-none appearance-none" value={formUser.role} onChange={e => applyPreset(e.target.value as UserRole)}>
                       {Object.values(UserRole).map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <div className="md:col-span-2">
                       <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Monthly Base Salary (Fixed Component)</label>
                       <div className="relative">
                          <span className="absolute left-6 top-1/2 -translate-y-1/2 font-black text-slate-300">₹</span>
                          <input type="number" className="w-full pl-12 pr-6 py-4 bg-slate-50 border-2 rounded-2xl font-black outline-none focus:border-slate-900" value={formUser.baseSalary} onChange={e => setFormUser({...formUser, baseSalary: Number(e.target.value)})} />
                       </div>
                    </div>
                 </div>

                 <div className="flex flex-col md:flex-row gap-4 pt-6">
                    <button onClick={() => { setShowAddUser(false); setShowEditUser(false); }} className="flex-1 py-5 bg-slate-100 text-slate-500 rounded-[30px] font-black text-[10px] uppercase tracking-widest hover:bg-slate-200">Discard</button>
                    <button onClick={handleSaveUser} className="flex-[2] py-5 bg-slate-900 text-white rounded-[30px] font-black uppercase text-[11px] tracking-widest hover:bg-slate-800 shadow-2xl">Confirm Identity Provision</button>
                 </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;
