import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSerial,
  formatPrice,
  resolveImageUrl,
  extractCategories,
  filterProducts,
  normalizeWhatsapp,
  buildWhatsappUrl,
  generateProductsCsv,
  sanitizeText,
  detectImageMimeFromMagicBytes,
  type Product,
} from './catalogue';
import { verifyPasswordTimingSafe } from './security';

const sampleProducts: Product[] = [
  {
    id: 1,
    no: 1,
    name: 'Wiper',
    category: '',
    wholesale: 10,
    retail: 20,
    img: '/objects/uploads/dbfc0b70-d044-4466-ae2d-21eebf5e1a8e',
    inStock: true,
  },
  {
    id: 2,
    no: 2,
    name: 'Floor Mop',
    category: 'Cleaning',
    wholesale: 120,
    retail: 180,
    img: 'https://example.com/mop.jpg',
    inStock: false,
  },
  {
    id: 3,
    no: 15,
    name: 'Steel Bucket',
    category: 'Hardware',
    wholesale: 250,
    retail: 350,
    img: '',
    inStock: true,
  },
];

test('formatSerial pads numbers to 3 digits and handles invalid inputs', () => {
  assert.equal(formatSerial(1), '001');
  assert.equal(formatSerial(15), '015');
  assert.equal(formatSerial(123), '123');
  assert.equal(formatSerial(-5), '000');
});

test('formatPrice formats numbers with Indian Rupee symbol and locale', () => {
  assert.equal(formatPrice(10), '₹10');
  assert.equal(formatPrice(1500), '₹1,500');
  assert.equal(formatPrice(0), '₹0');
});

test('resolveImageUrl handles internal object uploads and blocks unsafe schemes', () => {
  assert.equal(
    resolveImageUrl('/objects/uploads/dbfc0b70-d044-4466-ae2d-21eebf5e1a8e'),
    '/api/storage/objects/uploads/dbfc0b70-d044-4466-ae2d-21eebf5e1a8e'
  );
  assert.equal(resolveImageUrl('https://example.com/photo.jpg'), 'https://example.com/photo.jpg');
  assert.equal(resolveImageUrl('http://insecure.example.com/photo.jpg'), '');
  assert.equal(resolveImageUrl('javascript:alert(1)'), '');
  assert.equal(resolveImageUrl('data:text/html,<script>alert(1)</script>'), '');
  assert.equal(resolveImageUrl(''), '');
});

test('extractCategories returns sorted unique non-empty categories', () => {
  assert.deepEqual(extractCategories(sampleProducts), ['Cleaning', 'Hardware']);
});

test('filterProducts matches by name, serial number, and category', () => {
  assert.equal(filterProducts(sampleProducts, 'wiper', '').length, 1);
  assert.equal(filterProducts(sampleProducts, '#001', '').length, 1);
  assert.equal(filterProducts(sampleProducts, '015', '').length, 1);
  assert.equal(filterProducts(sampleProducts, '', 'Cleaning').length, 1);
  assert.equal(filterProducts(sampleProducts, 'bucket', 'Cleaning').length, 0);
});

test('normalizeWhatsapp strips non-digits and prefixes 10-digit numbers with 91', () => {
  assert.equal(normalizeWhatsapp('9876543210'), '919876543210');
  assert.equal(normalizeWhatsapp('+91 98765-43210'), '919876543210');
  assert.equal(normalizeWhatsapp('09876543210'), '919876543210');
});

test('buildWhatsappUrl constructs encoded wa.me enquiry URL and rejects invalid numbers', () => {
  const url = buildWhatsappUrl('919876543210', { no: 1, name: 'Wiper' });
  assert.equal(
    url,
    'https://wa.me/919876543210?text=Hi%2C%20I%20am%20interested%20in%20%23001%20Wiper'
  );
  assert.equal(buildWhatsappUrl('123', { no: 1, name: 'Wiper' }), '');
});

test('generateProductsCsv formats CSV with BOM and formula injection protection', () => {
  const csv = generateProductsCsv([
    {
      id: 1,
      no: 1,
      name: '=Wiper',
      category: 'Cleaning',
      wholesale: 10,
      retail: 20,
      img: '',
      inStock: true,
    },
  ]);
  assert.ok(csv.startsWith('\uFEFFNo,Product,Category,Wholesale,Retail,In stock\n'));
  assert.ok(csv.includes('001,"\'=Wiper","Cleaning",10,20,Yes'));
});

test('sanitizeText strips control characters and enforces maxLength', () => {
  assert.equal(sanitizeText('  Apple\u0000\u0007 Watch  ', 20), 'Apple Watch');
  assert.equal(sanitizeText('abcdefghij', 5), 'abcde');
});

test('detectImageMimeFromMagicBytes validates genuine JPEG, PNG, WebP headers and rejects HTML/SVG', () => {
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const webpBytes = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
  const htmlBytes = Buffer.from('<!DOCTYPE html><script>alert(1)</script>');

  assert.equal(detectImageMimeFromMagicBytes(jpegBytes), 'image/jpeg');
  assert.equal(detectImageMimeFromMagicBytes(pngBytes), 'image/png');
  assert.equal(detectImageMimeFromMagicBytes(webpBytes), 'image/webp');
  assert.equal(detectImageMimeFromMagicBytes(htmlBytes), null);
});

test('verifyPasswordTimingSafe compares passwords in constant time and enforces min length', () => {
  assert.equal(verifyPasswordTimingSafe('admin1234', 'admin1234'), true);
  assert.equal(verifyPasswordTimingSafe('wrongpassword', 'admin1234'), false);
  assert.equal(verifyPasswordTimingSafe('short', 'short'), false);
});
