
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import type { Pool, Connection } from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import fs from 'fs-extra';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config();

// PORT configuration: Default to 3000 for AI Studio, but respect environment for Railway
const PORT = Number(process.env.PORT) || 3000;
process.env.PORT = PORT.toString();

// NODE_ENV configuration: Default to development for preview, but respect environment
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

console.log(`[SYSTEM] Environment: ${process.env.NODE_ENV}`);
console.log(`[SYSTEM] Port: ${PORT}`);

const BACKUP_DIR = path.join(__dirname, 'backups');
fs.ensureDirSync(BACKUP_DIR);

const parseData = (d: any) => {
  if (!d) return {};
  if (typeof d === 'object') return d;
  try { return JSON.parse(d); } catch (e) { return {}; }
};

// ════════════════════════════════════════════════════════════════
//  MULTI-TENANT ENGINE
// ════════════════════════════════════════════════════════════════

const JWT_SECRET = process.env.JWT_SECRET || 'royal-erp-jwt-secret-change-in-production';
const SUPER_ADMIN_KEY = process.env.SUPER_ADMIN_KEY || 'test';

// Simple JWT implementation (no external lib needed)
const signToken = (payload: any, expiresInDays = 30): string => {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp     = Math.floor(Date.now() / 1000) + expiresInDays * 86400;
  const body    = Buffer.from(JSON.stringify({ ...payload, exp, iat: Math.floor(Date.now()/1000) })).toString('base64url');
  const sig     = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
};

const verifyToken = (token: string): any | null => {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
};

// In-memory tenant cache (loaded from DB on startup)
const tenantCache = new Map<string, any>(); // tenantId → tenant row

// Extend Express Request with tenant context
declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      tenant?:   any;
    }
  }
}

// ── Tenant auth middleware ────────────────────────────────────────────────────
// Attaches tenantId to every authenticated request.
// Skips: /api/tenant/login, /api/tenant/register, /api/superadmin/*
const tenantMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const open = [
    '/api/tenant/login', '/api/tenant/register',
    '/api/superadmin',   '/api/admin/',           // superadmin & admin diagnostic endpoints
    '/api/health', '/api/ping', '/api/public/',
    '/api/auth/2fa/',                             // 2FA endpoints use their own auth
  ];
  if (open.some(p => req.path.startsWith(p)) || !req.path.startsWith('/api/')) {
    return next();
  }

  const token = req.headers.authorization?.replace('Bearer ', '') ||
                (req.query.token as string);

  if (!token) {
    // Legacy single-tenant mode: no token = use default tenant
    req.tenantId = process.env.DEFAULT_TENANT_ID || 'default';
    return next();
  }

  const payload = verifyToken(token);
  if (!payload?.tenantId) {
    return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }

  req.tenantId = payload.tenantId;
  req.tenant   = tenantCache.get(payload.tenantId);
  next();
};

interface DbConfig {
  uri?: string;
  host?: string;
  port?: number;
  user: string;
  password?: string;
  database: string;
  waitForConnections: boolean;
  connectionLimit: number;
  queueLimit: number;
  connectTimeout: number;
  enableKeepAlive: boolean;
  keepAliveInitialDelay: number;
  socketPath?: string;
  ssl?: { rejectUnauthorized: boolean };
}

const isValidUrl = (url: string | undefined): boolean => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('${{')) return false; // Ignore placeholders
  try {
    return trimmed.includes('://');
  } catch {
    return false;
  }
};

const getDbConfig = (): DbConfig => {
  const rawUrl = process.env.DATABASE_URL || process.env.MYSQL_URL;
  const dbUrl = isValidUrl(rawUrl) ? rawUrl!.trim() : null;

  if (dbUrl) {
    const sanitizedUrl = dbUrl.replace(/:([^:@]+)@/, ':****@');
    console.log(`[SYSTEM] Using Database URL: ${sanitizedUrl}`);

    let host = 'unknown';
    let user = 'unknown';
    let database = 'railway';
    try {
      const match = dbUrl.match(/mysql:\/\/([^:]+):?([^@]+)?@([^:/]+):?(\d+)?\/(.+)/);
      if (match) {
        user = match[1];
        host = match[3];
        database = match[5].split('?')[0];
      }
    } catch (e) {}

    return {
      uri: dbUrl,
      host,
      user,
      database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 30000, // Increased timeout for slow connections
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      ssl: dbUrl.includes('sslmode=') ? { rejectUnauthorized: false } : undefined
    } as any;
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'railway',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 30000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
  };
};

let activeDbConfig = getDbConfig();
let pool: Pool | null = null;
let dbHealthy = false;
let dbError: any = null;
let inMemoryDb: any = null;
let lastUpdatedCache: number = 0;
let syncResponseCache: string | null = null;
let isWarmingUp = false;
let warmupPromise: Promise<any> | null = null;
let lastReconnectAttempt = 0;
const RECONNECT_INTERVAL = 60000; // 1 minute

async function loadLatestBackup() {
  try {
    if (!(await fs.pathExists(BACKUP_DIR))) return null;
    const files = await fs.readdir(BACKUP_DIR);
    const backups = files.filter(f => f.startsWith('backup-') && f.endsWith('.json')).sort();
    if (backups.length > 0) {
      const latest = backups[backups.length - 1];
      console.log(`[SYSTEM] Loading latest state from backup: ${latest}`);
      return await fs.readJson(path.join(BACKUP_DIR, latest));
    }
  } catch (err) {
    console.error('[SYSTEM] Failed to load latest backup:', err);
  }
  return null;
}

const getInitialData = () => ({
  products: [], sales: [], purchases: [], vendorOrders: [], quotations: [], payments: [], expenses: [],
  offers: [], commissionRules: [], users: [{ 
    id: '1', name: 'Administrator', role: 'Admin', email: 'admin@royal.com', password: 'admin', 
    status: 'Active', baseSalary: 50000,
    permissions: { canViewDashboard: true, canManageInventory: true, canManageSales: true, canViewReports: true, canManageUsers: true, canViewCredits: true, canManageCustomers: true, canManageReturns: true, canManageGallery: true }
  }],
  customers: [], activityLogs: [], advances: [], payrollRecords: [], returns: [], galleryLeads: [],
  loadingCharges: [],
  settings: {
    showroomName: 'ROYAL TILES & GRANITES',
    systemBranding: 'ROYAL ERP',
    showroomAddress: 'Near NIrani Sugaras Royal Plaza, Main Tile Market',
    showroomCity: 'Mudhol',
    showroomPhone: '+91 98765 43210',
    showroomGst: '29RTX1029384Z5',
    showroomDescription: "Luxury architectural surfaces.",
    galleryTitle: 'Royal Gallery',
    gallerySubTitle: 'Live Inventory',
    customInvoiceFieldLabels: ['Vehicle Number', 'Site Engineer'],
    backendUrl: '',
    backupFrequency: '15min', // '15min', '1hour', 'daily'
    lastUpdated: Date.now()
  }
});

async function initDatabase(config: DbConfig = activeDbConfig) {
  try {
    // Re-check env vars in case they were set after initial load
    const rawUrl = process.env.DATABASE_URL || process.env.MYSQL_URL;
    
    if (rawUrl) {
      console.log("[DEBUG] initDatabase found rawUrl (masked):", rawUrl.substring(0, 10) + "...");
    } else {
      console.warn("[DEBUG] initDatabase: rawUrl is Undefined. Checking config object...");
    }

    const connectionString = isValidUrl(rawUrl) ? rawUrl!.trim() : (config.uri ? config.uri : null);
    const isUsingUrl = !!connectionString;
    
    let target = '';
    if (isUsingUrl) {
      const sanitized = connectionString!.replace(/:([^:@]+)@/, ':****@');
      target = `URL(${sanitized})`;
    } else {
      target = config.socketPath ? `socket:${config.socketPath}` : `${config.host}:${config.port}`;
    }
    
    console.log(`[SYSTEM] Handshaking with MySQL Node: ${target}`);
    
    if (pool) {
      await pool.end().catch(() => {});
    }
    
    // First connect without database to create it if it doesn't exist
    if (!isUsingUrl && config.database) {
      const { database, ...configWithoutDb } = config;
      const tempPool = mysql.createPool(configWithoutDb);
      const tempConn = await tempPool.getConnection();
      await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
      tempConn.release();
      await tempPool.end();
    }
    
    // Now create the actual pool with the database
    if (isUsingUrl) {
      console.log('[DEBUG] Creating pool from connection string...');
      pool = mysql.createPool(connectionString!);
    } else {
      console.log('[DEBUG] Creating pool from config object...');
      pool = mysql.createPool(config);
    }
    
    // Add pool error handler to catch disconnects
    (pool as any).on('error', (err: any) => {
      console.error('⚠️ [POOL ERROR]:', err.message);
      dbHealthy = false;
      dbError = { message: err.message, code: err.code };
    });

    const connection = await pool.getConnection();
    console.log(`✅ [ENGINE] Persistence pool established.`);
    
    // ── Create tenants table first (multi-tenant) ──────────────────────────
    await connection.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id           VARCHAR(64) PRIMARY KEY,
        name         VARCHAR(255) NOT NULL,
        slug         VARCHAR(64) UNIQUE NOT NULL,
        owner_email  VARCHAR(255) NOT NULL,
        owner_phone  VARCHAR(20),
        address      TEXT,
        gst          VARCHAR(20),
        plan         VARCHAR(20) DEFAULT 'standard',
        status       VARCHAR(20) DEFAULT 'active',
        settings     JSON,
        created_at   BIGINT,
        updated_at   BIGINT
      )
    `);

    // ── Add tenant_id to existing tables (safe — skips if already exists) ──
    // Uses INFORMATION_SCHEMA check — works on ALL MySQL versions (5.6, 5.7, 8.x)
    const safeAddTenantId = async (table: string) => {
      try {
        const dbName = (activeDbConfig.database || 'royal_erp');
        const [rows]: any = await connection.query(
          'SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',
          [dbName, table, 'tenant_id']
        );
        if (rows[0].cnt === 0) {
          await connection.query(
            'ALTER TABLE `' + table + '` ADD COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT \'default\''
          );
          console.log('[SCHEMA] Added tenant_id to ' + table);
        }
      } catch (e: any) {
        console.warn('[SCHEMA] tenant_id on ' + table + ': ' + (e as any).message);
      }
    };

    await connection.query(`
      CREATE TABLE IF NOT EXISTS system_persistence (
        id VARCHAR(50) PRIMARY KEY,
        payload LONGTEXT,
        updated_at BIGINT
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS products (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255),
        category VARCHAR(100),
        brand VARCHAR(100),
        stock_boxes INT DEFAULT 0,
        stock_loose INT DEFAULT 0,
        selling_price DECIMAL(10, 2),
        status VARCHAR(20),
        data JSON,
        updated_at BIGINT,
        INDEX idx_updated_at (updated_at),
        INDEX idx_category (category),
        INDEX idx_brand (brand),
        INDEX idx_status (status),
        INDEX idx_status_updated (status, updated_at),
        INDEX idx_status_category_updated (status, category, updated_at),
        INDEX idx_status_brand_updated (status, brand, updated_at),
        INDEX idx_status_cat_brand_updated (status, category, brand, updated_at)
      )
    `);

    // Ensure indexes and virtual columns exist for existing tables
    try {
      const [columns]: any = await connection.query('SHOW COLUMNS FROM products');
      const columnNames = columns.map((c: any) => c.Field);
      
      if (!columnNames.includes('size')) {
        await connection.query('ALTER TABLE products ADD COLUMN size VARCHAR(50) AS (data->>"$.size") VIRTUAL');
      }
      if (!columnNames.includes('grade')) {
        await connection.query('ALTER TABLE products ADD COLUMN grade VARCHAR(50) AS (data->>"$.grade") VIRTUAL');
      }
      if (!columnNames.includes('shade_no')) {
        await connection.query('ALTER TABLE products ADD COLUMN shade_no VARCHAR(50) AS (data->>"$.shadeNo") VIRTUAL');
      }
      if (!columnNames.includes('batch_no')) {
        await connection.query('ALTER TABLE products ADD COLUMN batch_no VARCHAR(50) AS (data->>"$.batchNo") VIRTUAL');
      }

      const [indexes]: any = await connection.query('SHOW INDEX FROM products');
      const indexNames = indexes.map((idx: any) => idx.Key_name);
      
      if (!indexNames.includes('idx_updated_at')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_updated_at (updated_at)');
      }
      if (!indexNames.includes('idx_category')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_category (category)');
      }
      if (!indexNames.includes('idx_brand')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_brand (brand)');
      }
      if (!indexNames.includes('idx_status')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_status (status)');
      }
      if (!indexNames.includes('idx_status_updated')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_status_updated (status, updated_at)');
      }
      if (!indexNames.includes('idx_status_category_updated')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_status_category_updated (status, category, updated_at)');
      }
      if (!indexNames.includes('idx_status_brand_updated')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_status_brand_updated (status, brand, updated_at)');
      }
      if (!indexNames.includes('idx_status_cat_brand_updated')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_status_cat_brand_updated (status, category, brand, updated_at)');
      }
      if (!indexNames.includes('idx_size')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_size (size)');
      }
      if (!indexNames.includes('idx_grade')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_grade (grade)');
      }
      if (!indexNames.includes('idx_shade_no')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_shade_no (shade_no)');
      }
      if (!indexNames.includes('idx_batch_no')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_batch_no (batch_no)');
      }
      console.log('✅ [DB] Database schema and indexes verified.');
    } catch (e) {
      console.error('⚠️ [DB] Error adding indexes/columns:', e);
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS sales (
        id VARCHAR(50) PRIMARY KEY,
        invoice_no VARCHAR(50),
        customer_name VARCHAR(255),
        date VARCHAR(20),
        total_amount DECIMAL(10, 2),
        data JSON,
        updated_at BIGINT,
        INDEX idx_sales_date (date),
        INDEX idx_sales_updated_at (updated_at)
      )
    `);

    // Ensure indexes exist for sales
    try {
      const [indexes]: any = await connection.query('SHOW INDEX FROM sales');
      const indexNames = indexes.map((idx: any) => idx.Key_name);
      if (!indexNames.includes('idx_sales_date')) {
        await connection.query('ALTER TABLE sales ADD INDEX idx_sales_date (date)');
      }
      if (!indexNames.includes('idx_sales_updated_at')) {
        await connection.query('ALTER TABLE sales ADD INDEX idx_sales_updated_at (updated_at)');
      }
    } catch (e) {}

    await connection.query(`
      CREATE TABLE IF NOT EXISTS purchases (
        id VARCHAR(50) PRIMARY KEY,
        vendor_name VARCHAR(255),
        invoice_no VARCHAR(50),
        date VARCHAR(20),
        data JSON,
        updated_at BIGINT,
        INDEX idx_purchases_date (date),
        INDEX idx_purchases_updated_at (updated_at)
      )
    `);

    // Ensure indexes exist for purchases
    try {
      const [indexes]: any = await connection.query('SHOW INDEX FROM purchases');
      const indexNames = indexes.map((idx: any) => idx.Key_name);
      if (!indexNames.includes('idx_purchases_date')) {
        await connection.query('ALTER TABLE purchases ADD INDEX idx_purchases_date (date)');
      }
      if (!indexNames.includes('idx_purchases_updated_at')) {
        await connection.query('ALTER TABLE purchases ADD INDEX idx_purchases_updated_at (updated_at)');
      }
    } catch (e) {}

    await connection.query(`
      CREATE TABLE IF NOT EXISTS vendor_orders (
        id VARCHAR(50) PRIMARY KEY,
        order_no VARCHAR(50),
        vendor_name VARCHAR(255),
        status VARCHAR(50),
        payment_status VARCHAR(50),
        data JSON,
        updated_at BIGINT
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS gallery_leads (
        id VARCHAR(50) PRIMARY KEY,
        customer_name VARCHAR(255),
        customer_mobile VARCHAR(20),
        status VARCHAR(50),
        timestamp VARCHAR(50),
        data JSON,
        updated_at BIGINT,
        INDEX idx_leads_timestamp (timestamp),
        INDEX idx_leads_updated_at (updated_at)
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS loading_charges (
        id VARCHAR(50) PRIMARY KEY,
        product_type VARCHAR(255),
        unit_type VARCHAR(50),
        rate DECIMAL(10, 2),
        per_unit INT,
        is_active BOOLEAN DEFAULT TRUE,
        updated_at BIGINT
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255),
        role VARCHAR(50),
        status VARCHAR(20),
        data JSON,
        updated_at BIGINT,
        INDEX idx_users_updated_at (updated_at),
        INDEX idx_users_email (email)
      )
    `);

    // Ensure updated_at exists in all tables (for existing databases)
    const tables = ['products', 'sales', 'purchases', 'vendor_orders', 'system_persistence', 'loading_charges', 'gallery_leads', 'users'];
    for (const table of tables) {
      try {
        const dbName = (activeDbConfig.database || 'royal_erp');
        const [colRows]: any = await connection.query(
          'SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME="updated_at"',
          [dbName, table]
        );
        if (colRows[0].cnt === 0) {
          await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN updated_at BIGINT DEFAULT 0`);
        }
      } catch (err) { /* column already exists or table not yet created */ }
    }
    
    // ── Add tenant_id column to all tables that need it ─────────────────────
    await safeAddTenantId('system_persistence');
    await safeAddTenantId('products');
    await safeAddTenantId('sales');
    await safeAddTenantId('purchases');
    await safeAddTenantId('vendor_orders');
    await safeAddTenantId('gallery_leads');
    await safeAddTenantId('loading_charges');
    await safeAddTenantId('users');

    // ── Create indexes for fast per-tenant queries ────────────────────────
    const tableIndexes: [string, string][] = [
      ['products','idx_products_tenant'],
      ['sales','idx_sales_tenant'],
      ['users','idx_users_tenant'],
      ['system_persistence','idx_persistence_tenant'],
    ];
    for (const [table, idxName] of tableIndexes) {
      try {
        const [rows]: any = await connection.query(
          'SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?',
          [table, idxName]
        );
        if (rows[0].cnt === 0) {
          await connection.query(`CREATE INDEX \`${idxName}\` ON \`${table}\`(tenant_id)`);
        }
      } catch { /* index may already exist */ }
    }

    // Ensure default admin user exists
    const [userCountRows]: any = await connection.query('SELECT COUNT(*) as count FROM users');
    if (userCountRows[0].count === 0) {
      console.log('💡 [SYSTEM] No users found. Provisioning default Administrator node...');
      const defaultAdmin = getInitialData().users[0];
      await connection.query(
        'INSERT INTO users (id, name, email, role, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [defaultAdmin.id, defaultAdmin.name, defaultAdmin.email, defaultAdmin.role, defaultAdmin.status, JSON.stringify(defaultAdmin), Date.now()]
      );
    }
    
    connection.release();
    dbHealthy = true;
    dbError = null;
    return true;
  } catch (err: any) {
    if (err.code === 'ENOENT' && config.socketPath && process.env.DB_HOST) {
      console.log('⚠️ [SYSTEM] Socket not found. Falling back to TCP/IP...');
      const tcpConfig = { ...config };
      delete tcpConfig.socketPath;
      tcpConfig.host = process.env.DB_HOST;
      tcpConfig.port = parseInt(process.env.DB_PORT || '3306');
      
      // Update active config to persist the working connection method
      activeDbConfig = tcpConfig;
      return initDatabase(tcpConfig);
    }

    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      console.log('⚠️ [SYSTEM] Database unreachable. Starting in OFFLINE MODE (In-Memory).');
      dbHealthy = false;
      dbError = { message: 'Offline Mode (No DB Connection)', code: 'OFFLINE' };
      if (!inMemoryDb) inMemoryDb = getInitialData();
      return false;
    }

    dbHealthy = false;
    dbError = {
      message: err.message,
      code: err.code,
      errno: err.errno,
      sqlState: err.sqlState,
      hint: err.code === 'ECONNREFUSED' ? 'Check if Cloud SQL Proxy is running on port 3306' : 
            err.code === 'ETIMEDOUT' ? 'Database unreachable. Check Firewall/VPC Peering or Authorized Networks.' :
            err.code === 'ER_ACCESS_DENIED_ERROR' ? 'Check DB_USER and DB_PASSWORD' : 'Verify GCP Authorized Networks'
    };
    console.error('❌ [DATABASE ERROR]:', dbError.message);
    if (err.code === 'ETIMEDOUT') {
      console.log('💡 [HINT]: If using Cloud SQL Public IP, add 0.0.0.0/0 to Authorized Networks for testing.');
    }
    console.log('⚠️ [SYSTEM] Falling back to in-memory database.');
    return false;
  }
}

async function startServer() {
  const app = express();
  // Using top-level PORT constant

  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma'],
    credentials: true
  }));
  app.use(compression());
  app.use(bodyParser.json({ limit: '100mb' }));

  // ── TENANT ISOLATION MIDDLEWARE ───────────────────────────────────────────
  // MUST be registered here — reads JWT from Authorization header,
  // sets req.tenantId on every request so all handlers are tenant-scoped
  app.use(tenantMiddleware);

  app.use((req, res, next) => {
    // Add health headers
    res.setHeader('X-System-Persistence', dbHealthy ? 'Relational (Healthy)' : 'In-Memory (Offline)');
    if (dbError) {
      res.setHeader('X-DB-Error', typeof dbError === 'object' ? dbError.message : String(dbError));
    }
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Host: ${req.headers.host}`);
    next();
  });

  // System Boot
  console.log('[SYSTEM] Initializing persistence layer...');
  
  // Initialize with empty data immediately so we can start listening
  inMemoryDb = getInitialData();
  lastUpdatedCache = inMemoryDb.lastUpdated || 0;

  // Load backup and initialize DB in background
  (async () => {
    try {
      const backup = await loadLatestBackup();
      if (backup) {
        console.log('✅ [SYSTEM] Backup loaded into memory.');
        inMemoryDb = backup;
        lastUpdatedCache = inMemoryDb.lastUpdated || 0;
        // Invalidate sync cache since we have new data
        syncResponseCache = null;
      }
    } catch (err) {
      console.error('❌ [SYSTEM] Failed to load backup:', err);
    }

    const dbSuccess = await initDatabase();
    if (dbSuccess) {
      console.log('✅ [SYSTEM] Database connected. Starting background cache warmup...');
      warmupPromise = readFromDb();
      try {
        await warmupPromise;
        console.log('✅ [SYSTEM] Cache warmed successfully from DB');
      } catch (err: any) {
        console.error('❌ [SYSTEM] Cache warmup failed:', err.message);
      }
    } else {
      console.log('⚠️ [SYSTEM] Database unreachable. Running in Backup-Only mode.');
    }
  })();

  async function readFromDb() {
    // If we are already warming up, return the existing promise
    if (isWarmingUp && warmupPromise) return warmupPromise;

    // If we have a healthy cache and it's recently updated, return it
    if (inMemoryDb && dbHealthy && pool && !isWarmingUp && lastUpdatedCache > 0) {
      return inMemoryDb;
    }

    if (!dbHealthy || !pool) {
      const now = Date.now();
      if (now - lastReconnectAttempt > RECONNECT_INTERVAL) {
        lastReconnectAttempt = now;
        console.log('[SYSTEM] Attempting background DB reconnection...');
        initDatabase().catch(err => console.error('[RECONNECT FAULT]', err.message));
      }
      return inMemoryDb || getInitialData();
    }
  
  isWarmingUp = true;
  const startTime = Date.now();
  
  warmupPromise = (async () => {
    try {
      console.log('[DB] Starting full data fetch...');
      
      // Fetch all relational data in parallel for speed
      const [
        [metaRows],
        [productsRows],
        [salesRows],
        [purchasesRows],
        [vendorOrdersRows],
        [loadingChargesRows],
        [galleryLeadsRows],
        [usersRows]
      ]: any = await Promise.all([
        pool.query('SELECT payload FROM system_persistence WHERE id = "global_master" AND (tenant_id IS NULL OR tenant_id = "" OR tenant_id = "default") ORDER BY updated_at DESC LIMIT 1'),
        pool.query('SELECT id, name, category, brand, stock_boxes, stock_loose, selling_price, status, data, updated_at FROM products WHERE (tenant_id IS NULL OR tenant_id = "" OR tenant_id = "default")'),
        pool.query('SELECT id, invoice_no, customer_name, date, total_amount, data, updated_at FROM sales WHERE (tenant_id IS NULL OR tenant_id = "" OR tenant_id = "default")'),
        pool.query('SELECT id, vendor_name, invoice_no, date, data, updated_at FROM purchases WHERE (tenant_id IS NULL OR tenant_id = "" OR tenant_id = "default")'),
        pool.query('SELECT id, order_no, vendor_name, status, payment_status, data, updated_at FROM vendor_orders WHERE (tenant_id IS NULL OR tenant_id = "" OR tenant_id = "default")'),
        pool.query('SELECT id, product_type, unit_type, rate, per_unit, is_active, updated_at FROM loading_charges WHERE (tenant_id IS NULL OR tenant_id = "" OR tenant_id = "default")'),
        pool.query('SELECT id, customer_name, customer_mobile, status, `timestamp`, data, updated_at FROM gallery_leads WHERE (tenant_id IS NULL OR tenant_id = "" OR tenant_id = "default")'),
        pool.query('SELECT id, name, email, role, status, data, updated_at FROM users WHERE (tenant_id IS NULL OR tenant_id = "" OR tenant_id = "default")')
      ]);

      let baseData = metaRows.length > 0 ? JSON.parse(metaRows[0].payload) : getInitialData();

      // Optimize mapping: Only parse JSON if necessary and use a single pass
      const products = productsRows.map((p: any) => ({ 
        ...parseData(p.data), 
        id: p.id, name: p.name, category: p.category, brand: p.brand, 
        stockBoxes: p.stock_boxes, stockLoose: p.stock_loose, 
        sellingPrice: parseFloat(p.selling_price), status: p.status,
        updatedAt: p.updated_at
      }));

      const sales = salesRows.map((s: any) => ({ 
        ...parseData(s.data), 
        id: s.id, invoiceNo: s.invoice_no, customerName: s.customer_name, 
        date: s.date, totalAmount: parseFloat(s.total_amount),
        updatedAt: s.updated_at
      }));
      
      const purchases = purchasesRows.map((p: any) => ({ 
        ...parseData(p.data), 
        id: p.id, vendorName: p.vendor_name, gstInvoiceNo: p.invoice_no, date: p.date,
        updatedAt: p.updated_at
      }));
      
      const vendorOrders = vendorOrdersRows.map((o: any) => ({ 
        ...parseData(o.data), 
        id: o.id, orderNo: o.order_no, vendorName: o.vendor_name, 
        status: o.status, paymentStatus: o.payment_status,
        updatedAt: o.updated_at
      }));

      const loadingCharges = loadingChargesRows.map((l: any) => ({
        id: l.id,
        productType: l.product_type,
        unitType: l.unit_type,
        rate: parseFloat(l.rate),
        perUnit: l.per_unit,
        isActive: !!l.is_active,
        updatedAt: l.updated_at
      }));

      const galleryLeads = galleryLeadsRows.map((l: any) => ({
        ...parseData(l.data),
        id: l.id,
        customerName: l.customer_name,
        customerMobile: l.customer_mobile,
        status: l.status,
        timestamp: l.timestamp,
        updatedAt: l.updated_at
      }));

      const users = usersRows.map((u: any) => ({
        ...parseData(u.data),
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
        updatedAt: u.updated_at
      }));

      // Calculate global lastUpdated efficiently
      let maxTs = baseData.lastUpdated || 0;
      productsRows.forEach((p: any) => { if (p.updated_at > maxTs) maxTs = p.updated_at; });
      salesRows.forEach((s: any) => { if (s.updated_at > maxTs) maxTs = s.updated_at; });
      purchasesRows.forEach((p: any) => { if (p.updated_at > maxTs) maxTs = p.updated_at; });
      vendorOrdersRows.forEach((o: any) => { if (o.updated_at > maxTs) maxTs = o.updated_at; });
      loadingChargesRows.forEach((l: any) => { if (l.updated_at > maxTs) maxTs = l.updated_at; });
      galleryLeadsRows.forEach((l: any) => { if (l.updated_at > maxTs) maxTs = l.updated_at; });
      usersRows.forEach((u: any) => { if (u.updated_at > maxTs) maxTs = u.updated_at; });

      const dbData = {
        ...baseData,
        lastUpdated: maxTs,
        products,
        sales,
        purchases,
        vendorOrders,
        loadingCharges,
        galleryLeads,
        users
      };

      // Recovery Check: If in-memory data is newer, it means we had offline writes.
      if (inMemoryDb && inMemoryDb.lastUpdated > (dbData.lastUpdated || 0)) {
        console.log(`[RECOVERY] In-memory data (v${inMemoryDb.lastUpdated}) is newer than DB (v${dbData.lastUpdated}).`);
        const recoveryData = { ...inMemoryDb };
        syncInMemoryToRelationalDb(recoveryData).catch(err => console.error('[RECOVERY SYNC FAILED]', err.message));
        isWarmingUp = false;
        warmupPromise = null;
        return recoveryData;
      }

      inMemoryDb = dbData;
      lastUpdatedCache = dbData.lastUpdated;
      
      // Pre-populate sync cache for full syncs
      const prunedData = { ...dbData };
      if (prunedData.activityLogs && prunedData.activityLogs.length > 200) {
        prunedData.activityLogs = prunedData.activityLogs.slice(0, 200);
      }
      syncResponseCache = JSON.stringify({
        ...prunedData,
        _metadata: {
          db_healthy: dbHealthy,
          is_fallback: !dbHealthy,
          is_warming_up: false,
          timestamp: Date.now()
        }
      });
      
      console.log(`[DB] Fetch completed in ${Date.now() - startTime}ms. Total Sales: ${sales.length}`);
      isWarmingUp = false;
      warmupPromise = null;
      return dbData;
    } catch (err: any) {
      console.error('[READ FAULT]', err.message);
      dbHealthy = false;
      isWarmingUp = false;
      warmupPromise = null;
      return inMemoryDb || getInitialData();
    }
  })();
  
  return warmupPromise;
}

async function writeToDb(data: any) {
  // Merge meta-data into inMemoryDb cache to avoid overwriting relational data
  if (!inMemoryDb) inMemoryDb = getInitialData();
  inMemoryDb = { ...inMemoryDb, ...data };

  if (!dbHealthy || !pool) {
    return;
  }

  try {
    // CRITICAL: Always save the FULL meta-data state from inMemoryDb to prevent partial overwrites
    // We exclude relational tables that have their own dedicated tables
    const { products, sales, purchases, vendorOrders, loadingCharges, galleryLeads, users, ...metaData } = inMemoryDb;
    const jsonStr = JSON.stringify(metaData);
    const now = Date.now();
    await pool.query(
      'INSERT INTO system_persistence (id, tenant_id, payload, updated_at) VALUES ("global_master", "default", ?, ?) ON DUPLICATE KEY UPDATE payload = ?, updated_at = ?',
      [jsonStr, now, jsonStr, now]
    );
    
    // Invalidate sync cache whenever we write to DB
    syncResponseCache = null;
  } catch (err: any) {
    console.error('[WRITE FAULT]', err.message);
    dbHealthy = false;
  }
}

async function syncInMemoryToRelationalDb(data: any) {
  if (!pool || !dbHealthy) return;
  
  try {
    console.log('[SYSTEM] Syncing relational data from memory to DB (Optimized)...');
    
    // 1. Meta data
    const { products, sales, purchases, vendorOrders, loadingCharges, galleryLeads, users, ...metaData } = data;
    await writeToDb(metaData);

    // 2. Products (Bulk)
    if (data.products && data.products.length > 0) {
      const values = data.products.map((p: any) => [
        p.id, p.name, p.category, p.brand, p.stockBoxes, p.stockLoose, p.sellingPrice, p.status, JSON.stringify(p), Date.now()
      ]);
      await pool.query(
        'INSERT INTO products (id, name, category, brand, stock_boxes, stock_loose, selling_price, status, data, updated_at) VALUES ? ON DUPLICATE KEY UPDATE name=VALUES(name), category=VALUES(category), brand=VALUES(brand), stock_boxes=VALUES(stock_boxes), stock_loose=VALUES(stock_loose), selling_price=VALUES(selling_price), status=VALUES(status), data=VALUES(data), updated_at=VALUES(updated_at)',
        [values]
      );
    }

    // 3. Sales (Bulk)
    if (data.sales && data.sales.length > 0) {
      const values = data.sales.map((s: any) => [
        s.id, s.invoiceNo, s.customerName, s.date, s.totalAmount, JSON.stringify(s), Date.now()
      ]);
      await pool.query(
        'INSERT INTO sales (id, invoice_no, customer_name, date, total_amount, data, updated_at) VALUES ? ON DUPLICATE KEY UPDATE invoice_no=VALUES(invoice_no), customer_name=VALUES(customer_name), date=VALUES(date), total_amount=VALUES(total_amount), data=VALUES(data), updated_at=VALUES(updated_at)',
        [values]
      );
    }

    // 4. Purchases (Bulk)
    if (data.purchases && data.purchases.length > 0) {
      const values = data.purchases.map((p: any) => [
        p.id, p.vendorName, p.gstInvoiceNo, p.date, JSON.stringify(p), Date.now()
      ]);
      await pool.query(
        'INSERT INTO purchases (id, vendor_name, invoice_no, date, data, updated_at) VALUES ? ON DUPLICATE KEY UPDATE vendor_name=VALUES(vendor_name), invoice_no=VALUES(invoice_no), date=VALUES(date), data=VALUES(data), updated_at=VALUES(updated_at)',
        [values]
      );
    }

    // 5. Loading Charges (Bulk)
    if (data.loadingCharges && data.loadingCharges.length > 0) {
      const values = data.loadingCharges.map((l: any) => [
        l.id, l.productType, l.unitType, l.rate, l.perUnit, l.isActive ? 1 : 0, Date.now()
      ]);
      await pool.query(
        'INSERT INTO loading_charges (id, product_type, unit_type, rate, per_unit, is_active, updated_at) VALUES ? ON DUPLICATE KEY UPDATE product_type=VALUES(product_type), unit_type=VALUES(unit_type), rate=VALUES(rate), per_unit=VALUES(per_unit), is_active=VALUES(is_active), updated_at=VALUES(updated_at)',
        [values]
      );
    }

    // 5. Vendor Orders (Bulk)
    if (data.vendorOrders && data.vendorOrders.length > 0) {
      const values = data.vendorOrders.map((o: any) => [
        o.id, o.orderNo, o.vendorName, o.status, o.paymentStatus, JSON.stringify(o), Date.now()
      ]);
      await pool.query(
        'INSERT INTO vendor_orders (id, order_no, vendor_name, status, payment_status, data, updated_at) VALUES ? ON DUPLICATE KEY UPDATE order_no=VALUES(order_no), vendor_name=VALUES(vendor_name), status=VALUES(status), payment_status=VALUES(payment_status), data=VALUES(data), updated_at=VALUES(updated_at)',
        [values]
      );
    }

    // 6. Gallery Leads (Bulk)
    if (data.galleryLeads && data.galleryLeads.length > 0) {
      const values = data.galleryLeads.map((l: any) => [
        l.id, l.customerName, l.customerMobile, l.status, l.timestamp, JSON.stringify(l), Date.now()
      ]);
      await pool.query(
        'INSERT INTO gallery_leads (id, customer_name, customer_mobile, status, `timestamp`, data, updated_at) VALUES ? ON DUPLICATE KEY UPDATE customer_name=VALUES(customer_name), customer_mobile=VALUES(customer_mobile), status=VALUES(status), `timestamp`=VALUES(timestamp), data=VALUES(data), updated_at=VALUES(updated_at)',
        [values]
      );
    }

    // 7. Users (Bulk)
    if (data.users && data.users.length > 0) {
      const values = data.users.map((u: any) => [
        u.id, u.name, u.email, u.role, u.status, JSON.stringify(u), Date.now()
      ]);
      await pool.query(
        'INSERT INTO users (id, name, email, role, status, data, updated_at) VALUES ? ON DUPLICATE KEY UPDATE name=VALUES(name), email=VALUES(email), role=VALUES(role), status=VALUES(status), data=VALUES(data), updated_at=VALUES(updated_at)',
        [values]
      );
    }

    console.log('[SYSTEM] Recovery sync completed successfully.');
  } catch (err: any) {
    console.error('[SYNC FAULT]', err.message);
  }
}

// ... (middleware setup)

  function updateCache(collection: string, item: any, isDelete: boolean = false) {
    if (!inMemoryDb) inMemoryDb = getInitialData();
    if (!inMemoryDb[collection]) inMemoryDb[collection] = [];
    
    const now = Date.now();
    if (isDelete) {
      inMemoryDb[collection] = inMemoryDb[collection].filter((x: any) => x.id !== (typeof item === 'string' ? item : item.id));
    } else {
      const idx = inMemoryDb[collection].findIndex((x: any) => x.id === item.id);
      const itemWithTs = { ...item, updatedAt: now };
      if (idx >= 0) inMemoryDb[collection][idx] = itemWithTs;
      else inMemoryDb[collection].push(itemWithTs);
    }
    inMemoryDb.lastUpdated = now;
    syncResponseCache = null; // Invalidate cache
  }

  // Paginated Endpoints for Large Collections
  app.get('/api/products', async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = (page - 1) * limit;
      const search = req.query.search as string;
      const category = req.query.category as string;
      const brand = req.query.brand as string;
      const size = req.query.size as string;
      const stockStatus = req.query.stockStatus as string;
      const grade = req.query.grade as string;
      const status = req.query.status as string;

      if (!pool || !dbHealthy) {
        // Fallback to in-memory if DB is down
        let all = inMemoryDb?.products || [];
        
        if (search && typeof search === 'string') {
          const words = search.toLowerCase().trim().split(/\s+/);
          all = all.filter((p: any) => 
            words.every(word => 
              (p.name || '').toLowerCase().includes(word) || 
              (p.brand || '').toLowerCase().includes(word) ||
              (p.category || '').toLowerCase().includes(word) ||
              (p.size || '').toLowerCase().includes(word) ||
              (p.shadeNo || '').toLowerCase().includes(word) ||
              (p.batchNo || '').toLowerCase().includes(word)
            )
          );
        }
        if (category && category !== 'All') all = all.filter((p: any) => p.category === category);
        if (brand && brand !== 'All') all = all.filter((p: any) => p.brand === brand);
        if (size && size !== 'All') all = all.filter((p: any) => p.size === size);
        if (grade && grade !== 'All') all = all.filter((p: any) => p.grade === grade);
        if (status && status !== 'All') all = all.filter((p: any) => p.status === status);
        
        if (stockStatus === 'Low') all = all.filter((p: any) => p.stockBoxes <= (p.reorderLevel || 0));
        else if (stockStatus === 'Out') all = all.filter((p: any) => p.stockBoxes <= 0);
        else if (stockStatus === 'In') all = all.filter((p: any) => p.stockBoxes > 0);

        return res.json({ 
          data: all.slice(offset, offset + limit),
          total: all.length,
          page,
          limit
        });
      }

      let query = 'SELECT id, name, category, brand, stock_boxes, stock_loose, selling_price, status, data, updated_at FROM products WHERE 1=1';
      let countQuery = 'SELECT COUNT(*) as count FROM products WHERE 1=1';
      const params: any[] = [];

      if (search && typeof search === 'string') {
        const words = search.trim().split(/\s+/);
        for (const word of words) {
          const searchClause = ' AND (name LIKE ? OR brand LIKE ? OR category LIKE ? OR size LIKE ? OR shade_no LIKE ? OR batch_no LIKE ?)';
          query += searchClause;
          countQuery += searchClause;
          const searchParam = `%${word}%`;
          params.push(searchParam, searchParam, searchParam, searchParam, searchParam, searchParam);
        }
      }

      if (category && category !== 'All') {
        query += ' AND category = ?';
        countQuery += ' AND category = ?';
        params.push(category);
      }
      if (brand && brand !== 'All') {
        query += ' AND brand = ?';
        countQuery += ' AND brand = ?';
        params.push(brand);
      }
      if (size && size !== 'All') {
        query += ' AND (size = ? OR size LIKE ?)';
        countQuery += ' AND (size = ? OR size LIKE ?)';
        params.push(size, size);
      }
      if (grade && grade !== 'All') {
        query += ' AND (grade = ? OR grade LIKE ?)';
        countQuery += ' AND (grade = ? OR grade LIKE ?)';
        params.push(grade, grade);
      }
      if (status && status !== 'All') {
        query += ' AND status = ?';
        countQuery += ' AND status = ?';
        params.push(status);
      }
      if (stockStatus === 'Low') {
        query += ' AND stock_boxes <= CAST(COALESCE(data->>"$.reorderLevel", "0") AS UNSIGNED)';
        countQuery += ' AND stock_boxes <= CAST(COALESCE(data->>"$.reorderLevel", "0") AS UNSIGNED)';
      } else if (stockStatus === 'Out') {
        query += ' AND stock_boxes <= 0';
        countQuery += ' AND stock_boxes <= 0';
      } else if (stockStatus === 'In') {
        query += ' AND stock_boxes > 0';
        countQuery += ' AND stock_boxes > 0';
      }

      query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
      const queryParams = [...params, limit, offset];

      const conn = await pool.getConnection();
      try {
        // Increase sort buffer for this session to handle large sorts
        await conn.query('SET SESSION sort_buffer_size = 33554432'); // 32MB
        const [rows]: any = await conn.query(query, queryParams);
        const [[{ count }]]: any = await conn.query(countQuery, params);

        res.json({
          data: rows.map((p: any) => {
            let parsedData = {};
            try {
              if (p.data) {
                parsedData = typeof p.data === 'string' ? JSON.parse(p.data) : p.data;
              }
            } catch (e) {
              console.error('Error parsing product data:', e);
            }
            
            return {
              ...parsedData,
              id: p.id,
              name: p.name,
              category: p.category,
              brand: p.brand,
              stockBoxes: p.stock_boxes,
              stockLoose: p.stock_loose,
              sellingPrice: parseFloat(p.selling_price),
              status: p.status,
              updated_at: p.updated_at
            };
          }),
          total: count,
          page,
          limit
        });
      } finally {
        conn.release();
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/products/filters', async (req: Request, res: Response) => {
    try {
      if (!pool || !dbHealthy) {
        const products = inMemoryDb?.products || [];
        return res.json({
          brands: Array.from(new Set(products.map((p: any) => p.brand))).filter(Boolean).sort(),
          categories: Array.from(new Set(products.map((p: any) => p.category))).filter(Boolean).sort(),
          sizes: Array.from(new Set(products.map((p: any) => p.size))).filter(Boolean).sort(),
          grades: Array.from(new Set(products.map((p: any) => p.grade))).filter(Boolean).sort()
        });
      }

      const [brandRows]: any = await pool.query('SELECT DISTINCT brand FROM products WHERE brand IS NOT NULL AND brand != "" ORDER BY brand');
      const [categoryRows]: any = await pool.query('SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != "" ORDER BY category');
      const [sizeRows]: any = await pool.query('SELECT DISTINCT size FROM products WHERE size IS NOT NULL AND size != "" ORDER BY size');
      const [gradeRows]: any = await pool.query('SELECT DISTINCT grade FROM products WHERE grade IS NOT NULL AND grade != "" ORDER BY grade');

      res.json({
        brands: brandRows.map((r: any) => r.brand),
        categories: categoryRows.map((r: any) => r.category),
        sizes: sizeRows.map((r: any) => r.size),
        grades: gradeRows.map((r: any) => r.grade)
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/sales', async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = (page - 1) * limit;

      if (!pool || !dbHealthy) {
        const all = inMemoryDb?.sales || [];
        return res.json({ 
          data: all.slice(offset, offset + limit),
          total: all.length,
          page,
          limit
        });
      }

      const conn = await pool.getConnection();
      try {
        await conn.query('SET SESSION sort_buffer_size = 33554432'); // 32MB
        const [rows]: any = await conn.query(
          'SELECT id, invoice_no, customer_name, date, total_amount, data, updated_at FROM sales ORDER BY date DESC LIMIT ? OFFSET ?',
          [limit, offset]
        );
        const [[{ count }]]: any = await conn.query('SELECT COUNT(*) as count FROM sales');

        res.json({
          data: rows.map((s: any) => {
            let parsedData = {};
            try {
              if (s.data) {
                parsedData = typeof s.data === 'string' ? JSON.parse(s.data) : s.data;
              }
            } catch (e) {
              console.error('Error parsing sale data:', e);
            }
            
            return {
              ...parsedData,
              id: s.id,
              invoiceNo: s.invoice_no,
              customerName: s.customer_name,
              date: s.date,
              totalAmount: parseFloat(s.total_amount),
              updated_at: s.updated_at
            };
          }),
          total: count,
          page,
          limit
        });
      } finally {
        conn.release();
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Existing Granular Endpoints

  app.post('/api/products', async (req: Request, res: Response) => {
    const p = req.body;
    updateCache('products', p);  // updates inMemoryDb + invalidates syncResponseCache
    
    if (!pool || !dbHealthy) {
      return res.json({ success: true, mode: 'offline' });
    }

    try {
      const now = Date.now();
      await pool.query(
        'INSERT INTO products (id, name, category, brand, stock_boxes, stock_loose, selling_price, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=?, category=?, brand=?, stock_boxes=?, stock_loose=?, selling_price=?, status=?, data=?, updated_at=?',
        [
          p.id, p.name, p.category, p.brand,
          p.stockBoxes ?? 0, p.stockLoose ?? 0,
          p.sellingPrice ?? 0, p.status ?? 'Active',
          JSON.stringify(p), now,
          // ON DUPLICATE KEY UPDATE:
          p.name, p.category, p.brand,
          p.stockBoxes ?? 0, p.stockLoose ?? 0,
          p.sellingPrice ?? 0, p.status ?? 'Active',
          JSON.stringify(p), now
        ]
      );
      syncResponseCache = null; // ensure next GET /api/products returns fresh data
      res.json({ success: true, id: p.id });
    } catch (e: any) {
      console.error('[PRODUCTS] DB write failed, falling back to memory:', e.message);
      dbHealthy = false;
      res.json({ success: true, mode: 'offline_fallback', id: p.id });
    }
  });

  app.delete('/api/products/:id', async (req: Request, res: Response) => {
    const id = req.params.id;
    updateCache('products', id, true);
    
    if (!pool || !dbHealthy) {
      return res.json({ success: true, mode: 'offline' });
    }

    try {
      await pool.query('DELETE FROM products WHERE id = ?', [id]);
      res.json({ success: true });
    } catch (e: any) {
      dbHealthy = false;
      res.json({ success: true, mode: 'offline_fallback' });
    }
  });

  // GET /api/users — used by login to fetch users without waiting for full sync
  app.get('/api/users', async (req: Request, res: Response) => {
    try {
      let users: any[] = [];
      if (pool && dbHealthy) {
        const [rows]: any = await pool.query(
          'SELECT id, name, email, role, status, data, updated_at FROM users'
        );
        users = rows.map((u: any) => {
          const d = parseData(u.data);
          return {
            id: u.id, name: u.name, email: u.email,
            role: u.role, status: u.status,
            password: d.password || '',
            permissions: d.permissions || {},
            baseSalary: d.baseSalary || 0,
            updatedAt: u.updated_at,
          };
        });
      } else {
        // Fallback to in-memory
        users = (inMemoryDb?.users || []).map((u: any) => ({
          id: u.id, name: u.name, email: u.email, role: u.role,
          status: u.status, password: u.password || '',
          permissions: u.permissions || {}, baseSalary: u.baseSalary || 0,
        }));
      }
      res.json({ users });
    } catch (err: any) {
      console.error('[GET /api/users] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/users', async (req: Request, res: Response) => {
    try {
      const u = req.body;
      const now = Date.now();
      const userWithTs = { ...u, updatedAt: now };
      updateCache('users', userWithTs);
      
      if (pool && dbHealthy) {
        await pool.query(
          'INSERT INTO users (id, name, email, role, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=?, email=?, role=?, status=?, data=?, updated_at=?',
          [
            u.id, u.name, u.email, u.role, u.status, JSON.stringify(userWithTs), now,
            u.name, u.email, u.role, u.status, JSON.stringify(userWithTs), now
          ]
        );
      }
      res.json({ success: true, id: u.id });
    } catch (err: any) {
      console.error(`[USERS] Failed to persist: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/users/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      updateCache('users', id, true);
      
      if (pool && dbHealthy) {
        await pool.query('DELETE FROM users WHERE id = ?', [id]);
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sales', async (req: Request, res: Response) => {
    const s = req.body;
    updateCache('sales', s);
    
    if (!pool || !dbHealthy) {
      return res.json({ success: true, mode: 'offline' });
    }

    try {
      await pool.query(
        'INSERT INTO sales (id, invoice_no, customer_name, date, total_amount, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE invoice_no=?, customer_name=?, date=?, total_amount=?, data=?, updated_at=?',
        [
          s.id, s.invoiceNo, s.customerName, s.date, s.totalAmount, JSON.stringify(s), Date.now(),
          s.invoiceNo, s.customerName, s.date, s.totalAmount, JSON.stringify(s), Date.now()
        ]
      );
      res.json({ success: true });
    } catch (e: any) {
      dbHealthy = false;
      res.json({ success: true, mode: 'offline_fallback' });
    }
  });

  app.post('/api/purchases', async (req: Request, res: Response) => {
    const p = req.body;
    updateCache('purchases', p);
    
    if (!pool || !dbHealthy) {
      return res.json({ success: true, mode: 'offline' });
    }

    try {
      await pool.query(
        'INSERT INTO purchases (id, vendor_name, invoice_no, date, data, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE vendor_name=?, invoice_no=?, date=?, data=?, updated_at=?',
        [
          p.id, p.vendorName, p.gstInvoiceNo, p.date, JSON.stringify(p), Date.now(),
          p.vendorName, p.gstInvoiceNo, p.date, JSON.stringify(p), Date.now()
        ]
      );
      res.json({ success: true });
    } catch (e: any) {
      dbHealthy = false;
      res.json({ success: true, mode: 'offline_fallback' });
    }
  });

  app.post('/api/vendor-orders', async (req: Request, res: Response) => {
    const o = req.body;
    updateCache('vendorOrders', o);
    
    if (!pool || !dbHealthy) {
      return res.json({ success: true, mode: 'offline' });
    }

    try {
      await pool.query(
        'INSERT INTO vendor_orders (id, order_no, vendor_name, status, payment_status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE order_no=?, vendor_name=?, status=?, payment_status=?, data=?, updated_at=?',
        [o.id, o.orderNo, o.vendorName, o.status, o.paymentStatus, JSON.stringify(o), Date.now(), o.orderNo, o.vendorName, o.status, o.paymentStatus, JSON.stringify(o), Date.now()]
      );
      res.json({ success: true });
    } catch (e: any) {
      dbHealthy = false;
      res.json({ success: true, mode: 'offline_fallback' });
    }
  });

  app.get('/api/gallery-leads', async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = (page - 1) * limit;
      const search = req.query.search as string;
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      const isDailyLatest = req.query.dailyLatest === 'true';

      if (!pool || !dbHealthy) {
        let all = inMemoryDb?.galleryLeads || [];
        
        if (isDailyLatest) {
          const d = new Date();
          d.setHours(d.getHours() - 48);
          const threshold = d.toISOString();
          all = all.filter((l: any) => l.timestamp >= threshold);
        } else {
          if (startDate) all = all.filter((l: any) => l.timestamp >= startDate);
          if (endDate) all = all.filter((l: any) => l.timestamp <= endDate + 'T23:59:59');
        }

        if (search) {
          const s = search.toLowerCase();
          all = all.filter((l: any) => 
            l.customerName.toLowerCase().includes(s) || 
            l.customerMobile.includes(s) ||
            l.id.toLowerCase().includes(s)
          );
        }

        all.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        return res.json({
          data: all.slice(offset, offset + limit),
          total: all.length,
          page,
          limit
        });
      }

      let query = 'SELECT id, customer_name, customer_mobile, status, `timestamp`, data, updated_at FROM gallery_leads WHERE 1=1';
      let countQuery = 'SELECT COUNT(*) as count FROM gallery_leads WHERE 1=1';
      const params: any[] = [];

      if (isDailyLatest) {
        // Use a 48-hour window for "Daily Latest" to account for UTC/Local day differences
        const d = new Date();
        d.setHours(d.getHours() - 48);
        const threshold = d.toISOString();
        
        query += ' AND `timestamp` >= ?';
        countQuery += ' AND `timestamp` >= ?';
        params.push(threshold);
      } else {
        if (startDate) {
          query += ' AND `timestamp` >= ?';
          countQuery += ' AND `timestamp` >= ?';
          params.push(startDate);
        }
        if (endDate) {
          query += ' AND `timestamp` <= ?';
          countQuery += ' AND `timestamp` <= ?';
          params.push(`${endDate}T23:59:59`);
        }
      }

      if (search) {
        const s = `%${search}%`;
        query += ' AND (customer_name LIKE ? OR customer_mobile LIKE ? OR id LIKE ?)';
        countQuery += ' AND (customer_name LIKE ? OR customer_mobile LIKE ? OR id LIKE ?)';
        params.push(s, s, s);
      }

      query += ' ORDER BY `timestamp` DESC LIMIT ? OFFSET ?';
      const queryParams = [...params, limit, offset];

      const [rows]: any = await pool.query(query, queryParams);
      const [[{ count }]]: any = await pool.query(countQuery, params);

      res.json({
        data: rows.map((l: any) => ({
          ...parseData(l.data),
          id: l.id,
          customerName: l.customer_name,
          customerMobile: l.customer_mobile,
          status: l.status,
          timestamp: l.timestamp,
          updatedAt: l.updated_at
        })),
        total: count,
        page,
        limit
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/gallery-leads', async (req: Request, res: Response) => {
    try {
      const lead = req.body;
      const now = Date.now();
      const leadWithTs = { ...lead, updatedAt: now };
      
      console.log(`[GALLERY] Receiving order: ${lead.id} from ${lead.customerName}`);
      updateCache('galleryLeads', leadWithTs);
      
      // Ensure it's persisted to the main data store immediately
      if (inMemoryDb) {
        await writeToDb(inMemoryDb);
      }

      if (pool && dbHealthy) {
        await pool.query(
          'INSERT INTO gallery_leads (id, customer_name, customer_mobile, status, `timestamp`, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE customer_name=?, customer_mobile=?, status=?, `timestamp`=?, data=?, updated_at=?',
          [
            lead.id, lead.customerName, lead.customerMobile, lead.status, lead.timestamp, JSON.stringify(lead), now,
            lead.customerName, lead.customerMobile, lead.status, lead.timestamp, JSON.stringify(lead), now
          ]
        );
        console.log(`[GALLERY] Persisted to MySQL: ${lead.id}`);
      }
      res.json({ success: true, id: lead.id });
    } catch (err: any) {
      console.error(`[GALLERY] Failed to persist: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/gallery-leads/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const now = Date.now();
      
      if (!inMemoryDb) inMemoryDb = getInitialData();
      const idx = inMemoryDb.galleryLeads.findIndex((l: any) => l.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Lead not found' });
      
      const updatedLead = { ...inMemoryDb.galleryLeads[idx], ...updates, updatedAt: now };
      inMemoryDb.galleryLeads[idx] = updatedLead;
      syncResponseCache = null;

      if (pool && dbHealthy) {
        await pool.query(
          'UPDATE gallery_leads SET customer_name=?, customer_mobile=?, status=?, timestamp=?, data=?, updated_at=? WHERE id=?',
          [
            updatedLead.customerName, updatedLead.customerMobile, updatedLead.status, updatedLead.timestamp, 
            JSON.stringify(updatedLead), now, id
          ]
        );
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });



app.post('/api/db/test', async (req: Request, res: Response) => {
  const { host, port, user, password, database, socketPath } = req.body;
  const start = Date.now();
  
  let testConn: Connection | null = null;
  try {
    const config: any = {
      user,
      password,
      database: database || undefined,
      connectTimeout: 8000
    };
    
    if (socketPath) config.socketPath = socketPath;
    else {
      config.host = host;
      config.port = parseInt(port) || 3306;
    }

    testConn = await mysql.createConnection(config);
    await testConn.query('SELECT 1 as pulse');
    const latency = Date.now() - start;
    
    res.json({
      success: true,
      message: "Handshake Successful",
      latency: `${latency}ms`,
      node: host || socketPath
    });
  } catch (err: any) {
    res.status(401).json({
      success: false,
      error: err.message,
      code: err.code,
      hint: err.code === 'ECONNREFUSED' ? 'Target node is not listening. Check proxy status.' : 'Authentication failed.'
    });
  } finally {
    if (testConn) await testConn.end();
  }
});

// Config API
app.get('/api/db/config', (req: Request, res: Response) => {
  const sanitized = { ...activeDbConfig };
  sanitized.password = '••••••••';
  res.json(sanitized);
});

// Update Config & Reconnect
app.post('/api/db/config', async (req: Request, res: Response) => {
  const { host, port, user, password, database, socketPath } = req.body;
  
  const newConfig: DbConfig = {
    ...activeDbConfig,
    user,
    password,
    database,
    host: host || activeDbConfig.host || 'localhost',
    port: parseInt(port) || activeDbConfig.port || 3306
  };

  if (socketPath) {
    newConfig.socketPath = socketPath;
    delete newConfig.host;
    delete newConfig.port;
  } else {
    delete newConfig.socketPath;
  }

  const success = await initDatabase(newConfig);
  if (success) {
    activeDbConfig = newConfig;
    res.json({ success: true, message: "Migration Complete" });
  } else {
    res.status(503).json({ success: false, error: dbError });
  }
});

app.get('/api/sync/version', async (req: Request, res: Response) => {
  try {
    if (!inMemoryDb) {
      const data = await readFromDb();
      return res.json({ lastUpdated: data.lastUpdated || 0 });
    }
    res.json({ lastUpdated: inMemoryDb.lastUpdated || 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch version' });
  }
});

  app.get('/api/loading-charges', async (req, res) => {
    const data = await readFromDb();
    res.json(data.loadingCharges || []);
  });

  app.post('/api/loading-charges', async (req, res) => {
    try {
      const rule = req.body;
      const data = await readFromDb();
      if (!data.loadingCharges) data.loadingCharges = [];
      
      const newRule = { ...rule, id: rule.id || Math.random().toString(36).substr(2, 9), updatedAt: Date.now() };
      data.loadingCharges.push(newRule);
      
      await writeToDb(data);
      
      if (pool && dbHealthy) {
        await pool.query(
          'INSERT INTO loading_charges (id, product_type, unit_type, rate, per_unit, is_active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [newRule.id, newRule.productType, newRule.unitType, newRule.rate, newRule.perUnit, newRule.isActive ? 1 : 0, newRule.updatedAt]
        );
      }
      
      res.json(newRule);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/loading-charges/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const data = await readFromDb();
      
      if (!data.loadingCharges) data.loadingCharges = [];
      const index = data.loadingCharges.findIndex((l: any) => l.id === id);
      if (index === -1) return res.status(404).json({ error: 'Rule not found' });
      
      const updatedRule = { ...data.loadingCharges[index], ...updates, updatedAt: Date.now() };
      data.loadingCharges[index] = updatedRule;
      
      await writeToDb(data);
      
      if (pool && dbHealthy) {
        await pool.query(
          'UPDATE loading_charges SET product_type=?, unit_type=?, rate=?, per_unit=?, is_active=?, updated_at=? WHERE id=?',
          [updatedRule.productType, updatedRule.unitType, updatedRule.rate, updatedRule.perUnit, updatedRule.isActive ? 1 : 0, updatedRule.updatedAt, id]
        );
      }
      
      res.json(updatedRule);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/loading-charges/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const data = await readFromDb();
      
      if (!data.loadingCharges) data.loadingCharges = [];
      data.loadingCharges = data.loadingCharges.filter((l: any) => l.id !== id);
      
      await writeToDb(data);
      
      if (pool && dbHealthy) {
        await pool.query('DELETE FROM loading_charges WHERE id=?', [id]);
      }
      
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/sync', async (req: Request, res: Response) => {
  const since = parseInt(req.query.since as string) || 0;

  // ── CRITICAL TENANT ISOLATION ────────────────────────────────────────────────
  // A tenant MUST ONLY see their own data. NEVER fall back to another tenant's data.
  const tenantId       = req.tenantId || 'default';
  const isDefaultTenant = !req.tenantId || req.tenantId === 'default';

  if (isWarmingUp && warmupPromise) await warmupPromise;

  let data: any;

  if (isDefaultTenant) {
    // ── Default tenant: use in-memory cache (already scoped to default) ────────
    const rawData = inMemoryDb || await readFromDb();
    if (!rawData) return res.status(503).json({ error: 'Storage node offline', details: dbError });
    data = rawData;

  } else {
    // ── Named tenant: ONLY load from DB for this specific tenant ──────────────
    // NEVER use inMemoryDb here — it contains default tenant data
    if (!pool || !dbHealthy) {
      // DB not available → return truly empty data, never default tenant data
      return res.json({
        ...getInitialData(),
        lastUpdated: 0,
        _tenant: tenantId,
        _warning: 'DB offline — no tenant data available',
      });
    }

    try {
      // Fetch settings/meta from system_persistence
      const [spRows]: any = await pool.query(
        'SELECT payload FROM system_persistence WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 1',
        [tenantId]
      );
      // Start with empty base — NEVER borrow from default tenant
      const base = spRows.length ? parseData(spRows[0].payload) : getInitialData();

      // Fetch all relational data for THIS tenant only
      const [prodRows]:  any = await pool.query('SELECT id,name,category,brand,data,selling_price,stock_boxes,stock_loose,status,updated_at FROM products WHERE tenant_id=?', [tenantId]);
      const [saleRows]:  any = await pool.query('SELECT id,data,invoice_no,customer_name,date,total_amount,updated_at FROM sales WHERE tenant_id=?', [tenantId]);
      const [purchRows]: any = await pool.query('SELECT id,data,vendor_name,invoice_no,date,updated_at FROM purchases WHERE tenant_id=?', [tenantId]);
      const [voRows]:    any = await pool.query('SELECT id,data,order_no,vendor_name,status,payment_status,updated_at FROM vendor_orders WHERE tenant_id=?', [tenantId]);
      const [userRows]:  any = await pool.query('SELECT id,name,email,role,status,data,updated_at FROM users WHERE tenant_id=?', [tenantId]);

      base.products    = prodRows.map((p: any)  => ({ ...parseData(p.data),  id:p.id, name:p.name, category:p.category, brand:p.brand, sellingPrice:parseFloat(p.selling_price)||0, stockBoxes:p.stock_boxes||0, stockLoose:p.stock_loose||0, status:p.status }));
      base.sales       = saleRows.map((s: any)  => ({ ...parseData(s.data),  id:s.id, invoiceNo:s.invoice_no, customerName:s.customer_name, date:s.date, totalAmount:parseFloat(s.total_amount)||0 }));
      base.purchases   = purchRows.map((p: any) => ({ ...parseData(p.data),  id:p.id, vendorName:p.vendor_name, date:p.date }));
      base.vendorOrders= voRows.map((v: any)    => ({ ...parseData(v.data),  id:v.id, orderNo:v.order_no, vendorName:v.vendor_name, status:v.status, paymentStatus:v.payment_status }));
      base.users       = userRows.map((u: any)  => ({ ...parseData(u.data),  id:u.id, name:u.name, email:u.email, role:u.role, status:u.status }));
      base._tenant     = tenantId;
      data             = base;

    } catch (err: any) {
      console.error('[SYNC] Tenant query error:', err.message);
      // Even on error: return empty data, never default tenant data
      return res.status(500).json({ error: 'Sync failed: ' + err.message });
    }
  }

  
  // If 'since' is provided, we can send a delta
  if (since > 0) {
    if (since >= (data.lastUpdated || 0)) {
      return res.json({ 
        lastUpdated: data.lastUpdated,
        isDelta: true,
        changed: false,
        _metadata: { db_healthy: dbHealthy, timestamp: Date.now() }
      });
    }

    // Construct a delta payload
    const delta: any = {
      lastUpdated: data.lastUpdated,
      isDelta: true,
      changed: true,
      _metadata: { db_healthy: dbHealthy, timestamp: Date.now() }
    };

    // Filter each collection for items updated after 'since'
    const collections = ['products', 'sales', 'purchases', 'vendorOrders', 'quotations', 'payments', 'expenses', 'offers', 'commissionRules', 'customers', 'activityLogs', 'advances', 'payrollRecords', 'returns', 'loadingCharges', 'galleryLeads', 'users'];
    
    let hasChanges = false;
    collections.forEach(col => {
      if (data[col]) {
        const items = data[col].filter((item: any) => (item.updatedAt || 0) > since);
        if (items.length > 0) {
          delta[col] = items;
          hasChanges = true;
        }
      }
    });

    if (data.settings && (data.settings.lastUpdated || 0) > since) {
      delta.settings = data.settings;
      hasChanges = true;
    }

    if (!hasChanges) {
      return res.json({ 
        lastUpdated: data.lastUpdated,
        isDelta: true,
        changed: false,
        _metadata: { db_healthy: dbHealthy, timestamp: Date.now() }
      });
    }

    return res.json(delta);
  }

  // ── Response cache (DEFAULT TENANT ONLY) ─────────────────────────────────
  // NEVER cache for named tenants — each tenant must get their own scoped data
  if (isDefaultTenant && syncResponseCache && since === 0) {
    res.setHeader('Content-Type', 'application/json');
    return res.send(syncResponseCache);
  }

  // Prune activityLogs to keep payload size manageable
  const prunedData = { ...data };
  if (prunedData.activityLogs && prunedData.activityLogs.length > 200) {
    prunedData.activityLogs = prunedData.activityLogs.slice(0, 200);
  }

  const responsePayload = {
    ...prunedData,
    _tenant: tenantId,
    _metadata: {
      db_healthy: dbHealthy,
      tenant_id: tenantId,
      is_default: isDefaultTenant,
      is_fallback: !dbHealthy,
      timestamp: Date.now()
    }
  };

  // Only cache full sync responses for the default tenant
  if (since === 0 && isDefaultTenant) {
    syncResponseCache = JSON.stringify(responsePayload);
  }

  res.json(responsePayload);
});

app.post('/api/sync', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    data.lastUpdated = Date.now();
    await writeToDb(data);
    syncResponseCache = null; // Invalidate cache after sync
    res.json({ success: true, timestamp: data.lastUpdated });
  } catch (err: any) {
    res.status(500).json({ error: "Storage failure", details: err.message });
  }
});

  // Backup Logic
  const performBackup = async () => {
    try {
      const data = await readFromDb();
      if (!data) {
        console.warn('[BACKUP] Skipped: No data retrieved from DB');
        return;
      }
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `backup-${timestamp}.json`;
      const filepath = path.join(BACKUP_DIR, filename);
      
      await fs.writeJson(filepath, data, { spaces: 2 });
      console.log(`[BACKUP] Success: ${filename}`);
      
      // Cleanup old backups (keep last 50)
      const files = await fs.readdir(BACKUP_DIR);
      const backups = files.filter((f: string) => f.startsWith('backup-') && f.endsWith('.json')).sort();
      if (backups.length > 50) {
        const toDelete = backups.slice(0, backups.length - 50);
        for (const file of toDelete) {
          await fs.remove(path.join(BACKUP_DIR, file));
          console.log(`[BACKUP] Pruned: ${file}`);
        }
      }
    } catch (err) {
      console.error('[BACKUP] Failed:', err);
    }
  };

  // Schedule Backup based on settings
  let lastBackupTime = Date.now();
  setInterval(async () => {
    try {
      const data = await readFromDb();
      const freq = data.settings?.backupFrequency || 'daily';
      let intervalMs = 15 * 60 * 1000;
      if (freq === '1hour') intervalMs = 60 * 60 * 1000;
      if (freq === 'daily') intervalMs = 24 * 60 * 60 * 1000;

      if (Date.now() - lastBackupTime >= intervalMs) {
        await performBackup();
        lastBackupTime = Date.now();
      }
    } catch (e) {
      console.error('[SCHEDULER] Error:', e);
    }
  }, 60 * 1000); // Check every minute

  // Initial backup on startup
  setTimeout(performBackup, 10000);

  // Backup API Endpoints
  app.get('/api/backups', async (req, res) => {
    try {
      const files = await fs.readdir(BACKUP_DIR);
      const backups = files
        .filter((f: string) => f.startsWith('backup-') && f.endsWith('.json'))
        .map((f: string) => ({
          filename: f,
          url: `/api/backups/${f}`,
          timestamp: f.replace('backup-', '').replace('.json', '')
        }))
        .sort((a: any, b: any) => b.filename.localeCompare(a.filename));
      res.json(backups);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/backups/sql', async (req, res) => {
    if (!pool || !dbHealthy) {
      return res.status(503).json({ error: "Database offline, cannot generate SQL dump." });
    }

    try {
      let sql = `-- ROYAL ERP SQL DUMP\n-- Generated: ${new Date().toISOString()}\n\n`;
      
      const tables = ['products', 'sales', 'purchases', 'vendor_orders', 'system_persistence'];
      
      for (const table of tables) {
        const [rows]: any = await pool.query(`SELECT * FROM ${table}`);
        if (rows.length > 0) {
          sql += `-- Dumping data for table \`${table}\`\n`;
          const columns = Object.keys(rows[0]);
          const columnStr = columns.map(c => `\`${c}\``).join(', ');
          
          for (const row of rows) {
            const values = columns.map(c => {
              const val = row[c];
              if (val === null) return 'NULL';
              if (typeof val === 'number') return val;
              if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
              return `'${val.toString().replace(/'/g, "''")}'`;
            }).join(', ');
            sql += `INSERT INTO \`${table}\` (${columnStr}) VALUES (${values});\n`;
          }
          sql += '\n';
        }
      }

      res.setHeader('Content-Type', 'application/sql');
      res.setHeader('Content-Disposition', `attachment; filename=royal-erp-dump-${Date.now()}.sql`);
      res.send(sql);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/backups/trigger', async (req, res) => {
    try {
      await performBackup();
      res.json({ success: true, message: 'Backup triggered successfully' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/backups/:filename', async (req, res) => {
    const filepath = path.join(BACKUP_DIR, req.params.filename);
    if (await fs.pathExists(filepath)) {
      res.download(filepath);
    } else {
      res.status(404).json({ error: 'Backup not found' });
    }
  });

  app.post('/api/backups/restore/:filename', async (req, res) => {
    const filename = req.params.filename;
    const filepath = path.join(BACKUP_DIR, filename);
    
    if (!(await fs.pathExists(filepath))) {
      return res.status(404).json({ error: 'Backup file not found' });
    }

    try {
      const data = await fs.readJson(filepath);
      
      if (pool && dbHealthy) {
        // Restore relational data to MySQL
        const { products, sales, purchases, vendorOrders, ...metaData } = data;

        // Restore Products
        if (products) {
          for (const p of products) {
            await pool.query(
              'INSERT INTO products (id, name, category, brand, stock_boxes, stock_loose, selling_price, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=?, category=?, brand=?, stock_boxes=?, stock_loose=?, selling_price=?, status=?, data=?, updated_at=?',
              [
                p.id, p.name, p.category, p.brand, p.stockBoxes, p.stockLoose, p.sellingPrice, p.status, JSON.stringify(p), Date.now(),
                p.name, p.category, p.brand, p.stockBoxes, p.stockLoose, p.sellingPrice, p.status, JSON.stringify(p), Date.now()
              ]
            );
          }
        }

        // Restore Sales
        if (sales) {
          for (const s of sales) {
            await pool.query(
              'INSERT INTO sales (id, invoice_no, customer_name, date, total_amount, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE invoice_no=?, customer_name=?, date=?, total_amount=?, data=?, updated_at=?',
              [s.id, s.invoiceNo, s.customerName, s.date, s.totalAmount, JSON.stringify(s), Date.now(), s.invoiceNo, s.customerName, s.date, s.totalAmount, JSON.stringify(s), Date.now()]
            );
          }
        }

        // Restore Purchases
        if (purchases) {
          for (const p of purchases) {
            await pool.query(
              'INSERT INTO purchases (id, vendor_name, invoice_no, date, data, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE vendor_name=?, invoice_no=?, date=?, data=?, updated_at=?',
              [p.id, p.vendorName, p.gstInvoiceNo, p.date, JSON.stringify(p), Date.now(), p.vendorName, p.gstInvoiceNo, p.date, JSON.stringify(p), Date.now()]
            );
          }
        }

        // Restore Vendor Orders
        if (vendorOrders) {
          for (const o of vendorOrders) {
            await pool.query(
              'INSERT INTO vendor_orders (id, order_no, vendor_name, status, payment_status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE order_no=?, vendor_name=?, status=?, payment_status=?, data=?, updated_at=?',
              [o.id, o.orderNo, o.vendorName, o.status, o.paymentStatus, JSON.stringify(o), Date.now(), o.orderNo, o.vendorName, o.status, o.paymentStatus, JSON.stringify(o), Date.now()]
            );
          }
        }

        // Restore Meta Data
        await writeToDb(data);
      } else {
        // Restore to In-Memory
        inMemoryDb = data;
      }

      res.json({ success: true, message: `System restored to state: ${filename}` });
    } catch (err: any) {
      console.error('[RESTORE FAULT]', err);
      res.status(500).json({ error: 'Restore failed', details: err.message });
    }
  });


  // ─── DATA MANAGEMENT ENDPOINTS ────────────────────────────────────────────

  // CLEAR all data from DB (admin only — dev/deployment tool)
  app.post('/api/admin/clear-db', async (req: Request, res: Response) => {
    try {
      // 1. Auto-backup before clearing
      await performBackup();

      // Preserve users and settings before wipe
      const preservedUsers    = inMemoryDb?.users    || [];
      const preservedSettings = inMemoryDb?.settings || {};

      if (pool && dbHealthy) {
        const conn = await pool.getConnection();
        try {
          await conn.query('SET FOREIGN_KEY_CHECKS = 0');

          // Clear ALL business data tables (NOT users table)
          for (const table of [
            'products', 'sales', 'purchases', 'vendor_orders',
            'gallery_leads', 'loading_charges'
          ]) {
            await conn.query(`TRUNCATE TABLE ${table}`);
          }

          // system_persistence holds: quotations, payments, expenses, offers,
          // commissionRules, customers, advances, payrollRecords, returns,
          // giftInventory, giftIssuances, incentiveEntries, activityLogs, etc.
          // Replace it with a clean record that keeps users + settings only
          const cleanPayload = JSON.stringify({
            quotations: [], payments: [], expenses: [], offers: [],
            commissionRules: [], customers: [], activityLogs: [],
            advances: [], payrollRecords: [], returns: [],
            giftInventory: [], giftIssuances: [], incentiveEntries: [],
            users: preservedUsers,
            settings: preservedSettings,
            lastUpdated: Date.now(),
          });
          await conn.query(
            'INSERT INTO system_persistence (id, tenant_id, payload, updated_at) VALUES ("global_master", "default", ?, ?) ' +
            'ON DUPLICATE KEY UPDATE payload = ?, updated_at = ?',
            [cleanPayload, Date.now(), cleanPayload, Date.now()]
          );

          await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        } finally {
          conn.release();
        }
      }

      // 2. Reset in-memory store (preserve users + settings)
      inMemoryDb = {
        products: [], sales: [], purchases: [], vendorOrders: [],
        quotations: [], payments: [], expenses: [], offers: [],
        commissionRules: [], customers: [], activityLogs: [],
        advances: [], payrollRecords: [], returns: [], galleryLeads: [],
        loadingCharges: [], giftInventory: [], giftIssuances: [],
        incentiveEntries: [],
        users: preservedUsers,
        settings: preservedSettings,
        lastUpdated: Date.now(),
      };
      syncResponseCache = null;

      console.log('[CLEAR-DB] Complete. Users preserved:', preservedUsers.length, '| Settings preserved: yes');
      res.json({ success: true, message: 'All business data cleared. Users and settings preserved.' });
    } catch (err: any) {
      console.error('[CLEAR-DB] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // IMPORT full JSON backup (from downloaded backup file)
  app.post('/api/admin/import-json', async (req: Request, res: Response) => {
    try {
      const data = req.body;
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: 'Invalid JSON payload' });
      }

      // Validate it looks like a real backup
      if (!data.products && !data.sales && !data.settings) {
        return res.status(400).json({ error: 'File does not appear to be a valid Royal ERP backup' });
      }

      // Auto-backup before import
      await performBackup();

      if (pool && dbHealthy) {
        const { products, sales, purchases, vendorOrders, ...metaData } = data;

        if (products?.length) {
          for (const p of products) {
            await pool.query(
              'INSERT INTO products (id, name, category, brand, stock_boxes, stock_loose, selling_price, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=?, category=?, brand=?, stock_boxes=?, stock_loose=?, selling_price=?, status=?, data=?, updated_at=?',
              [p.id, p.name, p.category, p.brand, p.stockBoxes ?? 0, p.stockLoose ?? 0, p.sellingPrice ?? 0, p.status ?? 'Active', JSON.stringify(p), Date.now(),
               p.name, p.category, p.brand, p.stockBoxes ?? 0, p.stockLoose ?? 0, p.sellingPrice ?? 0, p.status ?? 'Active', JSON.stringify(p), Date.now()]
            );
          }
        }
        if (sales?.length) {
          for (const s of sales) {
            await pool.query(
              'INSERT INTO sales (id, invoice_no, customer_name, date, total_amount, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE invoice_no=?, customer_name=?, date=?, total_amount=?, data=?, updated_at=?',
              [s.id, s.invoiceNo, s.customerName, s.date, s.totalAmount, JSON.stringify(s), Date.now(),
               s.invoiceNo, s.customerName, s.date, s.totalAmount, JSON.stringify(s), Date.now()]
            );
          }
        }
        if (purchases?.length) {
          for (const p of purchases) {
            await pool.query(
              'INSERT INTO purchases (id, vendor_name, invoice_no, date, data, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE vendor_name=?, invoice_no=?, date=?, data=?, updated_at=?',
              [p.id, p.vendorName, p.gstInvoiceNo || '', p.date, JSON.stringify(p), Date.now(),
               p.vendorName, p.gstInvoiceNo || '', p.date, JSON.stringify(p), Date.now()]
            );
          }
        }
        if (vendorOrders?.length) {
          for (const o of vendorOrders) {
            await pool.query(
              'INSERT INTO vendor_orders (id, order_no, vendor_name, status, payment_status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE order_no=?, vendor_name=?, status=?, payment_status=?, data=?, updated_at=?',
              [o.id, o.orderNo, o.vendorName, o.status, o.paymentStatus, JSON.stringify(o), Date.now(),
               o.orderNo, o.vendorName, o.status, o.paymentStatus, JSON.stringify(o), Date.now()]
            );
          }
        }
        await writeToDb(data);
      }

      inMemoryDb = { ...inMemoryDb, ...data, lastUpdated: Date.now() };
      syncResponseCache = null;

      res.json({
        success: true,
        message: `Import complete`,
        counts: {
          products: data.products?.length || 0,
          sales: data.sales?.length || 0,
          purchases: data.purchases?.length || 0,
          vendorOrders: data.vendorOrders?.length || 0,
          customers: data.customers?.length || 0,
        }
      });
    } catch (err: any) {
      console.error('[IMPORT-JSON] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // IMPORT products from CSV/Excel (parsed on client, sent as JSON array)
  app.post('/api/admin/import-products-csv', async (req: Request, res: Response) => {
    try {
      const { rows, category: importCategory } = req.body as { rows: any[]; category?: string };
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: 'No rows provided' });
      }

      const results = { created: 0, updated: 0, skipped: 0, errors: [] as string[] };
      const now = Date.now();

      // ── Server-side deduplication: remove duplicate rows within this batch ──
      const batchSeen = new Set<string>();
      const dedupedRows = rows.filter(row => {
        const n = (row['Product Name'] || row['name'] || row['Name'] || '').toString().trim().toLowerCase();
        const s = (row['Size'] || row['size'] || '').toString().trim().toLowerCase();
        if (!n) return true;
        const key = `${n}|${s}`;
        if (batchSeen.has(key)) { results.skipped++; return false; }
        batchSeen.add(key);
        return true;
      });

      for (const row of dedupedRows) {
        try {
          // Map CSV columns — flexible, accepts common aliases, category-specific columns
          const name = (row['Product Name'] || row['name'] || row['Name'] || '').toString().trim();
          // ── Category: ALWAYS read from the file first ─────────────────────
          // The UI dropdown (importCategory) is ONLY a fallback when no
          // Category column exists in the file. This prevents the dropdown from
          // overriding product categories that are explicitly set in the CSV.
          const categoryFromFile = (row['Category'] || row['category'] || row['Sheet'] || '').toString().trim();
          const category = categoryFromFile || importCategory || 'Floor Tile';
          const brand    = (row['Brand'] || row['brand'] || '').toString().trim();
          const size     = (row['Size'] || row['size'] || '').toString().trim();
          const grade    = (row['Grade'] || row['grade'] || 'Premium').toString().trim();
          const shadeNo  = (row['Shade No'] || row['shadeNo'] || '').toString().trim();
          const status   = (row['Status'] || row['status'] || 'Active').toString().trim();
          const vendorName = (row['Vendor Name'] || row['vendor'] || '').toString().trim();

          // Category-specific pricing fields
          const isGranite  = ['Granite','Marble'].includes(category);
          const isKadapa   = category === 'Kadapa';
          const isWeight   = ['Adhesive','Grout'].includes(category);

          let purchasePrice  = parseFloat(row['Purchase Price']      || row['purchasePrice']     || row['Rate'] || '0') || 0;
          let sellingPrice   = parseFloat(row['Selling Price']       || row['sellingPrice']      || row['MRP'] || '0') || 0;
          let costPerSqft    = parseFloat(row['Purchase Rate Per Sqft'] || row['costPerSqft']    || '0') || 0;
          let sellingPerSqft = parseFloat(row['Selling Price Per Sqft'] || row['sellingPricePerSqft'] || '0') || 0;
          let transportPct   = parseFloat(row['Transport Pct']       || row['transportPct']      || '0') || 0;
          let stockBoxes     = parseInt(row['Stock Boxes'] || row['stockBoxes'] || row['Stock'] || row['Qty'] || '0') || 0;
          let stockSlabs     = parseInt(row['Stock Slabs'] || row['stockSlabs'] || '0') || 0;
          const tilesPerBox  = parseInt(row['Tiles Per Box'] || row['tilesPerBox'] || '4') || 4;
          const sqftPerBox   = parseFloat(row['Sqft Per Box'] || row['sqftPerBox'] || '16') || 16;
          const reorderLevel = parseInt(row['Reorder Level'] || row['reorderLevel'] || '10') || 10;
          const unitType     = (row['Unit'] || row['unitType'] || (isGranite || isKadapa ? 'Slab' : isWeight ? 'Bag' : 'Box')).toString().trim();
          const weightGrams  = parseInt(row['Weight Grams'] || row['weightGrams'] || '0') || 0;
          const finishType   = (row['Finish Type'] || row['kadapaType'] || '').toString().trim();

          // ── Kadapa slab dimensions from CSV ─────────────────────────────────
          // Height (Ft) and Width (Ft) drive sqft per slab and slab[] generation
          const kadapaHeightFt = parseFloat(row['Height (Ft)'] || row['heightFt'] || row['height_ft'] || '0') || 0;
          const kadapaWidthFt  = parseFloat(row['Width (Ft)']  || row['widthFt']  || row['width_ft']  || '0') || 0;

          // Derive sqft per slab (rounded-ft equivalent for standard widths)
          const ROUNDED_WIDTH_MAP: Record<number, number> = { 9: 1, 11: 1, 14: 1.25, 17: 1.5, 23: 2, 29: 2.5 };
          // kadapaWidthFt is already in ft (from CSV) — use directly
          const slabSqft = kadapaHeightFt && kadapaWidthFt
            ? Math.round(kadapaHeightFt * kadapaWidthFt * 100) / 100
            : 0;

          // For Granite/Marble/Kadapa: landed cost per sqft
          if (isGranite && costPerSqft > 0 && purchasePrice === 0) {
            const transport = costPerSqft * (transportPct / 100);
            purchasePrice = parseFloat((costPerSqft + transport).toFixed(2));
          }
          if (isKadapa && costPerSqft > 0 && purchasePrice === 0) {
            purchasePrice = slabSqft > 0
              ? parseFloat((slabSqft * costPerSqft).toFixed(2))  // landed per slab = sqft × rate/sqft
              : costPerSqft;
          }
          const effectiveStock = (isGranite || isKadapa) ? stockSlabs : stockBoxes;

          // ── Auto-generate slabs[] for Kadapa ─────────────────────────────────
          // Each slab gets its own Slab object — same structure as KadapaManager.handleAdd()
          // This ensures KadapaManager, Quotation, and P&L all see the correct data.
          let generatedSlabs: any[] = [];
          if (isKadapa && slabSqft > 0 && effectiveStock > 0) {
            const landedPerSlab  = Math.round(slabSqft * costPerSqft * 100) / 100;
            const sellPerSqft    = sellingPerSqft || 0;
            const sellingPerSlab = Math.round(slabSqft * sellPerSqft * 100) / 100;

            // Prefix logic: same as KadapaManager FINISH_PREFIX
            const prefixMap: Record<string, { normal: string; big: string }> = {
              'Single Polish':     { normal: 'SP',  big: 'DSP' },
              'Double Polish':     { normal: 'DP',  big: 'DDP' },
              'Big Single Polish': { normal: 'DSP', big: 'DSP' },
              'Big Double Polish': { normal: 'DDP', big: 'DDP' },
            };
            const isBig = kadapaHeightFt >= 5;
            const pfx   = (prefixMap[finishType] || { normal: 'KD', big: 'KD' })[isBig ? 'big' : 'normal'];
            const baseNo = `${pfx}-${kadapaHeightFt}x${kadapaWidthFt}`;

            for (let i = 0; i < effectiveStock; i++) {
              generatedSlabs.push({
                id:                  `slab-csv-${now}-${i}-${Math.random().toString(36).substr(2, 5)}`,
                slabNo:              `${baseNo}-${i + 1}`,
                heightFt:            kadapaHeightFt,
                heightIn:            0,
                lengthFt:            kadapaWidthFt,
                lengthIn:            0,
                sqft:                slabSqft,
                isSold:              false,
                finish:              finishType || 'Single Polish',
                landedCost:          landedPerSlab,
                landedCostPerSqft:   costPerSqft,
                sellingPrice:        sellingPerSlab,
                sellingPricePerSqft: sellPerSqft,
              });
            }
          }

          if (!name) { results.skipped++; continue; }

          // Check if product already exists (by name + size)
          let existingId: string | null = null;
          if (pool && dbHealthy) {
            const [existing]: any = await pool.query('SELECT id FROM products WHERE name = ? AND (size = ? OR size IS NULL)', [name, size]);
            if (existing.length > 0) existingId = existing[0].id;
          } else {
            // In-memory: match by name (case-insensitive) + size
            const found = inMemoryDb?.products?.find((p: any) =>
              p.name.trim().toLowerCase() === name.toLowerCase() &&
              (!size || (p.size || '').trim().toLowerCase() === size.toLowerCase())
            );
            if (found) existingId = found.id;
          }

          const productId = existingId || `csv-${now}-${Math.random().toString(36).substr(2, 6)}`;
          // Compute correct sqftPerBox (per slab) and totalCostPerUnit (landed per sqft for P&L)
          const kadapaSqftPerBox    = isKadapa && slabSqft > 0 ? slabSqft : sqftPerBox;
          const kadapaTotalCostUnit = isKadapa && costPerSqft > 0 ? costPerSqft : purchasePrice;
          const kadapaTilesPerBox   = isKadapa ? 1 : tilesPerBox;  // 1 slab = 1 "box"

          const productData: any = {
            id: productId, name, category, brand,
            // For Kadapa: size = "heightFt x widthFt" if dimensions provided, else from CSV
            size: isKadapa && kadapaHeightFt && kadapaWidthFt
              ? `${kadapaHeightFt}x${kadapaWidthFt}`
              : size,
            purchasePrice,
            sellingPrice,
            // totalCostPerUnit = landed cost PER SQFT for Kadapa (used by P&L correctly)
            totalCostPerUnit: kadapaTotalCostUnit,
            stockBoxes: effectiveStock, stockLoose: 0,
            tilesPerBox: kadapaTilesPerBox,
            sqftPerBox:  kadapaSqftPerBox,
            reorderLevel,
            grade, shadeNo, status,
            isTile: !isWeight, unitType,
            transportCost: transportPct, transportCostType: 'Percentage', transportBasis: 'Per Unit',
            otherCharges: 0,
            costPerSqft:          costPerSqft || 0,
            sellingPricePerSqft:  sellingPerSqft || 0,
            kadapaType:           finishType || undefined,
            slabHeightFt:         isKadapa ? kadapaHeightFt : undefined,
            slabLengthFt:         isKadapa ? kadapaWidthFt  : undefined,
            baseWeightGrams:      weightGrams || 0,
            images: [], showInGallery: true,
            locationStock: [
              { godownId: 'g1', boxes: effectiveStock, loose: 0 },
              { godownId: 'g2', boxes: 0, loose: 0 },
              { godownId: 'g3', boxes: 0, loose: 0 }
            ],
            damageHistory: [], purchaseHistory: [], adjustmentLog: [],
            // ── Auto-generated slabs: same structure as KadapaManager ──────────
            slabs: generatedSlabs,
            // Vendor linking
            lastPurchaseVendor: vendorName || undefined,
            lastPurchaseDate:   vendorName ? new Date().toISOString().split('T')[0] : undefined,
            updatedAt: now
          };

          if (pool && dbHealthy) {
            await pool.query(
              'INSERT INTO products (id, name, category, brand, stock_boxes, stock_loose, selling_price, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=?, category=?, brand=?, stock_boxes=?, stock_loose=?, selling_price=?, status=?, data=?, updated_at=?',
              [productId, name, category, brand, stockBoxes, 0, sellingPrice, status, JSON.stringify(productData), now,
               name, category, brand, stockBoxes, 0, sellingPrice, status, JSON.stringify(productData), now]
            );
          }

          // Update in-memory
          if (!inMemoryDb) inMemoryDb = { products: [] };
          if (!inMemoryDb.products) inMemoryDb.products = [];
          const memIdx = inMemoryDb.products.findIndex((p: any) => p.id === productId);
          if (memIdx >= 0) { inMemoryDb.products[memIdx] = productData; results.updated++; }
          else { inMemoryDb.products.push(productData); results.created++; }

        } catch (rowErr: any) {
          results.errors.push(`Row "${row['Product Name'] || row['name'] || '?'}": ${rowErr.message}`);
          results.skipped++;
        }
      }

      inMemoryDb.lastUpdated = Date.now();
      syncResponseCache = null;

      res.json({ success: true, results });
    } catch (err: any) {
      console.error('[IMPORT-CSV] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET DB stats (for the dashboard in the UI)
  app.get('/api/admin/db-stats', async (req: Request, res: Response) => {
    try {
      if (pool && dbHealthy) {
        const tables = ['products', 'sales', 'purchases', 'vendor_orders'];
        const counts: Record<string, number> = {};
        for (const t of tables) {
          const [[row]]: any = await pool.query(`SELECT COUNT(*) as count FROM ${t}`);
          counts[t] = row.count;
        }
        const files = await fs.readdir(BACKUP_DIR).catch(() => []);
        const backupFiles = (files as string[]).filter((f: string) => f.endsWith('.json'));
        res.json({ counts, backupCount: backupFiles.length, dbMode: 'mysql', dbConnected: true });
      } else {
        const db = inMemoryDb || {};
        res.json({
          counts: {
            products: db.products?.length || 0,
            sales: db.sales?.length || 0,
            purchases: db.purchases?.length || 0,
            vendor_orders: db.vendorOrders?.length || 0,
          },
          backupCount: 0,
          dbMode: 'memory',
          dbConnected: false
        });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Activity logs — lightweight write endpoint (fire-and-forget from client)
  app.post('/api/activity-logs', async (req: Request, res: Response) => {
    try {
      const log = req.body;
      if (!log || !log.id) return res.json({ success: true }); // silent ignore
      if (!inMemoryDb) inMemoryDb = getInitialData();
      if (!inMemoryDb.activityLogs) inMemoryDb.activityLogs = [];
      inMemoryDb.activityLogs.unshift(log);
      // Keep only last 200 in memory
      if (inMemoryDb.activityLogs.length > 200) {
        inMemoryDb.activityLogs = inMemoryDb.activityLogs.slice(0, 200);
      }
      // No DB write needed — activity logs are ephemeral, included in next sync payload
      res.json({ success: true });
    } catch (e: any) {
      res.json({ success: true }); // always succeed — client doesn't need to know about failures
    }
  });

  app.get('/api/activity-logs', async (req: Request, res: Response) => {
    try {
      const logs = inMemoryDb?.activityLogs || [];
      res.json(logs.slice(0, 200));
    } catch (e: any) {
      res.json([]);
    }
  });

  app.get('/api/health', async (req, res) => {
    let livePing = false;
    let pingError = null;
    if (pool) {
      try {
        await pool.query('SELECT 1');
        livePing = true;
      } catch (e: any) {
        livePing = false;
        pingError = e.message;
        console.error(`[HEALTH PING FAULT] ${e.message}`);
      }
    }

    res.json({ 
      status: 'active', 
      db_connected: livePing,
      db_error: dbError || (pingError ? { message: pingError } : null),
      config: {
          host: activeDbConfig.host || activeDbConfig.socketPath || 'unknown',
          user: activeDbConfig.user || 'unknown',
          database: activeDbConfig.database || 'unknown'
      },
      timestamp: Date.now()
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
  // ════════════════════════════════════════════════════════════════════
  //  TENANT MANAGEMENT APIs
  // ════════════════════════════════════════════════════════════════════

  /**
   * GET /api/public/gallery?tenant=slug-or-id
   * Public endpoint — no auth needed.
   * Returns products marked showInGallery=true for a given tenant.
   * Used by the WebGallery component for public visitors.
   */
  app.get('/api/public/gallery', async (req: Request, res: Response) => {
    const tenantParam = (req.query.tenant as string || '').trim();
    try {
      let products: any[] = [];
      let shopSettings: any = {};
      // Default to 'default' when no tenant specified — existing single-shop setup
      let tenantId = tenantParam || 'default';

      if (pool && dbHealthy) {
        // Resolve tenantId from slug or id if tenant param given
        if (tenantParam) {
          const [tr]: any = await pool.query(
            'SELECT id, name, settings FROM tenants WHERE (slug=? OR id=?) AND status="active"',
            [tenantParam, tenantParam]);
          if (tr.length) {
            tenantId     = tr[0].id;
            shopSettings = parseData(tr[0].settings);
          }
        } else {
          // No tenant param — load default shop settings from system_persistence
          try {
            const [sp]: any = await pool.query(
              'SELECT payload FROM system_persistence WHERE tenant_id="default" OR tenant_id IS NULL LIMIT 1');
            if (sp.length) {
              const data = parseData(sp[0].payload);
              shopSettings = data.settings || {};
            }
          } catch {}
        }

        // Try fetching with tenant_id filter
        try {
          const [rows]: any = await pool.query(
            'SELECT id,name,category,brand,data,selling_price,stock_boxes,status FROM products WHERE (tenant_id=? OR tenant_id IS NULL OR tenant_id="") AND status="Active"',
            [tenantId]);
          products = rows.map((p: any) => {
            const d = parseData(p.data);
            return { ...d, id: p.id, name: p.name, category: p.category, brand: p.brand,
              sellingPrice: parseFloat(p.selling_price) || d.sellingPrice || 0,
              stockBoxes: p.stock_boxes || d.stockBoxes || 0, status: p.status };
          }).filter((p: any) => p.showInGallery !== false);
        } catch {
          // tenant_id column may not exist yet — return all active products
          const [rows]: any = await pool.query(
            'SELECT id,name,category,brand,data,selling_price,stock_boxes,status FROM products WHERE status="Active"');
          products = rows.map((p: any) => {
            const d = parseData(p.data);
            return { ...d, id: p.id, name: p.name, category: p.category, brand: p.brand,
              sellingPrice: parseFloat(p.selling_price) || d.sellingPrice || 0,
              stockBoxes: p.stock_boxes || d.stockBoxes || 0, status: p.status };
          }).filter((p: any) => p.showInGallery !== false);
        }
      } else {
        // In-memory fallback
        products = (inMemoryDb?.products || []).filter((p: any) =>
          p.status === 'Active' && p.showInGallery !== false &&
          (!tenantParam || p.tenantId === tenantId));
        shopSettings = inMemoryDb?.settings || {};
      }

      res.json({
        products,
        settings: {
          showroomName:    shopSettings.showroomName    || shopSettings.systemBranding || 'Royal ERP',
          showroomPhone:   shopSettings.showroomPhone   || '',
          showroomAddress: shopSettings.showroomAddress || '',
          categories:      shopSettings.categories      || [],
          whatsappNumber:  shopSettings.whatsappNumber  || shopSettings.showroomPhone || '',
        },
      });
    } catch (err: any) {
      console.error('[PUBLIC GALLERY]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/admin/diagnose?key=test
   * Shows exact DB state — what's in each tenant's data
   */
  app.get('/api/admin/diagnose', async (req: Request, res: Response) => {
    if (req.query.key !== SUPER_ADMIN_KEY) return res.status(403).json({ error:'Wrong key' });
    try {
      const result: any = { dbHealthy, inMemoryProductCount: inMemoryDb?.products?.length || 0 };
      if (pool && dbHealthy) {
        const [spRows]: any = await pool.query('SELECT id, tenant_id, updated_at, LENGTH(payload) as payload_size FROM system_persistence ORDER BY updated_at DESC');
        result.system_persistence = spRows;
        const [prodCounts]: any = await pool.query('SELECT tenant_id, COUNT(*) as count FROM products GROUP BY tenant_id');
        result.product_counts_by_tenant = prodCounts;
        const [saleCounts]: any = await pool.query('SELECT tenant_id, COUNT(*) as count FROM sales GROUP BY tenant_id');
        result.sale_counts_by_tenant = saleCounts;
        const [tenants]: any = await pool.query('SELECT id, name, slug FROM tenants');
        result.tenants = tenants;
      }
      result.inMemory = {
        products: inMemoryDb?.products?.length || 0,
        sales: inMemoryDb?.sales?.length || 0,
        users: inMemoryDb?.users?.length || 0,
      };
      res.json(result);
    } catch(e:any) { res.status(500).json({ error: e.message }); }
  });

  /**
   * POST /api/admin/fix-default-tenant?key=test
   * Fixes the system_persistence tenant_id for default shop
   * and force-reloads inMemoryDb from DB
   */
  app.post('/api/admin/fix-default-tenant', async (req: Request, res: Response) => {
    if (req.query.key !== SUPER_ADMIN_KEY) return res.status(403).json({ error:'Wrong key' });
    try {
      if (pool && dbHealthy) {
        // Step 1: Fix system_persistence — ensure global_master belongs to default
        await pool.query(
          'UPDATE system_persistence SET tenant_id = "default" WHERE id = "global_master"'
        );
        // Step 2: Fix products — anything with NULL or empty tenant_id → default
        await pool.query(
          'UPDATE products SET tenant_id = "default" WHERE tenant_id IS NULL OR tenant_id = ""'
        );
        await pool.query(
          'UPDATE sales SET tenant_id = "default" WHERE tenant_id IS NULL OR tenant_id = ""'
        );
        await pool.query(
          'UPDATE purchases SET tenant_id = "default" WHERE tenant_id IS NULL OR tenant_id = ""'
        );
        await pool.query(
          'UPDATE users SET tenant_id = "default" WHERE tenant_id IS NULL OR tenant_id = ""'
        );
        // Step 3: Force reload inMemoryDb from DB
        inMemoryDb = null as any;
        await readFromDb();
        res.json({ success: true, message: 'Default tenant fixed and inMemoryDb reloaded', products: inMemoryDb?.products?.length || 0 });
      } else {
        res.json({ success: false, message: 'DB not connected' });
      }
    } catch(e:any) { res.status(500).json({ error: e.message }); }
  });

  // ════════════════════════════════════════════════════════════════════════
  //  TWO-FACTOR AUTHENTICATION (TOTP — Google Authenticator compatible)
  // ════════════════════════════════════════════════════════════════════════

  /** TOTP engine — pure Node.js crypto, no external library */
  const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  const base32Encode = (buf: Buffer): string => {
    let result = ''; let bits = 0; let val = 0;
    for (const byte of buf) {
      val = (val << 8) | byte; bits += 8;
      while (bits >= 5) { result += base32Chars[(val >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) result += base32Chars[(val << (5 - bits)) & 31];
    return result;
  };

  const base32Decode = (str: string): Buffer => {
    const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
    const bytes: number[] = [];
    let bits = 0; let val = 0;
    for (const ch of clean) {
      val = (val << 5) | base32Chars.indexOf(ch); bits += 5;
      if (bits >= 8) { bytes.push((val >>> (bits - 8)) & 255); bits -= 8; }
    }
    return Buffer.from(bytes);
  };

  const generateTOTP = (secret: string, counter: number): string => {
    const key = base32Decode(secret);
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset+1] << 16) | (hmac[offset+2] << 8) | hmac[offset+3];
    return (code % 1000000).toString().padStart(6, '0');
  };

  const verifyTOTP = (secret: string, token: string): boolean => {
    const counter = Math.floor(Date.now() / 1000 / 30);
    for (let i = -2; i <= 2; i++) { // ±2 windows = ±60s clock drift
      if (generateTOTP(secret, counter + i) === token) return true;
    }
    return false;
  };

  const generateTOTPSecret = (): string => base32Encode(crypto.randomBytes(20));

  /** POST /api/auth/2fa/setup — generate a new TOTP secret for a user */
  app.post('/api/auth/2fa/setup', async (req: Request, res: Response) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const secret = generateTOTPSecret();
    // Store temporarily — user must verify before it's saved permanently
    res.json({ secret, otpauthUrl: `otpauth://totp/RoyalERP:${userId}?secret=${secret}&issuer=RoyalERP&algorithm=SHA1&digits=6&period=30` });
  });

  /** POST /api/auth/2fa/verify — verify TOTP token and enable 2FA on the user */
  app.post('/api/auth/2fa/verify', async (req: Request, res: Response) => {
    const { userId, secret, token } = req.body;
    if (!userId || !secret || !token) return res.status(400).json({ error: 'userId, secret, token required' });
    if (!verifyTOTP(secret, token.toString().trim())) return res.status(401).json({ error: 'Invalid OTP — check your authenticator app' });
    // Save secret to user record
    try {
      if (pool && dbHealthy) {
        const [rows]: any = await pool.query('SELECT data FROM users WHERE id=?', [userId]);
        if (rows.length) {
          const d = parseData(rows[0].data);
          d.totpSecret = secret; d.twoFactorEnabled = true;
          await pool.query('UPDATE users SET data=?, updated_at=? WHERE id=?', [JSON.stringify(d), Date.now(), userId]);
        }
      } else {
        const u = inMemoryDb?.users?.find((x: any) => x.id === userId);
        if (u) { u.totpSecret = secret; u.twoFactorEnabled = true; }
      }
      res.json({ success: true, message: '2FA enabled successfully' });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  /** POST /api/auth/2fa/disable — disable 2FA for a user */
  app.post('/api/auth/2fa/disable', async (req: Request, res: Response) => {
    const { userId, token } = req.body;
    if (!userId || !token) return res.status(400).json({ error: 'userId and token required' });
    try {
      let secret = '';
      if (pool && dbHealthy) {
        const [rows]: any = await pool.query('SELECT data FROM users WHERE id=?', [userId]);
        if (rows.length) { const d = parseData(rows[0].data); secret = d.totpSecret || ''; }
      }
      if (!secret || !verifyTOTP(secret, token.toString().trim()))
        return res.status(401).json({ error: 'Invalid OTP' });
      if (pool && dbHealthy) {
        const [rows]: any = await pool.query('SELECT data FROM users WHERE id=?', [userId]);
        if (rows.length) {
          const d = parseData(rows[0].data);
          delete d.totpSecret; d.twoFactorEnabled = false;
          await pool.query('UPDATE users SET data=?, updated_at=? WHERE id=?', [JSON.stringify(d), Date.now(), userId]);
        }
      }
      res.json({ success: true, message: '2FA disabled' });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  /** POST /api/auth/2fa/admin-reset — admin force-disables 2FA for a user (lost phone scenario) */
  app.post('/api/auth/2fa/admin-reset', async (req: Request, res: Response) => {
    const { userId, adminId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    // Only allow if requester is admin of the same tenant
    const tenantId = req.tenantId || 'default';
    try {
      let adminOk = false;
      if (pool && dbHealthy) {
        const [adminRows]: any = await pool.query(
          'SELECT id, role FROM users WHERE id=? AND (tenant_id=? OR tenant_id IS NULL)',
          [adminId, tenantId]
        );
        adminOk = adminRows.length > 0 && ['Admin','admin'].includes(adminRows[0].role);
      } else {
        const admin = inMemoryDb?.users?.find((u: any) => u.id === adminId);
        adminOk = admin && ['Admin','admin'].includes(admin.role);
      }
      if (!adminOk) return res.status(403).json({ error: 'Only admin users can reset 2FA' });

      if (pool && dbHealthy) {
        const [rows]: any = await pool.query('SELECT data FROM users WHERE id=?', [userId]);
        if (rows.length) {
          const d = parseData(rows[0].data);
          delete d.totpSecret; d.twoFactorEnabled = false;
          await pool.query('UPDATE users SET data=?, updated_at=? WHERE id=?', [JSON.stringify(d), Date.now(), userId]);
        }
      } else {
        const u = inMemoryDb?.users?.find((x: any) => x.id === userId);
        if (u) { delete (u as any).totpSecret; (u as any).twoFactorEnabled = false; }
      }
      console.log(`[2FA] Admin ${adminId} reset 2FA for user ${userId}`);
      res.json({ success: true, message: '2FA has been disabled for this user' });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  /** POST /api/auth/2fa/check — check if login OTP is valid (called after password step) */
  app.post('/api/auth/2fa/check', async (req: Request, res: Response) => {
    const { userId, token } = req.body;
    if (!userId || !token) return res.status(400).json({ error: 'userId and token required' });
    try {
      let secret = '';
      if (pool && dbHealthy) {
        const [rows]: any = await pool.query('SELECT data FROM users WHERE id=?', [userId]);
        if (rows.length) { const d = parseData(rows[0].data); secret = d.totpSecret || ''; }
      } else {
        const u = inMemoryDb?.users?.find((x: any) => x.id === userId);
        if (u) secret = (u as any).totpSecret || '';
      }
      if (!secret) return res.status(400).json({ error: '2FA not set up for this user' });
      if (!verifyTOTP(secret, token.toString().trim()))
        return res.status(401).json({ error: 'Invalid OTP. Try again.' });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });


  /**
   * POST /api/admin/migrate-default-tenant?key=test
   * One-time migration: moves all 'default' tenant data to a named tenant.
   * Run ONCE to convert the base URL shop into a proper tenant.
   */
  app.post('/api/admin/migrate-default-tenant', async (req: Request, res: Response) => {
    if (req.query.key !== SUPER_ADMIN_KEY) return res.status(403).json({ error:'Wrong key' });
    const { shopName, slug, ownerEmail } = req.body;
    if (!shopName || !slug || !ownerEmail) return res.status(400).json({ error:'shopName, slug, ownerEmail required' });
    if (!pool || !dbHealthy) return res.status(503).json({ error:'DB not connected' });

    const tenantId = `${slug}-${crypto.randomBytes(4).toString('hex')}`;
    const now      = Date.now();

    try {
      // 1. Create tenant record
      await pool.query(
        'INSERT IGNORE INTO tenants (id, name, slug, owner_email, plan, status, settings, created_at) VALUES (?,?,?,?,?,?,?,?)',
        [tenantId, shopName, slug, ownerEmail, 'pro', 'active', '{}', now]
      );

      // 2. Migrate all default-tagged rows in every table
      const tables = [
        { table:'products',           col:'tenant_id' },
        { table:'sales',              col:'tenant_id' },
        { table:'purchases',          col:'tenant_id' },
        { table:'vendor_orders',      col:'tenant_id' },
        { table:'users',              col:'tenant_id' },
        { table:'loading_charges',    col:'tenant_id' },
        { table:'gallery_leads',      col:'tenant_id' },
      ];
      const results: any = {};
      for (const { table, col } of tables) {
        try {
          const [r]: any = await pool.query(
            `UPDATE ${table} SET ${col}=? WHERE ${col}='default' OR ${col} IS NULL OR ${col}=''`,
            [tenantId]
          );
          results[table] = r.affectedRows;
        } catch (e: any) { results[table] = `error: ${e.message}`; }
      }

      // 3. Migrate system_persistence
      const [sp]: any = await pool.query(
        `UPDATE system_persistence SET tenant_id=? WHERE id='global_master' AND (tenant_id='default' OR tenant_id IS NULL OR tenant_id='')`,
        [tenantId]
      );
      results.system_persistence = sp.affectedRows;

      // 4. Force reload inMemoryDb (it now has no default data)
      inMemoryDb = null as any;

      res.json({
        success: true,
        tenantId,
        slug,
        loginUrl: `/?tenant=${slug}`,
        migrated: results,
        message: `Default tenant migrated to "${shopName}" (slug: ${slug}). Update your bookmarks to /?tenant=${slug}`
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });


  /** POST /api/admin/reset-user-password?key=test
   * Emergency: reset a user's password by email + tenantId.
   * Use when migrated users can't login because password wasn't in DB.
   */
  app.post('/api/admin/reset-user-password', async (req: Request, res: Response) => {
    if (req.query.key !== SUPER_ADMIN_KEY) return res.status(403).json({ error:'Wrong key' });
    const { email, newPassword, tenantId } = req.body;
    if (!email || !newPassword) return res.status(400).json({ error:'email + newPassword required' });
    if (!pool || !dbHealthy) return res.status(503).json({ error:'DB not connected' });
    try {
      // Find user rows matching email (any tenant if tenantId not specified)
      const [rows]: any = await pool.query(
        'SELECT id, data, tenant_id FROM users WHERE LOWER(email)=LOWER(?)',
        [email.trim()]
      );
      if (!rows.length) return res.status(404).json({ error:'User not found: ' + email });
      const results = [];
      for (const row of rows) {
        if (tenantId && row.tenant_id !== tenantId) continue;
        const d = parseData(row.data) || {};
        d.password = newPassword;
        await pool.query('UPDATE users SET data=?, updated_at=? WHERE id=?',
          [JSON.stringify(d), Date.now(), row.id]);
        results.push({ id: row.id, tenant_id: row.tenant_id, updated: true });
      }
      if (!results.length) return res.status(404).json({ error:'No matching user for tenantId: ' + tenantId });
      res.json({ success: true, updated: results });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  /** GET /api/superadmin/ping — no auth needed, confirms tenant API is active */
  app.get('/api/superadmin/ping', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      tenantApiActive: true,
      serverVersion: '3.2.0-multitenant',
      keyHint: 'Set SUPER_ADMIN_KEY env var on Railway, or use default: test',
    });
  });

  /**
   * GET /api/superadmin/debug?key=test&email=admin@mudhol.com
   * Shows exactly what tenants and users exist in the DB.
   * Use this to diagnose login issues.
   */
  app.get('/api/superadmin/debug', async (req: Request, res: Response) => {
    if (req.query.key !== SUPER_ADMIN_KEY) return res.status(403).json({ error: 'Wrong key' });
    const email = (req.query.email as string || '').toLowerCase().trim();
    try {
      const result: any = { dbHealthy, inMemoryUsers: 0 };

      if (pool && dbHealthy) {
        // All tenants
        const [tenants]: any = await pool.query('SELECT id, name, slug, status FROM tenants');
        result.tenants = tenants;

        // All users (or filter by email)
        const [users]: any = email
          ? await pool.query('SELECT id, name, email, role, status, tenant_id FROM users WHERE LOWER(email)=?', [email])
          : await pool.query('SELECT id, name, email, role, status, tenant_id FROM users LIMIT 20');
        result.users = users;

        // Check if tenant_id column exists on users table
        const [cols]: any = await pool.query(
          'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME="users" AND TABLE_SCHEMA=DATABASE()');
        result.userTableColumns = cols.map((c: any) => c.COLUMN_NAME);
      } else {
        result.inMemoryUsers = inMemoryDb?.users?.length || 0;
        result.note = 'DB not connected — using in-memory';
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** POST /api/superadmin/tenants — create new shop */
  app.post('/api/superadmin/tenants', async (req: Request, res: Response) => {
    const key = req.headers['x-super-admin-key'] || req.body.superAdminKey;
    if (key !== SUPER_ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });

    const { shopName, ownerEmail, password, phone, address, gst, plan } = req.body;
    if (!shopName || !ownerEmail || !password)
      return res.status(400).json({ error: 'shopName, ownerEmail and password are required' });

    const baseSlug  = shopName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 28);
    const slug      = `${baseSlug}-${crypto.randomBytes(2).toString('hex')}`; // always unique
    const tenantId  = `${baseSlug}-${crypto.randomBytes(4).toString('hex')}`;
    const now      = Date.now();

    const defaultSettings = {
      showroomName: shopName, showroomPhone: phone||'',
      showroomAddress: address||'', gstNumber: gst||'',
      categories: ['Granite','Marble','Kadapa','Floor Tile','Wall Tile','Adhesive','Sanitary'],
      allowItemImagesInDocs: true, printShowCompanyGst: true, printShowCustomerGst: true,
    };

    const adminUserId = `usr-${crypto.randomBytes(6).toString('hex')}`;
    const adminUser   = {
      id: adminUserId, name: 'Administrator', email: ownerEmail,
      role: 'Admin', status: 'Active', password, baseSalary: 0, tenantId,
      permissions: {
        canViewDashboard:true, canManageInventory:true, canManageSales:true,
        canViewReports:true, canManageUsers:true, canViewCredits:true,
        canManageCustomers:true, canManageReturns:true, canManageGallery:true,
      },
    };

    try {
      if (pool && dbHealthy) {
        const conn = await pool.getConnection();
        try {
          await conn.query(
            'INSERT INTO tenants (id,name,slug,owner_email,owner_phone,address,gst,plan,status,settings,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            [tenantId,shopName,slug,ownerEmail,phone||'',address||'',gst||'',plan||'standard','active',JSON.stringify(defaultSettings),now,now]
          );
          const initialData = {
            users:[adminUser], settings:defaultSettings,
            products:[], sales:[], purchases:[], vendorOrders:[], quotations:[],
            customers:[], offers:[], commissionRules:[], activityLogs:[],
            advances:[], payrollRecords:[], returns:[], galleryLeads:[],
            loadingCharges:[], giftInventory:[], giftIssuances:[], incentiveEntries:[],
            lastUpdated: now,
          };
          // Each tenant gets their own unique persistence row
          // MUST use tenant-specific id to avoid overwriting the default shop's 'global_master'
          await conn.query(
            'INSERT INTO system_persistence (id,tenant_id,payload,updated_at) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload), updated_at=VALUES(updated_at)',
            [`global_master_${tenantId}`,tenantId,JSON.stringify(initialData),now]
          );
          await conn.query(
            'INSERT INTO users (id,tenant_id,name,email,role,status,data,updated_at) VALUES (?,?,?,?,?,?,?,?)',
            [adminUserId,tenantId,'Administrator',ownerEmail,'Admin','Active',JSON.stringify(adminUser),now]
          );
        } finally { conn.release(); }
      }
      tenantCache.set(tenantId, { id:tenantId, name:shopName, slug, status:'active' });
      console.log(`[TENANT] Created: ${tenantId} (${shopName})`);
      res.json({ success:true, tenant:{id:tenantId,name:shopName,slug}, loginUrl:`/?tenant=${slug}`, message:`Shop created. Login: ${ownerEmail} / ${password}` });
    } catch (err: any) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A shop with a very similar name already exists. Try adding your city name — e.g. "Royal Tiles Kadapa".' });
      res.status(500).json({ error: err.message });
    }
  });

  /** POST /api/tenant/login — returns JWT with tenantId */
  app.post('/api/tenant/login', async (req: Request, res: Response) => {
    const { email, password, tenantSlug } = req.body;
    console.log('[LOGIN] attempt — email:', email, '| slug:', tenantSlug, '| dbHealthy:', dbHealthy);
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    // 'default' slug means the original single-tenant shop — use that path
    const effectiveSlug = tenantSlug === 'default' ? '' : (tenantSlug || '');
    try {
      let user: any = null;
      let tenantId  = effectiveSlug ? '' : (process.env.DEFAULT_TENANT_ID || 'default');

      if (pool && dbHealthy) {
        // ── Step 1: resolve tenantId from slug/id ──────────────────────────
        if (tenantSlug) {
          const [tr]: any = await pool.query(
            'SELECT id, slug FROM tenants WHERE (slug=? OR id=?)',
            [tenantSlug, tenantSlug]);
          console.log('[LOGIN] tenants found:', tr.length, tr.map((r:any)=>r.id));
          if (!tr.length) {
            return res.status(401).json({ error: 'Shop not found. URL should be /?tenant=your-shop-slug' });
          }
          tenantId = tr[0].id;
        }

        // ── Step 2: find user by email (with or without tenant filter) ──────
        // First try: WITH tenant_id column
        let ur: any[] = [];
        try {
          const [rows]: any = await pool.query(
            'SELECT id,name,email,role,status,data,tenant_id FROM users WHERE LOWER(email)=LOWER(?)',
            [email.trim()]);
          console.log('[LOGIN] all users with this email:', rows.length,
            rows.map((r:any) => ({ email: r.email, tenant_id: r.tenant_id })));
          // Filter by tenantId if we have one
          ur = tenantId ? rows.filter((r:any) => r.tenant_id === tenantId) : rows;
          console.log('[LOGIN] after tenant filter (tenantId=' + tenantId + '):', ur.length);
        } catch (colErr: any) {
          console.warn('[LOGIN] tenant_id col missing, fallback:', colErr.message);
          const [rows]: any = await pool.query(
            'SELECT id,name,email,role,status,data FROM users WHERE LOWER(email)=LOWER(?)',
            [email.trim()]);
          ur = rows;
        }

        if (ur.length) {
          const u = ur[0];
          const d = parseData(u.data);
          user = { id:u.id, name:u.name, email:u.email, role:u.role,
                   status:u.status, tenantId: u.tenant_id || tenantId, ...d };
          console.log('[LOGIN] user found — stored password length:', (user.password||'').length);
        } else {
          console.warn('[LOGIN] no user found for email:', email.trim(), 'tenantId:', tenantId);
        }
      } else {
        console.warn('[LOGIN] DB not healthy — in-memory only');
      }

      if (!user) return res.status(401).json({
        error: 'Email not found',
        debug: { tenantId, email: email.trim(), dbHealthy }
      });
      if (user.status === 'Suspended') return res.status(403).json({ error:'Account suspended' });
      if (user.password !== password) return res.status(401).json({ error:'Incorrect password' });

      const token = signToken({ tenantId: user.tenantId, userId: user.id, role: user.role });
      const loginPerms = user.permissions || {
        canViewDashboard:true, canManageInventory:true, canManageSales:true,
        canViewReports:true, canManageUsers:true, canViewCredits:true,
        canManageCustomers:true, canManageReturns:true, canManageGallery:true,
      };
      res.json({
        success: true, token,
        user: {
          id:user.id, name:user.name, email:user.email, role:user.role,
          tenantId:user.tenantId, permissions:loginPerms,
          baseSalary:user.baseSalary||0, status:user.status||'Active',
          password:user.password,
          twoFactorEnabled:user.twoFactorEnabled||false,
        },
        expiresAt: new Date(Date.now() + 30*86400*1000).toISOString() });
// Load environment variables from .env file
dotenv.config();

// PORT configuration: Default to 3000 for AI Studio, but respect environment for Railway
const PORT = Number(process.env.PORT) || 3000;
process.env.PORT = PORT.toString();

// NODE_ENV configuration: Default to development for preview, but respect environment
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

console.log(`[SYSTEM] Environment: ${process.env.NODE_ENV}`);
console.log(`[SYSTEM] Port: ${PORT}`);

const BACKUP_DIR = path.join(__dirname, 'backups');
fs.ensureDirSync(BACKUP_DIR);

const parseData = (d: any) => {
  if (!d) return {};
  if (typeof d === 'object') return d;
  try { return JSON.parse(d); } catch (e) { return {}; }
};

// ════════════════════════════════════════════════════════════════
//  MULTI-TENANT ENGINE
// ════════════════════════════════════════════════════════════════

const JWT_SECRET = process.env.JWT_SECRET || 'royal-erp-jwt-secret-change-in-production';
const SUPER_ADMIN_KEY = process.env.SUPER_ADMIN_KEY || 'test';

// Simple JWT implementation (no external lib needed)
const signToken = (payload: any, expiresInDays = 30): string => {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp     = Math.floor(Date.now() / 1000) + expiresInDays * 86400;
  const body    = Buffer.from(JSON.stringify({ ...payload, exp, iat: Math.floor(Date.now()/1000) })).toString('base64url');
  const sig     = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
};

const verifyToken = (token: string): any | null => {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
};

// In-memory tenant cache (loaded from DB on startup)
const tenantCache = new Map<string, any>(); // tenantId → tenant row

// Extend Express Request with tenant context
declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      tenant?:   any;
    }
  }
}

// ── Tenant auth middleware ────────────────────────────────────────────────────
// Attaches tenantId to every authenticated request.
// Skips: /api/tenant/login, /api/tenant/register, /api/superadmin/*
const tenantMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const open = [
    '/api/tenant/login', '/api/tenant/register',
    '/api/superadmin',   '/api/admin/',           // superadmin & admin diagnostic endpoints
    '/api/health', '/api/ping', '/api/public/',
    '/api/auth/2fa/',                             // 2FA endpoints use their own auth
  ];
  if (open.some(p => req.path.startsWith(p)) || !req.path.startsWith('/api/')) {
    return next();
  }

  const token = req.headers.authorization?.replace('Bearer ', '') ||
                (req.query.token as string);

  if (!token) {
    // Legacy single-tenant mode: no token = use default tenant
    req.tenantId = process.env.DEFAULT_TENANT_ID || 'default';
    return next();
  }

  const payload = verifyToken(token);
  if (!payload?.tenantId) {
    return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }

  req.tenantId = payload.tenantId;
  req.tenant   = tenantCache.get(payload.tenantId);
  next();
};

interface DbConfig {
  uri?: string;
  host?: string;
  port?: number;
  user: string;
  password?: string;
  database: string;
  waitForConnections: boolean;
  connectionLimit: number;
  queueLimit: number;
  connectTimeout: number;
  enableKeepAlive: boolean;
  keepAliveInitialDelay: number;
  socketPath?: string;
  ssl?: { rejectUnauthorized: boolean };
}

const isValidUrl = (url: string | undefined): boolean => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('${{')) return false; // Ignore placeholders
  try {
    return trimmed.includes('://');
  } catch {
    return false;
  }
};

const getDbConfig = (): DbConfig => {
  const rawUrl = process.env.DATABASE_URL || process.env.MYSQL_URL;
  const dbUrl = isValidUrl(rawUrl) ? rawUrl!.trim() : null;

  if (dbUrl) {
    const sanitizedUrl = dbUrl.replace(/:([^:@]+)@/, ':****@');
    console.log(`[SYSTEM] Using Database URL: ${sanitizedUrl}`);

    let host = 'unknown';
    let user = 'unknown';
    let database = 'railway';
    try {
      const match = dbUrl.match(/mysql:\/\/([^:]+):?([^@]+)?@([^:/]+):?(\d+)?\/(.+)/);
      if (match) {
        user = match[1];
        host = match[3];
        database = match[5].split('?')[0];
      }
    } catch (e) {}

    return {
      uri: dbUrl,
      host,
      user,
      database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 30000, // Increased timeout for slow connections
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      ssl: dbUrl.includes('sslmode=') ? { rejectUnauthorized: false } : undefined
    } as any;
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'railway',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 30000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
  };
};

let activeDbConfig = getDbConfig();
let pool: Pool | null = null;
let dbHealthy = false;
let dbError: any = null;
let inMemoryDb: any = null;
let lastUpdatedCache: number = 0;
let syncResponseCache: string | null = null;
let isWarmingUp = false;
let warmupPromise: Promise<any> | null = null;
let lastReconnectAttempt = 0;
const RECONNECT_INTERVAL = 60000; // 1 minute

async function loadLatestBackup() {
  try {
    if (!(await fs.pathExists(BACKUP_DIR))) return null;
    const files = await fs.readdir(BACKUP_DIR);
    const backups = files.filter(f => f.startsWith('backup-') && f.endsWith('.json')).sort();
    if (backups.length > 0) {
      const latest = backups[backups.length - 1];
      console.log(`[SYSTEM] Loading latest state from backup: ${latest}`);
      return await fs.readJson(path.join(BACKUP_DIR, latest));
    }
  } catch (err) {
    console.error('[SYSTEM] Failed to load latest backup:', err);
  }
  return null;
}

const getInitialData = () => ({
  products: [], sales: [], purchases: [], vendorOrders: [], quotations: [], payments: [], expenses: [],
  offers: [], commissionRules: [], users: [{ 
    id: '1', name: 'Administrator', role: 'Admin', email: 'admin@royal.com', password: 'admin', 
    status: 'Active', baseSalary: 50000,
    permissions: { canViewDashboard: true, canManageInventory: true, canManageSales: true, canViewReports: true, canManageUsers: true, canViewCredits: true, canManageCustomers: true, canManageReturns: true, canManageGallery: true }
  }],
  customers: [], activityLogs: [], advances: [], payrollRecords: [], returns: [], galleryLeads: [],
  loadingCharges: [],
  settings: {
    showroomName: 'ROYAL TILES & GRANITES',
    systemBranding: 'ROYAL ERP',
    showroomAddress: 'Near NIrani Sugaras Royal Plaza, Main Tile Market',
    showroomCity: 'Mudhol',
    showroomPhone: '+91 98765 43210',
    showroomGst: '29RTX1029384Z5',
    showroomDescription: "Luxury architectural surfaces.",
    galleryTitle: 'Royal Gallery',
    gallerySubTitle: 'Live Inventory',
    customInvoiceFieldLabels: ['Vehicle Number', 'Site Engineer'],
    backendUrl: '',
    backupFrequency: '15min', // '15min', '1hour', 'daily'
    lastUpdated: Date.now()
  }
});

async function initDatabase(config: DbConfig = activeDbConfig) {
  try {
    // Re-check env vars in case they were set after initial load
    const rawUrl = process.env.DATABASE_URL || process.env.MYSQL_URL;
    
    if (rawUrl) {
      console.log("[DEBUG] initDatabase found rawUrl (masked):", rawUrl.substring(0, 10) + "...");
    } else {
      console.warn("[DEBUG] initDatabase: rawUrl is Undefined. Checking config object...");
    }

    const connectionString = isValidUrl(rawUrl) ? rawUrl!.trim() : (config.uri ? config.uri : null);
    const isUsingUrl = !!connectionString;
    
    let target = '';
    if (isUsingUrl) {
      const sanitized = connectionString!.replace(/:([^:@]+)@/, ':****@');
      target = `URL(${sanitized})`;
    } else {
      target = config.socketPath ? `socket:${config.socketPath}` : `${config.host}:${config.port}`;
    }
    
    console.log(`[SYSTEM] Handshaking with MySQL Node: ${target}`);
    
    if (pool) {
      await pool.end().catch(() => {});
    }
    
    // First connect without database to create it if it doesn't exist
    if (!isUsingUrl && config.database) {
      const { database, ...configWithoutDb } = config;
      const tempPool = mysql.createPool(configWithoutDb);
      const tempConn = await tempPool.getConnection();
      await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
      tempConn.release();
      await tempPool.end();
    }
    
    // Now create the actual pool with the database
    if (isUsingUrl) {
      console.log('[DEBUG] Creating pool from connection string...');
      pool = mysql.createPool(connectionString!);
    } else {
      console.log('[DEBUG] Creating pool from config object...');
      pool = mysql.createPool(config);
    }
    
    // Add pool error handler to catch disconnects
    (pool as any).on('error', (err: any) => {
      console.error('⚠️ [POOL ERROR]:', err.message);
      dbHealthy = false;
      dbError = { message: err.message, code: err.code };
    });

    const connection = await pool.getConnection();
    console.log(`✅ [ENGINE] Persistence pool established.`);
    
    // ── Create tenants table first (multi-tenant) ──────────────────────────
    await connection.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id           VARCHAR(64) PRIMARY KEY,
        name         VARCHAR(255) NOT NULL,
        slug         VARCHAR(64) UNIQUE NOT NULL,
        owner_email  VARCHAR(255) NOT NULL,
        owner_phone  VARCHAR(20),
        address      TEXT,
        gst          VARCHAR(20),
        plan         VARCHAR(20) DEFAULT 'standard',
        status       VARCHAR(20) DEFAULT 'active',
        settings     JSON,
        created_at   BIGINT,
        updated_at   BIGINT
      )
    `);

    // ── Add tenant_id to existing tables (safe — skips if already exists) ──
    // Uses INFORMATION_SCHEMA check — works on ALL MySQL versions (5.6, 5.7, 8.x)
    const safeAddTenantId = async (table: string) => {
      try {
        const dbName = (activeDbConfig.database || 'royal_erp');
        const [rows]: any = await connection.query(
          'SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',
          [dbName, table, 'tenant_id']
        );
        if (rows[0].cnt === 0) {
          await connection.query(
            'ALTER TABLE `' + table + '` ADD COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT \'default\''
          );
          console.log('[SCHEMA] Added tenant_id to ' + table);
        }
      } catch (e: any) {
        console.warn('[SCHEMA] tenant_id on ' + table + ': ' + (e as any).message);
      }
    };

    await connection.query(`
      CREATE TABLE IF NOT EXISTS system_persistence (
        id VARCHAR(50) PRIMARY KEY,
        payload LONGTEXT,
        updated_at BIGINT
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS products (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255),
        category VARCHAR(100),
        brand VARCHAR(100),
        stock_boxes INT DEFAULT 0,
        stock_loose INT DEFAULT 0,
        selling_price DECIMAL(10, 2),
        status VARCHAR(20),
        data JSON,
        updated_at BIGINT,
        INDEX idx_updated_at (updated_at),
        INDEX idx_category (category),
        INDEX idx_brand (brand),
        INDEX idx_status (status),
        INDEX idx_status_updated (status, updated_at),
        INDEX idx_status_category_updated (status, category, updated_at),
        INDEX idx_status_brand_updated (status, brand, updated_at),
        INDEX idx_status_cat_brand_updated (status, category, brand, updated_at)
      )
    `);

    // Ensure indexes and virtual columns exist for existing tables
    try {
      const [columns]: any = await connection.query('SHOW COLUMNS FROM products');
      const columnNames = columns.map((c: any) => c.Field);
      
      if (!columnNames.includes('size')) {
        await connection.query('ALTER TABLE products ADD COLUMN size VARCHAR(50) AS (data->>"$.size") VIRTUAL');
      }
      if (!columnNames.includes('grade')) {
        await connection.query('ALTER TABLE products ADD COLUMN grade VARCHAR(50) AS (data->>"$.grade") VIRTUAL');
      }
      if (!columnNames.includes('shade_no')) {
        await connection.query('ALTER TABLE products ADD COLUMN shade_no VARCHAR(50) AS (data->>"$.shadeNo") VIRTUAL');
      }
      if (!columnNames.includes('batch_no')) {
        await connection.query('ALTER TABLE products ADD COLUMN batch_no VARCHAR(50) AS (data->>"$.batchNo") VIRTUAL');
      }

      const [indexes]: any = await connection.query('SHOW INDEX FROM products');
      const indexNames = indexes.map((idx: any) => idx.Key_name);
      
      if (!indexNames.includes('idx_updated_at')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_updated_at (updated_at)');
      }
      if (!indexNames.includes('idx_category')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_category (category)');
      }
      if (!indexNames.includes('idx_brand')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_brand (brand)');
      }
      if (!indexNames.includes('idx_status')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_status (status)');
      }
      if (!indexNames.includes('idx_status_updated')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_status_updated (status, updated_at)');
      }
      if (!indexNames.includes('idx_status_category_updated')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_status_category_updated (status, category, updated_at)');
      }
      if (!indexNames.includes('idx_status_brand_updated')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_status_brand_updated (status, brand, updated_at)');
      }
      if (!indexNames.includes('idx_status_cat_brand_updated')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_status_cat_brand_updated (status, category, brand, updated_at)');
      }
      if (!indexNames.includes('idx_size')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_size (size)');
      }
      if (!indexNames.includes('idx_grade')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_grade (grade)');
      }
      if (!indexNames.includes('idx_shade_no')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_shade_no (shade_no)');
      }
      if (!indexNames.includes('idx_batch_no')) {
        await connection.query('ALTER TABLE products ADD INDEX idx_batch_no (batch_no)');
      }
      console.log('✅ [DB] Database schema and indexes verified.');
    } catch (e) {
      console.error('⚠️ [DB] Error adding indexes/columns:', e);
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS sales (
        id VARCHAR(50) PRIMARY KEY,
        invoice_no VARCHAR(50),
        customer_name VARCHAR(255),
        date VARCHAR(20),
        total_amount DECIMAL(10, 2),
        data JSON,
        updated_at BIGINT,
        INDEX idx_sales_date (date),
        INDEX idx_sales_updated_at (updated_at)
      )
    `);

    // Ensure indexes exist for sales
    try {
      const [indexes]: any = await connection.query('SHOW INDEX FROM sales');
      const indexNames = indexes.map((idx: any) => idx.Key_name);
      if (!indexNames.includes('idx_sales_date')) {
        await connection.query('ALTER TABLE sales ADD INDEX idx_sales_date (date)');
      }
      if (!indexNames.includes('idx_sales_updated_at')) {
        await connection.query('ALTER TABLE sales ADD INDEX idx_sales_updated_at (updated_at)');
      }
    } catch (e) {}

    await connection.query(`
      CREATE TABLE IF NOT EXISTS purchases (
        id VARCHAR(50) PRIMARY KEY,
        vendor_name VARCHAR(255),
        invoice_no VARCHAR(50),
        date VARCHAR(20),
        data JSON,
        updated_at BIGINT,
        INDEX idx_purchases_date (date),
        INDEX idx_purchases_updated_at (updated_at)
      )
    `);

    // Ensure indexes exist for purchases
    try {
      const [indexes]: any = await connection.query('SHOW INDEX FROM purchases');
      const indexNames = indexes.map((idx: any) => idx.Key_name);
      if (!indexNames.includes('idx_purchases_date')) {
        await connection.query('ALTER TABLE purchases ADD INDEX idx_purchases_date (date)');
      }
      if (!indexNames.includes('idx_purchases_updated_at')) {
        await connection.query('ALTER TABLE purchases ADD INDEX idx_purchases_updated_at (updated_at)');
      }
    } catch (e) {}

    await connection.query(`
      CREATE TABLE IF NOT EXISTS vendor_orders (
        id VARCHAR(50) PRIMARY KEY,
        order_no VARCHAR(50),
        vendor_name VARCHAR(255),
        status VARCHAR(50),
        payment_status VARCHAR(50),
        data JSON,
        updated_at BIGINT
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS gallery_leads (
        id VARCHAR(50) PRIMARY KEY,
        customer_name VARCHAR(255),
        customer_mobile VARCHAR(20),
        status VARCHAR(50),
        timestamp VARCHAR(50),
        data JSON,
        updated_at BIGINT,
        INDEX idx_leads_timestamp (timestamp),
        INDEX idx_leads_updated_at (updated_at)
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS loading_charges (
        id VARCHAR(50) PRIMARY KEY,
        product_type VARCHAR(255),
        unit_type VARCHAR(50),
        rate DECIMAL(10, 2),
        per_unit INT,
        is_active BOOLEAN DEFAULT TRUE,
        updated_at BIGINT
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255),
        role VARCHAR(50),
        status VARCHAR(20),
        data JSON,
        updated_at BIGINT,
        INDEX idx_users_updated_at (updated_at),
        INDEX idx_users_email (email)
      )
    `);

    // Ensure updated_at exists in all tables (for existing databases)
    const tables = ['products', 'sales', 'purchases', 'vendor_orders', 'system_persistence', 'loading_charges', 'gallery_leads', 'users'];
    for (const table of tables) {
      try {
        const dbName = (activeDbConfig.database || 'royal_erp');
        const [colRows]: any = await connection.query(
          'SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME="updated_at"',
          [dbName, table]
        );
        if (colRows[0].cnt === 0) {
          await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN updated_at BIGINT DEFAULT 0`);
        }
      } catch (err) { /* column already exists or table not yet created */ }
    }
    
    // ── Add tenant_id column to all tables that need it ─────────────────────
    await safeAddTenantId('system_persistence');
    await safeAddTenantId('products');
    await safeAddTenantId('sales');
    await safeAddTenantId('purchases');
    await safeAddTenantId('vendor_orders');
    await safeAddTenantId('gallery_leads');
    await safeAddTenantId('loading_charges');
    await safeAddTenantId('users');

    // ── Create indexes for fast per-tenant queries ────────────────────────
    const tableIndexes: [string, string][] = [
      ['products','idx_products_tenant'],
      ['sales','idx_sales_tenant'],
      ['users','idx_users_tenant'],
      ['system_persistence','idx_persistence_tenant'],
    ];
    for (const [table, idxName] of tableIndexes) {
      try {
        const [rows]: any = await connection.query(
          'SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?',
          [table, idxName]
        );
        if (rows[0].cnt === 0) {
          await connection.query(`CREATE INDEX \`${idxName}\` ON \`${table}\`(tenant_id)`);
        }
      } catch { /* index may already exist */ }
    }

    // Ensure default admin user exists
    const [userCountRows]: any = await connection.query('SELECT COUNT(*) as count FROM users');
    if (userCountRows[0].count === 0) {
      console.log('💡 [SYSTEM] No users found. Provisioning default Administrator node...');
      const defaultAdmin = getInitialData().users[0];
      await connection.query(
        'INSERT INTO users (id, name, email, role, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [defaultAdmin.id, defaultAdmin.name, defaultAdmin.email, defaultAdmin.role, defaultAdmin.status, JSON.stringify(defaultAdmin), Date.now()]
      );
    }
    
    connection.release();
    dbHealthy = true;
    dbError = null;
    return true;
  } catch (err: any) {
    if (err.code === 'ENOENT' && config.socketPath && process.env.DB_HOST) {
      console.log('⚠️ [SYSTEM] Socket not found. Falling back to TCP/IP...');
      const tcpConfig = { ...config };
      delete tcpConfig.socketPath;
      tcpConfig.host = process.env.DB_HOST;
      tcpConfig.port = parseInt(process.env.DB_PORT || '3306');
      
      // Update active config to persist the working connection method
      activeDbConfig = tcpConfig;
      return initDatabase(tcpConfig);
    }

    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      console.log('⚠️ [SYSTEM] Database unreachable. Starting in OFFLINE MODE (In-Memory).');
      dbHealthy = false;
      dbError = { message: 'Offline Mode (No DB Connection)', code: 'OFFLINE' };
      if (!inMemoryDb) inMemoryDb = getInitialData();
      return false;
    }

    dbHealthy = false;
    dbError = {
      message: err.message,
      code: err.code,
      errno: err.errno,
      sqlState: err.sqlState,
      hint: err.code === 'ECONNREFUSED' ? 'Check if Cloud SQL Proxy is running on port 3306' : 
            err.code === 'ETIMEDOUT' ? 'Database unreachable. Check Firewall/VPC Peering or Authorized Networks.' :
            err.code === 'ER_ACCESS_DENIED_ERROR' ? 'Check DB_USER and DB_PASSWORD' : 'Verify GCP Authorized Networks'
    };
    console.error('❌ [DATABASE ERROR]:', dbError.message);
    if (err.code === 'ETIMEDOUT') {
      console.log('💡 [HINT]: If using Cloud SQL Public IP, add 0.0.0.0/0 to Authorized Networks for testing.');
    }
    console.log('⚠️ [SYSTEM] Falling back to in-memory database.');
    return false;
  }
}

async function startServer() {
  const app = express();
  // Using top-level PORT constant

  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma'],
    credentials: true
  }));
  app.use(compression());
  app.use(bodyParser.json({ limit: '100mb' }));

  // ── TENANT ISOLATION MIDDLEWARE ───────────────────────────────────────────
  // MUST be registered here — reads JWT from Authorization header,
  // sets req.tenantId on every request so all handlers are tenant-scoped
  app.use(tenantMiddleware);

  app.use((req, res, next) => {
    // Add health headers
    res.setHeader('X-System-Persistence', dbHealthy ? 'Relational (Healthy)' : 'In-Memory (Offline)');
    if (dbError) {
      res.setHeader('X-DB-Error', typeof dbError === 'object' ? dbError.message : String(dbError));
    }
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Host: ${req.headers.host}`);
    next();
  });

  // System Boot
  console.log('[SYSTEM] Initializing persistence layer...');
  
  // Initialize with empty data immediately so we can start listening
  inMemoryDb = getInitialData();
  lastUpdatedCache = inMemoryDb.lastUpdated || 0;

  // Load backup and initialize DB in background
  (async () => {
    try {
      const backup = await loadLatestBackup();
      if (backup) {
        console.log('✅ [SYSTEM] Backup loaded into memory.');
        inMemoryDb = backup;
        lastUpdatedCache = inMemoryDb.lastUpdated || 0;
        // Invalidate sync cache since we have new data
        syncResponseCache = null;
      }
    } catch (err) {
      console.error('❌ [SYSTEM] Failed to load backup:', err);
    }

    const dbSuccess = await initDatabase();
    if (dbSuccess) {
      console.log('✅ [SYSTEM] Database connected. Starting background cache warmup...');
      warmupPromise = readFromDb();
      try {
        await warmupPromise;
        console.log('✅ [SYSTEM] Cache warmed successfully from DB');
      } catch (err: any) {
        console.error('❌ [SYSTEM] Cache warmup failed:', err.message);
      }
    } else {
      console.log('⚠️ [SYSTEM] Database unreachable. Running in Backup-Only mode.');
    }
  })();

  async function readFromDb() {
    // If we are already warming up, return the existing promise
    if (isWarmingUp && warmupPromise) return warmupPromise;

    // If we have a healthy cache and it's recently updated, return it
    if (inMemoryDb && dbHealthy && pool && !isWarmingUp && lastUpdatedCache > 0) {
      return inMemoryDb;
    }

    if (!dbHealthy || !pool) {
      const now = Date.now();
      if (now - lastReconnectAttempt > RECONNECT_INTERVAL) {
        lastReconnectAttempt = now;
        console.log('[SYSTEM] Attempting background DB reconnection...');
        initDatabase().catch(err => console.error('[RECONNECT FAULT]', err.message));
      }
      return inMemoryDb || getInitialData();
    }
  
  isWarmingUp = true;
  const startTime = Date.now();
  
  warmupPromise = (async () => {
    try {
      console.log('[DB] Starting full data fetch...');
      
      // Fetch all relational data in parallel for speed
      const [
        [metaRows],
        [productsRows],
        [salesRows],
        [purchasesRows],
        [vendorOrdersRows],
        [loadingChargesRows],
        [galleryLeadsRows],
        [usersRows]
      ]: any = await Promise.all([
        pool.query('SELECT payload FROM system_persistence WHERE id = "global_master" AND (tenant_id IS NULL OR tenant_id = "" OR tenant_id = "default") ORDER BY updated_at DESC LIMIT 1'),
        pool.query('SELECT id, name, category, brand, stock_boxes, stock_loose, selling_price, status, data, updated_at FROM products WHERE (tenant_id IS NULL OR tenant_id = "" OR tenant_id = "default")'),
        pool.query('SELECT id, invoice_no, customer_name, date, total_amount, data, updated_at FROM sales WHERE (tenant_id IS NULL OR tenant_id = "" OR tenant_id = "default")'),
        pool.query('SELECT id, vendor_name, invoice_no, date, data, updated_at FROM purchases WHERE (tenant_id IS NULL OR tenant_id = "" OR tenant_id = "default")'),
        pool.query('SELECT id, order_no, vendor_name, status, payment_status, data, updated_at FROM vendor_orders WHERE (tenant_id IS NULL OR tenant_id = "" OR tenant_id = "default")'),
        pool.query('SELECT id, product_type, unit_type, rate, per_unit, is_active, updated_at FROM loading_charges WHERE (tenant_id IS NULL OR tenant_id = "" OR tenant_id = "default")'),
        pool.query('SELECT id, customer_name, customer_mobile, status, `timestamp`, data, updated_at FROM gallery_leads WHERE (tenant_id IS NULL OR tenant_id = "" OR tenant_id = "default")'),
        pool.query('SELECT id, name, email, role, status, data, updated_at FROM users WHERE (tenant_id IS NULL OR tenant_id = "" OR tenant_id = "default")')
      ]);

      let baseData = metaRows.length > 0 ? JSON.parse(metaRows[0].payload) : getInitialData();

      // Optimize mapping: Only parse JSON if necessary and use a single pass
      const products = productsRows.map((p: any) => ({ 
        ...parseData(p.data), 
        id: p.id, name: p.name, category: p.category, brand: p.brand, 
        stockBoxes: p.stock_boxes, stockLoose: p.stock_loose, 
        sellingPrice: parseFloat(p.selling_price), status: p.status,
        updatedAt: p.updated_at
      }));

      const sales = salesRows.map((s: any) => ({ 
        ...parseData(s.data), 
        id: s.id, invoiceNo: s.invoice_no, customerName: s.customer_name, 
        date: s.date, totalAmount: parseFloat(s.total_amount),
        updatedAt: s.updated_at
      }));
      
      const purchases = purchasesRows.map((p: any) => ({ 
        ...parseData(p.data), 
        id: p.id, vendorName: p.vendor_name, gstInvoiceNo: p.invoice_no, date: p.date,
        updatedAt: p.updated_at
      }));
      
      const vendorOrders = vendorOrdersRows.map((o: any) => ({ 
        ...parseData(o.data), 
        id: o.id, orderNo: o.order_no, vendorName: o.vendor_name, 
        status: o.status, paymentStatus: o.payment_status,
        updatedAt: o.updated_at
      }));

      const loadingCharges = loadingChargesRows.map((l: any) => ({
        id: l.id,
        productType: l.product_type,
        unitType: l.unit_type,
        rate: parseFloat(l.rate),
        perUnit: l.per_unit,
        isActive: !!l.is_active,
        updatedAt: l.updated_at
      }));

      const galleryLeads = galleryLeadsRows.map((l: any) => ({
        ...parseData(l.data),
        id: l.id,
        customerName: l.customer_name,
        customerMobile: l.customer_mobile,
        status: l.status,
        timestamp: l.timestamp,
        updatedAt: l.updated_at
      }));

      const users = usersRows.map((u: any) => ({
        ...parseData(u.data),
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
        updatedAt: u.updated_at
      }));

      // Calculate global lastUpdated efficiently
      let maxTs = baseData.lastUpdated || 0;
      productsRows.forEach((p: any) => { if (p.updated_at > maxTs) maxTs = p.updated_at; });
      salesRows.forEach((s: any) => { if (s.updated_at > maxTs) maxTs = s.updated_at; });
      purchasesRows.forEach((p: any) => { if (p.updated_at > maxTs) maxTs = p.updated_at; });
      vendorOrdersRows.forEach((o: any) => { if (o.updated_at > maxTs) maxTs = o.updated_at; });
      loadingChargesRows.forEach((l: any) => { if (l.updated_at > maxTs) maxTs = l.updated_at; });
      galleryLeadsRows.forEach((l: any) => { if (l.updated_at > maxTs) maxTs = l.updated_at; });
      usersRows.forEach((u: any) => { if (u.updated_at > maxTs) maxTs = u.updated_at; });

      const dbData = {
        ...baseData,
        lastUpdated: maxTs,
        products,
        sales,
        purchases,
        vendorOrders,
        loadingCharges,
        galleryLeads,
        users
      };

      // Recovery Check: If in-memory data is newer, it means we had offline writes.
      if (inMemoryDb && inMemoryDb.lastUpdated > (dbData.lastUpdated || 0)) {
        console.log(`[RECOVERY] In-memory data (v${inMemoryDb.lastUpdated}) is newer than DB (v${dbData.lastUpdated}).`);
        const recoveryData = { ...inMemoryDb };
        syncInMemoryToRelationalDb(recoveryData).catch(err => console.error('[RECOVERY SYNC FAILED]', err.message));
        isWarmingUp = false;
        warmupPromise = null;
        return recoveryData;
      }

      inMemoryDb = dbData;
      lastUpdatedCache = dbData.lastUpdated;
      
      // Pre-populate sync cache for full syncs
      const prunedData = { ...dbData };
      if (prunedData.activityLogs && prunedData.activityLogs.length > 200) {
        prunedData.activityLogs = prunedData.activityLogs.slice(0, 200);
      }
      syncResponseCache = JSON.stringify({
        ...prunedData,
        _metadata: {
          db_healthy: dbHealthy,
          is_fallback: !dbHealthy,
          is_warming_up: false,
          timestamp: Date.now()
        }
      });
      
      console.log(`[DB] Fetch completed in ${Date.now() - startTime}ms. Total Sales: ${sales.length}`);
      isWarmingUp = false;
      warmupPromise = null;
      return dbData;
    } catch (err: any) {
      console.error('[READ FAULT]', err.message);
      dbHealthy = false;
      isWarmingUp = false;
      warmupPromise = null;
      return inMemoryDb || getInitialData();
    }
  })();
  
  return warmupPromise;
}

async function writeToDb(data: any) {
  // Merge meta-data into inMemoryDb cache to avoid overwriting relational data
  if (!inMemoryDb) inMemoryDb = getInitialData();
  inMemoryDb = { ...inMemoryDb, ...data };

  if (!dbHealthy || !pool) {
    return;
  }

  try {
    // CRITICAL: Always save the FULL meta-data state from inMemoryDb to prevent partial overwrites
    // We exclude relational tables that have their own dedicated tables
    const { products, sales, purchases, vendorOrders, loadingCharges, galleryLeads, users, ...metaData } = inMemoryDb;
    const jsonStr = JSON.stringify(metaData);
    const now = Date.now();
    await pool.query(
      'INSERT INTO system_persistence (id, tenant_id, payload, updated_at) VALUES ("global_master", "default", ?, ?) ON DUPLICATE KEY UPDATE payload = ?, updated_at = ?',
      [jsonStr, now, jsonStr, now]
    );
    
    // Invalidate sync cache whenever we write to DB
    syncResponseCache = null;
  } catch (err: any) {
    console.error('[WRITE FAULT]', err.message);
    dbHealthy = false;
  }
}

async function syncInMemoryToRelationalDb(data: any) {
  if (!pool || !dbHealthy) return;
  
  try {
    console.log('[SYSTEM] Syncing relational data from memory to DB (Optimized)...');
    
    // 1. Meta data
    const { products, sales, purchases, vendorOrders, loadingCharges, galleryLeads, users, ...metaData } = data;
    await writeToDb(metaData);

    // 2. Products (Bulk)
    if (data.products && data.products.length > 0) {
      const values = data.products.map((p: any) => [
        p.id, p.name, p.category, p.brand, p.stockBoxes, p.stockLoose, p.sellingPrice, p.status, JSON.stringify(p), Date.now()
      ]);
      await pool.query(
        'INSERT INTO products (id, name, category, brand, stock_boxes, stock_loose, selling_price, status, data, updated_at) VALUES ? ON DUPLICATE KEY UPDATE name=VALUES(name), category=VALUES(category), brand=VALUES(brand), stock_boxes=VALUES(stock_boxes), stock_loose=VALUES(stock_loose), selling_price=VALUES(selling_price), status=VALUES(status), data=VALUES(data), updated_at=VALUES(updated_at)',
        [values]
      );
    }

    // 3. Sales (Bulk)
    if (data.sales && data.sales.length > 0) {
      const values = data.sales.map((s: any) => [
        s.id, s.invoiceNo, s.customerName, s.date, s.totalAmount, JSON.stringify(s), Date.now()
      ]);
      await pool.query(
        'INSERT INTO sales (id, invoice_no, customer_name, date, total_amount, data, updated_at) VALUES ? ON DUPLICATE KEY UPDATE invoice_no=VALUES(invoice_no), customer_name=VALUES(customer_name), date=VALUES(date), total_amount=VALUES(total_amount), data=VALUES(data), updated_at=VALUES(updated_at)',
        [values]
      );
    }

    // 4. Purchases (Bulk)
    if (data.purchases && data.purchases.length > 0) {
      const values = data.purchases.map((p: any) => [
        p.id, p.vendorName, p.gstInvoiceNo, p.date, JSON.stringify(p), Date.now()
      ]);
      await pool.query(
        'INSERT INTO purchases (id, vendor_name, invoice_no, date, data, updated_at) VALUES ? ON DUPLICATE KEY UPDATE vendor_name=VALUES(vendor_name), invoice_no=VALUES(invoice_no), date=VALUES(date), data=VALUES(data), updated_at=VALUES(updated_at)',
        [values]
      );
    }

    // 5. Loading Charges (Bulk)
    if (data.loadingCharges && data.loadingCharges.length > 0) {
      const values = data.loadingCharges.map((l: any) => [
        l.id, l.productType, l.unitType, l.rate, l.perUnit, l.isActive ? 1 : 0, Date.now()
      ]);
      await pool.query(
        'INSERT INTO loading_charges (id, product_type, unit_type, rate, per_unit, is_active, updated_at) VALUES ? ON DUPLICATE KEY UPDATE product_type=VALUES(product_type), unit_type=VALUES(unit_type), rate=VALUES(rate), per_unit=VALUES(per_unit), is_active=VALUES(is_active), updated_at=VALUES(updated_at)',
        [values]
      );
    }

    // 5. Vendor Orders (Bulk)
    if (data.vendorOrders && data.vendorOrders.length > 0) {
      const values = data.vendorOrders.map((o: any) => [
        o.id, o.orderNo, o.vendorName, o.status, o.paymentStatus, JSON.stringify(o), Date.now()
      ]);
      await pool.query(
        'INSERT INTO vendor_orders (id, order_no, vendor_name, status, payment_status, data, updated_at) VALUES ? ON DUPLICATE KEY UPDATE order_no=VALUES(order_no), vendor_name=VALUES(vendor_name), status=VALUES(status), payment_status=VALUES(payment_status), data=VALUES(data), updated_at=VALUES(updated_at)',
        [values]
      );
    }

    // 6. Gallery Leads (Bulk)
    if (data.galleryLeads && data.galleryLeads.length > 0) {
      const values = data.galleryLeads.map((l: any) => [
        l.id, l.customerName, l.customerMobile, l.status, l.timestamp, JSON.stringify(l), Date.now()
      ]);
      await pool.query(
        'INSERT INTO gallery_leads (id, customer_name, customer_mobile, status, `timestamp`, data, updated_at) VALUES ? ON DUPLICATE KEY UPDATE customer_name=VALUES(customer_name), customer_mobile=VALUES(customer_mobile), status=VALUES(status), `timestamp`=VALUES(timestamp), data=VALUES(data), updated_at=VALUES(updated_at)',
        [values]
      );
    }

    // 7. Users (Bulk)
    if (data.users && data.users.length > 0) {
      const values = data.users.map((u: any) => [
        u.id, u.name, u.email, u.role, u.status, JSON.stringify(u), Date.now()
      ]);
      await pool.query(
        'INSERT INTO users (id, name, email, role, status, data, updated_at) VALUES ? ON DUPLICATE KEY UPDATE name=VALUES(name), email=VALUES(email), role=VALUES(role), status=VALUES(status), data=VALUES(data), updated_at=VALUES(updated_at)',
        [values]
      );
    }

    console.log('[SYSTEM] Recovery sync completed successfully.');
  } catch (err: any) {
    console.error('[SYNC FAULT]', err.message);
  }
}

// ... (middleware setup)

  function updateCache(collection: string, item: any, isDelete: boolean = false) {
    if (!inMemoryDb) inMemoryDb = getInitialData();
    if (!inMemoryDb[collection]) inMemoryDb[collection] = [];
    
    const now = Date.now();
    if (isDelete) {
      inMemoryDb[collection] = inMemoryDb[collection].filter((x: any) => x.id !== (typeof item === 'string' ? item : item.id));
    } else {
      const idx = inMemoryDb[collection].findIndex((x: any) => x.id === item.id);
      const itemWithTs = { ...item, updatedAt: now };
      if (idx >= 0) inMemoryDb[collection][idx] = itemWithTs;
      else inMemoryDb[collection].push(itemWithTs);
    }
    inMemoryDb.lastUpdated = now;
    syncResponseCache = null; // Invalidate cache
  }

  // Paginated Endpoints for Large Collections
  app.get('/api/products', async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = (page - 1) * limit;
      const search = req.query.search as string;
      const category = req.query.category as string;
      const brand = req.query.brand as string;
      const size = req.query.size as string;
      const stockStatus = req.query.stockStatus as string;
      const grade = req.query.grade as string;
      const status = req.query.status as string;

      if (!pool || !dbHealthy) {
        // Fallback to in-memory if DB is down
        let all = inMemoryDb?.products || [];
        
        if (search && typeof search === 'string') {
          const words = search.toLowerCase().trim().split(/\s+/);
          all = all.filter((p: any) => 
            words.every(word => 
              (p.name || '').toLowerCase().includes(word) || 
              (p.brand || '').toLowerCase().includes(word) ||
              (p.category || '').toLowerCase().includes(word) ||
              (p.size || '').toLowerCase().includes(word) ||
              (p.shadeNo || '').toLowerCase().includes(word) ||
              (p.batchNo || '').toLowerCase().includes(word)
            )
          );
        }
        if (category && category !== 'All') all = all.filter((p: any) => p.category === category);
        if (brand && brand !== 'All') all = all.filter((p: any) => p.brand === brand);
        if (size && size !== 'All') all = all.filter((p: any) => p.size === size);
        if (grade && grade !== 'All') all = all.filter((p: any) => p.grade === grade);
        if (status && status !== 'All') all = all.filter((p: any) => p.status === status);
        
        if (stockStatus === 'Low') all = all.filter((p: any) => p.stockBoxes <= (p.reorderLevel || 0));
        else if (stockStatus === 'Out') all = all.filter((p: any) => p.stockBoxes <= 0);
        else if (stockStatus === 'In') all = all.filter((p: any) => p.stockBoxes > 0);

        return res.json({ 
          data: all.slice(offset, offset + limit),
          total: all.length,
          page,
          limit
        });
      }

      let query = 'SELECT id, name, category, brand, stock_boxes, stock_loose, selling_price, status, data, updated_at FROM products WHERE 1=1';
      let countQuery = 'SELECT COUNT(*) as count FROM products WHERE 1=1';
      const params: any[] = [];

      if (search && typeof search === 'string') {
        const words = search.trim().split(/\s+/);
        for (const word of words) {
          const searchClause = ' AND (name LIKE ? OR brand LIKE ? OR category LIKE ? OR size LIKE ? OR shade_no LIKE ? OR batch_no LIKE ?)';
          query += searchClause;
          countQuery += searchClause;
          const searchParam = `%${word}%`;
          params.push(searchParam, searchParam, searchParam, searchParam, searchParam, searchParam);
        }
      }

      if (category && category !== 'All') {
        query += ' AND category = ?';
        countQuery += ' AND category = ?';
        params.push(category);
      }
      if (brand && brand !== 'All') {
        query += ' AND brand = ?';
        countQuery += ' AND brand = ?';
        params.push(brand);
      }
      if (size && size !== 'All') {
        query += ' AND (size = ? OR size LIKE ?)';
        countQuery += ' AND (size = ? OR size LIKE ?)';
        params.push(size, size);
      }
      if (grade && grade !== 'All') {
        query += ' AND (grade = ? OR grade LIKE ?)';
        countQuery += ' AND (grade = ? OR grade LIKE ?)';
        params.push(grade, grade);
      }
      if (status && status !== 'All') {
        query += ' AND status = ?';
        countQuery += ' AND status = ?';
        params.push(status);
      }
      if (stockStatus === 'Low') {
        query += ' AND stock_boxes <= CAST(COALESCE(data->>"$.reorderLevel", "0") AS UNSIGNED)';
        countQuery += ' AND stock_boxes <= CAST(COALESCE(data->>"$.reorderLevel", "0") AS UNSIGNED)';
      } else if (stockStatus === 'Out') {
        query += ' AND stock_boxes <= 0';
        countQuery += ' AND stock_boxes <= 0';
      } else if (stockStatus === 'In') {
        query += ' AND stock_boxes > 0';
        countQuery += ' AND stock_boxes > 0';
      }

      query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
      const queryParams = [...params, limit, offset];

      const conn = await pool.getConnection();
      try {
        // Increase sort buffer for this session to handle large sorts
        await conn.query('SET SESSION sort_buffer_size = 33554432'); // 32MB
        const [rows]: any = await conn.query(query, queryParams);
        const [[{ count }]]: any = await conn.query(countQuery, params);

        res.json({
          data: rows.map((p: any) => {
            let parsedData = {};
            try {
              if (p.data) {
                parsedData = typeof p.data === 'string' ? JSON.parse(p.data) : p.data;
              }
            } catch (e) {
              console.error('Error parsing product data:', e);
            }
            
            return {
              ...parsedData,
              id: p.id,
              name: p.name,
              category: p.category,
              brand: p.brand,
              stockBoxes: p.stock_boxes,
              stockLoose: p.stock_loose,
              sellingPrice: parseFloat(p.selling_price),
              status: p.status,
              updated_at: p.updated_at
            };
          }),
          total: count,
          page,
          limit
        });
      } finally {
        conn.release();
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/products/filters', async (req: Request, res: Response) => {
    try {
      if (!pool || !dbHealthy) {
        const products = inMemoryDb?.products || [];
        return res.json({
          brands: Array.from(new Set(products.map((p: any) => p.brand))).filter(Boolean).sort(),
          categories: Array.from(new Set(products.map((p: any) => p.category))).filter(Boolean).sort(),
          sizes: Array.from(new Set(products.map((p: any) => p.size))).filter(Boolean).sort(),
          grades: Array.from(new Set(products.map((p: any) => p.grade))).filter(Boolean).sort()
        });
      }

      const [brandRows]: any = await pool.query('SELECT DISTINCT brand FROM products WHERE brand IS NOT NULL AND brand != "" ORDER BY brand');
      const [categoryRows]: any = await pool.query('SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != "" ORDER BY category');
      const [sizeRows]: any = await pool.query('SELECT DISTINCT size FROM products WHERE size IS NOT NULL AND size != "" ORDER BY size');
      const [gradeRows]: any = await pool.query('SELECT DISTINCT grade FROM products WHERE grade IS NOT NULL AND grade != "" ORDER BY grade');

      res.json({
        brands: brandRows.map((r: any) => r.brand),
        categories: categoryRows.map((r: any) => r.category),
        sizes: sizeRows.map((r: any) => r.size),
        grades: gradeRows.map((r: any) => r.grade)
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/sales', async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = (page - 1) * limit;

      if (!pool || !dbHealthy) {
        const all = inMemoryDb?.sales || [];
        return res.json({ 
          data: all.slice(offset, offset + limit),
          total: all.length,
          page,
          limit
        });
      }

      const conn = await pool.getConnection();
      try {
        await conn.query('SET SESSION sort_buffer_size = 33554432'); // 32MB
        const [rows]: any = await conn.query(
          'SELECT id, invoice_no, customer_name, date, total_amount, data, updated_at FROM sales ORDER BY date DESC LIMIT ? OFFSET ?',
          [limit, offset]
        );
        const [[{ count }]]: any = await conn.query('SELECT COUNT(*) as count FROM sales');

        res.json({
          data: rows.map((s: any) => {
            let parsedData = {};
            try {
              if (s.data) {
                parsedData = typeof s.data === 'string' ? JSON.parse(s.data) : s.data;
              }
            } catch (e) {
              console.error('Error parsing sale data:', e);
            }
            
            return {
              ...parsedData,
              id: s.id,
              invoiceNo: s.invoice_no,
              customerName: s.customer_name,
              date: s.date,
              totalAmount: parseFloat(s.total_amount),
              updated_at: s.updated_at
            };
          }),
          total: count,
          page,
          limit
        });
      } finally {
        conn.release();
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Existing Granular Endpoints

  app.post('/api/products', async (req: Request, res: Response) => {
    const p = req.body;
    updateCache('products', p);  // updates inMemoryDb + invalidates syncResponseCache
    
    if (!pool || !dbHealthy) {
      return res.json({ success: true, mode: 'offline' });
    }

    try {
      const now = Date.now();
      await pool.query(
        'INSERT INTO products (id, name, category, brand, stock_boxes, stock_loose, selling_price, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=?, category=?, brand=?, stock_boxes=?, stock_loose=?, selling_price=?, status=?, data=?, updated_at=?',
        [
          p.id, p.name, p.category, p.brand,
          p.stockBoxes ?? 0, p.stockLoose ?? 0,
          p.sellingPrice ?? 0, p.status ?? 'Active',
          JSON.stringify(p), now,
          // ON DUPLICATE KEY UPDATE:
          p.name, p.category, p.brand,
          p.stockBoxes ?? 0, p.stockLoose ?? 0,
          p.sellingPrice ?? 0, p.status ?? 'Active',
          JSON.stringify(p), now
        ]
      );
      syncResponseCache = null; // ensure next GET /api/products returns fresh data
      res.json({ success: true, id: p.id });
    } catch (e: any) {
      console.error('[PRODUCTS] DB write failed, falling back to memory:', e.message);
      dbHealthy = false;
      res.json({ success: true, mode: 'offline_fallback', id: p.id });
    }
  });

  app.delete('/api/products/:id', async (req: Request, res: Response) => {
    const id = req.params.id;
    updateCache('products', id, true);
    
    if (!pool || !dbHealthy) {
      return res.json({ success: true, mode: 'offline' });
    }

    try {
      await pool.query('DELETE FROM products WHERE id = ?', [id]);
      res.json({ success: true });
    } catch (e: any) {
      dbHealthy = false;
      res.json({ success: true, mode: 'offline_fallback' });
    }
  });

  // GET /api/users — used by login to fetch users without waiting for full sync
  app.get('/api/users', async (req: Request, res: Response) => {
    try {
      let users: any[] = [];
      if (pool && dbHealthy) {
        const [rows]: any = await pool.query(
          'SELECT id, name, email, role, status, data, updated_at FROM users'
        );
        users = rows.map((u: any) => {
          const d = parseData(u.data);
          return {
            id: u.id, name: u.name, email: u.email,
            role: u.role, status: u.status,
            password: d.password || '',
            permissions: d.permissions || {},
            baseSalary: d.baseSalary || 0,
            updatedAt: u.updated_at,
          };
        });
      } else {
        // Fallback to in-memory
        users = (inMemoryDb?.users || []).map((u: any) => ({
          id: u.id, name: u.name, email: u.email, role: u.role,
          status: u.status, password: u.password || '',
          permissions: u.permissions || {}, baseSalary: u.baseSalary || 0,
        }));
      }
      res.json({ users });
    } catch (err: any) {
      console.error('[GET /api/users] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/users', async (req: Request, res: Response) => {
    try {
      const u = req.body;
      const now = Date.now();
      const userWithTs = { ...u, updatedAt: now };
      updateCache('users', userWithTs);
      
      if (pool && dbHealthy) {
        await pool.query(
          'INSERT INTO users (id, name, email, role, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=?, email=?, role=?, status=?, data=?, updated_at=?',
          [
            u.id, u.name, u.email, u.role, u.status, JSON.stringify(userWithTs), now,
            u.name, u.email, u.role, u.status, JSON.stringify(userWithTs), now
          ]
        );
      }
      res.json({ success: true, id: u.id });
    } catch (err: any) {
      console.error(`[USERS] Failed to persist: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/users/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      updateCache('users', id, true);
      
      if (pool && dbHealthy) {
        await pool.query('DELETE FROM users WHERE id = ?', [id]);
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sales', async (req: Request, res: Response) => {
    const s = req.body;
    updateCache('sales', s);
    
    if (!pool || !dbHealthy) {
      return res.json({ success: true, mode: 'offline' });
    }

    try {
      await pool.query(
        'INSERT INTO sales (id, invoice_no, customer_name, date, total_amount, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE invoice_no=?, customer_name=?, date=?, total_amount=?, data=?, updated_at=?',
        [
          s.id, s.invoiceNo, s.customerName, s.date, s.totalAmount, JSON.stringify(s), Date.now(),
          s.invoiceNo, s.customerName, s.date, s.totalAmount, JSON.stringify(s), Date.now()
        ]
      );
      res.json({ success: true });
    } catch (e: any) {
      dbHealthy = false;
      res.json({ success: true, mode: 'offline_fallback' });
    }
  });

  app.post('/api/purchases', async (req: Request, res: Response) => {
    const p = req.body;
    updateCache('purchases', p);
    
    if (!pool || !dbHealthy) {
      return res.json({ success: true, mode: 'offline' });
    }

    try {
      await pool.query(
        'INSERT INTO purchases (id, vendor_name, invoice_no, date, data, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE vendor_name=?, invoice_no=?, date=?, data=?, updated_at=?',
        [
          p.id, p.vendorName, p.gstInvoiceNo, p.date, JSON.stringify(p), Date.now(),
          p.vendorName, p.gstInvoiceNo, p.date, JSON.stringify(p), Date.now()
        ]
      );
      res.json({ success: true });
    } catch (e: any) {
      dbHealthy = false;
      res.json({ success: true, mode: 'offline_fallback' });
    }
  });

  app.post('/api/vendor-orders', async (req: Request, res: Response) => {
    const o = req.body;
    updateCache('vendorOrders', o);
    
    if (!pool || !dbHealthy) {
      return res.json({ success: true, mode: 'offline' });
    }

    try {
      await pool.query(
        'INSERT INTO vendor_orders (id, order_no, vendor_name, status, payment_status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE order_no=?, vendor_name=?, status=?, payment_status=?, data=?, updated_at=?',
        [o.id, o.orderNo, o.vendorName, o.status, o.paymentStatus, JSON.stringify(o), Date.now(), o.orderNo, o.vendorName, o.status, o.paymentStatus, JSON.stringify(o), Date.now()]
      );
      res.json({ success: true });
    } catch (e: any) {
      dbHealthy = false;
      res.json({ success: true, mode: 'offline_fallback' });
    }
  });

  app.get('/api/gallery-leads', async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = (page - 1) * limit;
      const search = req.query.search as string;
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      const isDailyLatest = req.query.dailyLatest === 'true';

      if (!pool || !dbHealthy) {
        let all = inMemoryDb?.galleryLeads || [];
        
        if (isDailyLatest) {
          const d = new Date();
          d.setHours(d.getHours() - 48);
          const threshold = d.toISOString();
          all = all.filter((l: any) => l.timestamp >= threshold);
        } else {
          if (startDate) all = all.filter((l: any) => l.timestamp >= startDate);
          if (endDate) all = all.filter((l: any) => l.timestamp <= endDate + 'T23:59:59');
        }

        if (search) {
          const s = search.toLowerCase();
          all = all.filter((l: any) => 
            l.customerName.toLowerCase().includes(s) || 
            l.customerMobile.includes(s) ||
            l.id.toLowerCase().includes(s)
          );
        }

        all.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        return res.json({
          data: all.slice(offset, offset + limit),
          total: all.length,
          page,
          limit
        });
      }

      let query = 'SELECT id, customer_name, customer_mobile, status, `timestamp`, data, updated_at FROM gallery_leads WHERE 1=1';
      let countQuery = 'SELECT COUNT(*) as count FROM gallery_leads WHERE 1=1';
      const params: any[] = [];

      if (isDailyLatest) {
        // Use a 48-hour window for "Daily Latest" to account for UTC/Local day differences
        const d = new Date();
        d.setHours(d.getHours() - 48);
        const threshold = d.toISOString();
        
        query += ' AND `timestamp` >= ?';
        countQuery += ' AND `timestamp` >= ?';
        params.push(threshold);
      } else {
        if (startDate) {
          query += ' AND `timestamp` >= ?';
          countQuery += ' AND `timestamp` >= ?';
          params.push(startDate);
        }
        if (endDate) {
          query += ' AND `timestamp` <= ?';
          countQuery += ' AND `timestamp` <= ?';
          params.push(`${endDate}T23:59:59`);
        }
      }

      if (search) {
        const s = `%${search}%`;
        query += ' AND (customer_name LIKE ? OR customer_mobile LIKE ? OR id LIKE ?)';
        countQuery += ' AND (customer_name LIKE ? OR customer_mobile LIKE ? OR id LIKE ?)';
        params.push(s, s, s);
      }

      query += ' ORDER BY `timestamp` DESC LIMIT ? OFFSET ?';
      const queryParams = [...params, limit, offset];

      const [rows]: any = await pool.query(query, queryParams);
      const [[{ count }]]: any = await pool.query(countQuery, params);

      res.json({
        data: rows.map((l: any) => ({
          ...parseData(l.data),
          id: l.id,
          customerName: l.customer_name,
          customerMobile: l.customer_mobile,
          status: l.status,
          timestamp: l.timestamp,
          updatedAt: l.updated_at
        })),
        total: count,
        page,
        limit
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/gallery-leads', async (req: Request, res: Response) => {
    try {
      const lead = req.body;
      const now = Date.now();
      const leadWithTs = { ...lead, updatedAt: now };
      
      console.log(`[GALLERY] Receiving order: ${lead.id} from ${lead.customerName}`);
      updateCache('galleryLeads', leadWithTs);
      
      // Ensure it's persisted to the main data store immediately
      if (inMemoryDb) {
        await writeToDb(inMemoryDb);
      }

      if (pool && dbHealthy) {
        await pool.query(
          'INSERT INTO gallery_leads (id, customer_name, customer_mobile, status, `timestamp`, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE customer_name=?, customer_mobile=?, status=?, `timestamp`=?, data=?, updated_at=?',
          [
            lead.id, lead.customerName, lead.customerMobile, lead.status, lead.timestamp, JSON.stringify(lead), now,
            lead.customerName, lead.customerMobile, lead.status, lead.timestamp, JSON.stringify(lead), now
          ]
        );
        console.log(`[GALLERY] Persisted to MySQL: ${lead.id}`);
      }
      res.json({ success: true, id: lead.id });
    } catch (err: any) {
      console.error(`[GALLERY] Failed to persist: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/gallery-leads/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const now = Date.now();
      
      if (!inMemoryDb) inMemoryDb = getInitialData();
      const idx = inMemoryDb.galleryLeads.findIndex((l: any) => l.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Lead not found' });
      
      const updatedLead = { ...inMemoryDb.galleryLeads[idx], ...updates, updatedAt: now };
      inMemoryDb.galleryLeads[idx] = updatedLead;
      syncResponseCache = null;

      if (pool && dbHealthy) {
        await pool.query(
          'UPDATE gallery_leads SET customer_name=?, customer_mobile=?, status=?, timestamp=?, data=?, updated_at=? WHERE id=?',
          [
            updatedLead.customerName, updatedLead.customerMobile, updatedLead.status, updatedLead.timestamp, 
            JSON.stringify(updatedLead), now, id
          ]
        );
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });



app.post('/api/db/test', async (req: Request, res: Response) => {
  const { host, port, user, password, database, socketPath } = req.body;
  const start = Date.now();
  
  let testConn: Connection | null = null;
  try {
    const config: any = {
      user,
      password,
      database: database || undefined,
      connectTimeout: 8000
    };
    
    if (socketPath) config.socketPath = socketPath;
    else {
      config.host = host;
      config.port = parseInt(port) || 3306;
    }

    testConn = await mysql.createConnection(config);
    await testConn.query('SELECT 1 as pulse');
    const latency = Date.now() - start;
    
    res.json({
      success: true,
      message: "Handshake Successful",
      latency: `${latency}ms`,
      node: host || socketPath
    });
  } catch (err: any) {
    res.status(401).json({
      success: false,
      error: err.message,
      code: err.code,
      hint: err.code === 'ECONNREFUSED' ? 'Target node is not listening. Check proxy status.' : 'Authentication failed.'
    });
  } finally {
    if (testConn) await testConn.end();
  }
});

// Config API
app.get('/api/db/config', (req: Request, res: Response) => {
  const sanitized = { ...activeDbConfig };
  sanitized.password = '••••••••';
  res.json(sanitized);
});

// Update Config & Reconnect
app.post('/api/db/config', async (req: Request, res: Response) => {
  const { host, port, user, password, database, socketPath } = req.body;
  
  const newConfig: DbConfig = {
    ...activeDbConfig,
    user,
    password,
    database,
    host: host || activeDbConfig.host || 'localhost',
    port: parseInt(port) || activeDbConfig.port || 3306
  };

  if (socketPath) {
    newConfig.socketPath = socketPath;
    delete newConfig.host;
    delete newConfig.port;
  } else {
    delete newConfig.socketPath;
  }

  const success = await initDatabase(newConfig);
  if (success) {
    activeDbConfig = newConfig;
    res.json({ success: true, message: "Migration Complete" });
  } else {
    res.status(503).json({ success: false, error: dbError });
  }
});

app.get('/api/sync/version', async (req: Request, res: Response) => {
  try {
    if (!inMemoryDb) {
      const data = await readFromDb();
      return res.json({ lastUpdated: data.lastUpdated || 0 });
    }
    res.json({ lastUpdated: inMemoryDb.lastUpdated || 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch version' });
  }
});

  app.get('/api/loading-charges', async (req, res) => {
    const data = await readFromDb();
    res.json(data.loadingCharges || []);
  });

  app.post('/api/loading-charges', async (req, res) => {
    try {
      const rule = req.body;
      const data = await readFromDb();
      if (!data.loadingCharges) data.loadingCharges = [];
      
      const newRule = { ...rule, id: rule.id || Math.random().toString(36).substr(2, 9), updatedAt: Date.now() };
      data.loadingCharges.push(newRule);
      
      await writeToDb(data);
      
      if (pool && dbHealthy) {
        await pool.query(
          'INSERT INTO loading_charges (id, product_type, unit_type, rate, per_unit, is_active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [newRule.id, newRule.productType, newRule.unitType, newRule.rate, newRule.perUnit, newRule.isActive ? 1 : 0, newRule.updatedAt]
        );
      }
      
      res.json(newRule);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/loading-charges/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const data = await readFromDb();
      
      if (!data.loadingCharges) data.loadingCharges = [];
      const index = data.loadingCharges.findIndex((l: any) => l.id === id);
      if (index === -1) return res.status(404).json({ error: 'Rule not found' });
      
      const updatedRule = { ...data.loadingCharges[index], ...updates, updatedAt: Date.now() };
      data.loadingCharges[index] = updatedRule;
      
      await writeToDb(data);
      
      if (pool && dbHealthy) {
        await pool.query(
          'UPDATE loading_charges SET product_type=?, unit_type=?, rate=?, per_unit=?, is_active=?, updated_at=? WHERE id=?',
          [updatedRule.productType, updatedRule.unitType, updatedRule.rate, updatedRule.perUnit, updatedRule.isActive ? 1 : 0, updatedRule.updatedAt, id]
        );
      }
      
      res.json(updatedRule);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/loading-charges/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const data = await readFromDb();
      
      if (!data.loadingCharges) data.loadingCharges = [];
      data.loadingCharges = data.loadingCharges.filter((l: any) => l.id !== id);
      
      await writeToDb(data);
      
      if (pool && dbHealthy) {
        await pool.query('DELETE FROM loading_charges WHERE id=?', [id]);
      }
      
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/sync', async (req: Request, res: Response) => {
  const since = parseInt(req.query.since as string) || 0;

  // ── CRITICAL TENANT ISOLATION ────────────────────────────────────────────────
  // A tenant MUST ONLY see their own data. NEVER fall back to another tenant's data.
  const tenantId       = req.tenantId || 'default';
  const isDefaultTenant = !req.tenantId || req.tenantId === 'default';

  if (isWarmingUp && warmupPromise) await warmupPromise;

  let data: any;

  if (isDefaultTenant) {
    // ── Default tenant: use in-memory cache (already scoped to default) ────────
    const rawData = inMemoryDb || await readFromDb();
    if (!rawData) return res.status(503).json({ error: 'Storage node offline', details: dbError });
    data = rawData;

  } else {
    // ── Named tenant: ONLY load from DB for this specific tenant ──────────────
    // NEVER use inMemoryDb here — it contains default tenant data
    if (!pool || !dbHealthy) {
      // DB not available → return truly empty data, never default tenant data
      return res.json({
        ...getInitialData(),
        lastUpdated: 0,
        _tenant: tenantId,
        _warning: 'DB offline — no tenant data available',
      });
    }

    try {
      // Fetch settings/meta from system_persistence
      const [spRows]: any = await pool.query(
        'SELECT payload FROM system_persistence WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 1',
        [tenantId]
      );
      // Start with empty base — NEVER borrow from default tenant
      const base = spRows.length ? parseData(spRows[0].payload) : getInitialData();

      // Fetch all relational data for THIS tenant only
      const [prodRows]:  any = await pool.query('SELECT id,name,category,brand,data,selling_price,stock_boxes,stock_loose,status,updated_at FROM products WHERE tenant_id=?', [tenantId]);
      const [saleRows]:  any = await pool.query('SELECT id,data,invoice_no,customer_name,date,total_amount,updated_at FROM sales WHERE tenant_id=?', [tenantId]);
      const [purchRows]: any = await pool.query('SELECT id,data,vendor_name,invoice_no,date,updated_at FROM purchases WHERE tenant_id=?', [tenantId]);
      const [voRows]:    any = await pool.query('SELECT id,data,order_no,vendor_name,status,payment_status,updated_at FROM vendor_orders WHERE tenant_id=?', [tenantId]);
      const [userRows]:  any = await pool.query('SELECT id,name,email,role,status,data,updated_at FROM users WHERE tenant_id=?', [tenantId]);

      base.products    = prodRows.map((p: any)  => ({ ...parseData(p.data),  id:p.id, name:p.name, category:p.category, brand:p.brand, sellingPrice:parseFloat(p.selling_price)||0, stockBoxes:p.stock_boxes||0, stockLoose:p.stock_loose||0, status:p.status }));
      base.sales       = saleRows.map((s: any)  => ({ ...parseData(s.data),  id:s.id, invoiceNo:s.invoice_no, customerName:s.customer_name, date:s.date, totalAmount:parseFloat(s.total_amount)||0 }));
      base.purchases   = purchRows.map((p: any) => ({ ...parseData(p.data),  id:p.id, vendorName:p.vendor_name, date:p.date }));
      base.vendorOrders= voRows.map((v: any)    => ({ ...parseData(v.data),  id:v.id, orderNo:v.order_no, vendorName:v.vendor_name, status:v.status, paymentStatus:v.payment_status }));
      base.users       = userRows.map((u: any)  => ({ ...parseData(u.data),  id:u.id, name:u.name, email:u.email, role:u.role, status:u.status }));
      base._tenant     = tenantId;
      data             = base;

    } catch (err: any) {
      console.error('[SYNC] Tenant query error:', err.message);
      // Even on error: return empty data, never default tenant data
      return res.status(500).json({ error: 'Sync failed: ' + err.message });
    }
  }

  
  // If 'since' is provided, we can send a delta
  if (since > 0) {
    if (since >= (data.lastUpdated || 0)) {
      return res.json({ 
        lastUpdated: data.lastUpdated,
        isDelta: true,
        changed: false,
        _metadata: { db_healthy: dbHealthy, timestamp: Date.now() }
      });
    }

    // Construct a delta payload
    const delta: any = {
      lastUpdated: data.lastUpdated,
      isDelta: true,
      changed: true,
      _metadata: { db_healthy: dbHealthy, timestamp: Date.now() }
    };

    // Filter each collection for items updated after 'since'
    const collections = ['products', 'sales', 'purchases', 'vendorOrders', 'quotations', 'payments', 'expenses', 'offers', 'commissionRules', 'customers', 'activityLogs', 'advances', 'payrollRecords', 'returns', 'loadingCharges', 'galleryLeads', 'users'];
    
    let hasChanges = false;
    collections.forEach(col => {
      if (data[col]) {
        const items = data[col].filter((item: any) => (item.updatedAt || 0) > since);
        if (items.length > 0) {
          delta[col] = items;
          hasChanges = true;
        }
      }
    });

    if (data.settings && (data.settings.lastUpdated || 0) > since) {
      delta.settings = data.settings;
      hasChanges = true;
    }

    if (!hasChanges) {
      return res.json({ 
        lastUpdated: data.lastUpdated,
        isDelta: true,
        changed: false,
        _metadata: { db_healthy: dbHealthy, timestamp: Date.now() }
      });
    }

    return res.json(delta);
  }

  // ── Response cache (DEFAULT TENANT ONLY) ─────────────────────────────────
  // NEVER cache for named tenants — each tenant must get their own scoped data
  if (isDefaultTenant && syncResponseCache && since === 0) {
    res.setHeader('Content-Type', 'application/json');
    return res.send(syncResponseCache);
  }

  // Prune activityLogs to keep payload size manageable
  const prunedData = { ...data };
  if (prunedData.activityLogs && prunedData.activityLogs.length > 200) {
    prunedData.activityLogs = prunedData.activityLogs.slice(0, 200);
  }

  const responsePayload = {
    ...prunedData,
    _tenant: tenantId,
    _metadata: {
      db_healthy: dbHealthy,
      tenant_id: tenantId,
      is_default: isDefaultTenant,
      is_fallback: !dbHealthy,
      timestamp: Date.now()
    }
  };

  // Only cache full sync responses for the default tenant
  if (since === 0 && isDefaultTenant) {
    syncResponseCache = JSON.stringify(responsePayload);
  }

  res.json(responsePayload);
});

app.post('/api/sync', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    data.lastUpdated = Date.now();
    await writeToDb(data);
    syncResponseCache = null; // Invalidate cache after sync
    res.json({ success: true, timestamp: data.lastUpdated });
  } catch (err: any) {
    res.status(500).json({ error: "Storage failure", details: err.message });
  }
});

  // Backup Logic
  const performBackup = async () => {
    try {
      const data = await readFromDb();
      if (!data) {
        console.warn('[BACKUP] Skipped: No data retrieved from DB');
        return;
      }
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `backup-${timestamp}.json`;
      const filepath = path.join(BACKUP_DIR, filename);
      
      await fs.writeJson(filepath, data, { spaces: 2 });
      console.log(`[BACKUP] Success: ${filename}`);
      
      // Cleanup old backups (keep last 50)
      const files = await fs.readdir(BACKUP_DIR);
      const backups = files.filter((f: string) => f.startsWith('backup-') && f.endsWith('.json')).sort();
      if (backups.length > 50) {
        const toDelete = backups.slice(0, backups.length - 50);
        for (const file of toDelete) {
          await fs.remove(path.join(BACKUP_DIR, file));
          console.log(`[BACKUP] Pruned: ${file}`);
        }
      }
    } catch (err) {
      console.error('[BACKUP] Failed:', err);
    }
  };

  // Schedule Backup based on settings
  let lastBackupTime = Date.now();
  setInterval(async () => {
    try {
      const data = await readFromDb();
      const freq = data.settings?.backupFrequency || 'daily';
      let intervalMs = 15 * 60 * 1000;
      if (freq === '1hour') intervalMs = 60 * 60 * 1000;
      if (freq === 'daily') intervalMs = 24 * 60 * 60 * 1000;

      if (Date.now() - lastBackupTime >= intervalMs) {
        await performBackup();
        lastBackupTime = Date.now();
      }
    } catch (e) {
      console.error('[SCHEDULER] Error:', e);
    }
  }, 60 * 1000); // Check every minute

  // Initial backup on startup
  setTimeout(performBackup, 10000);

  // Backup API Endpoints
  app.get('/api/backups', async (req, res) => {
    try {
      const files = await fs.readdir(BACKUP_DIR);
      const backups = files
        .filter((f: string) => f.startsWith('backup-') && f.endsWith('.json'))
        .map((f: string) => ({
          filename: f,
          url: `/api/backups/${f}`,
          timestamp: f.replace('backup-', '').replace('.json', '')
        }))
        .sort((a: any, b: any) => b.filename.localeCompare(a.filename));
      res.json(backups);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/backups/sql', async (req, res) => {
    if (!pool || !dbHealthy) {
      return res.status(503).json({ error: "Database offline, cannot generate SQL dump." });
    }

    try {
      let sql = `-- ROYAL ERP SQL DUMP\n-- Generated: ${new Date().toISOString()}\n\n`;
      
      const tables = ['products', 'sales', 'purchases', 'vendor_orders', 'system_persistence'];
      
      for (const table of tables) {
        const [rows]: any = await pool.query(`SELECT * FROM ${table}`);
        if (rows.length > 0) {
          sql += `-- Dumping data for table \`${table}\`\n`;
          const columns = Object.keys(rows[0]);
          const columnStr = columns.map(c => `\`${c}\``).join(', ');
          
          for (const row of rows) {
            const values = columns.map(c => {
              const val = row[c];
              if (val === null) return 'NULL';
              if (typeof val === 'number') return val;
              if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
              return `'${val.toString().replace(/'/g, "''")}'`;
            }).join(', ');
            sql += `INSERT INTO \`${table}\` (${columnStr}) VALUES (${values});\n`;
          }
          sql += '\n';
        }
      }

      res.setHeader('Content-Type', 'application/sql');
      res.setHeader('Content-Disposition', `attachment; filename=royal-erp-dump-${Date.now()}.sql`);
      res.send(sql);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/backups/trigger', async (req, res) => {
    try {
      await performBackup();
      res.json({ success: true, message: 'Backup triggered successfully' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/backups/:filename', async (req, res) => {
    const filepath = path.join(BACKUP_DIR, req.params.filename);
    if (await fs.pathExists(filepath)) {
      res.download(filepath);
    } else {
      res.status(404).json({ error: 'Backup not found' });
    }
  });

  app.post('/api/backups/restore/:filename', async (req, res) => {
    const filename = req.params.filename;
    const filepath = path.join(BACKUP_DIR, filename);
    
    if (!(await fs.pathExists(filepath))) {
      return res.status(404).json({ error: 'Backup file not found' });
    }

    try {
      const data = await fs.readJson(filepath);
      
      if (pool && dbHealthy) {
        // Restore relational data to MySQL
        const { products, sales, purchases, vendorOrders, ...metaData } = data;

        // Restore Products
        if (products) {
          for (const p of products) {
            await pool.query(
              'INSERT INTO products (id, name, category, brand, stock_boxes, stock_loose, selling_price, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=?, category=?, brand=?, stock_boxes=?, stock_loose=?, selling_price=?, status=?, data=?, updated_at=?',
              [
                p.id, p.name, p.category, p.brand, p.stockBoxes, p.stockLoose, p.sellingPrice, p.status, JSON.stringify(p), Date.now(),
                p.name, p.category, p.brand, p.stockBoxes, p.stockLoose, p.sellingPrice, p.status, JSON.stringify(p), Date.now()
              ]
            );
          }
        }

        // Restore Sales
        if (sales) {
          for (const s of sales) {
            await pool.query(
              'INSERT INTO sales (id, invoice_no, customer_name, date, total_amount, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE invoice_no=?, customer_name=?, date=?, total_amount=?, data=?, updated_at=?',
              [s.id, s.invoiceNo, s.customerName, s.date, s.totalAmount, JSON.stringify(s), Date.now(), s.invoiceNo, s.customerName, s.date, s.totalAmount, JSON.stringify(s), Date.now()]
            );
          }
        }

        // Restore Purchases
        if (purchases) {
          for (const p of purchases) {
            await pool.query(
              'INSERT INTO purchases (id, vendor_name, invoice_no, date, data, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE vendor_name=?, invoice_no=?, date=?, data=?, updated_at=?',
              [p.id, p.vendorName, p.gstInvoiceNo, p.date, JSON.stringify(p), Date.now(), p.vendorName, p.gstInvoiceNo, p.date, JSON.stringify(p), Date.now()]
            );
          }
        }

        // Restore Vendor Orders
        if (vendorOrders) {
          for (const o of vendorOrders) {
            await pool.query(
              'INSERT INTO vendor_orders (id, order_no, vendor_name, status, payment_status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE order_no=?, vendor_name=?, status=?, payment_status=?, data=?, updated_at=?',
              [o.id, o.orderNo, o.vendorName, o.status, o.paymentStatus, JSON.stringify(o), Date.now(), o.orderNo, o.vendorName, o.status, o.paymentStatus, JSON.stringify(o), Date.now()]
            );
          }
        }

        // Restore Meta Data
        await writeToDb(data);
      } else {
        // Restore to In-Memory
        inMemoryDb = data;
      }

      res.json({ success: true, message: `System restored to state: ${filename}` });
    } catch (err: any) {
      console.error('[RESTORE FAULT]', err);
      res.status(500).json({ error: 'Restore failed', details: err.message });
    }
  });


  // ─── DATA MANAGEMENT ENDPOINTS ────────────────────────────────────────────

  // CLEAR all data from DB (admin only — dev/deployment tool)
  app.post('/api/admin/clear-db', async (req: Request, res: Response) => {
    try {
      // 1. Auto-backup before clearing
      await performBackup();

      // Preserve users and settings before wipe
      const preservedUsers    = inMemoryDb?.users    || [];
      const preservedSettings = inMemoryDb?.settings || {};

      if (pool && dbHealthy) {
        const conn = await pool.getConnection();
        try {
          await conn.query('SET FOREIGN_KEY_CHECKS = 0');

          // Clear ALL business data tables (NOT users table)
          for (const table of [
            'products', 'sales', 'purchases', 'vendor_orders',
            'gallery_leads', 'loading_charges'
          ]) {
            await conn.query(`TRUNCATE TABLE ${table}`);
          }

          // system_persistence holds: quotations, payments, expenses, offers,
          // commissionRules, customers, advances, payrollRecords, returns,
          // giftInventory, giftIssuances, incentiveEntries, activityLogs, etc.
          // Replace it with a clean record that keeps users + settings only
          const cleanPayload = JSON.stringify({
            quotations: [], payments: [], expenses: [], offers: [],
            commissionRules: [], customers: [], activityLogs: [],
            advances: [], payrollRecords: [], returns: [],
            giftInventory: [], giftIssuances: [], incentiveEntries: [],
            users: preservedUsers,
            settings: preservedSettings,
            lastUpdated: Date.now(),
          });
          await conn.query(
            'INSERT INTO system_persistence (id, tenant_id, payload, updated_at) VALUES ("global_master", "default", ?, ?) ' +
            'ON DUPLICATE KEY UPDATE payload = ?, updated_at = ?',
            [cleanPayload, Date.now(), cleanPayload, Date.now()]
          );

          await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        } finally {
          conn.release();
        }
      }

      // 2. Reset in-memory store (preserve users + settings)
      inMemoryDb = {
        products: [], sales: [], purchases: [], vendorOrders: [],
        quotations: [], payments: [], expenses: [], offers: [],
        commissionRules: [], customers: [], activityLogs: [],
        advances: [], payrollRecords: [], returns: [], galleryLeads: [],
        loadingCharges: [], giftInventory: [], giftIssuances: [],
        incentiveEntries: [],
        users: preservedUsers,
        settings: preservedSettings,
        lastUpdated: Date.now(),
      };
      syncResponseCache = null;

      console.log('[CLEAR-DB] Complete. Users preserved:', preservedUsers.length, '| Settings preserved: yes');
      res.json({ success: true, message: 'All business data cleared. Users and settings preserved.' });
    } catch (err: any) {
      console.error('[CLEAR-DB] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // IMPORT full JSON backup (from downloaded backup file)
  app.post('/api/admin/import-json', async (req: Request, res: Response) => {
    try {
      const data = req.body;
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: 'Invalid JSON payload' });
      }

      // Validate it looks like a real backup
      if (!data.products && !data.sales && !data.settings) {
        return res.status(400).json({ error: 'File does not appear to be a valid Royal ERP backup' });
      }

      // Auto-backup before import
      await performBackup();

      if (pool && dbHealthy) {
        const { products, sales, purchases, vendorOrders, ...metaData } = data;

        if (products?.length) {
          for (const p of products) {
            await pool.query(
              'INSERT INTO products (id, name, category, brand, stock_boxes, stock_loose, selling_price, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=?, category=?, brand=?, stock_boxes=?, stock_loose=?, selling_price=?, status=?, data=?, updated_at=?',
              [p.id, p.name, p.category, p.brand, p.stockBoxes ?? 0, p.stockLoose ?? 0, p.sellingPrice ?? 0, p.status ?? 'Active', JSON.stringify(p), Date.now(),
               p.name, p.category, p.brand, p.stockBoxes ?? 0, p.stockLoose ?? 0, p.sellingPrice ?? 0, p.status ?? 'Active', JSON.stringify(p), Date.now()]
            );
          }
        }
        if (sales?.length) {
          for (const s of sales) {
            await pool.query(
              'INSERT INTO sales (id, invoice_no, customer_name, date, total_amount, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE invoice_no=?, customer_name=?, date=?, total_amount=?, data=?, updated_at=?',
              [s.id, s.invoiceNo, s.customerName, s.date, s.totalAmount, JSON.stringify(s), Date.now(),
               s.invoiceNo, s.customerName, s.date, s.totalAmount, JSON.stringify(s), Date.now()]
            );
          }
        }
        if (purchases?.length) {
          for (const p of purchases) {
            await pool.query(
              'INSERT INTO purchases (id, vendor_name, invoice_no, date, data, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE vendor_name=?, invoice_no=?, date=?, data=?, updated_at=?',
              [p.id, p.vendorName, p.gstInvoiceNo || '', p.date, JSON.stringify(p), Date.now(),
               p.vendorName, p.gstInvoiceNo || '', p.date, JSON.stringify(p), Date.now()]
            );
          }
        }
        if (vendorOrders?.length) {
          for (const o of vendorOrders) {
            await pool.query(
              'INSERT INTO vendor_orders (id, order_no, vendor_name, status, payment_status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE order_no=?, vendor_name=?, status=?, payment_status=?, data=?, updated_at=?',
              [o.id, o.orderNo, o.vendorName, o.status, o.paymentStatus, JSON.stringify(o), Date.now(),
               o.orderNo, o.vendorName, o.status, o.paymentStatus, JSON.stringify(o), Date.now()]
            );
          }
        }
        await writeToDb(data);
      }

      inMemoryDb = { ...inMemoryDb, ...data, lastUpdated: Date.now() };
      syncResponseCache = null;

      res.json({
        success: true,
        message: `Import complete`,
        counts: {
          products: data.products?.length || 0,
          sales: data.sales?.length || 0,
          purchases: data.purchases?.length || 0,
          vendorOrders: data.vendorOrders?.length || 0,
          customers: data.customers?.length || 0,
        }
      });
    } catch (err: any) {
      console.error('[IMPORT-JSON] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // IMPORT products from CSV/Excel (parsed on client, sent as JSON array)
  app.post('/api/admin/import-products-csv', async (req: Request, res: Response) => {
    try {
      const { rows, category: importCategory } = req.body as { rows: any[]; category?: string };
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: 'No rows provided' });
      }

      const results = { created: 0, updated: 0, skipped: 0, errors: [] as string[] };
      const now = Date.now();

      // ── Server-side deduplication: remove duplicate rows within this batch ──
      const batchSeen = new Set<string>();
      const dedupedRows = rows.filter(row => {
        const n = (row['Product Name'] || row['name'] || row['Name'] || '').toString().trim().toLowerCase();
        const s = (row['Size'] || row['size'] || '').toString().trim().toLowerCase();
        if (!n) return true;
        const key = `${n}|${s}`;
        if (batchSeen.has(key)) { results.skipped++; return false; }
        batchSeen.add(key);
        return true;
      });

      for (const row of dedupedRows) {
        try {
          // Map CSV columns — flexible, accepts common aliases, category-specific columns
          const name = (row['Product Name'] || row['name'] || row['Name'] || '').toString().trim();
          // ── Category: ALWAYS read from the file first ─────────────────────
          // The UI dropdown (importCategory) is ONLY a fallback when no
          // Category column exists in the file. This prevents the dropdown from
          // overriding product categories that are explicitly set in the CSV.
          const categoryFromFile = (row['Category'] || row['category'] || row['Sheet'] || '').toString().trim();
          const category = categoryFromFile || importCategory || 'Floor Tile';
          const brand    = (row['Brand'] || row['brand'] || '').toString().trim();
          const size     = (row['Size'] || row['size'] || '').toString().trim();
          const grade    = (row['Grade'] || row['grade'] || 'Premium').toString().trim();
          const shadeNo  = (row['Shade No'] || row['shadeNo'] || '').toString().trim();
          const status   = (row['Status'] || row['status'] || 'Active').toString().trim();
          const vendorName = (row['Vendor Name'] || row['vendor'] || '').toString().trim();

          // Category-specific pricing fields
          const isGranite  = ['Granite','Marble'].includes(category);
          const isKadapa   = category === 'Kadapa';
          const isWeight   = ['Adhesive','Grout'].includes(category);

          let purchasePrice  = parseFloat(row['Purchase Price']      || row['purchasePrice']     || row['Rate'] || '0') || 0;
          let sellingPrice   = parseFloat(row['Selling Price']       || row['sellingPrice']      || row['MRP'] || '0') || 0;
          let costPerSqft    = parseFloat(row['Purchase Rate Per Sqft'] || row['costPerSqft']    || '0') || 0;
          let sellingPerSqft = parseFloat(row['Selling Price Per Sqft'] || row['sellingPricePerSqft'] || '0') || 0;
          let transportPct   = parseFloat(row['Transport Pct']       || row['transportPct']      || '0') || 0;
          let stockBoxes     = parseInt(row['Stock Boxes'] || row['stockBoxes'] || row['Stock'] || row['Qty'] || '0') || 0;
          let stockSlabs     = parseInt(row['Stock Slabs'] || row['stockSlabs'] || '0') || 0;
          const tilesPerBox  = parseInt(row['Tiles Per Box'] || row['tilesPerBox'] || '4') || 4;
          const sqftPerBox   = parseFloat(row['Sqft Per Box'] || row['sqftPerBox'] || '16') || 16;
          const reorderLevel = parseInt(row['Reorder Level'] || row['reorderLevel'] || '10') || 10;
          const unitType     = (row['Unit'] || row['unitType'] || (isGranite || isKadapa ? 'Slab' : isWeight ? 'Bag' : 'Box')).toString().trim();
          const weightGrams  = parseInt(row['Weight Grams'] || row['weightGrams'] || '0') || 0;
          const finishType   = (row['Finish Type'] || row['kadapaType'] || '').toString().trim();

          // ── Kadapa slab dimensions from CSV ─────────────────────────────────
          // Height (Ft) and Width (Ft) drive sqft per slab and slab[] generation
          const kadapaHeightFt = parseFloat(row['Height (Ft)'] || row['heightFt'] || row['height_ft'] || '0') || 0;
          const kadapaWidthFt  = parseFloat(row['Width (Ft)']  || row['widthFt']  || row['width_ft']  || '0') || 0;

          // Derive sqft per slab (rounded-ft equivalent for standard widths)
          const ROUNDED_WIDTH_MAP: Record<number, number> = { 9: 1, 11: 1, 14: 1.25, 17: 1.5, 23: 2, 29: 2.5 };
          // kadapaWidthFt is already in ft (from CSV) — use directly
          const slabSqft = kadapaHeightFt && kadapaWidthFt
            ? Math.round(kadapaHeightFt * kadapaWidthFt * 100) / 100
            : 0;

          // For Granite/Marble/Kadapa: landed cost per sqft
          if (isGranite && costPerSqft > 0 && purchasePrice === 0) {
            const transport = costPerSqft * (transportPct / 100);
            purchasePrice = parseFloat((costPerSqft + transport).toFixed(2));
          }
          if (isKadapa && costPerSqft > 0 && purchasePrice === 0) {
            purchasePrice = slabSqft > 0
              ? parseFloat((slabSqft * costPerSqft).toFixed(2))  // landed per slab = sqft × rate/sqft
              : costPerSqft;
          }
          const effectiveStock = (isGranite || isKadapa) ? stockSlabs : stockBoxes;

          // ── Auto-generate slabs[] for Kadapa ─────────────────────────────────
          // Each slab gets its own Slab object — same structure as KadapaManager.handleAdd()
          // This ensures KadapaManager, Quotation, and P&L all see the correct data.
          let generatedSlabs: any[] = [];
          if (isKadapa && slabSqft > 0 && effectiveStock > 0) {
            const landedPerSlab  = Math.round(slabSqft * costPerSqft * 100) / 100;
            const sellPerSqft    = sellingPerSqft || 0;
            const sellingPerSlab = Math.round(slabSqft * sellPerSqft * 100) / 100;

            // Prefix logic: same as KadapaManager FINISH_PREFIX
            const prefixMap: Record<string, { normal: string; big: string }> = {
              'Single Polish':     { normal: 'SP',  big: 'DSP' },
              'Double Polish':     { normal: 'DP',  big: 'DDP' },
              'Big Single Polish': { normal: 'DSP', big: 'DSP' },
              'Big Double Polish': { normal: 'DDP', big: 'DDP' },
            };
            const isBig = kadapaHeightFt >= 5;
            const pfx   = (prefixMap[finishType] || { normal: 'KD', big: 'KD' })[isBig ? 'big' : 'normal'];
            const baseNo = `${pfx}-${kadapaHeightFt}x${kadapaWidthFt}`;

            for (let i = 0; i < effectiveStock; i++) {
              generatedSlabs.push({
                id:                  `slab-csv-${now}-${i}-${Math.random().toString(36).substr(2, 5)}`,
                slabNo:              `${baseNo}-${i + 1}`,
                heightFt:            kadapaHeightFt,
                heightIn:            0,
                lengthFt:            kadapaWidthFt,
                lengthIn:            0,
                sqft:                slabSqft,
                isSold:              false,
                finish:              finishType || 'Single Polish',
                landedCost:          landedPerSlab,
                landedCostPerSqft:   costPerSqft,
                sellingPrice:        sellingPerSlab,
                sellingPricePerSqft: sellPerSqft,
              });
            }
          }

          if (!name) { results.skipped++; continue; }

          // Check if product already exists (by name + size)
          let existingId: string | null = null;
          if (pool && dbHealthy) {
            const [existing]: any = await pool.query('SELECT id FROM products WHERE name = ? AND (size = ? OR size IS NULL)', [name, size]);
            if (existing.length > 0) existingId = existing[0].id;
          } else {
            // In-memory: match by name (case-insensitive) + size
            const found = inMemoryDb?.products?.find((p: any) =>
              p.name.trim().toLowerCase() === name.toLowerCase() &&
              (!size || (p.size || '').trim().toLowerCase() === size.toLowerCase())
            );
            if (found) existingId = found.id;
          }

          const productId = existingId || `csv-${now}-${Math.random().toString(36).substr(2, 6)}`;
          // Compute correct sqftPerBox (per slab) and totalCostPerUnit (landed per sqft for P&L)
          const kadapaSqftPerBox    = isKadapa && slabSqft > 0 ? slabSqft : sqftPerBox;
          const kadapaTotalCostUnit = isKadapa && costPerSqft > 0 ? costPerSqft : purchasePrice;
          const kadapaTilesPerBox   = isKadapa ? 1 : tilesPerBox;  // 1 slab = 1 "box"

          const productData: any = {
            id: productId, name, category, brand,
            // For Kadapa: size = "heightFt x widthFt" if dimensions provided, else from CSV
            size: isKadapa && kadapaHeightFt && kadapaWidthFt
              ? `${kadapaHeightFt}x${kadapaWidthFt}`
              : size,
            purchasePrice,
            sellingPrice,
            // totalCostPerUnit = landed cost PER SQFT for Kadapa (used by P&L correctly)
            totalCostPerUnit: kadapaTotalCostUnit,
            stockBoxes: effectiveStock, stockLoose: 0,
            tilesPerBox: kadapaTilesPerBox,
            sqftPerBox:  kadapaSqftPerBox,
            reorderLevel,
            grade, shadeNo, status,
            isTile: !isWeight, unitType,
            transportCost: transportPct, transportCostType: 'Percentage', transportBasis: 'Per Unit',
            otherCharges: 0,
            costPerSqft:          costPerSqft || 0,
            sellingPricePerSqft:  sellingPerSqft || 0,
            kadapaType:           finishType || undefined,
            slabHeightFt:         isKadapa ? kadapaHeightFt : undefined,
            slabLengthFt:         isKadapa ? kadapaWidthFt  : undefined,
            baseWeightGrams:      weightGrams || 0,
            images: [], showInGallery: true,
            locationStock: [
              { godownId: 'g1', boxes: effectiveStock, loose: 0 },
              { godownId: 'g2', boxes: 0, loose: 0 },
              { godownId: 'g3', boxes: 0, loose: 0 }
            ],
            damageHistory: [], purchaseHistory: [], adjustmentLog: [],
            // ── Auto-generated slabs: same structure as KadapaManager ──────────
            slabs: generatedSlabs,
            // Vendor linking
            lastPurchaseVendor: vendorName || undefined,
            lastPurchaseDate:   vendorName ? new Date().toISOString().split('T')[0] : undefined,
            updatedAt: now
          };

          if (pool && dbHealthy) {
            await pool.query(
              'INSERT INTO products (id, name, category, brand, stock_boxes, stock_loose, selling_price, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=?, category=?, brand=?, stock_boxes=?, stock_loose=?, selling_price=?, status=?, data=?, updated_at=?',
              [productId, name, category, brand, stockBoxes, 0, sellingPrice, status, JSON.stringify(productData), now,
               name, category, brand, stockBoxes, 0, sellingPrice, status, JSON.stringify(productData), now]
            );
          }

          // Update in-memory
          if (!inMemoryDb) inMemoryDb = { products: [] };
          if (!inMemoryDb.products) inMemoryDb.products = [];
          const memIdx = inMemoryDb.products.findIndex((p: any) => p.id === productId);
          if (memIdx >= 0) { inMemoryDb.products[memIdx] = productData; results.updated++; }
          else { inMemoryDb.products.push(productData); results.created++; }

        } catch (rowErr: any) {
          results.errors.push(`Row "${row['Product Name'] || row['name'] || '?'}": ${rowErr.message}`);
          results.skipped++;
        }
      }

      inMemoryDb.lastUpdated = Date.now();
      syncResponseCache = null;

      res.json({ success: true, results });
    } catch (err: any) {
      console.error('[IMPORT-CSV] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET DB stats (for the dashboard in the UI)
  app.get('/api/admin/db-stats', async (req: Request, res: Response) => {
    try {
      if (pool && dbHealthy) {
        const tables = ['products', 'sales', 'purchases', 'vendor_orders'];
        const counts: Record<string, number> = {};
        for (const t of tables) {
          const [[row]]: any = await pool.query(`SELECT COUNT(*) as count FROM ${t}`);
          counts[t] = row.count;
        }
        const files = await fs.readdir(BACKUP_DIR).catch(() => []);
        const backupFiles = (files as string[]).filter((f: string) => f.endsWith('.json'));
        res.json({ counts, backupCount: backupFiles.length, dbMode: 'mysql', dbConnected: true });
      } else {
        const db = inMemoryDb || {};
        res.json({
          counts: {
            products: db.products?.length || 0,
            sales: db.sales?.length || 0,
            purchases: db.purchases?.length || 0,
            vendor_orders: db.vendorOrders?.length || 0,
          },
          backupCount: 0,
          dbMode: 'memory',
          dbConnected: false
        });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Activity logs — lightweight write endpoint (fire-and-forget from client)
  app.post('/api/activity-logs', async (req: Request, res: Response) => {
    try {
      const log = req.body;
      if (!log || !log.id) return res.json({ success: true }); // silent ignore
      if (!inMemoryDb) inMemoryDb = getInitialData();
      if (!inMemoryDb.activityLogs) inMemoryDb.activityLogs = [];
      inMemoryDb.activityLogs.unshift(log);
      // Keep only last 200 in memory
      if (inMemoryDb.activityLogs.length > 200) {
        inMemoryDb.activityLogs = inMemoryDb.activityLogs.slice(0, 200);
      }
      // No DB write needed — activity logs are ephemeral, included in next sync payload
      res.json({ success: true });
    } catch (e: any) {
      res.json({ success: true }); // always succeed — client doesn't need to know about failures
    }
  });

  app.get('/api/activity-logs', async (req: Request, res: Response) => {
    try {
      const logs = inMemoryDb?.activityLogs || [];
      res.json(logs.slice(0, 200));
    } catch (e: any) {
      res.json([]);
    }
  });

  app.get('/api/health', async (req, res) => {
    let livePing = false;
    let pingError = null;
    if (pool) {
      try {
        await pool.query('SELECT 1');
        livePing = true;
      } catch (e: any) {
        livePing = false;
        pingError = e.message;
        console.error(`[HEALTH PING FAULT] ${e.message}`);
      }
    }

    res.json({ 
      status: 'active', 
      db_connected: livePing,
      db_error: dbError || (pingError ? { message: pingError } : null),
      config: {
          host: activeDbConfig.host || activeDbConfig.socketPath || 'unknown',
          user: activeDbConfig.user || 'unknown',
          database: activeDbConfig.database || 'unknown'
      },
      timestamp: Date.now()
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
  // ════════════════════════════════════════════════════════════════════
  //  TENANT MANAGEMENT APIs
  // ════════════════════════════════════════════════════════════════════

  /**
   * GET /api/public/gallery?tenant=slug-or-id
   * Public endpoint — no auth needed.
   * Returns products marked showInGallery=true for a given tenant.
   * Used by the WebGallery component for public visitors.
   */
  app.get('/api/public/gallery', async (req: Request, res: Response) => {
    const tenantParam = (req.query.tenant as string || '').trim();
    try {
      let products: any[] = [];
      let shopSettings: any = {};
      // Default to 'default' when no tenant specified — existing single-shop setup
      let tenantId = tenantParam || 'default';

      if (pool && dbHealthy) {
        // Resolve tenantId from slug or id if tenant param given
        if (tenantParam) {
          const [tr]: any = await pool.query(
            'SELECT id, name, settings FROM tenants WHERE (slug=? OR id=?) AND status="active"',
            [tenantParam, tenantParam]);
          if (tr.length) {
            tenantId     = tr[0].id;
            shopSettings = parseData(tr[0].settings);
          }
        } else {
          // No tenant param — load default shop settings from system_persistence
          try {
            const [sp]: any = await pool.query(
              'SELECT payload FROM system_persistence WHERE tenant_id="default" OR tenant_id IS NULL LIMIT 1');
            if (sp.length) {
              const data = parseData(sp[0].payload);
              shopSettings = data.settings || {};
            }
          } catch {}
        }

        // Try fetching with tenant_id filter
        try {
          const [rows]: any = await pool.query(
            'SELECT id,name,category,brand,data,selling_price,stock_boxes,status FROM products WHERE (tenant_id=? OR tenant_id IS NULL OR tenant_id="") AND status="Active"',
            [tenantId]);
          products = rows.map((p: any) => {
            const d = parseData(p.data);
            return { ...d, id: p.id, name: p.name, category: p.category, brand: p.brand,
              sellingPrice: parseFloat(p.selling_price) || d.sellingPrice || 0,
              stockBoxes: p.stock_boxes || d.stockBoxes || 0, status: p.status };
          }).filter((p: any) => p.showInGallery !== false);
        } catch {
          // tenant_id column may not exist yet — return all active products
          const [rows]: any = await pool.query(
            'SELECT id,name,category,brand,data,selling_price,stock_boxes,status FROM products WHERE status="Active"');
          products = rows.map((p: any) => {
            const d = parseData(p.data);
            return { ...d, id: p.id, name: p.name, category: p.category, brand: p.brand,
              sellingPrice: parseFloat(p.selling_price) || d.sellingPrice || 0,
              stockBoxes: p.stock_boxes || d.stockBoxes || 0, status: p.status };
          }).filter((p: any) => p.showInGallery !== false);
        }
      } else {
        // In-memory fallback
        products = (inMemoryDb?.products || []).filter((p: any) =>
          p.status === 'Active' && p.showInGallery !== false &&
          (!tenantParam || p.tenantId === tenantId));
        shopSettings = inMemoryDb?.settings || {};
      }

      res.json({
        products,
        settings: {
          showroomName:    shopSettings.showroomName    || shopSettings.systemBranding || 'Royal ERP',
          showroomPhone:   shopSettings.showroomPhone   || '',
          showroomAddress: shopSettings.showroomAddress || '',
          categories:      shopSettings.categories      || [],
          whatsappNumber:  shopSettings.whatsappNumber  || shopSettings.showroomPhone || '',
        },
      });
    } catch (err: any) {
      console.error('[PUBLIC GALLERY]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/admin/diagnose?key=test
   * Shows exact DB state — what's in each tenant's data
   */
  app.get('/api/admin/diagnose', async (req: Request, res: Response) => {
    if (req.query.key !== SUPER_ADMIN_KEY) return res.status(403).json({ error:'Wrong key' });
    try {
      const result: any = { dbHealthy, inMemoryProductCount: inMemoryDb?.products?.length || 0 };
      if (pool && dbHealthy) {
        const [spRows]: any = await pool.query('SELECT id, tenant_id, updated_at, LENGTH(payload) as payload_size FROM system_persistence ORDER BY updated_at DESC');
        result.system_persistence = spRows;
        const [prodCounts]: any = await pool.query('SELECT tenant_id, COUNT(*) as count FROM products GROUP BY tenant_id');
        result.product_counts_by_tenant = prodCounts;
        const [saleCounts]: any = await pool.query('SELECT tenant_id, COUNT(*) as count FROM sales GROUP BY tenant_id');
        result.sale_counts_by_tenant = saleCounts;
        const [tenants]: any = await pool.query('SELECT id, name, slug FROM tenants');
        result.tenants = tenants;
      }
      result.inMemory = {
        products: inMemoryDb?.products?.length || 0,
        sales: inMemoryDb?.sales?.length || 0,
        users: inMemoryDb?.users?.length || 0,
      };
      res.json(result);
    } catch(e:any) { res.status(500).json({ error: e.message }); }
  });

  /**
   * POST /api/admin/fix-default-tenant?key=test
   * Fixes the system_persistence tenant_id for default shop
   * and force-reloads inMemoryDb from DB
   */
  app.post('/api/admin/fix-default-tenant', async (req: Request, res: Response) => {
    if (req.query.key !== SUPER_ADMIN_KEY) return res.status(403).json({ error:'Wrong key' });
    try {
      if (pool && dbHealthy) {
        // Step 1: Fix system_persistence — ensure global_master belongs to default
        await pool.query(
          'UPDATE system_persistence SET tenant_id = "default" WHERE id = "global_master"'
        );
        // Step 2: Fix products — anything with NULL or empty tenant_id → default
        await pool.query(
          'UPDATE products SET tenant_id = "default" WHERE tenant_id IS NULL OR tenant_id = ""'
        );
        await pool.query(
          'UPDATE sales SET tenant_id = "default" WHERE tenant_id IS NULL OR tenant_id = ""'
        );
        await pool.query(
          'UPDATE purchases SET tenant_id = "default" WHERE tenant_id IS NULL OR tenant_id = ""'
        );
        await pool.query(
          'UPDATE users SET tenant_id = "default" WHERE tenant_id IS NULL OR tenant_id = ""'
        );
        // Step 3: Force reload inMemoryDb from DB
        inMemoryDb = null as any;
        await readFromDb();
        res.json({ success: true, message: 'Default tenant fixed and inMemoryDb reloaded', products: inMemoryDb?.products?.length || 0 });
      } else {
        res.json({ success: false, message: 'DB not connected' });
      }
    } catch(e:any) { res.status(500).json({ error: e.message }); }
  });

  // ════════════════════════════════════════════════════════════════════════
  //  TWO-FACTOR AUTHENTICATION (TOTP — Google Authenticator compatible)
  // ════════════════════════════════════════════════════════════════════════

  /** TOTP engine — pure Node.js crypto, no external library */
  const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  const base32Encode = (buf: Buffer): string => {
    let result = ''; let bits = 0; let val = 0;
    for (const byte of buf) {
      val = (val << 8) | byte; bits += 8;
      while (bits >= 5) { result += base32Chars[(val >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) result += base32Chars[(val << (5 - bits)) & 31];
    return result;
  };

  const base32Decode = (str: string): Buffer => {
    const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
    const bytes: number[] = [];
    let bits = 0; let val = 0;
    for (const ch of clean) {
      val = (val << 5) | base32Chars.indexOf(ch); bits += 5;
      if (bits >= 8) { bytes.push((val >>> (bits - 8)) & 255); bits -= 8; }
    }
    return Buffer.from(bytes);
  };

  const generateTOTP = (secret: string, counter: number): string => {
    const key = base32Decode(secret);
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset+1] << 16) | (hmac[offset+2] << 8) | hmac[offset+3];
    return (code % 1000000).toString().padStart(6, '0');
  };

  const verifyTOTP = (secret: string, token: string): boolean => {
    const counter = Math.floor(Date.now() / 1000 / 30);
    for (let i = -2; i <= 2; i++) { // ±2 windows = ±60s clock drift
      if (generateTOTP(secret, counter + i) === token) return true;
    }
    return false;
  };

  const generateTOTPSecret = (): string => base32Encode(crypto.randomBytes(20));

  /** POST /api/auth/2fa/setup — generate a new TOTP secret for a user */
  app.post('/api/auth/2fa/setup', async (req: Request, res: Response) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const secret = generateTOTPSecret();
    // Store temporarily — user must verify before it's saved permanently
    res.json({ secret, otpauthUrl: `otpauth://totp/RoyalERP:${userId}?secret=${secret}&issuer=RoyalERP&algorithm=SHA1&digits=6&period=30` });
  });

  /** POST /api/auth/2fa/verify — verify TOTP token and enable 2FA on the user */
  app.post('/api/auth/2fa/verify', async (req: Request, res: Response) => {
    const { userId, secret, token } = req.body;
    if (!userId || !secret || !token) return res.status(400).json({ error: 'userId, secret, token required' });
    if (!verifyTOTP(secret, token.toString().trim())) return res.status(401).json({ error: 'Invalid OTP — check your authenticator app' });
    // Save secret to user record
    try {
      if (pool && dbHealthy) {
        const [rows]: any = await pool.query('SELECT data FROM users WHERE id=?', [userId]);
        if (rows.length) {
          const d = parseData(rows[0].data);
          d.totpSecret = secret; d.twoFactorEnabled = true;
          await pool.query('UPDATE users SET data=?, updated_at=? WHERE id=?', [JSON.stringify(d), Date.now(), userId]);
        }
      } else {
        const u = inMemoryDb?.users?.find((x: any) => x.id === userId);
        if (u) { u.totpSecret = secret; u.twoFactorEnabled = true; }
      }
      res.json({ success: true, message: '2FA enabled successfully' });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  /** POST /api/auth/2fa/disable — disable 2FA for a user */
  app.post('/api/auth/2fa/disable', async (req: Request, res: Response) => {
    const { userId, token } = req.body;
    if (!userId || !token) return res.status(400).json({ error: 'userId and token required' });
    try {
      let secret = '';
      if (pool && dbHealthy) {
        const [rows]: any = await pool.query('SELECT data FROM users WHERE id=?', [userId]);
        if (rows.length) { const d = parseData(rows[0].data); secret = d.totpSecret || ''; }
      }
      if (!secret || !verifyTOTP(secret, token.toString().trim()))
        return res.status(401).json({ error: 'Invalid OTP' });
      if (pool && dbHealthy) {
        const [rows]: any = await pool.query('SELECT data FROM users WHERE id=?', [userId]);
        if (rows.length) {
          const d = parseData(rows[0].data);
          delete d.totpSecret; d.twoFactorEnabled = false;
          await pool.query('UPDATE users SET data=?, updated_at=? WHERE id=?', [JSON.stringify(d), Date.now(), userId]);
        }
      }
      res.json({ success: true, message: '2FA disabled' });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  /** POST /api/auth/2fa/admin-reset — admin force-disables 2FA for a user (lost phone scenario) */
  app.post('/api/auth/2fa/admin-reset', async (req: Request, res: Response) => {
    const { userId, adminId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    // Only allow if requester is admin of the same tenant
    const tenantId = req.tenantId || 'default';
    try {
      let adminOk = false;
      if (pool && dbHealthy) {
        const [adminRows]: any = await pool.query(
          'SELECT id, role FROM users WHERE id=? AND (tenant_id=? OR tenant_id IS NULL)',
          [adminId, tenantId]
        );
        adminOk = adminRows.length > 0 && ['Admin','admin'].includes(adminRows[0].role);
      } else {
        const admin = inMemoryDb?.users?.find((u: any) => u.id === adminId);
        adminOk = admin && ['Admin','admin'].includes(admin.role);
      }
      if (!adminOk) return res.status(403).json({ error: 'Only admin users can reset 2FA' });

      if (pool && dbHealthy) {
        const [rows]: any = await pool.query('SELECT data FROM users WHERE id=?', [userId]);
        if (rows.length) {
          const d = parseData(rows[0].data);
          delete d.totpSecret; d.twoFactorEnabled = false;
          await pool.query('UPDATE users SET data=?, updated_at=? WHERE id=?', [JSON.stringify(d), Date.now(), userId]);
        }
      } else {
        const u = inMemoryDb?.users?.find((x: any) => x.id === userId);
        if (u) { delete (u as any).totpSecret; (u as any).twoFactorEnabled = false; }
      }
      console.log(`[2FA] Admin ${adminId} reset 2FA for user ${userId}`);
      res.json({ success: true, message: '2FA has been disabled for this user' });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  /** POST /api/auth/2fa/check — check if login OTP is valid (called after password step) */
  app.post('/api/auth/2fa/check', async (req: Request, res: Response) => {
    const { userId, token } = req.body;
    if (!userId || !token) return res.status(400).json({ error: 'userId and token required' });
    try {
      let secret = '';
      if (pool && dbHealthy) {
        const [rows]: any = await pool.query('SELECT data FROM users WHERE id=?', [userId]);
        if (rows.length) { const d = parseData(rows[0].data); secret = d.totpSecret || ''; }
      } else {
        const u = inMemoryDb?.users?.find((x: any) => x.id === userId);
        if (u) secret = (u as any).totpSecret || '';
      }
      if (!secret) return res.status(400).json({ error: '2FA not set up for this user' });
      if (!verifyTOTP(secret, token.toString().trim()))
        return res.status(401).json({ error: 'Invalid OTP. Try again.' });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });


  /**
   * POST /api/admin/migrate-default-tenant?key=test
   * One-time migration: moves all 'default' tenant data to a named tenant.
   * Run ONCE to convert the base URL shop into a proper tenant.
   */
  app.post('/api/admin/migrate-default-tenant', async (req: Request, res: Response) => {
    if (req.query.key !== SUPER_ADMIN_KEY) return res.status(403).json({ error:'Wrong key' });
    const { shopName, slug, ownerEmail } = req.body;
    if (!shopName || !slug || !ownerEmail) return res.status(400).json({ error:'shopName, slug, ownerEmail required' });
    if (!pool || !dbHealthy) return res.status(503).json({ error:'DB not connected' });

    const tenantId = `${slug}-${crypto.randomBytes(4).toString('hex')}`;
    const now      = Date.now();

    try {
      // 1. Create tenant record
      await pool.query(
        'INSERT IGNORE INTO tenants (id, name, slug, owner_email, plan, status, settings, created_at) VALUES (?,?,?,?,?,?,?,?)',
        [tenantId, shopName, slug, ownerEmail, 'pro', 'active', '{}', now]
      );

      // 2. Migrate all default-tagged rows in every table
      const tables = [
        { table:'products',           col:'tenant_id' },
        { table:'sales',              col:'tenant_id' },
        { table:'purchases',          col:'tenant_id' },
        { table:'vendor_orders',      col:'tenant_id' },
        { table:'users',              col:'tenant_id' },
        { table:'loading_charges',    col:'tenant_id' },
        { table:'gallery_leads',      col:'tenant_id' },
      ];
      const results: any = {};
      for (const { table, col } of tables) {
        try {
          const [r]: any = await pool.query(
            `UPDATE ${table} SET ${col}=? WHERE ${col}='default' OR ${col} IS NULL OR ${col}=''`,
            [tenantId]
          );
          results[table] = r.affectedRows;
        } catch (e: any) { results[table] = `error: ${e.message}`; }
      }

      // 3. Migrate system_persistence
      const [sp]: any = await pool.query(
        `UPDATE system_persistence SET tenant_id=? WHERE id='global_master' AND (tenant_id='default' OR tenant_id IS NULL OR tenant_id='')`,
        [tenantId]
      );
      results.system_persistence = sp.affectedRows;

      // 4. Force reload inMemoryDb (it now has no default data)
      inMemoryDb = null as any;

      res.json({
        success: true,
        tenantId,
        slug,
        loginUrl: `/?tenant=${slug}`,
        migrated: results,
        message: `Default tenant migrated to "${shopName}" (slug: ${slug}). Update your bookmarks to /?tenant=${slug}`
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });


  /** POST /api/admin/reset-user-password?key=test
   * Emergency: reset a user's password by email + tenantId.
   * Use when migrated users can't login because password wasn't in DB.
   */
  app.post('/api/admin/reset-user-password', async (req: Request, res: Response) => {
    if (req.query.key !== SUPER_ADMIN_KEY) return res.status(403).json({ error:'Wrong key' });
    const { email, newPassword, tenantId } = req.body;
    if (!email || !newPassword) return res.status(400).json({ error:'email + newPassword required' });
    if (!pool || !dbHealthy) return res.status(503).json({ error:'DB not connected' });
    try {
      // Find user rows matching email (any tenant if tenantId not specified)
      const [rows]: any = await pool.query(
        'SELECT id, data, tenant_id FROM users WHERE LOWER(email)=LOWER(?)',
        [email.trim()]
      );
      if (!rows.length) return res.status(404).json({ error:'User not found: ' + email });
      const results = [];
      for (const row of rows) {
        if (tenantId && row.tenant_id !== tenantId) continue;
        const d = parseData(row.data) || {};
        d.password = newPassword;
        await pool.query('UPDATE users SET data=?, updated_at=? WHERE id=?',
          [JSON.stringify(d), Date.now(), row.id]);
        results.push({ id: row.id, tenant_id: row.tenant_id, updated: true });
      }
      if (!results.length) return res.status(404).json({ error:'No matching user for tenantId: ' + tenantId });
      res.json({ success: true, updated: results });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  /** GET /api/superadmin/ping — no auth needed, confirms tenant API is active */
  app.get('/api/superadmin/ping', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      tenantApiActive: true,
      serverVersion: '3.2.0-multitenant',
      keyHint: 'Set SUPER_ADMIN_KEY env var on Railway, or use default: test',
    });
  });

  /**
   * GET /api/superadmin/debug?key=test&email=admin@mudhol.com
   * Shows exactly what tenants and users exist in the DB.
   * Use this to diagnose login issues.
   */
  app.get('/api/superadmin/debug', async (req: Request, res: Response) => {
    if (req.query.key !== SUPER_ADMIN_KEY) return res.status(403).json({ error: 'Wrong key' });
    const email = (req.query.email as string || '').toLowerCase().trim();
    try {
      const result: any = { dbHealthy, inMemoryUsers: 0 };

      if (pool && dbHealthy) {
        // All tenants
        const [tenants]: any = await pool.query('SELECT id, name, slug, status FROM tenants');
        result.tenants = tenants;

        // All users (or filter by email)
        const [users]: any = email
          ? await pool.query('SELECT id, name, email, role, status, tenant_id FROM users WHERE LOWER(email)=?', [email])
          : await pool.query('SELECT id, name, email, role, status, tenant_id FROM users LIMIT 20');
        result.users = users;

        // Check if tenant_id column exists on users table
        const [cols]: any = await pool.query(
          'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME="users" AND TABLE_SCHEMA=DATABASE()');
        result.userTableColumns = cols.map((c: any) => c.COLUMN_NAME);
      } else {
        result.inMemoryUsers = inMemoryDb?.users?.length || 0;
        result.note = 'DB not connected — using in-memory';
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** POST /api/superadmin/tenants — create new shop */
  app.post('/api/superadmin/tenants', async (req: Request, res: Response) => {
    const key = req.headers['x-super-admin-key'] || req.body.superAdminKey;
    if (key !== SUPER_ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });

    const { shopName, ownerEmail, password, phone, address, gst, plan } = req.body;
    if (!shopName || !ownerEmail || !password)
      return res.status(400).json({ error: 'shopName, ownerEmail and password are required' });

    const baseSlug  = shopName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 28);
    const slug      = `${baseSlug}-${crypto.randomBytes(2).toString('hex')}`; // always unique
    const tenantId  = `${baseSlug}-${crypto.randomBytes(4).toString('hex')}`;
    const now      = Date.now();

    const defaultSettings = {
      showroomName: shopName, showroomPhone: phone||'',
      showroomAddress: address||'', gstNumber: gst||'',
      categories: ['Granite','Marble','Kadapa','Floor Tile','Wall Tile','Adhesive','Sanitary'],
      allowItemImagesInDocs: true, printShowCompanyGst: true, printShowCustomerGst: true,
    };

    const adminUserId = `usr-${crypto.randomBytes(6).toString('hex')}`;
    const adminUser   = {
      id: adminUserId, name: 'Administrator', email: ownerEmail,
      role: 'Admin', status: 'Active', password, baseSalary: 0, tenantId,
      permissions: {
        canViewDashboard:true, canManageInventory:true, canManageSales:true,
        canViewReports:true, canManageUsers:true, canViewCredits:true,
        canManageCustomers:true, canManageReturns:true, canManageGallery:true,
      },
    };

    try {
      if (pool && dbHealthy) {
        const conn = await pool.getConnection();
        try {
          await conn.query(
            'INSERT INTO tenants (id,name,slug,owner_email,owner_phone,address,gst,plan,status,settings,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            [tenantId,shopName,slug,ownerEmail,phone||'',address||'',gst||'',plan||'standard','active',JSON.stringify(defaultSettings),now,now]
          );
          const initialData = {
            users:[adminUser], settings:defaultSettings,
            products:[], sales:[], purchases:[], vendorOrders:[], quotations:[],
            customers:[], offers:[], commissionRules:[], activityLogs:[],
            advances:[], payrollRecords:[], returns:[], galleryLeads:[],
            loadingCharges:[], giftInventory:[], giftIssuances:[], incentiveEntries:[],
            lastUpdated: now,
          };
          // Each tenant gets their own unique persistence row
          // MUST use tenant-specific id to avoid overwriting the default shop's 'global_master'
          await conn.query(
            'INSERT INTO system_persistence (id,tenant_id,payload,updated_at) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload), updated_at=VALUES(updated_at)',
            [`global_master_${tenantId}`,tenantId,JSON.stringify(initialData),now]
          );
          await conn.query(
            'INSERT INTO users (id,tenant_id,name,email,role,status,data,updated_at) VALUES (?,?,?,?,?,?,?,?)',
            [adminUserId,tenantId,'Administrator',ownerEmail,'Admin','Active',JSON.stringify(adminUser),now]
          );
        } finally { conn.release(); }
      }
      tenantCache.set(tenantId, { id:tenantId, name:shopName, slug, status:'active' });
      console.log(`[TENANT] Created: ${tenantId} (${shopName})`);
      res.json({ success:true, tenant:{id:tenantId,name:shopName,slug}, loginUrl:`/?tenant=${slug}`, message:`Shop created. Login: ${ownerEmail} / ${password}` });
    } catch (err: any) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A shop with a very similar name already exists. Try adding your city name — e.g. "Royal Tiles Kadapa".' });
      res.status(500).json({ error: err.message });
    }
  });

  /** POST /api/tenant/login — returns JWT with tenantId */
  app.post('/api/tenant/login', async (req: Request, res: Response) => {
    const { email, password, tenantSlug } = req.body;
    console.log('[LOGIN] attempt — email:', email, '| slug:', tenantSlug, '| dbHealthy:', dbHealthy);
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    // 'default' slug means the original single-tenant shop — use that path
    const effectiveSlug = tenantSlug === 'default' ? '' : (tenantSlug || '');
    try {
      let user: any = null;
      let tenantId  = effectiveSlug ? '' : (process.env.DEFAULT_TENANT_ID || 'default');

      if (pool && dbHealthy) {
        // ── Step 1: resolve tenantId from slug/id ──────────────────────────
        if (tenantSlug) {
          const [tr]: any = await pool.query(
            'SELECT id, slug FROM tenants WHERE (slug=? OR id=?)',
            [tenantSlug, tenantSlug]);
          console.log('[LOGIN] tenants found:', tr.length, tr.map((r:any)=>r.id));
          if (!tr.length) {
            return res.status(401).json({ error: 'Shop not found. URL should be /?tenant=your-shop-slug' });
          }
          tenantId = tr[0].id;
        }

        // ── Step 2: find user by email (with or without tenant filter) ──────
        // First try: WITH tenant_id column
        let ur: any[] = [];
        try {
          const [rows]: any = await pool.query(
            'SELECT id,name,email,role,status,data,tenant_id FROM users WHERE LOWER(email)=LOWER(?)',
            [email.trim()]);
          console.log('[LOGIN] all users with this email:', rows.length,
            rows.map((r:any) => ({ email: r.email, tenant_id: r.tenant_id })));
          // Filter by tenantId if we have one
          ur = tenantId ? rows.filter((r:any) => r.tenant_id === tenantId) : rows;
          console.log('[LOGIN] after tenant filter (tenantId=' + tenantId + '):', ur.length);
        } catch (colErr: any) {
          console.warn('[LOGIN] tenant_id col missing, fallback:', colErr.message);
          const [rows]: any = await pool.query(
            'SELECT id,name,email,role,status,data FROM users WHERE LOWER(email)=LOWER(?)',
            [email.trim()]);
          ur = rows;
        }

        if (ur.length) {
          const u = ur[0];
          const d = parseData(u.data);
          user = { id:u.id, name:u.name, email:u.email, role:u.role,
                   status:u.status, tenantId: u.tenant_id || tenantId, ...d };
          console.log('[LOGIN] user found — stored password length:', (user.password||'').length);
        } else {
          console.warn('[LOGIN] no user found for email:', email.trim(), 'tenantId:', tenantId);
        }
      } else {
        console.warn('[LOGIN] DB not healthy — in-memory only');
      }

      if (!user) return res.status(401).json({
        error: 'Email not found',
        debug: { tenantId, email: email.trim(), dbHealthy }
      });
      if (user.status === 'Suspended') return res.status(403).json({ error:'Account suspended' });
      if (user.password !== password) return res.status(401).json({ error:'Incorrect password' });

      const token = signToken({ tenantId: user.tenantId, userId: user.id, role: user.role });
      res.json({
        success: true, token,
        user: { id:user.id, name:user.name, email:user.email, role:user.role, tenantId:user.tenantId },
        expiresAt: new Date(Date.now() + 30*86400*1000).toISOString()
      });
    } catch (err: any) {
      console.error('[LOGIN] error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /** GET /api/superadmin/tenants — list all shops */
  app.get('/api/superadmin/tenants', async (req: Request, res: Response) => {
    if (req.headers['x-super-admin-key'] !== SUPER_ADMIN_KEY) return res.status(403).json({ error:'Unauthorized' });
    try {
      if (pool && dbHealthy) {
        const [rows]: any = await pool.query('SELECT id,name,slug,owner_email,owner_phone,plan,status,created_at FROM tenants ORDER BY created_at DESC');
        return res.json({ tenants: rows });
      }
      res.json({ tenants: [...tenantCache.values()] });
    } catch (err: any) { res.status(500).json({ error:err.message }); }
  });

  /** PATCH /api/superadmin/tenants/:id — suspend or activate a shop */
  app.patch('/api/superadmin/tenants/:id', async (req: Request, res: Response) => {
    if (req.headers['x-super-admin-key'] !== SUPER_ADMIN_KEY) return res.status(403).json({ error:'Unauthorized' });
    try {
      if (pool && dbHealthy) await pool.query('UPDATE tenants SET status=?,updated_at=? WHERE id=?',[req.body.status,Date.now(),req.params.id]);
      const c = tenantCache.get(req.params.id);
      if (c) tenantCache.set(req.params.id, { ...c, status: req.body.status });
      res.json({ success:true });
    } catch (err: any) { res.status(500).json({ error:err.message }); }
  });

  /** DELETE /api/superadmin/tenants/:id — remove a shop and its users permanently */
  app.delete('/api/superadmin/tenants/:id', async (req: Request, res: Response) => {
    if (req.headers['x-super-admin-key'] !== SUPER_ADMIN_KEY) return res.status(403).json({ error:'Unauthorized' });
    const id = req.params.id;
    try {
      if (pool && dbHealthy) {
        const conn = await pool.getConnection();
        try {
          await conn.query('DELETE FROM users WHERE tenant_id=?', [id]);
          await conn.query('DELETE FROM system_persistence WHERE tenant_id=?', [id]);
          await conn.query('DELETE FROM tenants WHERE id=? OR slug=?', [id, id]);
        } finally { conn.release(); }
      }
      tenantCache.delete(id);
      res.json({ success: true, message: `Shop ${id} deleted` });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Load all active tenants into cache after DB connects
  setTimeout(async () => {
    if (!pool || !dbHealthy) return;
    try {
      const [rows]: any = await pool.query('SELECT id,name,slug,status FROM tenants WHERE status="active"');
      rows.forEach((r: any) => tenantCache.set(r.id, r));
      console.log(`[TENANT] ${rows.length} active tenants loaded`);
    } catch {}
  }, 3000);

      // Production: Serve static files from dist
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    
    // SPA fallback for production
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Endpoint not found' });
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }


  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 REAL-WORLD ERP ENGINE ACTIVE ON PORT ${PORT}`);
    const dbTarget = activeDbConfig.uri 
      ? activeDbConfig.uri.replace(/:([^:@]+)@/, ':****@')
      : (activeDbConfig.host || activeDbConfig.socketPath || 'undefined');
    console.log(`📡 DB TARGET: ${dbTarget}`);
    if (dbTarget.includes('.internal')) {
      console.warn('⚠️ [WARNING] You are using an internal database URL (.internal). This may not be accessible from outside your hosting provider.');
    }
    
    // Pre-warm the cache on startup to ensure the first client sync is fast
    readFromDb().catch(err => console.error('[WARMUP FAULT]', err.message));
  });
}

startServer();
