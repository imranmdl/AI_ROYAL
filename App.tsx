
import React, { useState, useEffect, Suspense, lazy } from 'react';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';

// Lazy load heavy components
const Inventory = lazy(() => import('./components/Inventory'));
const Sales = lazy(() => import('./components/Sales'));
const Returns = lazy(() => import('./components/Returns'));
const Quotations = lazy(() => import('./components/Quotations'));
const Offers = lazy(() => import('./components/Offers'));
const CommissionMaster = lazy(() => import('./components/CommissionMaster'));
const CreditManagement = lazy(() => import('./components/CreditManagement'));
const Reports = lazy(() => import('./components/Reports'));
const UserManagement = lazy(() => import('./components/UserManagement'));
const CustomerConnect = lazy(() => import('./components/CustomerConnect'));
const Expenses = lazy(() => import('./components/Expenses'));
const VendorTracking = lazy(() => import('./components/VendorTracking'));
const SystemControl = lazy(() => import('./components/SystemControl'));
const DiagnosticsTerminal = lazy(() => import('./components/DiagnosticsTerminal'));
const Login = lazy(() => import('./components/Login'));
const WebGallery = lazy(() => import('./components/WebGallery'));
const ProfileSettings = lazy(() => import('./components/ProfileSettings'));
const GalleryLeads = lazy(() => import('./components/GalleryLeads'));
const PublicDocumentView = lazy(() => import('./components/PublicDocumentView'));
const IdleLogout = lazy(() => import('./components/IdleLogout'));

import { UserRole, Quotation, GalleryLead } from './types';
import { store } from './store';

// Lazy imports at module level — never inside conditionals or components
const SubscriptionPortalLazy  = lazy(() => import('./components/SubscriptionPortal'));

const App: React.FC = () => {
  // ── Routing: base URL → Subscription Portal, tenant URL → ERP ──────────
  React.useEffect(() => {
    const params      = new URLSearchParams(window.location.search);
    const tenant      = params.get('tenant');
    const configure   = params.get('configure');
    const isSubAdmin  = params.get('sub-admin') === 'true';
    const isSetup     = params.get('setup') === 'true';
    const isCapacitorApp = !!(window as any).Capacitor ||
      navigator.userAgent.includes('RoyalERP-Android') ||
      navigator.userAgent.includes('RoyalERP-iOS');

    // ── QR configure ────────────────────────────────────────────────────────
    if (tenant && configure === '1') {
      localStorage.setItem('royal_app_tenant', tenant);
      localStorage.setItem('royal_jwt', '');
      window.history.replaceState({}, '', `/?tenant=${tenant}`);
      return;
    }

    // ── Explicit tenant URL ─────────────────────────────────────────────────
    if (tenant) {
      localStorage.setItem('royal_app_tenant', tenant);
      return;
    }

    // ── No tenant in URL ────────────────────────────────────────────────────
    if (!tenant && !isSubAdmin && !isSetup) {
      if (isCapacitorApp) {
        // Mobile: restore stored tenant
        const stored = localStorage.getItem('royal_app_tenant');
        if (stored) {
          window.history.replaceState({}, '', `/?tenant=${stored}`);
          return;
        }
        // Mobile with no configured tenant: show QR setup screen
      } else {
        // Desktop browser with no tenant:
        // Redirect to Subscription Portal — no more "default" shop at base URL
        window.location.replace('/?sub-admin=true');
        return;
      }
    }
  }, []);

  // Login Bypass: Initializing as false
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isPublicMode, setIsPublicMode] = useState(false);
  const [isSyncing, setIsSyncing] = useState(store.isSyncing);
  const [hasData, setHasData] = useState(store.products.length > 0);
  const [publicDoc, setPublicDoc] = useState<{ type: 'invoice' | 'quotation', id: string } | null>(null);
  const [activeTab, setActiveTab] = useState('dashboard');

  // Force sync whenever user switches to a data-heavy tab
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    // Immediately fetch latest data when switching to reports/sales/quotations
    if (['reports','sales','quotations','inventory'].includes(tab)) {
      store.refreshFromServer(true);
    }
  };
  const [convQuotation, setConvQuotation] = useState<Quotation | null>(null);
  const [convLead, setConvLead] = useState<GalleryLead | null>(null);
  const [externalProductId, setExternalProductId] = useState<string | null>(null);
  // Super Admin Setup Panel — must be with all other hooks, never after an early return

  const [showSubAdmin, setShowSubAdmin] = useState(
    typeof window !== 'undefined' && window.location.search.includes('sub-admin=true')
  );

  useEffect(() => {
    const unsub = store.subscribe(() => {
      setIsSyncing(store.isSyncing);
      setHasData(store.products.length > 0);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const viewProduct = params.get('viewProduct');
    const viewInvoice = params.get('viewInvoice');
    const viewQuotation = params.get('viewQuotation');
    const isPublic = params.get('mode') === 'public';

    if (viewProduct) {
      setExternalProductId(viewProduct);
      if (!isLoggedIn) {
        setIsPublicMode(true);
      } else {
        setActiveTab('scanner');
      }
    } else if (viewInvoice) {
      setPublicDoc({ type: 'invoice', id: viewInvoice });
      setIsPublicMode(true);
    } else if (viewQuotation) {
      setPublicDoc({ type: 'quotation', id: viewQuotation });
      setIsPublicMode(true);
    } else if (isPublic) {
      setIsPublicMode(true);
    }
  }, [isLoggedIn]);

  const handleLoginSuccess = () => {
    setIsLoggedIn(true);
    setIsPublicMode(false);
    setPublicDoc(null);
    if (store.currentUser?.permissions?.canViewDashboard) setActiveTab('dashboard');
    else if (store.currentUser?.permissions?.canManageSales) setActiveTab('sales');
    else setActiveTab('inventory');
  };

  const handleLogout = () => {
    store.logout();
    setIsLoggedIn(false);
    setIsPublicMode(false);
    setPublicDoc(null);
    setActiveTab('dashboard');
  };

  const handleQuotationConversion = (q: Quotation) => {
    setConvQuotation(q);
    setActiveTab('sales');
  };

  const handleLeadConversion = (l: GalleryLead) => {
    // Mark as responded so it shows in portal
    if (l.status === 'New') store.updateGalleryLeadStatus(l.id, 'Responded');
    setConvLead(l);
    setActiveTab('quotations');
  };

  const handleInvoiceDone = () => {
    setConvQuotation(null);
    setActiveTab('sales');
  };

  // Only block the UI if we have absolutely no data and it's the very first sync
  if (isSyncing && !hasData && !store.isInitialSyncDone) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center space-y-8 p-10 text-center">
        <div className="relative">
          <div className="w-32 h-32 border-4 border-amber-500/20 rounded-full animate-ping absolute inset-0"></div>
          <div className="w-32 h-32 border-4 border-t-amber-500 border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin relative z-10"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-4xl font-black text-white italic tracking-tighter">R</div>
          </div>
        </div>
        <div className="space-y-3 max-w-md">
          <h2 className="text-3xl font-black text-white uppercase tracking-tighter italic">Synchronizing Node</h2>
          <p className="text-slate-400 font-bold text-xs uppercase tracking-[0.3em] leading-relaxed">
            Establishing secure handshake with cloud persistence... <br/>
            Loading commercial assets and ledger history.
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full border border-white/10">
          <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></div>
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Optimizing Data Stream</span>
        </div>
      </div>
    );
  }

  if (isPublicMode) {
    if (publicDoc) {
      return (
        <Suspense fallback={<div className="min-h-screen bg-slate-900 flex items-center justify-center"><div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div></div>}>
          <PublicDocumentView 
            type={publicDoc.type} 
            id={publicDoc.id} 
            onAdminAccess={() => { setIsPublicMode(false); setPublicDoc(null); }} 
          />
        </Suspense>
      );
    }
    return (
      <Suspense fallback={<div className="min-h-screen bg-slate-900 flex items-center justify-center"><div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div></div>}>
        <WebGallery 
          initialProductId={externalProductId} 
          onAdminAccess={() => setIsPublicMode(false)} 
        />
      </Suspense>
    );
  }

  if (showSubAdmin) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-slate-900 flex items-center justify-center"><div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div></div>}>
        <SubscriptionPortalLazy onClose={() => {
          setShowSubAdmin(false);
          window.history.replaceState({}, '', window.location.pathname);
        }} />
      </Suspense>
    );
  }

  if (!isLoggedIn) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-slate-900 flex items-center justify-center"><div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div></div>}>
        <Login 
          onLoginSuccess={handleLoginSuccess} 
          onPublicGallery={() => setIsPublicMode(true)} 
        />
      </Suspense>
    );
  }

  const currentUser = store.currentUser!;
  // Ensure permissions object exists — new tenant users may not have it yet
  if (currentUser && !currentUser.permissions) {
    currentUser.permissions = {
      canViewDashboard: true, canManageInventory: true, canManageSales: true,
      canViewReports: true, canManageUsers: true, canViewCredits: true,
      canManageCustomers: true, canManageReturns: true, canManageGallery: true,
    };
  }

  const AccessDenied = () => (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center space-y-6">
       <div className="w-24 h-24 bg-red-100 text-red-600 rounded-full flex items-center justify-center text-4xl shadow-inner border-2 border-red-50">
          <i className="fas fa-lock"></i>
       </div>
       <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">Access Restricted</h2>
          <p className="text-slate-500 font-medium max-w-sm mt-2">Your current access policy does not permit viewing this module. Contact administrator for privilege elevation.</p>
       </div>
       <button onClick={() => setActiveTab('dashboard')} className="bg-slate-900 text-white px-8 py-3 rounded-2xl font-black text-sm hover:scale-105 transition-all">RETURN TO DASHBOARD</button>
    </div>
  );

  const renderContent = () => {
    return (
      <Suspense fallback={
        <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-4">
          <div className="w-12 h-12 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin"></div>
          <p className="text-slate-400 font-black text-[10px] uppercase tracking-widest animate-pulse">Loading Module...</p>
        </div>
      }>
        {(() => {
          if (activeTab.startsWith('reports_')) {
            const subTab = activeTab.replace('reports_', '');
            return currentUser.permissions?.canViewReports ? <Reports defaultTab={subTab as any} /> : <AccessDenied />;
          }

          switch (activeTab) {
            case 'dashboard': 
              return currentUser.permissions?.canViewDashboard ? <Dashboard /> : <AccessDenied />;
            case 'inventory': 
              return currentUser.permissions?.canManageInventory ? <Inventory currentRole={currentUser.role} setActiveTab={setActiveTab} /> : <AccessDenied />;
            case 'sales': 
              return currentUser.permissions?.canManageSales ? <Sales initialQuotation={convQuotation} onInvoiceCreated={handleInvoiceDone} /> : <AccessDenied />;
            case 'returns':
              return currentUser.permissions?.canManageReturns ? <Returns /> : <AccessDenied />;
            case 'quotations': 
              return currentUser.permissions?.canManageSales ? <Quotations onConvertToSale={handleQuotationConversion} initialLead={convLead} onLeadConverted={() => setConvLead(null)} /> : <AccessDenied />;
            case 'offers':
              return currentUser.permissions?.canManageSales ? <Offers /> : <AccessDenied />;
            case 'commission_master':
              return currentUser.role === UserRole.ADMIN ? <CommissionMaster /> : <AccessDenied />;
            case 'credits': 
              return currentUser.permissions?.canViewCredits ? <CreditManagement /> : <AccessDenied />;
            case 'users': 
              return currentUser.permissions.canManageUsers ? <UserManagement /> : <AccessDenied />;
            case 'connect': 
              return currentUser.permissions.canManageCustomers ? <CustomerConnect /> : <AccessDenied />;
            case 'expenses':
              return currentUser.permissions?.canManageSales ? <Expenses /> : <AccessDenied />;
            case 'gallery_leads':
              return currentUser.permissions.canManageGallery ? <GalleryLeads onConvertToQuotation={handleLeadConversion} /> : <AccessDenied />;
            case 'vendor_tracking':
              return currentUser.permissions?.canManageInventory ? <VendorTracking setActiveTab={setActiveTab} /> : <AccessDenied />;
            case 'profile':
              return <ProfileSettings />;
            case 'system':
              return currentUser.role === UserRole.ADMIN ? <SystemControl /> : <AccessDenied />;
            case 'diagnostics':
              return currentUser.role === UserRole.ADMIN ? <DiagnosticsTerminal /> : <AccessDenied />;
            default: return <Dashboard />;
          }
        })()}
      </Suspense>
    );
  };

  return (
    <Layout 
      currentRole={currentUser.role} 
      activeTab={activeTab} 
      setActiveTab={setActiveTab} 
      onLogout={handleLogout}
      userName={currentUser.name}
    >
      {isLoggedIn && <IdleLogout onLogout={handleLogout} timeoutMinutes={20} />}
      {renderContent()}
    </Layout>
  );
};

export default App;
