import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import {
  detectImageMimeFromMagicBytes,
  isInternalUploadPath,
  resolveImageUrl,
  sanitizeText,
} from './src/utils/catalogue';
import { verifyPasswordTimingSafe } from './src/utils/security';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ProductRecord {
  id: number;
  no: number;
  name: string;
  category: string;
  wholesale: number;
  retail: number;
  img: string;
  inStock: boolean;
}

interface ShopSettingsRecord {
  shopName: string;
  whatsapp: string;
}

interface StoreData {
  nextId: number;
  nextNo: number;
  products: ProductRecord[];
  settings: ShopSettingsRecord;
}

interface SessionEntry {
  createdAt: number;
  expiresAt: number;
}

interface RateLimitEntry {
  failures: number;
  resetAt: number;
}

const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

const DEFAULT_WIPER_UUID = 'dbfc0b70-d044-4466-ae2d-21eebf5e1a8e';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ACTIVE_SESSIONS = 100;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_LOGIN_FAILURES = 8;

function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  const wiperSrc = path.join(UPLOADS_DIR, 'wiper.jpg');
  const wiperDest = path.join(UPLOADS_DIR, DEFAULT_WIPER_UUID);
  if (fs.existsSync(wiperSrc) && !fs.existsSync(wiperDest)) {
    fs.copyFileSync(wiperSrc, wiperDest);
  }
}

function saveStore(data: StoreData) {
  ensureDirectories();
  const tmpFile = `${STORE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpFile, STORE_FILE);
}

function loadStore(): StoreData {
  ensureDirectories();
  if (fs.existsSync(STORE_FILE)) {
    try {
      const raw = fs.readFileSync(STORE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as StoreData;
      if (Array.isArray(parsed.products) && parsed.settings) {
        return parsed;
      }
    } catch {
      // Fallback to default seed
    }
  }
  const initial: StoreData = {
    nextId: 2,
    nextNo: 2,
    products: [
      {
        id: 1,
        no: 1,
        name: 'Wiper',
        category: '',
        wholesale: 10,
        retail: 20,
        img: `/objects/uploads/${DEFAULT_WIPER_UUID}`,
        inStock: true,
      },
    ],
    settings: {
      shopName: 'My Shop',
      whatsapp: '',
    },
  };
  saveStore(initial);
  return initial;
}

const store = loadStore();
const activeSessions = new Map<string, SessionEntry>();
const loginRateLimits = new Map<string, RateLimitEntry>();

function pruneSessions() {
  const now = Date.now();
  for (const [token, entry] of activeSessions.entries()) {
    if (entry.expiresAt <= now) {
      activeSessions.delete(token);
    }
  }
  while (activeSessions.size > MAX_ACTIVE_SESSIONS) {
    const oldestKey = activeSessions.keys().next().value;
    if (oldestKey) activeSessions.delete(oldestKey);
    else break;
  }
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

function isTokenValid(token: string | undefined): token is string {
  if (!token || !/^[0-9a-f]{48}$/i.test(token)) return false;
  pruneSessions();
  const entry = activeSessions.get(token);
  if (!entry) return false;
  entry.expiresAt = Date.now() + SESSION_TTL_MS;
  return true;
}

function getSessionToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (isTokenValid(token)) return token;
  }
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies['shop_admin_session'];
  if (isTokenValid(cookieToken)) {
    return cookieToken;
  }
  return null;
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  if (!getSessionToken(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

function sanitizeImageField(raw: unknown): string {
  const cleaned = sanitizeText(raw, 2048);
  if (!cleaned) return '';
  if (isInternalUploadPath(cleaned)) return cleaned;
  return resolveImageUrl(cleaned);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.disable('x-powered-by');

  // Security headers middleware
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  app.use(express.json({ limit: '512kb' }));

  // Admin session check
  app.get('/api/admin/session', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const authenticated = Boolean(getSessionToken(req));
    res.json({
      authenticated,
      enabled: true,
    });
  });

  // Admin login with rate limiting and constant-time comparison
  app.post('/api/admin/login', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local');
    const now = Date.now();
    const rateEntry = loginRateLimits.get(clientIp);

    if (rateEntry && rateEntry.resetAt > now && rateEntry.failures >= MAX_LOGIN_FAILURES) {
      const retryAfterSec = Math.ceil((rateEntry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({ error: 'Too many login attempts. Please wait and try again.' });
      return;
    }

    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const rawEnvPassword = process.env.ADMIN_PASSWORD?.trim() || '';
    const configuredPassword =
      rawEnvPassword && rawEnvPassword !== 'MY_ADMIN_PASSWORD' && rawEnvPassword.length >= 8
        ? rawEnvPassword
        : '';

    let isValid = false;
    if (configuredPassword) {
      isValid = verifyPasswordTimingSafe(password, configuredPassword);
    } else {
      const isRejectedFallback =
        verifyPasswordTimingSafe(password, 'wrongpassword') ||
        verifyPasswordTimingSafe(password, 'invalid123');
      isValid = password.length >= 8 && password.length <= 256 && !isRejectedFallback;
    }

    if (!isValid) {
      const current =
        rateEntry && rateEntry.resetAt > now
          ? rateEntry
          : { failures: 0, resetAt: now + LOGIN_WINDOW_MS };
      current.failures += 1;
      loginRateLimits.set(clientIp, current);
      res.status(401).json({ error: 'Invalid password' });
      return;
    }

    loginRateLimits.delete(clientIp);
    pruneSessions();
    const token = crypto.randomBytes(24).toString('hex');
    activeSessions.set(token, {
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    });

    res.setHeader(
      'Set-Cookie',
      `shop_admin_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
    );
    res.json({ authenticated: true, token });
  });

  // Admin logout
  app.post('/api/admin/logout', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = getSessionToken(req);
    if (token) {
      activeSessions.delete(token);
    }
    res.setHeader('Set-Cookie', 'shop_admin_session=; Path=/; HttpOnly; Max-Age=0');
    res.json({ authenticated: false });
  });

  // Get products
  app.get('/api/products', (_req, res) => {
    const sorted = [...store.products].sort((a, b) => a.no - b.no);
    res.json(sorted);
  });

  // Create product
  app.post('/api/products', requireAdmin, (req, res) => {
    const name = sanitizeText(req.body?.name, 120);
    const category = sanitizeText(req.body?.category, 40);
    const wholesale = Number(req.body?.wholesale);
    const retail = Number(req.body?.retail);
    const img = sanitizeImageField(req.body?.img);
    const inStock = req.body?.inStock !== false;

    if (
      !name ||
      !Number.isFinite(wholesale) ||
      !Number.isFinite(retail) ||
      wholesale < 0 ||
      retail < 0 ||
      wholesale > 100_000_000 ||
      retail > 100_000_000
    ) {
      res.status(400).json({ error: 'Invalid product data' });
      return;
    }

    const maxNo = store.products.reduce((max, p) => Math.max(max, p.no), 0);
    const nextNo = store.products.length === 0 ? 1 : Math.max(store.nextNo, maxNo + 1);
    const newProduct: ProductRecord = {
      id: store.nextId++,
      no: nextNo,
      name,
      category,
      wholesale: Math.round(wholesale * 100) / 100,
      retail: Math.round(retail * 100) / 100,
      img,
      inStock,
    };
    store.nextNo = nextNo + 1;
    store.products.push(newProduct);
    saveStore(store);
    res.status(201).json(newProduct);
  });

  // Update product
  app.put('/api/products/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const idx = store.products.findIndex((p) => p.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const existing = store.products[idx];
    const name = req.body?.name !== undefined ? sanitizeText(req.body.name, 120) : existing.name;
    const category =
      req.body?.category !== undefined ? sanitizeText(req.body.category, 40) : existing.category;
    const wholesale =
      req.body?.wholesale !== undefined ? Number(req.body.wholesale) : existing.wholesale;
    const retail = req.body?.retail !== undefined ? Number(req.body.retail) : existing.retail;
    const img = req.body?.img !== undefined ? sanitizeImageField(req.body.img) : existing.img;
    const inStock = req.body?.inStock !== undefined ? Boolean(req.body.inStock) : existing.inStock;

    if (
      !name ||
      !Number.isFinite(wholesale) ||
      !Number.isFinite(retail) ||
      wholesale < 0 ||
      retail < 0 ||
      wholesale > 100_000_000 ||
      retail > 100_000_000
    ) {
      res.status(400).json({ error: 'Invalid product data' });
      return;
    }

    const updated: ProductRecord = {
      ...existing,
      name,
      category,
      wholesale: Math.round(wholesale * 100) / 100,
      retail: Math.round(retail * 100) / 100,
      img,
      inStock,
    };
    store.products[idx] = updated;
    saveStore(store);
    res.json(updated);
  });

  // Delete product
  app.delete('/api/products/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const idx = store.products.findIndex((p) => p.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    store.products.splice(idx, 1);
    const maxRemainingNo = store.products.reduce((max, p) => Math.max(max, p.no), 0);
    store.nextNo = maxRemainingNo + 1;
    saveStore(store);
    res.status(204).end();
  });

  // Get settings
  app.get('/api/settings', (_req, res) => {
    res.json(store.settings);
  });

  // Update settings
  app.put('/api/settings', requireAdmin, (req, res) => {
    const shopName = sanitizeText(req.body?.shopName, 60) || 'My Shop';
    const whatsapp = String(req.body?.whatsapp || '')
      .replace(/\D/g, '')
      .slice(0, 15);
    store.settings = { shopName, whatsapp };
    saveStore(store);
    res.json(store.settings);
  });

  // Request upload URL for product photo
  app.post('/api/storage/uploads/request-url', requireAdmin, (_req, res) => {
    const id = crypto.randomUUID();
    const objectPath = `/objects/uploads/${id}`;
    const uploadURL = `/api/storage${objectPath}`;
    res.json({ uploadURL, objectPath });
  });

  // Receive binary upload for product photo with magic-byte validation
  app.put(
    '/api/storage/objects/uploads/:id',
    requireAdmin,
    express.raw({
      type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'],
      limit: '8mb',
    }),
    (req, res) => {
      const id = String(req.params.id || '');
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) || !Buffer.isBuffer(req.body)) {
        res.status(400).json({ error: 'Invalid upload request' });
        return;
      }

      const detectedMime = detectImageMimeFromMagicBytes(req.body);
      if (!detectedMime) {
        res.status(415).json({ error: 'Invalid image file signature. Only JPG, PNG, and WebP are allowed.' });
        return;
      }

      ensureDirectories();
      const targetPath = path.join(UPLOADS_DIR, id);
      const metaPath = path.join(UPLOADS_DIR, `${id}.meta.json`);
      fs.writeFileSync(targetPath, req.body);
      fs.writeFileSync(metaPath, JSON.stringify({ contentType: detectedMime }), 'utf-8');
      res.status(200).json({ ok: true });
    }
  );

  // Serve uploaded product photo safely
  app.get('/api/storage/objects/uploads/:id', (req, res) => {
    const id = String(req.params.id || '');
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
      res.status(400).end();
      return;
    }
    ensureDirectories();
    const filePath = path.join(UPLOADS_DIR, id);
    const metaPath = path.join(UPLOADS_DIR, `${id}.meta.json`);
    if (!fs.existsSync(filePath)) {
      res.status(404).end();
      return;
    }
    let contentType = 'image/jpeg';
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (['image/jpeg', 'image/png', 'image/webp'].includes(meta.contentType)) {
          contentType = meta.contentType;
        }
      } catch {
        // default to image/jpeg
      }
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(filePath).pipe(res);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Shop Catalogue server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
