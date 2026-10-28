export interface Product {
  id: number;
  no: number;
  name: string;
  category: string;
  wholesale: number;
  retail: number;
  img: string;
  inStock: boolean;
}

export interface ShopSettings {
  shopName: string;
  whatsapp: string;
}

export const DEFAULT_SHOP_NAME = 'My Shop';
export const CURRENCY_SYMBOL = '₹';

/**
 * Strips ASCII control characters and trims whitespace to prevent injection/rendering bugs.
 */
export function sanitizeText(input: unknown, maxLength = 120): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .trim()
    .slice(0, maxLength);
}

export function formatSerial(no: number | string): string {
  const num = Number.parseInt(String(no), 10);
  if (!Number.isFinite(num) || num < 0) return '000';
  return String(num).padStart(3, '0');
}

export function formatPrice(amount: number | string | null | undefined): string {
  const num = Number(amount || 0);
  if (!Number.isFinite(num)) return `${CURRENCY_SYMBOL}0`;
  return CURRENCY_SYMBOL + num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export function isInternalUploadPath(img: string): boolean {
  return /^\/objects\/uploads\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(img);
}

/**
 * Resolves a product image URL safely, allowing only internal upload paths or valid HTTPS URLs.
 */
export function resolveImageUrl(img: string | null | undefined): string {
  if (!img || typeof img !== 'string') return '';
  const trimmed = img.trim();
  if (!trimmed) return '';
  if (isInternalUploadPath(trimmed)) {
    return `/api/storage${trimmed}`;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:') {
      return parsed.href;
    }
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return parsed.href;
    }
    return '';
  } catch {
    return '';
  }
}

export function extractCategories(products: Product[]): string[] {
  return [...new Set(products.map((p) => sanitizeText(p.category, 40)).filter(Boolean))].sort();
}

export function filterProducts(
  products: Product[],
  searchQuery: string,
  selectedCategory: string
): Product[] {
  const q = sanitizeText(searchQuery, 120).toLowerCase().replace(/^#/, '');
  return products.filter(
    (p) =>
      (!selectedCategory || p.category === selectedCategory) &&
      (!q ||
        p.name.toLowerCase().includes(q) ||
        formatSerial(p.no).includes(q) ||
        String(p.category || '').toLowerCase().includes(q))
  );
}

export function normalizeWhatsapp(raw: string): string {
  let cleaned = String(raw || '').replace(/\D/g, '').replace(/^0+/, '');
  if (cleaned.length === 10) {
    cleaned = '91' + cleaned;
  }
  return cleaned.slice(0, 15);
}

export function buildWhatsappUrl(whatsapp: string, product: Pick<Product, 'no' | 'name'>): string {
  const digits = String(whatsapp || '').replace(/\D/g, '');
  if (!digits || digits.length < 8 || digits.length > 15) return '';
  const text = `Hi, I am interested in #${formatSerial(product.no)} ${sanitizeText(product.name, 120)}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function escapeCsvCell(val: unknown): string {
  let str = String(val ?? '');
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  return '"' + str.replace(/"/g, '""') + '"';
}

export function generateProductsCsv(products: Product[]): string {
  const rows: (string | number)[][] = [
    ['No', 'Product', 'Category', 'Wholesale', 'Retail', 'In stock'],
    ...products.map((p) => [
      formatSerial(p.no),
      escapeCsvCell(p.name),
      escapeCsvCell(p.category || ''),
      p.wholesale,
      p.retail,
      p.inStock === false ? 'No' : 'Yes',
    ]),
  ];
  return '\uFEFF' + rows.map((r) => r.join(',')).join('\n');
}

/**
 * Inspects binary buffer magic bytes to verify genuine JPEG, PNG, or WebP images.
 * Prevents uploading disguised HTML/SVG/scripts as images.
 */
export function detectImageMimeFromMagicBytes(
  buf: Uint8Array
): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (!buf || buf.length < 12) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WebP: "RIFF" (52 49 46 46) at 0..3 and "WEBP" (57 45 42 50) at 8..11
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}
