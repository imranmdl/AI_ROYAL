import {
  Product, Sale, User, Purchase, PurchaseItem, PurchaseRecord,
  Quotation, Payment, Expense, ActivityLog, UserRole, UserStatus,
  Customer, CustomerType, LeadStatus, CustomerInteraction,
  Godown, StockLocation, UserPermissions, DamageRecord,
  StockAdjustmentEntry, Offer, SystemSettings, CommissionRule,
  Return, CommissionTier, AdvanceRecord, PayrollRecord, ReturnItem,
  PayrollStatus, VendorOrder, VendorOrderItem, DamagedItemTracking,
  VendorPaymentRecord, VendorPaymentStatus, DashboardVisibilitySettings,
  GalleryLead, LoadingChargeRule
} from './types';

const SYNC_URL   = '/api/sync';
const HEALTH_URL = '/api/health';

export interface HealthLogEntry {
  timestamp: string;
  isOnline: boolean;
  dbConnected: boolean;
  latency?: number;
  error?: string | null;
}

interface Subscription {
  selector?: (s: DataStore) => unknown;
  prevValue?: unknown;
  listener: () => void;
}

class DataStore {
  products: Product[] = [];
  users: User[] = [{
    id: '1', name: 'Administrator', role: UserRole.ADMIN,
    email: 'admin@royal.com', password: 'admin',
    status: 'Active' as any, baseSalary: 50000,
    permissions: {
      canViewDashboard: true, canManageInventory: true, canManageSales: true,
      canViewReports: true, canManageUsers: true, canViewCredits: true,
      canManageCustomers: true, canManageReturns: true, canManageGallery: true,
    }
  }];
  godowns: Godown[] = [
    { id: 'g1', name: 'Main Showroom',  location: 'City Center'     },
    { id: 'g2', name: 'West Godown',    location: 'Industrial Area'  },
    { id: 'g3', name: 'Factory Yard',   location: 'Hubli Road'       },
  ];
  sales: Sale[] = []; purchases: Purchase[] = []; quotations: Quotation[] = [];
  payments: Payment[] = []; expenses: Expense[] = []; offers: Offer[] = [];
  commissionRules: CommissionRule[] = []; customers: Customer[] = []; incentiveEntries: any[] = [];
  referralAgents: ReferralAgent[] = []; referralCommissions: ReferralCommissionEntry[] = [];
  contractorIncentives: any[] = [];
  approvalRequests: any[] = [];
  activityLogs: ActivityLog[] = []; advances: AdvanceRecord[] = []; giftInventory: any[] = []; giftIssuances: any[] = [];
  payrollRecords: PayrollRecord[] = []; returns: Return[] = [];
  vendorOrders: VendorOrder[] = []; galleryLeads: GalleryLead[] = []; customCredits: any[] = []; paymentReminders: any[] = [];
  loadingCharges: LoadingChargeRule[] = [];

  currentUser: User | null = null;
  lastUpdated = 0; isSyncing = false; syncError: string | null = null;
  isOnline = false; dbConnected = false; connectionError: string | null = null;
  initialSyncAttempted = false;
  public isInitialSyncDone = false;
  public syncProgress = 0;
  healthHistory: HealthLogEntry[] = [];

  settings: SystemSettings & { backendUrl?: string; backupFrequency?: string } = {
    backupFrequency: 'daily', lastBackupTimestamp: 0,
    showroomName: 'ROYAL TILES & GRANITES', showroomAddress: 'Royal Plaza, Main Tile Market',
    showroomCity: 'City Center, Hubli - Dharwad', showroomPhone: '+91 98765 43210',
    showroomGst: '29RTX1029384Z5', systemBranding: 'ROYAL ERP',
    showroomDescription: 'Luxury architectural surfaces.',
    galleryTitle: 'Royal Gallery', gallerySubTitle: 'Live Inventory Preview',
    galleryNotification: '', decimalPlaceText: '',
    customInvoiceFieldLabels: ['Vehicle Number', 'Site Engineer'],
    backendUrl: localStorage.getItem('royal_backend_url') || '',
    dashboardVisibility: {
      showStockValuation: true, showGrossMargin: true, showNetProfit: true,
      showDailyBooking: true, showOverdueOption: true, showGalleryStock: true,
      enableGalleryCart: true, enableGalleryOtp: true,
    },
    predefinedSizes: [
      '600x600 mm','600x1200 mm','800x800 mm','800x1600 mm','1200x1200 mm',
      '1200x1800 mm','1200x2400 mm','2x2 ft','2x4 ft','4x8 ft','10x2 ft','10x3 ft',
    ],
    predefinedBrands: ['Kajaria','Somany','Orient Bell','Johnson','Nitco','RAK Ceramics','Asian Granito'],
    predefinedGrades: ['Premium','Standard','Commercial','Budget'],
    predefinedShades: ['SH-01','SH-02','SH-03','SH-04','SH-05'],
    predefinedBatches: ['B-2024-A','B-2024-B','B-2024-C'],
    itemCreationSource: 'both',
    categories: ['Wall Tile','Floor Tile','Floor','Kadapa','Granite','Marble','Adhesive','Grout','Sanitary','Tools'],
    enableIndividualSlabManagement: true,
    marginThresholds: [
      { category: 'Wall Tile',  minMarginPct: 0,  warningMarginPct: 10, approvalRequired: false },
      { category: 'Floor Tile', minMarginPct: 0,  warningMarginPct: 10, approvalRequired: false },
      { category: 'Granite',    minMarginPct: 5,  warningMarginPct: 18, approvalRequired: true  },
      { category: 'Kadapa',     minMarginPct: 5,  warningMarginPct: 15, approvalRequired: true  },
      { category: 'Marble',     minMarginPct: 10, warningMarginPct: 25, approvalRequired: true  },
    ],
    printShowCompanyGst: true,
    printShowCustomerGst: true,
    categoryUnitMap: {
      'Wall Tile':  { defaultUnit: 'Box',   allowedUnits: ['Box'],                     hasVariants: false },
      'Floor Tile': { defaultUnit: 'Box',   allowedUnits: ['Box'],                     hasVariants: false },
      'Floor':      { defaultUnit: 'Box',   allowedUnits: ['Box'],                     hasVariants: false },
      'Kadapa':     { defaultUnit: 'Slab',  allowedUnits: ['Slab'],                    hasVariants: false },
      'Granite':    { defaultUnit: 'Slab',  allowedUnits: ['Slab'],                    hasVariants: false },
      'Marble':     { defaultUnit: 'Slab',  allowedUnits: ['Slab'],                    hasVariants: false },
      'Adhesive':   { defaultUnit: 'Bag',   allowedUnits: ['Bag','Piece','Pouch','Kg'], hasVariants: true  },
      'Grout':      { defaultUnit: 'Bag',   allowedUnits: ['Bag','Piece','Pouch','Kg'], hasVariants: true  },
      'Sanitary':   { defaultUnit: 'Piece', allowedUnits: ['Piece','Unit'],             hasVariants: false },
      'Tools':      { defaultUnit: 'Piece', allowedUnits: ['Piece','Unit','Bag'],       hasVariants: false },
    },
    kadapaItemTypes: [
      { id: 'ksp',  name: 'Single Polish',     ratePerSqft: 28 },
      { id: 'kdp',  name: 'Double Polish',      ratePerSqft: 35 },
      { id: 'kbsp', name: 'Big Single Polish',  ratePerSqft: 45 },
      { id: 'kbdp', name: 'Big Double Polish',  ratePerSqft: 55 },
    ],
  };

  private subscriptions: Set<Subscription> = new Set();

  subscribe(listener: () => void, selector?: (s: DataStore) => unknown): () => void {
    const sub: Subscription = { selector, prevValue: selector ? selector(this) : undefined, listener };
    this.subscriptions.add(sub);
    return () => { this.subscriptions.delete(sub); };
  }

  private notify() {
    for (const sub of this.subscriptions) {
      if (!sub.selector) { sub.listener(); continue; }
      const next = sub.selector(this);
      if (next !== sub.prevValue) { sub.prevValue = next; sub.listener(); }
    }
  }

  private _lsTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduleLsSave() {
    if (this._lsTimer) clearTimeout(this._lsTimer);
    this._lsTimer = setTimeout(() => this._writeLocalStorage(), 500);
  }
  private _writeLocalStorage() {
    try {
      const safeUsers = this.users.map(({ password, ...rest }) => rest);
      const data = {
        users: safeUsers, products: this.products, sales: this.sales,
        purchases: this.purchases, vendorOrders: this.vendorOrders,
        quotations: this.quotations, payments: this.payments, expenses: this.expenses,
        offers: this.offers, commissionRules: this.commissionRules, customers: this.customers,
        advances: this.advances, payrollRecords: this.payrollRecords, returns: this.returns,
        galleryLeads: this.galleryLeads, lastUpdated: this.lastUpdated, settings: this.settings,
      };
      // Always write — even empty state must overwrite stale cache after a clear
      // Tag cache with current tenant so it's rejected if tenant changes
      const _tenant = new URLSearchParams(window.location.search).get('tenant') || 'default';
      localStorage.setItem('royal_erp_cache', JSON.stringify({ ...data, _tenant }));
    } catch (e) { console.warn('[STORE] localStorage write failed:', e); }
  }
  private loadFromLocalStorage() {
    try {
      const cached = localStorage.getItem('royal_erp_cache');
      if (!cached) return;
      const data = JSON.parse(cached);

      // ── Tenant safety check ───────────────────────────────────────────────
      const isCapacitorApp2 = !!(window as any).Capacitor ||
        navigator.userAgent.includes('RoyalERP-Android') ||
        navigator.userAgent.includes('RoyalERP-iOS');
      const urlTenantForCache = (new URLSearchParams(window.location.search).get('tenant') || 'default');
      const cachedTenant      = data._tenant || 'default';
      // On browser: discard cache if it belongs to a different tenant
      if (!isCapacitorApp2 && cachedTenant !== urlTenantForCache) {
        console.log(`[STORE] Cache tenant mismatch: cached="${cachedTenant}" url="${urlTenantForCache}" — discarding`);
        localStorage.removeItem('royal_erp_cache');
        return;
      }
      // Preserve passwords from cache — they were set during sync from DB (data JSON column contains password)
      // Fall back to in-memory defaults only for users not in cache at all
      const cachedUsers = data.users || [];
      const defaultUsers = this.users;
      const mergedUsers = cachedUsers.map((u: any) => {
        const def = defaultUsers.find((x: User) => x.id === u.id);
        return { ...u, password: u.password || def?.password || '' };
      });
      // Add any default users not yet in cache (e.g. first boot)
      defaultUsers.forEach((du: User) => {
        if (!mergedUsers.find((u: any) => u.id === du.id)) mergedUsers.push(du);
      });
      this.users = mergedUsers;
      this.products = data.products || []; this.sales = data.sales || [];
      this.purchases = data.purchases || []; this.vendorOrders = data.vendorOrders || [];
      this.quotations = data.quotations || []; this.payments = data.payments || [];
      this.expenses = data.expenses || []; this.offers = data.offers || [];
      this.commissionRules = data.commissionRules || []; this.customers = data.customers || []; this.incentiveEntries = data.incentiveEntries || [];
      this.contractorIncentives = data.contractorIncentives || [];
      this.approvalRequests = data.approvalRequests || [];
      this.activityLogs = data.activityLogs || []; this.advances = data.advances || []; this.giftInventory = data.giftInventory || []; this.giftIssuances = data.giftIssuances || [];
      this.payrollRecords = data.payrollRecords || []; this.returns = data.returns || [];
      this.referralAgents = data.referralAgents || []; this.referralCommissions = data.referralCommissions || [];
      this.galleryLeads = data.galleryLeads || []; this.customCredits = data.customCredits || []; this.paymentReminders = data.paymentReminders || []; this.lastUpdated = data.lastUpdated || 0;
      if (data.settings) this.settings = { ...this.settings, ...data.settings };
      this.notify();
    } catch (e) { console.warn('[STORE] localStorage read failed:', e); }
  }

  constructor() { this.loadFromLocalStorage(); this.boot(); }

  public isInitialSyncDone2 = false; // alias kept for compat

  private async boot() {
    // ── Tenant guard: runs BEFORE first sync ─────────────────────────────────
    const rawUrlTenant = new URLSearchParams(window.location.search).get('tenant') || '';
    const urlTenant    = rawUrlTenant === 'default' ? '' : rawUrlTenant;
    const storedJwt    = typeof localStorage !== 'undefined' ? this.getJwt() : '';
    const storedSlug   = typeof localStorage !== 'undefined' ? localStorage.getItem('royal_tenant_slug') || '' : '';
    const isCapacitorApp = !!(window as any).Capacitor ||
      navigator.userAgent.includes('RoyalERP-Android') ||
      navigator.userAgent.includes('RoyalERP-iOS');

    if (storedJwt) {
      if (!urlTenant && !isCapacitorApp) {
        // Browser at base URL → clear any tenant JWT so default shop loads correctly
        try {
          const payload = JSON.parse(atob(storedJwt.split('.')[1]));
          if (payload.tenantId && payload.tenantId !== 'default') {
            console.log('[STORE] Base URL: clearing cross-tenant JWT', payload.tenantId);
            this.clearJwt();
          }
        } catch { this.clearJwt(); }

      } else if (urlTenant && storedSlug && storedSlug !== urlTenant) {
        // URL tenant slug changed — ALWAYS clear JWT to prevent data leak
        // e.g. stored=mudhol but URL=taps-and-tiles2-54f8 → wipe immediately
        console.log(`[STORE] Tenant switch detected (${storedSlug} → ${urlTenant}): clearing JWT`);
        this.clearJwt();
        localStorage.setItem('royal_tenant_slug', urlTenant);
        localStorage.removeItem('royal_erp_cache');
        this.products = []; this.sales = []; this.purchases = [];
        this.vendorOrders = []; this.quotations = []; this.lastUpdated = 0;
        this.notify();
      }
    }

    this.checkDbHealth();
    const useDelta = this.lastUpdated > 0 && this.products.length > 0;
    this.refreshFromServer(!useDelta).then(() => { this.isInitialSyncDone = true; this.notify(); });
    // Sync every 20s (was 60s) — keeps dashboard/reports fresh
    setInterval(() => this.refreshFromServer(), 20_000);
    setInterval(() => this.checkDbHealth(), 10_000);

    // Force full sync when tab becomes visible again (mobile app resume)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.refreshFromServer(true);   // force = true, ignores lastUpdated
        }
      });
    }
  }

  // ── Tenant-scoped JWT key ────────────────────────────────────────────────
  // Each tenant slug gets its own localStorage key so two browser tabs
  // with different tenants can never read each other's JWT.
  private getJwtKey(): string {
    const slug = typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('tenant') || 
         localStorage.getItem('royal_app_tenant') || 'default')
      : 'default';
    return `royal_jwt_${slug}`;
  }
  /** Public: returns { Authorization: 'Bearer ...' } if logged in, else {} */
  getAuthHeaders(): Record<string,string> {
    const jwt = this.getJwt();
    return jwt ? { 'Authorization': `Bearer ${jwt}` } : {};
  }

  /** Public: returns the JWT for the CURRENT tenant (from URL ?tenant= slug). */
  getJwt(): string {
    if (typeof localStorage === 'undefined') return '';
    // Try tenant-scoped key first, fall back to legacy key for backwards compat
    return localStorage.getItem(this.getJwtKey())
        || localStorage.getItem('royal_jwt')  // legacy fallback
        || '';
  }
  private setJwt(token: string) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(this.getJwtKey(), token);
    localStorage.setItem('royal_jwt', token); // keep legacy key in sync
  }
  private clearJwt() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(this.getJwtKey());
    localStorage.setItem('royal_jwt', '');
  }

  private getApiUrl(path: string) {
    const base = (this.settings as any).backendUrl || '';
    if (!base) return path;
    const appIsLocal  = ['localhost','127.0.0.1'].includes(window.location.hostname);
    const baseIsLocal = base.includes('localhost') || base.includes('127.0.0.1');
    if (baseIsLocal && !appIsLocal) return path;
    return `${base.replace(/\/$/, '')}${path}`;
  }

  public async fetchProductsPage(page = 1, limit = 50, search?: string, filters?: any) {
    try {
      const q = new URLSearchParams({ page: String(page), limit: String(limit),
        ...(search && { search }), ...(filters?.category && { category: filters.category }),
        ...(filters?.brand && { brand: filters.brand }), ...(filters?.size && { size: filters.size }),
        ...(filters?.stockStatus && { stockStatus: filters.stockStatus }),
        ...(filters?.grade && { grade: filters.grade }), ...(filters?.status && { status: filters.status }),
      });
      const jwt = typeof localStorage !== 'undefined' ? this.getJwt() : '';
      const headers: Record<string,string> = {};
      if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
      const r = await fetch(this.getApiUrl(`/api/products?${q}`), { headers });
      return r.ok ? r.json() : { data: [], total: 0, page, limit };
    } catch { return { data: [], total: 0, page, limit }; }
  }
  public async fetchSalesPage(page = 1, limit = 50, search = '') {
    try {
      const jwt = typeof localStorage !== 'undefined' ? this.getJwt() : '';
      const headers: Record<string,string> = {};
      if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
      const r = await fetch(this.getApiUrl(`/api/sales?${new URLSearchParams({ page: String(page), limit: String(limit), search })}`), { headers });
      return r.ok ? r.json() : { data: [], total: 0, page, limit };
    } catch { return { data: [], total: 0, page, limit }; }
  }
  public async fetchGalleryLeadsPage(page = 1, limit = 50, search = '', filters?: { startDate?: string; endDate?: string; dailyLatest?: boolean }) {
    try {
      const q = new URLSearchParams({ page: String(page), limit: String(limit), search,
        ...(filters?.startDate && { startDate: filters.startDate }),
        ...(filters?.endDate && { endDate: filters.endDate }),
        ...(filters?.dailyLatest && { dailyLatest: 'true' }),
      });
      const jwt2 = typeof localStorage !== 'undefined' ? this.getJwt() : '';
      const gh: Record<string,string> = {}; if (jwt2) gh['Authorization'] = `Bearer ${jwt2}`;
      const r = await fetch(this.getApiUrl(`/api/gallery-leads?${q}`), { headers: gh });
      return r.ok ? r.json() : { data: [], total: 0, page, limit };
    } catch { return { data: [], total: 0, page, limit }; }
  }

  public async checkDbHealth() {
    const start = Date.now();
    try {
      const r = await fetch(this.getApiUrl(HEALTH_URL), { cache: 'no-store' });
      if (r.ok) {
        const h = await r.json();
        this.dbConnected = h.db_connected; this.connectionError = h.db_error?.message ?? h.db_error ?? null;
        this.isOnline = true;
        this.healthHistory = [{ timestamp: new Date().toLocaleTimeString(), isOnline: true,
          dbConnected: this.dbConnected, latency: Date.now() - start, error: this.connectionError,
        }, ...this.healthHistory.slice(0, 19)];
      } else { this.isOnline = false; this.dbConnected = false; }
    } catch (e: any) { this.isOnline = false; this.dbConnected = false; this.connectionError = e.message; }
    finally { this.notify(); }
  }

  public async refreshFromServer(force = false) {
    if (this.isSyncing && !force) return;
    try {
      this.isSyncing = true; this.syncError = null;
      const isCapacitorApp = !!(window as any).Capacitor ||
        navigator.userAgent.includes('RoyalERP-Android') ||
        navigator.userAgent.includes('RoyalERP-iOS');
      const currentUrlTenant = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('tenant') || ''
        : '';
      // Only send JWT when actually on a tenant URL or running inside the mobile app
      // Never send JWT on the default base URL — would filter to wrong tenant
      const jwt = (currentUrlTenant || isCapacitorApp)
        ? (typeof localStorage !== 'undefined' ? this.getJwt() : '')
        : '';
      const headers: Record<string,string> = { 'Accept-Encoding': 'gzip' };
      if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
      const r = await fetch(this.getApiUrl(`${SYNC_URL}?since=${force ? 0 : this.lastUpdated}&pulse=${Date.now()}`),
        { cache: 'no-store', headers });
      if (r.ok) {
        const data = await r.json();
        if (data.changed === false) { this.isOnline = true; return; }
        this.applyData(data); this.lastUpdated = data.lastUpdated || Date.now();
        this.isOnline = true; this.scheduleLsSave();
      } else { throw new Error(`Sync failed: ${r.statusText}`); }
    } catch (e: any) { console.error('[STORE] Sync error:', e.message); this.syncError = e.message; this.isOnline = false; }
    finally { this.isSyncing = false; this.notify(); }
  }

  private applyData(data: any) {
    if (!data) return;
    if (data._metadata?.is_fallback && (this.products.length > 0 || this.sales.length > 0) && !data.products?.length && !data.sales?.length) {
      console.warn('[STORE] Ignoring empty fallback.'); return;
    }
    const cols = ['users','products','sales','purchases','vendorOrders','quotations','payments',
      'expenses','offers','commissionRules','customers','activityLogs','advances',
      'payrollRecords','returns','galleryLeads','loadingCharges','giftInventory','giftIssuances','incentiveEntries','referralAgents','referralCommissions'];
    if (data.isDelta) {
      cols.forEach(col => {
        if (!Array.isArray(data[col])) return;
        const next = [...((this as any)[col] || [])];
        data[col].forEach((item: any) => {
          const idx = next.findIndex((x: any) => x.id === item.id);
          if (idx >= 0) next[idx] = { ...next[idx], ...item }; else next.push(item);
        });
        (this as any)[col] = next;
      });
    } else { cols.forEach(col => { if (data[col] !== undefined) (this as any)[col] = data[col]; }); }
    if (data.settings) { const { backendUrl, ...rest } = data.settings; this.settings = { ...this.settings, ...rest }; }
  }

  private _saveTimer: ReturnType<typeof setTimeout> | null = null;
  private _savePending = false;
  public async save() {
    this.lastUpdated = Date.now(); this.scheduleLsSave(); this.notify();
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._savePending = true;
    this._saveTimer = setTimeout(() => this._flushSave(), 400);
  }
  private async _flushSave() {
    if (!this._savePending) return;
    this._savePending = false;
    const { backendUrl, ...cleanSettings } = this.settings as any;
    // Keep passwords in the sync payload so the server can preserve them
    // Server POST /api/sync reads existing password before overwriting (never wipes)
    try {
      const jwt = this.getJwt();
      const headers: Record<string,string> = { 'Content-Type': 'application/json' };
      if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
      await fetch(this.getApiUrl(SYNC_URL), { method: 'POST', headers,
        body: JSON.stringify({ users: this.users,
          products: this.products, sales: this.sales, purchases: this.purchases,
          vendorOrders: this.vendorOrders, quotations: this.quotations,
          customers: this.customers, activityLogs: this.activityLogs,
          galleryLeads: this.galleryLeads, returns: this.returns, offers: this.offers,
          advances: this.advances, payrollRecords: this.payrollRecords,
          referralAgents: this.referralAgents, referralCommissions: this.referralCommissions,
          incentiveEntries: this.incentiveEntries, paymentReminders: this.paymentReminders,
          loadingCharges: this.loadingCharges, settings: cleanSettings,
          lastUpdated: this.lastUpdated }),
      });
    } catch (e) { console.warn('[STORE] Save failed:', e); }
  }

  addActivityLog(module: ActivityLog['module'], action: string) {
    const log: ActivityLog = { id: Date.now().toString(), userId: this.currentUser?.id || 'system',
      userName: this.currentUser?.name || 'System', action, details: action, timestamp: new Date().toISOString(), module };
    this.activityLogs.unshift(log);
    if (this.activityLogs.length > 200) this.activityLogs = this.activityLogs.slice(0, 200);
    const actJwt = this.getJwt();
      const actH: Record<string,string> = {'Content-Type':'application/json'};
      if (actJwt) actH['Authorization'] = `Bearer ${actJwt}`;
      fetch(this.getApiUrl('/api/activity-logs'), { method: 'POST', headers: actH, body: JSON.stringify(log) }).catch(() => {});
  }
  logActivity(module: ActivityLog['module'], action: string, details: string) {
    if (!this.currentUser) return;
    const log: ActivityLog = { id: `act-${Date.now()}-${Math.random().toString(36).substr(2,9)}`,
      userId: this.currentUser.id, userName: this.currentUser.name, action, details, timestamp: new Date().toLocaleString(), module };
    this.activityLogs.unshift(log);
    fetch(this.getApiUrl('/api/activity-logs'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(log) }).catch(() => {});
    this.save();
  }

  /**
   * SYNCHRONOUS login — works against whatever users are currently in memory.
   * Used as final step after loginAsync() has fetched fresh users.
   */
  login(email: string, pass: string): User {
    const u = this.users.find(u =>
      u.email.toLowerCase() === email.trim().toLowerCase() &&
      u.password === pass
    );
    if (!u) {
      const emailMatch = this.users.find(x => x.email.toLowerCase() === email.trim().toLowerCase());
      if (emailMatch) throw new Error('WRONG_PASSWORD');
      throw new Error('EMAIL_NOT_FOUND');
    }
    if (u.status === 'Suspended') throw new Error('ACCOUNT_SUSPENDED');
    this.currentUser = u;
    this.logActivity('Users', 'Login', 'Session started');
    return u;
  }

  /**
   * ASYNC login — fetches fresh users from server first, then authenticates.
   * Works on any machine even with empty localStorage and mid-sync state.
   * Falls back to in-memory users if server is unreachable.
   */
  async loginAsync(email: string, pass: string): Promise<User> {
    const normalizedEmail = email.trim().toLowerCase();

    // Read tenant slug from URL (?tenant=mdl-05a7)
    const tenantSlug = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('tenant') || ''
      : '';

    // 'default' and '' both use the original single-tenant path (admin@royal.com)
    const isMultiTenant = tenantSlug !== '' && tenantSlug !== 'default';

    // ── Multi-tenant path: use /api/tenant/login ──────────────────────────
    if (isMultiTenant) {
      const r = await fetch(this.getApiUrl('/api/tenant/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, password: pass, tenantSlug }),
        cache: 'no-store',
      });
      const data = await r.json();
      if (!r.ok) {
        const msg = data.error || '';
        if (msg.toLowerCase().includes('password')) throw new Error('WRONG_PASSWORD');
        if (msg.toLowerCase().includes('suspend'))  throw new Error('ACCOUNT_SUSPENDED');
        if (msg.toLowerCase().includes('shop'))     throw new Error('SHOP_NOT_FOUND');
        throw new Error('EMAIL_NOT_FOUND');
      }
      // Store JWT token for subsequent API calls
      if (data.token) {
        this.setJwt(data.token);
        localStorage.setItem('royal_tenant_slug', tenantSlug);
        localStorage.setItem('royal_tenant_id', data.user?.tenantId || '');
      }
      // ── CRITICAL: Wipe ALL store data before loading new tenant ──────────────
      // Prevents previous tenant/default data from showing while sync loads
      this.products = []; this.sales = []; this.purchases = [];
      this.vendorOrders = []; this.quotations = []; this.customers = [];
      this.users = []; this.activityLogs = []; this.galleryLeads = [];
      this.loadingCharges = []; this.advances = []; this.payrollRecords = [];
      this.returns = []; this.offers = []; this.incentiveEntries = [];
      this.referralAgents = []; this.referralCommissions = [];
      this.lastUpdated = 0;
      // Clear localStorage cache for previous tenant
      localStorage.removeItem('royal_erp_cache');
      this.notify();

      const u = data.user as User;
      if (u && !u.permissions) {
        (u as any).permissions = {
          canViewDashboard:true, canManageInventory:true, canManageSales:true,
          canViewReports:true, canManageUsers:true, canViewCredits:true,
          canManageCustomers:true, canManageReturns:true, canManageGallery:true,
        };
      }
      this.currentUser = u;
      this.logActivity('Users', 'Login', 'Session started');
      // Force full sync — bypasses cache, gets tenant-scoped data from server
      this.refreshFromServer(true).then(() => { this.isInitialSyncDone = true; this.notify(); });
      return u;
    }

    // ── Single-tenant path: existing flow (admin@royal.com at base URL) ─────
    // Clear any tenant JWT that might be leftover from testing another shop
    if (typeof localStorage !== 'undefined') {
      this.clearJwt();
      localStorage.removeItem('royal_app_tenant');
    }
    try {
      const r = await fetch(this.getApiUrl('/api/users'), { cache: 'no-store' });
      if (r.ok) {
        const data = await r.json();
        const serverUsers: User[] = data.users || [];
        if (serverUsers.length > 0) {
          serverUsers.forEach(su => {
            const idx = this.users.findIndex(u => u.id === su.id);
            if (idx >= 0) this.users[idx] = { ...this.users[idx], ...su };
            else this.users.push(su);
          });
        }
      }
    } catch (e) {
      console.warn('[LOGIN] Could not fetch users:', (e as any).message);
    }

    const u = this.users.find(u =>
      u.email.toLowerCase() === normalizedEmail && u.password === pass
    );
    if (!u) {
      const emailMatch = this.users.find(x => x.email.toLowerCase() === normalizedEmail);
      if (emailMatch) throw new Error('WRONG_PASSWORD');
      throw new Error('EMAIL_NOT_FOUND');
    }
    if (u.status === 'Suspended') throw new Error('ACCOUNT_SUSPENDED');
    this.currentUser = u;
    this.logActivity('Users', 'Login', 'Session started');
    if (!this.isInitialSyncDone) {
      this.refreshFromServer(true).then(() => { this.isInitialSyncDone = true; this.notify(); });
    }
    return u;
  }
  logout() { this.logActivity('Users', 'Logout', 'Session ended'); this.currentUser = null; }

  updateSettings(updates: Partial<SystemSettings & { backendUrl?: string }>) {
    this.settings = { ...this.settings, ...updates };
    if (updates.backendUrl !== undefined) localStorage.setItem('royal_backend_url', updates.backendUrl);
    this.save(); this.checkDbHealth();
  }
  updateDashboardVisibility(s: Partial<DashboardVisibilitySettings>) { this.settings.dashboardVisibility = { ...this.settings.dashboardVisibility, ...s }; this.save(); }
  updatePredefinedSizes(sizes: string[]) { this.settings.predefinedSizes = sizes; this.save(); }
  updatePredefinedBrands(brands: string[]) { this.settings.predefinedBrands = brands; this.save(); }
  /** Enable/disable a module by sidebar id */
  // ── Kadapa Default Catalog Seeder ────────────────────────────────────────
  /**
   * Creates all standard Kadapa size products for the given finishes with 0 stock.
   * Heights: 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7 ft
   * Widths:  1, 1.25, 1.5, 2, 2.5 ft (9, 14, 17, 23, 29 inches)
   * One product per unique size+finish combination.
   * Returns the count of products created/skipped.
   */
  seedDefaultKadapaProducts(
    selectedFinishes: Array<{name: string; ratePerSqft: number}>,
    sellingMultiplier = 2.0
  ): { created: number; skipped: number } {
    const HEIGHTS = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7];
    const WIDTHS  = [
      { ft: 1,    inches: 9  },
      { ft: 1.25, inches: 14 },
      { ft: 1.5,  inches: 17 },
      { ft: 2,    inches: 23 },
      { ft: 2.5,  inches: 29 },
    ];
    const PREFIX: Record<string,string> = {
      'Single Polish':'SP', 'Double Polish':'DP',
      'Big Single Polish':'DSP', 'Big Double Polish':'DDP',
    };
    let created = 0, skipped = 0;
    const now = Date.now();

    for (const finish of selectedFinishes) {
      const pfx = PREFIX[finish.name] || 'SP';
      for (const h of HEIGHTS) {
        for (const w of WIDTHS) {
          const sqft = Math.round(h * w.ft * 100) / 100;
          const size = `${h}x${w.ft}`;
          const name = `${pfx}_KDP_${size}`;
          // Skip if already exists
          if (this.products.find(p => p.name === name && p.category === 'Kadapa')) { skipped++; continue; }
          const landedPerSlab = Math.round(sqft * finish.ratePerSqft * 100) / 100;
          const sellingPerSlab = Math.round(landedPerSlab * sellingMultiplier * 100) / 100;
          const prod: any = {
            id: `kadapa-default-${pfx}-${h}-${w.inches}-${now}-${Math.random().toString(36).substr(2,4)}`,
            name, category: 'Kadapa', brand: 'Kadapa Stone',
            size, unitType: 'Slab', tilesPerBox: 1, sqftPerBox: sqft,
            purchasePrice: landedPerSlab, sellingPrice: sellingPerSlab,
            costPerSqft: finish.ratePerSqft, sellingPricePerSqft: Math.round(finish.ratePerSqft * sellingMultiplier),
            totalCostPerUnit: finish.ratePerSqft, transportCost: 0, otherCharges: 0,
            kadapaType: finish.name, graniteName: '', grade: 'Premium', shadeNo: '', batchNo: '',
            isTile: true, showInGallery: true, status: 'Active',
            stockBoxes: 0, stockLoose: 0, reorderLevel: 5,
            slabs: [], damageHistory: [], purchaseHistory: [], adjustmentLog: [],
            locationStock: this.godowns.map((g, i) => ({ godownId: g.id, boxes: 0, loose: 0 })),
            images: ['https://images.unsplash.com/photo-1517646331032-9e8563c520a1?auto=format&fit=crop&q=80&w=1000'],
            updatedAt: now,
          };
          this.addProduct(prod as any);
          created++;
        }
      }
    }
    return { created, skipped };
  }

  /**
   * Generate a pre-filled Kadapa CSV template with all standard sizes.
   * Returns CSV string ready for download.
   */
  generateKadapaCSVTemplate(
    selectedFinishes: Array<{name: string; ratePerSqft: number; sellingRate: number}>
  ): string {
    const HEIGHTS = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7];
    const WIDTHS  = [
      { ft: 1, inches: 9 }, { ft: 1.25, inches: 14 },
      { ft: 1.5, inches: 17 }, { ft: 2, inches: 23 }, { ft: 2.5, inches: 29 },
    ];
    const PREFIX: Record<string,string> = {
      'Single Polish':'SP','Double Polish':'DP','Big Single Polish':'DSP','Big Double Polish':'DDP',
    };
    const header = 'Category,Product Name,Finish Type,Height (Ft),Width (Ft),Purchase Rate Per Sqft,Selling Price Per Sqft,Stock Slabs,Vendor Name,Order ID,Status';
    const rows: string[] = [header];
    for (const finish of selectedFinishes) {
      const pfx = PREFIX[finish.name] || 'SP';
      for (const h of HEIGHTS) {
        for (const w of WIDTHS) {
          const name = `${pfx}_KDP_${h}x${w.ft}`;
          rows.push([
            'Kadapa', name, finish.name, h, w.ft,
            finish.ratePerSqft, finish.sellingRate, 0, '', '', 'Active'
          ].join(','));
        }
      }
    }
    return rows.join('
');
  }

  setModuleEnabled(moduleId: string, enabled: boolean) {
    const disabled = this.settings.disabledModules || [];
    if (enabled) {
      this.settings.disabledModules = disabled.filter(id => id !== moduleId);
    } else {
      if (!disabled.includes(moduleId)) this.settings.disabledModules = [...disabled, moduleId];
    }
    this.save(); this.notify();
  }
  isModuleEnabled(moduleId: string): boolean {
    return !(this.settings.disabledModules || []).includes(moduleId);
  }
  updatePredefinedGrades(grades: string[]) { this.settings.predefinedGrades = grades; this.save(); }
  updatePredefinedShades(shades: string[]) { this.settings.predefinedShades = shades; this.save(); }
  updatePredefinedBatches(batches: string[]) { this.settings.predefinedBatches = batches; this.save(); }
  updateCategories(cats: string[]) { this.settings.categories = cats; this.save(); }
  updateIndividualSlabManagement(e: boolean) { this.settings.enableIndividualSlabManagement = e; this.save(); }

  private post(path: string, body: any) {
    const jwt = this.getJwt();
    const headers: Record<string,string> = { 'Content-Type': 'application/json' };
    if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
    fetch(this.getApiUrl(path), { method: 'POST', headers, body: JSON.stringify(body) })
      .catch(e => console.error(`POST ${path}:`, e));
  }
  private async persistUser(u: User) {
    // Keep password in the data JSON blob so it survives DB → sync → client round-trips.
    // The /api/users endpoint stores the full object in the `data` column.
    try {
      const jwt = this.getJwt();
      const headers: Record<string,string> = { 'Content-Type': 'application/json' };
      if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
      const r = await fetch(this.getApiUrl('/api/users'), {
        method: 'POST',
        headers,
        body: JSON.stringify(u)   // include password in data blob
      });
      return r.ok;
    } catch { return false; }
  }
  private persistProduct(p: Product)     { this.post('/api/products', p); }
  private persistSale(s: Sale)           { this.post('/api/sales', s); }
  private persistPurchase(p: Purchase)   { this.post('/api/purchases', p); }
  private persistVendorOrder(o: VendorOrder){ this.post('/api/vendor-orders', o); }
  private async persistGalleryLead(l: GalleryLead): Promise<boolean> { try { const r = await fetch(this.getApiUrl('/api/gallery-leads'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(l) }); return r.ok; } catch { return false; } }

  async createUser(u: User) { const ts = { ...u, updatedAt: Date.now() }; this.users.push(ts); this.logActivity('Users','Create',u.name); await this.persistUser(ts); await this.save(); }
  /**
   * Link a freshly-imported CSV batch to a vendor — creates ONE consolidated
   * VendorOrder for traceability/analytics WITHOUT re-adding stock (the CSV
   * import already set stockBoxes). Also updates each product's purchasePrice
   * (landed cost including transport share), lastPurchaseVendor/Date, and
   * appends a purchaseHistory entry.
   */
  async linkImportBatchToVendor(opts: {
    vendorName: string;
    date: string;
    invoiceNo?: string;
    /** If provided, items are appended to THIS existing order (by id or orderNo)
     *  instead of the default same-vendor/same-date consolidation. */
    targetOrderId?: string;
    items: { productId: string; name?: string; category?: string; unit?: string; qty: number; purchaseRate: number; sellingPrice: number }[];
    transport?: { totalWeightTons: number; ratePerTon: number; loadingCharges: number; unloadingCharges: number; driverExpenses: number };
    laborCharges?: number;
  }): Promise<string> {
    const { vendorName, date, items } = opts;
    const transport = opts.transport || { totalWeightTons: 0, ratePerTon: 3500, loadingCharges: 0, unloadingCharges: 0, driverExpenses: 0 };
    const laborCharges = opts.laborCharges || 0;

    const freightCost = (transport.totalWeightTons || 0) * (transport.ratePerTon || 0);
    const totalTransportCost = freightCost + (transport.loadingCharges||0) + (transport.unloadingCharges||0) + (transport.driverExpenses||0);
    const totalQty = items.reduce((s, i) => s + (i.qty || 0), 0);
    const transportPerUnit = totalQty > 0 ? totalTransportCost / totalQty : 0;
    const laborPerUnit     = totalQty > 0 ? laborCharges / totalQty : 0;

    const orderItems: VendorOrderItem[] = items.map((it, idx) => {
      const actualAmount = it.qty * it.purchaseRate;
      const landed = it.purchaseRate + transportPerUnit + laborPerUnit;
      const margin = it.sellingPrice > 0 ? ((it.sellingPrice - landed) / it.sellingPrice) * 100 : 0;
      const prod = this.products.find(p => p.id === it.productId);
      return {
        id: `item-import-${Date.now()}-${idx}`,
        productId: it.productId, productName: it.name || prod?.name || it.productId,
        category: it.category || prod?.category || '', unit: it.unit || prod?.unitType || 'Box',
        orderedQty: it.qty,
        billedQty: it.qty, billedRate: it.purchaseRate, billedAmount: actualAmount,
        actualQty: it.qty, actualRate: it.purchaseRate, actualAmount,
        receivedQty: it.qty, damagedQty: 0, goodQty: it.qty,
        transportShare: transportPerUnit * it.qty, laborShare: laborPerUnit * it.qty,
        landedCostPerUnit: landed,
        sellingPrice: it.sellingPrice, marginPct: margin,
      };
    });

    const newTotalActual = orderItems.reduce((s,i)=>s+(i.actualAmount||0),0);

    // ── Consolidate: find an existing import-batch order for this vendor+date ──
    const vName = vendorName.trim() || 'Import Batch';
    let existingIdx = -1;
    if (opts.targetOrderId) {
      // Explicit order targeting (by CSV "Order ID" column or UI selection):
      // append to THIS order regardless of date — match by id or orderNo,
      // case-insensitive, and require the vendor name to match.
      existingIdx = this.vendorOrders.findIndex((o: any) =>
        (o.id === opts.targetOrderId || (o.orderNo || '').toLowerCase() === opts.targetOrderId!.toLowerCase()) &&
        (o.vendorName || '').trim().toLowerCase() === vName.toLowerCase() &&
        o.status !== 'Closed' && o.status !== 'Cancelled'
      );
    }
    if (existingIdx < 0) {
      // Default: consolidate same-vendor/same-date import batches
      existingIdx = this.vendorOrders.findIndex((o: any) =>
        o.isImportBatch &&
        (o.vendorName || '').trim().toLowerCase() === vName.toLowerCase() &&
        o.orderDate === date &&
        o.status !== 'Closed' && o.status !== 'Cancelled'
      );
    }

    let order: VendorOrder;
    if (existingIdx >= 0) {
      // Merge new items into the existing order, recompute per-unit transport/labor
      // across ALL items (old + new) using this call's transport totals as the new total.
      const existing: any = this.vendorOrders[existingIdx];
      const combinedItems = [...(existing.items || []), ...orderItems];
      const combinedQty = combinedItems.reduce((s: number, i: any) => s + (i.actualQty||0), 0);
      const newTransportPerUnit = combinedQty > 0 ? totalTransportCost / combinedQty : 0;
      const newLaborPerUnit     = combinedQty > 0 ? laborCharges / combinedQty : 0;
      const recalced = combinedItems.map((i: any) => {
        const landed = (i.actualRate||0) + newTransportPerUnit + newLaborPerUnit;
        const margin = i.sellingPrice > 0 ? ((i.sellingPrice - landed) / i.sellingPrice) * 100 : 0;
        return { ...i, transportShare: newTransportPerUnit*(i.actualQty||0), laborShare: newLaborPerUnit*(i.actualQty||0), landedCostPerUnit: landed, marginPct: margin };
      });
      const totalActual = recalced.reduce((s: number,i: any)=>s+(i.actualAmount||0),0);
      const grandTotal  = totalActual + totalTransportCost + laborCharges;
      order = {
        ...existing,
        items: recalced,
        transport: { ...existing.transport,
          totalWeightTons: transport.totalWeightTons||0, ratePerTon: transport.ratePerTon||0,
          freightCost, loadingCharges: transport.loadingCharges||0, unloadingCharges: transport.unloadingCharges||0,
          driverExpenses: transport.driverExpenses||0, totalTransportCost },
        laborCharges,
        totalBilledAmount: totalActual, totalActualAmount: totalActual,
        totalTransportCost, grandTotal,
        balanceAmount: Math.max(0, grandTotal - (existing.paidAmount||0)),
        updatedAt: Date.now(),
      };
      this.vendorOrders = this.vendorOrders.map((o:any, i:number) => i === existingIdx ? order : o);
    } else {
      const grandTotal = newTotalActual + totalTransportCost + laborCharges;
      order = {
        id: `imp-${Date.now()}`,
        orderNo: opts.invoiceNo || `IMP-${Date.now().toString().slice(-6)}`,
        vendorName: vName,
        orderDate: date, receivedDate: date,
        status: 'Received' as any, paymentStatus: 'Pending' as any,
        items: orderItems,
        transport: { vehicleNo:'', driverName:'', driverPhone:'', transporterName:'',
          totalWeightTons: transport.totalWeightTons||0, ratePerTon: transport.ratePerTon||0,
          freightCost, loadingCharges: transport.loadingCharges||0, unloadingCharges: transport.unloadingCharges||0,
          driverExpenses: transport.driverExpenses||0, totalTransportCost },
        laborCharges, miscCharges: 0,
        totalBilledAmount: newTotalActual, totalActualAmount: newTotalActual,
        totalTransportCost, grandTotal,
        cashAmount: 0, rtgsAmount: 0, paidAmount: 0, balanceAmount: grandTotal,
        paymentHistory: [], damagedItems: [],
        receivedGodownId: 'g1',
        remarks: 'Linked from CSV Import — stock already set during import (no auto re-inward)',
        isFullyReceived: true, isImportBatch: true, updatedAt: Date.now(),
      };
      this.vendorOrders = [order, ...this.vendorOrders];
    }

    // Push directly — do NOT go through saveVendorOrder's auto-inward (would double-count stock)
    this.persistVendorOrder(order);

    // Update each product: landed cost, vendor info, purchase history (no stock change)
    for (const item of orderItems) {
      const prod = this.products.find(p => p.id === item.productId);
      if (!prod) continue;
      const purchaseEntry = {
        id: `ph-${order.id}-${item.productId}-${Date.now()}`,
        date, vendor: order.vendorName, qty: item.goodQty,
        rate: item.actualRate, landedCost: item.landedCostPerUnit,
        totalValue: item.landedCostPerUnit * item.goodQty,
        invoiceNo: order.orderNo, orderId: order.id,
      };
      const updatedProd = {
        ...prod,
        purchasePrice: item.landedCostPerUnit,
        sellingPrice: item.sellingPrice || prod.sellingPrice,
        lastPurchaseVendor: order.vendorName,
        lastPurchaseDate: date,
        purchaseHistory: [...(prod.purchaseHistory || []).filter((ph:any)=>ph.orderId!==order.id), purchaseEntry],
        updatedAt: Date.now(),
      };
      this.products = this.products.map(p => p.id === item.productId ? updatedProd : p);
      this.persistProduct(updatedProd);
    }

    this.lastUpdated = Date.now();
    this.notify();
    await this.save();
    return order.id;
  }

  /**
   * Delete a vendor order. If reverseStock=true, also subtracts each item's
   * goodQty from the linked product's stockBoxes and removes the associated
   * purchaseHistory/damageHistory entries (use when deleting a duplicate that
   * already inflated inventory).
   */
  async deleteVendorOrder(orderId: string, reverseStock: boolean = false) {
    const order = this.vendorOrders.find((o: any) => o.id === orderId);
    if (!order) return;

    if (reverseStock) {
      for (const item of (order.items || [])) {
        const goodQty = (item.goodQty ?? ((item.receivedQty||0) - (item.damagedQty||0))) || 0;
        if (goodQty > 0 && item.productId) {
          const prod = this.products.find(p => p.id === item.productId);
          if (prod) {
            const updatedProd = {
              ...prod,
              stockBoxes: Math.max(0, (prod.stockBoxes || 0) - goodQty),
              purchaseHistory: (prod.purchaseHistory || []).filter((ph: any) => ph.orderId !== orderId),
              damageHistory: (prod.damageHistory || []).filter((dh: any) => dh.orderId !== orderId),
              updatedAt: Date.now(),
            };
            this.products = this.products.map(p => p.id === item.productId ? updatedProd : p);
            this.persistProduct(updatedProd);
          }
        }
      }
    }

    this.vendorOrders = this.vendorOrders.filter((o: any) => o.id !== orderId);
    try {
      const jwt = this.getJwt();
      const headers: Record<string,string> = {};
      if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
      await fetch(this.getApiUrl(`/api/vendor-orders/${orderId}`), { method: 'DELETE', headers });
    } catch {}

    this.lastUpdated = Date.now();
    this.notify();
    await this.save();
  }

  /**
   * Add a single item as a "Quick Entry" purchase for a vendor.
   * Instead of creating a brand-new VendorOrder every time (which produced
   * duplicate "Tile_venila" entries for the same vendor/day), this finds an
   * existing OPEN quick-entry order for the same vendor + date and appends
   * the item to it — updating totals — rather than creating a new order.
   * Returns the order id that was created/updated.
   */
  /**
   * Re-map a single item from its CURRENT vendor order to a NEW vendor (and/or date).
   * - Removes the item from the old order, recomputing transport/labor
   *   allocation + totals across the remaining items (if any remain).
   *   If the old order becomes empty, it's deleted entirely.
   * - Adds the item to the new vendor's order via addQuickVendorItem (which
   *   consolidates same-vendor/same-date entries instead of creating duplicates).
   * - Updates the product's lastPurchaseVendor/Date + purchaseHistory to point
   *   at the new order, so the OLD vendor's analytics/order no longer shows this item.
   */
  async remapItemToVendor(productId: string, oldOrderId: string, newVendorName: string, newDate?: string): Promise<void> {
    const oldOrder = this.vendorOrders.find((o: any) => o.id === oldOrderId);
    if (!oldOrder) return;
    const itemIdx = (oldOrder.items || []).findIndex((i: any) => i.productId === productId);
    if (itemIdx < 0) return;
    const movedItem = { ...oldOrder.items[itemIdx] };
    const remainingItems = oldOrder.items.filter((_: any, i: number) => i !== itemIdx);

    if (remainingItems.length === 0) {
      // Old order had only this item — remove the order entirely
      this.vendorOrders = this.vendorOrders.filter((o: any) => o.id !== oldOrderId);
      try {
        const headers = this.getAuthHeaders();
        await fetch(this.getApiUrl(`/api/vendor-orders/${oldOrderId}`), { method: 'DELETE', headers });
      } catch {}
    } else {
      // Recompute transport/labor allocation across the remaining items
      const remainingQty = remainingItems.reduce((s: number, i: any) => s + (i.actualQty || 0), 0);
      const transportPerUnit = remainingQty > 0 ? (oldOrder.totalTransportCost || 0) / remainingQty : 0;
      const laborPerUnit     = remainingQty > 0 ? (oldOrder.laborCharges || 0) / remainingQty : 0;
      const recalced = remainingItems.map((i: any) => {
        const landed = (i.actualRate||0) + transportPerUnit + laborPerUnit;
        const margin = i.sellingPrice > 0 ? ((i.sellingPrice - landed) / i.sellingPrice) * 100 : 0;
        return { ...i, transportShare: transportPerUnit*(i.actualQty||0), laborShare: laborPerUnit*(i.actualQty||0), landedCostPerUnit: landed, marginPct: margin };
      });
      const totalActual = recalced.reduce((s: number,i: any)=>s+(i.actualAmount||0),0);
      const grandTotal  = totalActual + (oldOrder.totalTransportCost||0) + (oldOrder.laborCharges||0);
      const updatedOld = {
        ...oldOrder, items: recalced,
        totalBilledAmount: totalActual, totalActualAmount: totalActual, grandTotal,
        balanceAmount: Math.max(0, grandTotal - (oldOrder.paidAmount||0)),
        updatedAt: Date.now(),
      };
      this.vendorOrders = this.vendorOrders.map((o: any) => o.id === oldOrderId ? updatedOld : o);
      this.persistVendorOrder(updatedOld);
    }

    // Add the item to the new vendor's order (consolidates by vendor+date)
    const date = newDate || new Date().toISOString().slice(0,10);
    const newItem: VendorOrderItem = { ...movedItem, id: `item-remap-${Date.now()}` };
    const newOrderId = await this.addQuickVendorItem(newVendorName, date, newItem, {
      remarks: `Re-mapped from vendor "${oldOrder.vendorName}" (#${oldOrder.orderNo})`,
    });

    // Update the product's vendor linkage so it stops showing under the old vendor
    const prod = this.products.find(p => p.id === productId);
    if (prod) {
      const purchaseEntry = {
        id: `ph-${newOrderId}-${productId}-${Date.now()}`,
        date, vendor: newVendorName.trim(), qty: movedItem.goodQty || movedItem.actualQty || 0,
        rate: movedItem.actualRate, landedCost: movedItem.landedCostPerUnit,
        totalValue: (movedItem.landedCostPerUnit||0) * (movedItem.goodQty||movedItem.actualQty||0),
        invoiceNo: newOrderId, orderId: newOrderId,
      };
      const updatedProd = {
        ...prod,
        lastPurchaseVendor: newVendorName.trim(),
        lastPurchaseDate: date,
        purchaseHistory: [
          ...(prod.purchaseHistory || []).filter((ph: any) => ph.orderId !== oldOrderId),
          purchaseEntry,
        ],
        updatedAt: Date.now(),
      };
      this.products = this.products.map(p => p.id === productId ? updatedProd : p);
      this.persistProduct(updatedProd);
    }

    this.lastUpdated = Date.now();
    this.notify();
    await this.save();
  }

  async addQuickVendorItem(vendorName: string, date: string, item: VendorOrderItem, opts?: { invoiceNo?: string; remarks?: string; targetOrderId?: string }): Promise<string> {
    const vName = (vendorName || 'Quick Entry').trim();
    let existing: any = null;
    if (opts?.targetOrderId) {
      // Explicit order targeting: append to THIS order (by id or orderNo),
      // requiring the vendor name to match — used for re-mapping items and
      // for "add to existing order" flows from the UI.
      existing = this.vendorOrders.find((o: any) =>
        (o.id === opts.targetOrderId || (o.orderNo || '').toLowerCase() === opts.targetOrderId!.toLowerCase()) &&
        (o.vendorName || '').trim().toLowerCase() === vName.toLowerCase() &&
        o.status !== 'Closed' && o.status !== 'Cancelled'
      ) || null;
    }
    if (!existing) {
      // Default: find an existing quick-entry order for this vendor + date that's still open
      existing = this.vendorOrders.find((o: any) =>
        o.isQuickEntry &&
        (o.vendorName || '').trim().toLowerCase() === vName.toLowerCase() &&
        o.orderDate === date &&
        o.status !== 'Closed' && o.status !== 'Cancelled'
      );
    }

    if (existing) {
      // Append item to existing order and recompute totals
      const items = [...(existing.items || []), item];
      const totalBilled = items.reduce((s: number, i: any) => s + (i.billedAmount || 0), 0);
      const totalActual = items.reduce((s: number, i: any) => s + (i.actualAmount || 0), 0);
      const grandTotal   = totalActual + (existing.totalTransportCost || 0) + (existing.laborCharges || 0) + (existing.miscCharges || 0);
      const updated = {
        ...existing,
        items,
        totalBilledAmount: totalBilled,
        totalActualAmount: totalActual,
        grandTotal,
        balanceAmount: Math.max(0, grandTotal - (existing.paidAmount || 0)),
        updatedAt: Date.now(),
      };
      await this.saveVendorOrder(updated);
      return existing.id;
    }

    // No existing quick-entry order — create a new one
    const orderId = `inw-${Date.now()}`;
    const actualAmount = item.actualAmount || 0;
    const newOrder: VendorOrder = {
      id: orderId,
      orderNo: opts?.invoiceNo || `INW-${Date.now().toString().slice(-6)}`,
      vendorName: vName,
      orderDate: date, receivedDate: date,
      status: 'Received' as any, paymentStatus: 'Pending' as any,
      items: [item],
      laborCharges: 0, miscCharges: 0,
      totalBilledAmount: item.billedAmount || actualAmount,
      totalActualAmount: actualAmount,
      totalTransportCost: 0,
      grandTotal: actualAmount,
      cashAmount: 0, rtgsAmount: 0, paidAmount: 0, balanceAmount: actualAmount,
      paymentHistory: [], damagedItems: [],
      receivedGodownId: 'g1',
      remarks: opts?.remarks || 'Quick Entry — items added here are consolidated per vendor/day',
      isQuickEntry: true,
      isFullyReceived: true, updatedAt: Date.now(),
    };
    await this.saveVendorOrder(newOrder);
    return orderId;
  }

  async saveVendorOrder(order: any) {
    const existing = this.vendorOrders.findIndex((o: any) => o.id === order.id);
    const prevOrder = existing >= 0 ? this.vendorOrders[existing] : null;
    if (existing >= 0) {
      this.vendorOrders = this.vendorOrders.map((o: any) => o.id === order.id ? { ...o, ...order } : o);
    } else {
      this.vendorOrders = [order, ...this.vendorOrders];
    }

    // ── Auto-inward received items to inventory ────────────────────────────
    const wasReceived = prevOrder && ['Received','Partially Received'].includes(prevOrder.status);
    const isReceived  = ['Received','Partially Received'].includes(order.status);
    if (isReceived) {
      for (const item of (order.items || [])) {
        const prevItem = prevOrder?.items?.find((pi: any) => pi.productId === item.productId);
        const prevRecv = prevItem?.receivedQty || 0;
        const newRecv  = item.receivedQty || 0;
        const newGood  = newRecv - (item.damagedQty || 0);
        const addedQty = newGood - Math.max(0, prevRecv - (prevItem?.damagedQty || 0));

        if (item.productId) {
          const prodBefore = this.products.find(p => p.id === item.productId);
          if (prodBefore) {
            // Compute damage entries for this item (used both for damageHistory and the log)
            const damageEntries = (order.damagedItems || [])
              .filter((d: any) => d.productId === item.productId)
              .map((d: any) => ({
                id: d.id || `dmg-${order.id}-${Date.now()}`,
                date: d.date || order.receivedDate || new Date().toISOString().slice(0,10),
                qty: d.qtyDamaged || 0,
                reason: d.reason || '',
                vendorName: order.vendorName,
                orderId: order.id,
                actionTaken: d.actionTaken || '',
              }));
            const newDamageEntries = damageEntries.filter((d: any) =>
              !(prodBefore.damageHistory || []).some((dh: any) => dh.orderId === order.id && dh.id === d.id));

            // ── Apply stock changes via adjustStock (updates totals + Item Traceability Log) ──
            if (Math.max(0, addedQty) > 0) {
              this.adjustStock(
                item.productId, order.receivedGodownId || 'g1',
                Math.max(0, addedQty), 0, 'Purchase',
                `Vendor Inward: ${order.vendorName} (#${order.orderNo})`,
                order.receivedDate || new Date().toISOString().slice(0,10),
                order.id
              );
            }
            for (const d of newDamageEntries) {
              if ((d.qty || 0) > 0) {
                this.adjustStock(
                  item.productId, order.receivedGodownId || 'g1',
                  -(d.qty || 0), 0, 'Damage',
                  `Damage on Receipt: ${order.vendorName} (#${order.orderNo})`,
                  d.date,
                  order.id
                );
              }
            }

            // ── Apply non-stock fields (purchaseHistory, damageHistory, vendor info) ──
            // Read the product AFTER adjustStock so we don't clobber its updated stockBoxes/stockLoose
            const prod = this.products.find(p => p.id === item.productId)!;
            const purchaseEntry = {
              id: `ph-${order.id}-${item.id||item.productId}-${Date.now()}`,
              date: order.receivedDate || new Date().toISOString().slice(0,10),
              vendor: order.vendorName,
              qty: newGood,
              rate: item.actualRate || 0,
              landedCost: item.landedCostPerUnit || item.actualRate || 0,
              totalValue: (item.landedCostPerUnit||item.actualRate||0) * newGood,
              invoiceNo: order.actualInvoice?.invoiceNo || order.orderNo,
              orderId: order.id,
            };
            const purchaseHistory = [
              ...(prod.purchaseHistory || []).filter((ph: any) => ph.orderId !== order.id),
              purchaseEntry,
            ];
            const damageHistory = [
              ...(prod.damageHistory || []).filter((dh: any) => dh.orderId !== order.id),
              ...damageEntries,
            ];
            const updatedProd = {
              ...prod,
              purchasePrice: item.landedCostPerUnit || item.actualRate || prod.purchasePrice,
              lastPurchaseVendor: order.vendorName,
              lastPurchaseDate: order.receivedDate || new Date().toISOString().slice(0,10),
              purchaseHistory,
              damageHistory,
              updatedAt: Date.now(),
            };
            this.products = this.products.map(p => p.id === item.productId ? updatedProd : p);
            this.persistProduct(updatedProd);
          }
        }
      }
    }

    this.lastUpdated = Date.now();
    this.notify();
    await this.save();
  }

  async updateUser(id: string, up: Partial<User>) { const now = Date.now(); this.users = this.users.map(u => u.id === id ? { ...u, ...up, updatedAt: now } : u); const upd = this.users.find(u => u.id === id); if (upd) await this.persistUser(upd); await this.save(); }
  async updatePermissions(id: string, p: UserPermissions) { const now = Date.now(); this.users = this.users.map(u => u.id === id ? { ...u, permissions: p, updatedAt: now } : u); const upd = this.users.find(u => u.id === id); if (upd) await this.persistUser(upd); await this.save(); }
  async deleteUser(id: string) { this.users = this.users.filter(u => u.id !== id); this.save(); try { await fetch(this.getApiUrl(`/api/users/${id}`), { method: 'DELETE' }); } catch {} }
  async updateSelfPassword(o: string, n: string) {
    // Get stored password — check users array first (has full data from sync)
    const storedUser = this.users.find((u: any) => u.id === this.currentUser?.id);
    const storedPass = storedUser?.password || (this.currentUser as any)?.password;
    if (storedPass !== o) return false;

    // Direct DB endpoint — guaranteed to update the users table
    try {
      const jwt = typeof localStorage !== 'undefined' ? this.getJwt() : '';
      const headers: Record<string,string> = { 'Content-Type': 'application/json' };
      if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
      const r = await fetch(this.getApiUrl(`/api/users/${this.currentUser?.id}/change-password`), {
        method: 'POST', headers,
        body: JSON.stringify({ oldPassword: o, newPassword: n }),
      });
      if (!r.ok) { const err = await r.json().catch(()=>({error:'Unknown'})); console.error('[PWD]', err.error); return false; }
    } catch (e) { console.error('[PWD] network error:', e); return false; }

    // Update in-memory state
    this.users = this.users.map((u: any) => u.id === this.currentUser?.id ? { ...u, password: n, updatedAt: Date.now() } : u);
    if (this.currentUser) (this.currentUser as any).password = n;
    await this.save();
    return true;
  }

  addProduct(p: Product) {
    // Duplicate guard: block if same name+size already exists
    const nameKey = p.name.trim().toLowerCase();
    const sizeKey = (p.size || '').trim().toLowerCase();
    const isDup = this.products.some(x =>
      x.name.trim().toLowerCase() === nameKey &&
      (x.size || '').trim().toLowerCase() === sizeKey
    );
    if (isDup) {
      console.warn('[STORE] Blocked duplicate product:', p.name, p.size);
      return;
    }
    const product = { ...p, status: p.status || 'Active' as const, damageHistory: p.damageHistory || [], purchaseHistory: p.purchaseHistory || [], adjustmentLog: p.adjustmentLog || [], locationStock: p.locationStock || this.godowns.map(g => ({ godownId: g.id, boxes: 0, loose: 0 })) };
    this.products.push(product); this.persistProduct(product);
  }

  /** Check if a product with the same name+size already exists */
  productExists(name: string, size = ''): boolean {
    const n = name.trim().toLowerCase();
    const s = size.trim().toLowerCase();
    return this.products.some(p =>
      p.name.trim().toLowerCase() === n &&
      (p.size || '').trim().toLowerCase() === s
    );
  }
  updateProduct(id: string, up: Partial<Product>) {
    this.products = this.products.map(p => { if (p.id !== id) return p; const updated = { ...p, ...up }; this.persistProduct(updated); if (updated.linkedOrderId) { const order = this.vendorOrders.find(o => o.id === updated.linkedOrderId); if (order) this.updateVendorOrder(order.id, { vendorName: updated.lastPurchaseVendor || order.vendorName, orderDate: updated.lastPurchaseDate || order.orderDate, vehicleNumber: updated.lastPurchaseVehicle || order.vehicleNumber }); } return updated; });
  }
  async deleteProduct(id: string) { this.products = this.products.filter(p => p.id !== id); try { await fetch(this.getApiUrl(`/api/products/${id}`), { method: 'DELETE' }); } catch {} }
  toggleProductStatus(id: string) { this.products = this.products.map(p => { if (p.id !== id) return p; const updated = { ...p, status: p.status === 'Active' ? 'Suspended' : 'Active' } as Product; this.persistProduct(updated); return updated; }); }

  adjustStock(productId: string, godownId: string, boxes: number, pieces: number, actionType: StockAdjustmentEntry['actionType'], notes?: string, customDate?: string, vendorOrderId?: string) {
    this.products = this.products.map(p => {
      if (p.id !== productId) return p;
      const next = { ...p };
      const tpb = p.tilesPerBox || 1;

      // ── Source of truth: existing top-level stockBoxes/stockLoose + delta ──
      // (locationStock can drift out of sync, e.g. if stock was set via inward
      // without updating per-godown breakdown — never recompute totals from it)
      let totalBoxes = (p.stockBoxes || 0) + boxes;
      let totalLoose = (p.stockLoose || 0) + pieces;
      // Normalize loose <-> boxes
      if (totalLoose >= tpb) { totalBoxes += Math.floor(totalLoose / tpb); totalLoose %= tpb; }
      else if (totalLoose < 0) { const req = Math.ceil(Math.abs(totalLoose) / tpb); totalBoxes -= req; totalLoose += req * tpb; }

      next.stockBoxes = totalBoxes;
      next.stockLoose = totalLoose;

      // ── Best-effort per-godown breakdown (secondary, for warehouse view) ──
      next.locationStock = next.locationStock.map(l => ({ ...l }));
      let loc = next.locationStock.find(l => l.godownId === godownId);
      if (!loc) {
        loc = { godownId, boxes: 0, loose: 0 };
        next.locationStock.push(loc);
      }
      loc.boxes += boxes; loc.loose += pieces;
      if (loc.loose >= tpb) { loc.boxes += Math.floor(loc.loose / tpb); loc.loose %= tpb; }
      else if (loc.loose < 0) { const req = Math.ceil(Math.abs(loc.loose) / tpb); loc.boxes -= req; loc.loose += req * tpb; }
      // Reconcile: if the godown breakdown sum doesn't match the new total
      // (drift from before), adjust this godown's entry to absorb the difference
      // so locationStock sum stays consistent with the authoritative total.
      const locSum = next.locationStock.reduce((s, l) => s + l.boxes, 0);
      if (locSum !== totalBoxes) loc.boxes += (totalBoxes - locSum);

      next.adjustmentLog.unshift({ id: Math.random().toString(), date: customDate || new Date().toLocaleString(), userId: this.currentUser?.id || 'sys', userName: this.currentUser?.name || 'System', actionType, qtyBoxes: boxes, qtyLoose: pieces, godownId, godownName: this.godowns.find(g => g.id === godownId)?.name || '?', notes, vendorOrderId });

      // ── Kadapa: auto-generate slab numbers on inward ──────────────────────
      // ANY inward path (Material Inward Terminal, Quick Add & Inward, Quick
      // Item Provisioning, vendor remap, etc.) funnels through adjustStock with
      // actionType='Purchase' and boxes>0 — so generating slabs here covers all
      // of them. Slab numbering matches KadapaManager's own format exactly:
      // {PREFIX}-{heightFt}ft-{lengthInches}in-{N}
      if (actionType === 'Purchase' && boxes > 0 && ['Kadapa','Granite','Marble'].includes(p.category || '')) {
        const sizeParts = (p.size || '').split(/x/i);
        const heightFt = parseFloat(sizeParts[0] || '0');
        const lengthFt = parseFloat(sizeParts[1] || '0');
        if (heightFt > 0 && lengthFt > 0) {
          const PREFIX: Record<string,string> = { 'Single Polish':'SP', 'Double Polish':'DP', 'Big Single Polish':'DSP', 'Big Double Polish':'DDP' };
          const finish = p.kadapaType || 'Single Polish';
          const pfx = PREFIX[finish] || 'SP';
          const lengthIn = Math.round(lengthFt * 12);
          const base = `${pfx}-${heightFt}ft-${lengthIn}in`;
          const existingSlabs = next.slabs || [];
          const sameBaseSlabs = existingSlabs.filter((s:any) => s.slabNo?.startsWith(base));
          const maxNum = sameBaseSlabs.reduce((m:number, s:any) => Math.max(m, parseInt(s.slabNo?.split('-').pop()||'0')||0), 0);
          const sqft = p.sqftPerBox || parseFloat((heightFt * lengthFt).toFixed(2));
          const now = Date.now();
          const newSlabs = Array.from({ length: Math.round(boxes) }, (_, i) => ({
            id: `slab-${now}-${i}-${Math.random().toString(36).substr(2,5)}`,
            slabNo: `${base}-${maxNum + i + 1}`,
            heightFt, heightIn: Math.round(heightFt * 12), lengthFt, lengthIn,
            sqft, isSold: false, finish,
            landedCost: p.purchasePrice || 0,
            landedCostPerSqft: sqft > 0 ? (p.purchasePrice || 0) / sqft : 0,
            sellingPrice: p.sellingPrice || 0,
            sellingPricePerSqft: p.sellingPricePerSqft || 0,
          }));
          next.slabs = [...existingSlabs, ...newSlabs];
        }
      }

      this.persistProduct(next); return next;
    });
  }

  reportDamage(productId: string, boxes: number, pieces: number, godownId: string, vendorOrderId?: string) {
    this.adjustStock(productId, godownId, -boxes, -pieces, 'Damage', 'Damage Report', undefined, vendorOrderId);
    if (vendorOrderId) {
      const order = this.vendorOrders.find(o => o.id === vendorOrderId);
      if (order) {
        const damage: DamagedItemTracking = { id: `dmg-${Date.now()}-${Math.random().toString(36).substr(2,9)}`, productId, productName: this.products.find(p => p.id === productId)?.name || 'Unknown', qtyDamaged: boxes || pieces, type: boxes > 0 ? 'Box' : 'Piece', reason: 'Manual Report from Inventory', date: new Date().toISOString().split('T')[0] };
        // Record the damage on the order WITHOUT re-running updateVendorOrder's
        // stock reconciliation — adjustStock above already deducted the stock,
        // so re-applying via updateVendorOrder would double-deduct it.
        this.vendorOrders = this.vendorOrders.map(o => o.id === vendorOrderId
          ? { ...o, damagedItems: [...(o.damagedItems || []), damage], updatedAt: Date.now() }
          : o);
        this.persistVendorOrder(this.vendorOrders.find(o => o.id === vendorOrderId)!);
      }
    }
  }

  addPurchase(p: Purchase) {
    this.purchases.push(p); this.persistPurchase(p);
    p.items.forEach(it => {
      this.adjustStock(it.productId, p.godownId, it.qtyBoxes, 0, 'Purchase', `Vendor: ${p.vendorName}`, p.date, p.vendorOrderId);
      this.products = this.products.map(prod => {
        if (prod.id !== it.productId) return prod;
        const landedCost = prod.totalCostPerUnit || it.landedCost || 0;
        const record: PurchaseRecord = {
          id:            p.id,
          date:          p.date,
          vendorName:    p.vendorName,
          vehicleNumber: p.vehicleNumber,
          gstInvoiceNo:  p.gstInvoiceNo,
          qtyBoxes:      it.qtyBoxes,
          godownId:      p.godownId,
          vendorOrderId: p.vendorOrderId,
          purchaseRate:  it.purchaseRate || 0,
          transportShare:it.transportShare || 0,
          landedCost,
          totalValue:    (it.qtyBoxes || 0) * landedCost,
          invoiceNo:     p.gstInvoiceNo,
        };
        const updated = { ...prod, purchaseHistory: [record, ...(prod.purchaseHistory || [])] };
        this.persistProduct(updated);
        return updated;
      });
    });
  }

  private _markSlabsSold(items: any[], isSold: boolean) {
    items.forEach(it => { if (!it.selectedSlabIds?.length) return; this.products = this.products.map(p => { if (p.id !== it.productId || !p.slabs) return p; const updated = { ...p, slabs: p.slabs.map((slab: any) => it.selectedSlabIds.includes(slab.id) ? { ...slab, isSold } : slab) }; this.persistProduct(updated); return updated; }); });
  }

  addSale(s: Sale) {
    const sale = { ...s, status: s.status || 'Active' }; this.sales.push(sale); this.persistSale(sale);
    if (sale.status === 'Active') {
      sale.items.forEach(it => {
        this.adjustStock(it.productId, it.sourceGodownId, -it.qtyBoxes, -it.qtyLoose, 'Sale', `Inv: ${sale.invoiceNo} - ${sale.customerName}`, sale.date);
        // Auto-deduct dependent items if trackStock=true
        const product = this.products.find(p => p.id === it.productId);
        const deps = (product as any)?.dependentItems || [];
        deps.forEach((dep: any) => {
          if (!dep.trackStock) return;
          const depQty = Math.ceil(it.qtyBoxes * dep.qtyPerUnit);
          if (depQty <= 0) return;
          const depProduct = this.products.find(p => p.id === dep.productId);
          if (!depProduct) return;
          const depGodown = depProduct.locationStock?.[0]?.godownId || it.sourceGodownId;
          this.adjustStock(dep.productId, depGodown, -depQty, 0, 'Sale', `Auto-dep: ${sale.invoiceNo} (${depQty}×${dep.productName} with ${it.qtyBoxes}×${product?.name})`, sale.date);
        });
      });
      this._markSlabsSold(sale.items, true);
    }
    this.logActivity('Sales', 'Invoice', sale.invoiceNo);
    // Auto-calculate and accrue incentives for the salesperson
    if (sale.salesPersonId && this.commissionRules.length > 0) {
      try { this.calculateSaleIncentives(sale); } catch(e) { console.warn('[INCENTIVE] Calculation error:', e); }
    }
  }
  updateSale(id: string, up: Partial<Sale>) {
    const old = this.sales.find(s => s.id === id); if (!old) return;
    const isActivating = (old.status === 'Draft' || old.status === 'Hold') && up.status === 'Active';
    this.sales = this.sales.map(s => s.id === id ? { ...s, ...up } : s);
    const updated = this.sales.find(s => s.id === id)!; this.persistSale(updated);
    if (isActivating) { updated.items.forEach(it => this.adjustStock(it.productId, it.sourceGodownId, -it.qtyBoxes, -it.qtyLoose, 'Sale', `Inv: ${updated.invoiceNo} - ${updated.customerName}`, updated.date)); this._markSlabsSold(updated.items, true); }
    this.save();
  }
  deleteSale(id: string) {
    const sale = this.sales.find(s => s.id === id);
    if (sale?.status === 'Active') { sale.items.forEach(it => this.adjustStock(it.productId, it.sourceGodownId, it.qtyBoxes, it.qtyLoose, 'Correction', `Deleted Inv: ${sale.invoiceNo}`, new Date().toLocaleDateString())); this._markSlabsSold(sale.items, false); }
    this.sales = this.sales.map(s => s.id === id ? { ...s, status: 'Deleted' } : s);
    const del = this.sales.find(s => s.id === id); if (del) this.persistSale(del); this.save();
  }
  toggleSaleCommissionStatus(id: string) { this.sales = this.sales.map(s => s.id === id ? { ...s, commissionStatus: s.commissionStatus === 'Paid' ? 'Accrued' : 'Paid' } : s); const upd = this.sales.find(s => s.id === id); if (upd) this.persistSale(upd); this.save(); }
  suggestCommission(_u: string, _p: string): { value: number; type: 'Fixed' | 'Percentage' } { return { value: 2, type: 'Percentage' }; }

  recordPayment(p: Payment) { this.payments.push(p); const s = this.sales.find(s => s.id === p.saleId); if (s) { s.amountPaid = parseFloat((s.amountPaid + p.amount).toFixed(2)); s.balance = parseFloat((s.totalAmount - s.amountPaid).toFixed(2)); this.persistSale(s); } this.save(); }
  recordConsolidatedPayment(mobile: string, name: string, amount: number, paymentMode: Payment['paymentMode'], remarks: string) {
    let remaining = amount;
    const customerSales = this.sales.filter(s => (s.customerMobile === mobile || s.customerName === name) && s.status !== 'Deleted' && s.balance > 0).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.invoiceNo.localeCompare(b.invoiceNo));
    for (const sale of customerSales) { if (remaining <= 0) break; const payAmount = parseFloat(Math.min(remaining, sale.balance).toFixed(2)); const payment: Payment = { id: `pay-${Date.now()}-${Math.random().toString(36).substr(2,9)}`, saleId: sale.id, invoiceNo: sale.invoiceNo, customerName: sale.customerName, amount: payAmount, date: new Date().toLocaleDateString(), paymentMode, remarks: remarks || 'Consolidated payment recovery' }; this.payments.push(payment); sale.amountPaid = parseFloat((sale.amountPaid + payAmount).toFixed(2)); sale.balance = parseFloat((sale.totalAmount - sale.amountPaid).toFixed(2)); this.persistSale(sale); remaining = parseFloat((remaining - payAmount).toFixed(2)); }
    this.save(); this.addActivityLog('Sales', `Consolidated payment of ₹${amount} received from ${name}`);
  }

  addCustomer(c: any) { const cust = { ...c, id: `cust-${Date.now()}-${Math.random().toString(36).substr(2,9)}`, totalBusiness: 0, interactions: [], createdAt: new Date().toLocaleDateString() }; this.customers.push(cust); this.save(); return cust; }
  addInteraction(id: string, inter: any) { this.customers = this.customers.map(c => c.id === id ? { ...c, interactions: [{ id: `int-${Date.now()}-${Math.random().toString(36).substr(2,9)}`, date: new Date().toLocaleDateString(), ...inter }, ...c.interactions] } : c); this.save(); }

  addQuotation(q: Quotation) { this.quotations.push({ ...q, status: q.status || 'Active' }); this.save(); }
  updateQuotation(id: string, up: Partial<Quotation>) { this.quotations = this.quotations.map(q => q.id === id ? { ...q, ...up } : q); this.save(); }
  deleteQuotation(id: string) { this.quotations = this.quotations.map(q => q.id === id ? { ...q, status: 'Deleted' } : q); this.save(); }

  addExpense(e: any) { this.expenses.push({ ...e, id: `exp-${Date.now()}-${Math.random().toString(36).substr(2,9)}` }); this.save(); }
  updateExpense(id: string, up: any) { this.expenses = this.expenses.map(e => e.id === id ? { ...e, ...up } : e); this.save(); }
  deleteExpense(id: string) { this.expenses = this.expenses.filter(e => e.id !== id); this.save(); }

  addOffer(o: any) {
    const offer = { ...o, id: `off-${Date.now()}-${Math.random().toString(36).substr(2,9)}`, createdBy: this.currentUser?.name || 'Admin', status: 'Draft', usageCount: 0, totalDiscountGiven: 0, totalRevenueGenerated: 0, campaignSpent: 0 };
    this.offers.push(offer); this.save();
  }
  updateOffer(id: string, updates: any) { this.offers = this.offers.map(o => o.id === id ? { ...o, ...updates } : o); this.save(); }
  publishOffer(id: string) { this.offers = this.offers.map(o => o.id === id ? { ...o, status: 'Published', publishedBy: this.currentUser?.name } : o); this.save(); }
  pauseOffer(id: string) { this.offers = this.offers.map(o => o.id === id ? { ...o, status: 'Paused' } : o); this.save(); }
  deleteOffer(id: string) { this.offers = this.offers.filter(o => o.id !== id); this.save(); }
  addContractorIncentive(c: any) { this.contractorIncentives.push({ ...c, id: `ci-${Date.now()}`, createdAt: new Date().toISOString(), createdBy: this.currentUser?.name || 'Admin' }); this.save(); }
  updateContractorIncentive(id: string, u: any) { this.contractorIncentives = this.contractorIncentives.map((c: any) => c.id === id ? { ...c, ...u } : c); this.save(); }
  // ── Gift management ─────────────────────────────────────────────────────────
  addGiftStock(gift: any) {
    if (!this.giftInventory) this.giftInventory = [];
    const existing = this.giftInventory.find((g: any) => g.name === gift.name);
    if (existing) { existing.qty += gift.qty; }
    else this.giftInventory.push(gift);
    this.notify(); this.persistAll();
  }

  issueGift(issuance: any) {
    if (!this.giftIssuances) this.giftIssuances = [];
    this.giftIssuances.push(issuance);
    // Deduct from inventory
    const g = (this.giftInventory || []).find((x: any) => x.id === issuance.giftId);
    if (g) g.qty = Math.max(0, g.qty - issuance.qty);
    this.notify(); this.persistAll();
  }

  // ── Agent commission methods ──────────────────────────────────────────────
  addAgentCommission(custId: string, comm: any) {
    this.customers = this.customers.map(c =>
      c.id === custId
        ? { ...c, agentCommissions: [...(c.agentCommissions || []), { ...comm, id: `ac-${Date.now()}` }] }
        : c
    );
    this.save();
  }
  markAgentCommissionPaid(custId: string, commId: string) {
    this.customers = this.customers.map(c => c.id === custId ? {
      ...c,
      agentCommissions: (c.agentCommissions || []).map((ac: any) =>
        ac.id === commId ? { ...ac, status: 'Paid', paidDate: new Date().toISOString().split('T')[0] } : ac
      )
    } : c);
    this.save();
  }
  updateCustomer(id: string, updates: Partial<Customer>) {
    this.customers = this.customers.map(c => c.id === id ? { ...c, ...updates } : c);
    this.save();
  }
  deleteCustomer(id: string) {
    this.customers = this.customers.filter(c => c.id !== id);
    this.save();
  }

  // ── Message templates ──────────────────────────────────────────────────────
  addMessageTemplate(t: any) {
    const cur = (this.settings as any).messageTemplates || [];
    this.updateSettings({ messageTemplates: [...cur, { ...t, id: `tmpl-${Date.now()}`, createdAt: new Date().toISOString().split('T')[0] }] } as any);
  }
  deleteMessageTemplate(id: string) {
    const cur = (this.settings as any).messageTemplates || [];
    this.updateSettings({ messageTemplates: cur.filter((t: any) => t.id !== id) } as any);
  }

  deleteContractorIncentive(id: string) { this.contractorIncentives = this.contractorIncentives.filter((c: any) => c.id !== id); this.save(); }
  addApprovalRequest(r: any) { this.approvalRequests.push({ ...r, id: `apr-${Date.now()}`, requestedAt: new Date().toISOString(), requestedBy: this.currentUser?.name || 'Unknown', status: 'Pending' }); this.save(); }
  resolveApproval(id: string, approved: boolean, comment?: string) { this.approvalRequests = this.approvalRequests.map((r: any) => r.id === id ? { ...r, status: approved ? 'Approved' : 'Rejected', approvedBy: this.currentUser?.name, approvedAt: new Date().toISOString(), comment } : r); this.save(); }
  validateMargin(categoryName: string, sellingPrice: number, costPerUnit: number, discountAmount: number): { marginPct: number; riskLevel: string; blocked: boolean; threshold?: any } {
    const netRevenue = sellingPrice - discountAmount;
    const profit = netRevenue - costPerUnit;
    const marginPct = netRevenue > 0 ? (profit / netRevenue) * 100 : -999;
    const thresholds = (this.settings as any).marginThresholds || [];
    const threshold = thresholds.find((t: any) => t.category === categoryName) || { minMarginPct: 0, warningMarginPct: 10, approvalRequired: false };
    const blocked = marginPct < threshold.minMarginPct;
    const riskLevel = marginPct < 0 ? 'Red' : marginPct < threshold.warningMarginPct ? 'Yellow' : 'Green';
    return { marginPct, riskLevel, blocked, threshold };
  }

  private async persistReferralAgent(a: ReferralAgent) {
    try {
      const headers: Record<string,string> = { 'Content-Type': 'application/json', ...this.getAuthHeaders() };
      await fetch(this.getApiUrl('/api/referral-agents'), { method: 'POST', headers, body: JSON.stringify(a) });
    } catch {}
  }
  private async persistReferralCommission(c: ReferralCommissionEntry) {
    try {
      const headers: Record<string,string> = { 'Content-Type': 'application/json', ...this.getAuthHeaders() };
      await fetch(this.getApiUrl('/api/referral-commissions'), { method: 'POST', headers, body: JSON.stringify(c) });
    } catch {}
  }

  // ── Referral Agent CRUD ──────────────────────────────────────────────────
  addReferralAgent(a: Omit<ReferralAgent,'id'|'createdAt'|'totalCommissionEarned'|'totalCommissionPaid'|'outstandingBalance'>): ReferralAgent {
    const agent: ReferralAgent = { ...a as any, id: `ra-${Date.now()}`, createdAt: new Date().toISOString().slice(0,10),
      totalCommissionEarned: 0, totalCommissionPaid: 0, outstandingBalance: 0 };
    this.referralAgents = [agent, ...this.referralAgents];
    this.persistReferralAgent(agent); this.notify(); this.save(); return agent;
  }
  updateReferralAgent(id: string, updates: Partial<ReferralAgent>) {
    this.referralAgents = this.referralAgents.map(a => a.id === id ? { ...a, ...updates } : a);
    const updated = this.referralAgents.find(a => a.id === id);
    if (updated) this.persistReferralAgent(updated);
    this.notify(); this.save();
  }
  deleteReferralAgent(id: string) {
    this.referralAgents = this.referralAgents.filter(a => a.id !== id);
    this.referralCommissions = this.referralCommissions.filter(e => e.agentId !== id);
    try {
      const headers = this.getAuthHeaders();
      fetch(this.getApiUrl(`/api/referral-agents/${id}`), { method: 'DELETE', headers });
    } catch {}
    this.notify(); this.save();
  }

  // ── Referral Commission Entries ───────────────────────────────────────────
  addReferralCommission(entry: Omit<ReferralCommissionEntry,'id'|'status'|'amountPaid'|'balance'>): ReferralCommissionEntry {
    const e: ReferralCommissionEntry = { ...entry as any, id: `rc-${Date.now()}`,
      status: 'Pending', amountPaid: 0, balance: entry.commissionAmount };
    this.referralCommissions = [e, ...this.referralCommissions];
    this.persistReferralCommission(e);
    // Update agent running totals
    this.referralAgents = this.referralAgents.map(a => a.id === e.agentId
      ? { ...a, totalCommissionEarned: a.totalCommissionEarned + e.commissionAmount, outstandingBalance: a.outstandingBalance + e.commissionAmount }
      : a);
    this.notify(); this.save(); return e;
  }
  payReferralCommission(entryId: string, amount: number, paymentMode: string, date: string, notes?: string) {
    let paidToAgent = '';
    this.referralCommissions = this.referralCommissions.map(e => {
      if (e.id !== entryId) return e;
      const newPaid = (e.amountPaid || 0) + amount;
      const newBal  = Math.max(0, e.commissionAmount - newPaid);
      paidToAgent = e.agentId;
      const updated = { ...e, amountPaid: newPaid, balance: newBal, paidDate: date, paymentMode: paymentMode as any,
        status: newBal <= 0 ? 'Paid' : 'Partial', notes: notes || e.notes };
      this.persistReferralCommission(updated);
      return updated;
    });
    if (paidToAgent) {
      this.referralAgents = this.referralAgents.map(a => a.id === paidToAgent
        ? { ...a, totalCommissionPaid: a.totalCommissionPaid + amount, outstandingBalance: Math.max(0, a.outstandingBalance - amount) }
        : a);
    }
    this.notify(); this.save();
  }
  /** Link a referral agent commission to an invoice at sale time */
  linkSaleToReferralAgent(saleId: string, invoiceNo: string, customerName: string, saleDate: string,
    saleAmountAfterDiscount: number, agentId: string, commissionType: 'Percentage' | 'Fixed', commissionValue: number) {
    const agent = this.referralAgents.find(a => a.id === agentId);
    if (!agent) return;
    const commissionAmount = commissionType === 'Percentage'
      ? parseFloat(((saleAmountAfterDiscount * commissionValue) / 100).toFixed(2))
      : commissionValue;
    this.addReferralCommission({
      agentId, agentName: agent.name, agentMobile: agent.mobile,
      invoiceNo, saleId, customerName, saleDate,
      saleAmountAfterDiscount, commissionType, commissionValue, commissionAmount,
    });
  }

  addCommissionRule(r: any) { this.commissionRules.push({ ...r, id: `rule-${Date.now()}-${Math.random().toString(36).substr(2,9)}`, createdAt: new Date().toISOString() }); this.save(); }
  /** Called after server clear-db: wipes localStorage AND all in-memory collections (keeps users + settings) */
  hardReset(keepUsers = true) {
    // Wipe localStorage cache entirely
    localStorage.removeItem('royal_erp_cache');

    // Zero out every business data array
    this.products         = [];
    this.sales            = [];
    this.purchases        = [];
    this.vendorOrders     = [];
    this.quotations       = [];
    this.payments         = [];
    this.expenses         = [];
    this.offers           = [];
    this.commissionRules  = [];
    this.customers        = [];
    this.activityLogs     = [];
    this.advances         = [];
    this.payrollRecords   = [];
    this.returns          = [];
    this.galleryLeads     = [];
    this.loadingCharges   = [];
    this.giftInventory    = [];
    this.giftIssuances    = [];
    this.incentiveEntries = [];

    // Keep users and settings if requested (login must still work)
    if (!keepUsers) this.users = [];

    this.lastUpdated = Date.now();
    this.notify();
  }

  deleteCommissionRule(id: string) { this.commissionRules = this.commissionRules.filter(r => r.id !== id); this.save(); }
  updateCommissionRule(id: string, updates: any) {
    this.commissionRules = this.commissionRules.map(r => r.id === id ? { ...r, ...updates } : r);
    this.save();
  }

  /**
   * INCENTIVE CALCULATION ENGINE
   *
   * Called after every sale. Scans active CommissionRules and computes
   * per-item incentives for the salesperson who made the sale.
   *
   * Priority order:
   *   1. Product-specific rules (SlowStock or product-level)
   *   2. Category rules
   *   3. Global rules (no category / product filter)
   *
   * Conditional rules: pick the HIGHEST matching tier by margin %.
   * SlowStock rules: only apply if product.updatedAt is old enough.
   */
  calculateSaleIncentives(sale: any): any[] {
    const now = new Date().toISOString().split('T')[0];
    const activeRules = this.commissionRules
      .filter(r => r.isActive && (!r.expiryDate || r.expiryDate >= now) && (!r.startDate || r.startDate <= now))
      .filter(r => !r.targetUserId || r.targetUserId === sale.salesPersonId)
      .sort((a, b) => ((b as any).priority || 1) - ((a as any).priority || 1));

    const entries: any[] = [];

    sale.items?.forEach((item: any) => {
      const product = this.products.find(p => p.id === item.productId);
      const landedCost = (product?.totalCostPerUnit || product?.purchasePrice || 0) * (item.qtyBoxes + item.qtyLoose / (product?.tilesPerBox || 1));
      const netSell    = item.amount || 0;
      const profit     = netSell - landedCost;
      const marginPct  = landedCost > 0 ? (profit / landedCost) * 100 : 0;

      // Find best matching rule for this item (highest priority match)
      let matchedRule: any = null;
      for (const rule of activeRules) {
        const catMatch     = !rule.targetCategory  || rule.targetCategory  === product?.category;
        const prodMatch    = !rule.targetProductId || rule.targetProductId === item.productId;
        if (!catMatch || !prodMatch) continue;

        // SlowStock: check age
        if (rule.type === 'SlowStock') {
          const minDays = (rule as any).minDaysInStock || 90;
          const lastPurch = product?.purchaseHistory?.[0]?.date;
          if (!lastPurch) continue;
          const ageDays = Math.floor((Date.now() - new Date(lastPurch).getTime()) / 86400000);
          if (ageDays < minDays) continue;
          // Also check margin cap
          const maxM = (rule as any).maxMarginForTrigger;
          if (maxM !== undefined && marginPct > maxM) continue;
        }

        matchedRule = rule;
        break; // highest priority match found
      }

      if (!matchedRule) return;

      let incentiveAmount = 0;
      let basis = '';

      if (matchedRule.type === 'Conditional' && matchedRule.tiers?.length) {
        // Find the highest qualifying tier
        const sorted = [...matchedRule.tiers].sort((a: any, b: any) => b.minMargin - a.minMargin);
        const tier   = sorted.find((t: any) => marginPct >= t.minMargin);
        if (!tier) return; // margin too low — no incentive
        incentiveAmount = tier.commissionType === 'Percentage'
          ? (netSell * tier.commissionValue) / 100
          : tier.commissionValue;
        basis = `${tier.commissionValue}${tier.commissionType === 'Percentage' ? '%' : '₹'} (margin ${marginPct.toFixed(1)}% ≥ ${tier.minMargin}%)`;
      } else if (matchedRule.type === 'Percentage') {
        incentiveAmount = (netSell * matchedRule.value) / 100;
        basis = `${matchedRule.value}% of ₹${Math.round(netSell)}`;
      } else {
        incentiveAmount = matchedRule.value;
        basis = `Fixed ₹${matchedRule.value}`;
      }

      if (incentiveAmount <= 0) return;

      const entry: any = {
        id:              `inc-${Date.now()}-${Math.random().toString(36).substr(2,6)}`,
        saleId:          sale.id,
        invoiceNo:       sale.invoiceNo,
        saleItemId:      item.id,
        productName:     item.productName,
        productId:       item.productId,
        userId:          sale.salesPersonId,
        userName:        sale.salesPersonName,
        ruleId:          matchedRule.id,
        ruleTitle:       matchedRule.title,
        date:            sale.date,
        saleAmount:      Math.round(netSell * 100) / 100,
        landedCost:      Math.round(landedCost * 100) / 100,
        profit:          Math.round(profit * 100) / 100,
        marginPct:       Math.round(marginPct * 100) / 100,
        incentiveAmount: Math.round(incentiveAmount * 100) / 100,
        basis,
        status:          'Accrued',
      };
      entries.push(entry);

      // Update rule usage stats
      const rIdx = this.commissionRules.findIndex(r => r.id === matchedRule.id);
      if (rIdx >= 0) {
        (this.commissionRules[rIdx] as any).usageCount = ((this.commissionRules[rIdx] as any).usageCount || 0) + 1;
        (this.commissionRules[rIdx] as any).totalIncentivePaid = ((this.commissionRules[rIdx] as any).totalIncentivePaid || 0) + incentiveAmount;
      }
    });

    if (entries.length) {
      if (!this.incentiveEntries) this.incentiveEntries = [];
      this.incentiveEntries.push(...entries);
      // Accrue into payroll — find or create the month statement
      const month = sale.date?.slice(0, 7);
      if (month && sale.salesPersonId) {
        const total = entries.reduce((s: number, e: any) => s + e.incentiveAmount, 0);
        const rec   = this.payrollRecords.find(p => p.userId === sale.salesPersonId && p.month === month);
        if (rec) {
          const idx = this.payrollRecords.indexOf(rec);
          this.payrollRecords[idx] = { ...rec, incentivesAccrued: rec.incentivesAccrued + total, netPayable: rec.netPayable + total, balanceDue: rec.balanceDue + total };
        }
      }
      this.save();
    }
    return entries;
  }

  /** Get all incentive entries for a user, optionally filtered by month */
  getIncentiveEntriesForUser(userId: string, month?: string): any[] {
    return (this.incentiveEntries || []).filter((e: any) =>
      e.userId === userId && (!month || e.date?.startsWith(month))
    );
  }

  /** Get slow-moving products: no sales for N days */
  getSlowMovingProducts(minDays = 90): any[] {
    const now = Date.now();
    const soldIds = new Set(this.sales.filter(s => s.status !== 'Deleted').flatMap(s => s.items.map(i => i.productId)));
    return this.products.filter(p => {
      if (p.stockBoxes <= 0) return false;
      const lastSale = this.sales
        .filter(s => s.status !== 'Deleted' && s.items.some(i => i.productId === p.id))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      if (!lastSale) {
        // Never sold — check purchase date
        const ph = p.purchaseHistory?.[0];
        if (!ph) return true;
        const ageDays = Math.floor((now - new Date(ph.date).getTime()) / 86400000);
        return ageDays >= minDays;
      }
      const ageDays = Math.floor((now - new Date(lastSale.date).getTime()) / 86400000);
      return ageDays >= minDays;
    });
  }

  addReturn(r: Return) { this.returns.push(r); r.items.forEach(it => { const sale = this.sales.find(s => s.id === r.saleId); const godownId = sale?.items.find(i => i.productId === it.productId)?.sourceGodownId || 'g1'; this.adjustStock(it.productId, godownId, it.qtyBoxes, it.qtyLoose, 'Return', `Return from Inv: ${r.invoiceNo}`); }); this.save(); }

  generateMonthlyStatement(userId: string, month: string) { const user = this.users.find(u => u.id === userId); if (!user) return; if (!this.payrollRecords) this.payrollRecords = []; const record: PayrollRecord = { id: `PAY-${userId}-${month}`, userId, userName: user.name, month, baseSalary: user.baseSalary, incentivesAccrued: 0, bonus: 0, travelExpenses: 0, otherExpenses: 0, advancesDeducted: 0, netPayable: user.baseSalary, paidAmount: 0, balanceDue: user.baseSalary, status: 'Pending' }; const idx = this.payrollRecords.findIndex(r => r.userId === userId && r.month === month); if (idx >= 0) this.payrollRecords[idx] = record; else this.payrollRecords.push(record); this.save(); }
  recordPayrollPayment(recordId: string, amount: number, _remarks: string) { this.payrollRecords = this.payrollRecords.map(r => r.id === recordId ? { ...r, paidAmount: r.paidAmount + amount, balanceDue: r.balanceDue - amount, status: 'Paid' } : r); this.save(); }
  addPayrollAdjustment(recordId: string, _type: string, amount: number) { this.payrollRecords = this.payrollRecords.map(r => r.id === recordId ? { ...r, netPayable: r.netPayable + amount, balanceDue: r.balanceDue + amount } : r); this.save(); }

  addCustomCredit(c: any) { this.customCredits.unshift({ ...c, id: `CC-${Date.now()}`, amountSettled: 0, status: 'Open' }); this.save(); this.logActivity('Ledger', `Custom credit added for ${c.customerName}: ${c.description}`); }
  settleCustomCredit(id: string, amount: number) {
    const c = this.customCredits.find((x: any) => x.id === id);
    if (!c) return;
    c.amountSettled = Math.min((c.amountSettled || 0) + amount, c.amount);
    c.status = c.amountSettled >= c.amount ? 'Settled' : 'Partial';
    this.save();
  }
  addReminder(r: any) { this.paymentReminders.unshift({ ...r, id: `REM-${Date.now()}`, createdAt: new Date().toISOString(), status: 'Pending' }); this.save(); }
  updateReminderStatus(id: string, status: string) { const r = this.paymentReminders.find((x: any) => x.id === id); if (r) { r.status = status; this.save(); } }

  async addGalleryLead(lead: Omit<GalleryLead, 'id' | 'timestamp' | 'status'>) { const newLead: GalleryLead = { ...lead, id: `GL-${Date.now()}`, timestamp: new Date().toISOString(), status: 'New' }; this.galleryLeads.unshift(newLead); this.save(); const success = await this.persistGalleryLead(newLead); this.addActivityLog('Sales', `New Gallery Lead from ${lead.customerName}`); return success; }
  updateGalleryLeadStatus(id: string, status: GalleryLead['status']) { const l = this.galleryLeads.find(l => l.id === id); if (l) { l.status = status; this.save(); this.persistGalleryLead(l); } }
  updateGalleryLead(id: string, updates: Partial<GalleryLead>) { const l = this.galleryLeads.find(l => l.id === id); if (l) { Object.assign(l, updates); this.save(); this.persistGalleryLead(l); } }

  addLoadingChargeRule(rule: Omit<LoadingChargeRule,'id'>) { this.loadingCharges.push({ ...rule, id: Math.random().toString(36).substr(2,9) }); this.save(); this.addActivityLog('Inventory', `Added loading charge rule for ${rule.productType}`); }
  updateLoadingChargeRule(id: string, updates: Partial<LoadingChargeRule>) { const idx = this.loadingCharges.findIndex(r => r.id === id); if (idx !== -1) { this.loadingCharges[idx] = { ...this.loadingCharges[idx], ...updates }; this.save(); } }
  deleteLoadingChargeRule(id: string) { this.loadingCharges = this.loadingCharges.filter(r => r.id !== id); this.save(); }
  calculateLoadingCharges(items: any[]): number { return this.getLoadingChargeBreakdown(items).total; }
  getLoadingChargeBreakdown(items: any[]) {
    let total = 0; const details: any[] = [];
    items.forEach(item => { const product = this.products.find(p => p.id === item.productId); if (!product) return; const rule = this.loadingCharges.find(r => r.isActive && (r.productType.toLowerCase() === product.name.toLowerCase() || r.productType.toLowerCase() === product.category.toLowerCase())); if (!rule) return; const qty = rule.unitType === 'sqft' ? (item.reqSqft || item.sqft || 0) : rule.unitType === 'box' ? (item.qtyBoxes || 0) : rule.unitType === 'piece' ? (item.qtyPieces || item.qtyLoose || 0) : (item.qtyBoxes || 0) + (item.qtyPieces || item.qtyLoose || 0); const amount = (qty / rule.perUnit) * rule.rate; total += amount; if (amount > 0) details.push({ productName: product.name, quantity: qty, unitType: rule.unitType, rate: rule.rate, perUnit: rule.perUnit, amount: Math.round(amount) }); });
    return { total: Math.round(total), details };
  }

  addVendorOrder(o: VendorOrder) { const order = { ...o, paymentHistory: o.paymentHistory || [] }; this.vendorOrders.push(order); this.persistVendorOrder(order); this.save(); }
  recordVendorPayment(orderId: string, payment: VendorPaymentRecord) { this.vendorOrders = this.vendorOrders.map(o => { if (o.id !== orderId) return o; const nextPaid = o.paidAmount + payment.amount; const nextBalance = o.totalAmount + o.transportationCost + o.otherCosts - nextPaid; const status = nextBalance <= 0 ? 'Paid' : nextPaid > 0 ? 'Partially Paid' : 'Pending'; const updated = { ...o, paidAmount: nextPaid, balanceAmount: nextBalance, paymentStatus: status as VendorPaymentStatus, paymentHistory: [...(o.paymentHistory || []), payment] }; this.persistVendorOrder(updated); return updated; }); this.save(); }
  updateVendorOrder(id: string, up: Partial<VendorOrder>) {
    this.vendorOrders = this.vendorOrders.map(o => { if (o.id !== id) return o; const updated = { ...o, ...up }; if (o.status === 'Received' && (up.items || up.damagedItems)) { if (up.items) { o.items.forEach(it => this.adjustStock(it.productId, o.receivedGodownId || 'g1', -it.qtyBoxes, 0, 'Correction', `Order Reverse: ${o.orderNo}`)); updated.items.forEach(it => this.adjustStock(it.productId, o.receivedGodownId || 'g1', it.qtyBoxes, 0, 'Correction', `Order Apply: ${o.orderNo}`)); } if (up.damagedItems) { o.damagedItems.forEach(d => this.adjustStock(d.productId, o.receivedGodownId || 'g1', d.type === 'Box' ? d.qtyDamaged : 0, d.type === 'Piece' ? d.qtyDamaged : 0, 'Correction', `Damage Reverse: ${o.orderNo}`)); updated.damagedItems.forEach(d => this.adjustStock(d.productId, o.receivedGodownId || 'g1', d.type === 'Box' ? -d.qtyDamaged : 0, d.type === 'Piece' ? -d.qtyDamaged : 0, 'Correction', `Damage Apply: ${o.orderNo}`)); } } this.persistVendorOrder(updated); return updated; });
    this.save();
  }
  // deleteVendorOrder defined earlier (with reverseStock + JWT auth) — legacy duplicate removed
  receiveVendorOrder(id: string, godownId: string, receivedDate: string, vehicleNumber: string, damagedItems: DamagedItemTracking[]) {
    const order = this.vendorOrders.find(o => o.id === id); if (!order) return;
    this.updateVendorOrder(id, { status: 'Received', receivedDate, vehicleNumber, receivedGodownId: godownId, damagedItems: [...(order.damagedItems || []), ...damagedItems] });
    this.addPurchase({ id: `pur-${Date.now()}-${Math.random().toString(36).substr(2,9)}`, vendorName: order.vendorName, vehicleNumber, gstInvoiceNo: order.orderNo, date: receivedDate, godownId, items: order.items.map(i => ({ productId: i.productId, productName: i.productName, qtyBoxes: i.qtyBoxes, rate: i.rate })), vendorOrderId: id });
    damagedItems.forEach(d => this.reportDamage(d.productId, d.type === 'Box' ? d.qtyDamaged : 0, d.type === 'Piece' ? d.qtyDamaged : 0, godownId, id));
  }

  getTotalInventoryValue() { return this.products.reduce((s, p) => s + ((p.stockBoxes + (p.stockLoose / (p.tilesPerBox || 1))) * p.totalCostPerUnit), 0); }
}

export const store = new DataStore();
