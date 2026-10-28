import { useEffect, useState } from 'react';
import {
  detectImageMimeFromMagicBytes,
  formatSerial,
  isInternalUploadPath,
  resolveImageUrl,
  sanitizeText,
  type Product,
} from '../utils/catalogue';

export interface ProductInput {
  name: string;
  category: string;
  wholesale: number;
  retail: number;
  img: string;
  inStock: boolean;
}

interface ProductModalProps {
  product: Product | null;
  categories: string[];
  onClose: () => void;
  onSave: (data: ProductInput, addAnother: boolean) => Promise<boolean>;
  onUploadImage: (file: File) => Promise<string>;
  onMessage: (msg: string) => void;
}

export function ProductModal({
  product,
  categories,
  onClose,
  onSave,
  onUploadImage,
  onMessage,
}: ProductModalProps) {
  const [name, setName] = useState(product?.name || '');
  const [category, setCategory] = useState(product?.category || '');
  const [wholesale, setWholesale] = useState(product ? String(product.wholesale) : '');
  const [retail, setRetail] = useState(product ? String(product.retail) : '');
  const [inStock, setInStock] = useState(product?.inStock ?? true);
  const [img, setImg] = useState(product?.img || '');
  const [file, setFile] = useState<File | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmedLowRetail, setConfirmedLowRetail] = useState(false);

  const isInternalUpload = isInternalUploadPath(img);

  useEffect(() => {
    if (!file) {
      setPreviewUrl('');
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const handleFileSelect = async (selected: File | undefined) => {
    if (!selected) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(selected.type)) {
      onMessage('Choose a JPG, PNG, or WebP image');
      return;
    }
    if (selected.size > 8 * 1024 * 1024) {
      onMessage('Choose an image smaller than 8 MB');
      return;
    }
    try {
      const headerSlice = new Uint8Array(await selected.slice(0, 16).arrayBuffer());
      if (!detectImageMimeFromMagicBytes(headerSlice)) {
        onMessage('Choose a valid JPG, PNG, or WebP image file');
        return;
      }
    } catch {
      // Allow server-side validation to verify if slice fails
    }
    setFile(selected);
    setImg('');
    setUploadedPath(null);
  };

  const handleSubmit = async (addAnother: boolean) => {
    const cleanName = sanitizeText(name, 120);
    const cleanCategory = sanitizeText(category, 40);
    const wPrice = Number.parseFloat(wholesale);
    const rPrice = Number.parseFloat(retail);

    if (!cleanName) {
      onMessage('Enter a product name');
      return;
    }
    if (!Number.isFinite(wPrice) || !Number.isFinite(rPrice) || wPrice < 0 || rPrice < 0) {
      onMessage('Enter both prices');
      return;
    }
    const rawImg = img.trim();
    if (!file && rawImg && !isInternalUploadPath(rawImg) && !resolveImageUrl(rawImg)) {
      onMessage('Enter a valid https:// photo URL');
      return;
    }
    if (rPrice < wPrice && !confirmedLowRetail) {
      setConfirmedLowRetail(true);
      onMessage('Retail is lower than wholesale. Tap Save again to confirm.');
      return;
    }

    setSaving(true);
    let finalImg = rawImg;
    if (file) {
      try {
        finalImg = uploadedPath || (await onUploadImage(file));
        setUploadedPath(finalImg);
      } catch {
        onMessage('Could not upload the image. Check your connection and try again.');
        setSaving(false);
        return;
      }
    }

    const ok = await onSave(
      {
        name: cleanName,
        category: cleanCategory,
        wholesale: wPrice,
        retail: rPrice,
        img: finalImg,
        inStock,
      },
      addAnother
    );
    setSaving(false);

    if (ok && addAnother) {
      setName('');
      setCategory('');
      setWholesale('');
      setRetail('');
      setInStock(true);
      setImg('');
      setFile(null);
      setUploadedPath(null);
      setConfirmedLowRetail(false);
    }
  };

  const displayPreview = previewUrl || resolveImageUrl(img);

  return (
    <div
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="product-title">
        <h2 id="product-title">
          {product ? 'Edit product' : 'Add product'}{' '}
          <span className="badge">{product ? formatSerial(product.no) : 'next serial'}</span>
        </h2>

        <label className="field">
          Choose photo
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={saving}
            onChange={(e) => {
              const chosen = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              void handleFileSelect(chosen);
            }}
          />
        </label>
        <div className="sub">JPG, PNG, or WebP · up to 8 MB · uploads when you save</div>

        {displayPreview && (
          <div className="photo">
            <img
              src={displayPreview}
              alt={`${name || 'Product'} preview`}
              referrerPolicy="no-referrer"
            />
          </div>
        )}

        <label className="field">
          Or use a photo URL (optional)
          <input
            type="text"
            inputMode="url"
            maxLength={2048}
            placeholder="https://example.com/photo.jpg"
            value={file || isInternalUpload ? '' : img}
            disabled={saving || !!file}
            onChange={(e) => {
              setImg(e.target.value);
              setUploadedPath(null);
            }}
          />
        </label>

        {(img || file) && (
          <button
            className="button ghost"
            type="button"
            disabled={saving}
            onClick={() => {
              setFile(null);
              setUploadedPath(null);
              setImg('');
            }}
          >
            Remove photo
          </button>
        )}

        <label className="field">
          Product name
          <input
            autoFocus
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="field">
          Category (optional)
          <input
            value={category}
            maxLength={40}
            list="category-list"
            onChange={(e) => setCategory(e.target.value)}
          />
        </label>
        <datalist id="category-list">
          {categories.map((cat) => (
            <option key={cat} value={cat} />
          ))}
        </datalist>

        <div className="two">
          <label className="field">
            Wholesale price
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={wholesale}
              onChange={(e) => {
                setWholesale(e.target.value);
                setConfirmedLowRetail(false);
              }}
            />
          </label>
          <label className="field">
            Retail price
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={retail}
              onChange={(e) => {
                setRetail(e.target.value);
                setConfirmedLowRetail(false);
              }}
            />
          </label>
        </div>

        <label className="check-row">
          <input
            type="checkbox"
            checked={inStock}
            onChange={(e) => setInStock(e.target.checked)}
          />
          In stock
        </label>

        <div className="form-actions">
          <button className="button ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          {!product && (
            <button
              className="button"
              type="button"
              disabled={saving}
              onClick={() => handleSubmit(true)}
            >
              Save & add another
            </button>
          )}
          <button
            className="button primary"
            type="button"
            disabled={saving}
            onClick={() => handleSubmit(false)}
          >
            {saving ? (file && !uploadedPath ? 'Uploading photo…' : 'Saving…') : 'Save'}
          </button>
        </div>
      </section>
    </div>
  );
}
