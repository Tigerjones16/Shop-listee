/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeleteButton } from './components/DeleteButton';
import { LoginModal } from './components/LoginModal';
import { ProductModal, type ProductInput } from './components/ProductModal';
import { SettingsModal } from './components/SettingsModal';
import {
  buildWhatsappUrl,
  DEFAULT_SHOP_NAME,
  extractCategories,
  filterProducts,
  formatPrice,
  formatSerial,
  generateProductsCsv,
  normalizeWhatsapp,
  resolveImageUrl,
  type Product,
  type ShopSettings,
} from './utils/catalogue';

type ModalType = 'login' | 'product' | 'settings' | 'install' | 'lightbox' | null;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const ADMIN_TOKEN_KEY = 'shop_catalogue_admin_token';

async function apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = window.sessionStorage.getItem(ADMIN_TOKEN_KEY);
  const headers = new Headers(options.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(errText || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<ShopSettings>({
    shopName: DEFAULT_SHOP_NAME,
    whatsapp: '',
  });
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);
  const [adminEnabled, setAdminEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [canInstall, setCanInstall] = useState(false);
  const [failedImages, setFailedImages] = useState<Record<number, boolean>>({});

  const installPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const toastTimerRef = useRef<number | undefined>(undefined);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMessage(''), 3000);
  }, []);

  const fetchAll = useCallback(async () => {
    setHasError(false);
    try {
      const [prods, sets, sess] = await Promise.all([
        apiRequest<Product[]>('/api/products'),
        apiRequest<ShopSettings>('/api/settings'),
        apiRequest<{ authenticated: boolean; enabled: boolean }>('/api/admin/session'),
      ]);
      setProducts(prods || []);
      setSettings(sets || { shopName: DEFAULT_SHOP_NAME, whatsapp: '' });
      setAdminAuthenticated(sess?.authenticated === true);
      setAdminEnabled(sess?.enabled !== false);
      setFailedImages({});
    } catch {
      setHasError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const categories = useMemo(() => extractCategories(products), [products]);
  const shopTitle = settings.shopName || DEFAULT_SHOP_NAME;

  useEffect(() => {
    if (selectedCategory && !categories.includes(selectedCategory)) {
      setSelectedCategory('');
    }
  }, [selectedCategory, categories]);

  useEffect(() => {
    document.title = shopTitle;
  }, [shopTitle]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      window.addEventListener(
        'load',
        () => {
          navigator.serviceWorker.register('/sw.js').catch(() => {});
        },
        { once: true }
      );
    }
  }, []);

  useEffect(() => {
    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    const isIos =
      /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isStandalone && isIos) {
      setCanInstall(true);
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      installPromptRef.current = e as BeforeInstallPromptEvent;
      setCanInstall(true);
    };
    const handleAppInstalled = () => {
      installPromptRef.current = null;
      setCanInstall(false);
      showToast('Installed');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [showToast]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const filteredProducts = useMemo(
    () => filterProducts(products, searchQuery, selectedCategory),
    [products, searchQuery, selectedCategory]
  );

  const openProductModal = (prod: Product | null) => {
    setEditingProduct(prod);
    setActiveModal('product');
  };

  const closeModal = () => setActiveModal(null);

  const handleAdminButtonClick = async () => {
    if (!adminAuthenticated) {
      setActiveModal('login');
      return;
    }
    try {
      await apiRequest('/api/admin/logout', { method: 'POST' });
      window.sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      await fetchAll();
      showToast('Signed out');
    } catch {
      showToast('Could not sign out. Try again.');
    }
  };

  const handleLogin = async (password: string) => {
    const res = await apiRequest<{ authenticated: boolean; token?: string }>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    if (res?.token) {
      window.sessionStorage.setItem(ADMIN_TOKEN_KEY, res.token);
    }
    await fetchAll();
    setActiveModal(null);
    showToast('Signed in');
  };

  const handleDeleteProduct = async (prod: Product) => {
    try {
      await apiRequest(`/api/products/${prod.id}`, { method: 'DELETE' });
      await fetchAll();
      showToast('Deleted');
    } catch {
      showToast('Could not delete. Try again.');
    }
  };

  const handleExportCsv = () => {
    const csvContent = generateProductsCsv(products);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'products.csv';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const handleInstallClick = async () => {
    const promptEvent = installPromptRef.current;
    if (promptEvent) {
      await promptEvent.prompt();
      try {
        await promptEvent.userChoice;
      } catch {
        // Ignore user dismissal
      }
      installPromptRef.current = null;
      setCanInstall(false);
      return;
    }
    setActiveModal('install');
  };

  const handleSaveProduct = async (data: ProductInput, addAnother: boolean): Promise<boolean> => {
    try {
      if (editingProduct) {
        await apiRequest(`/api/products/${editingProduct.id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        });
      } else {
        await apiRequest('/api/products', {
          method: 'POST',
          body: JSON.stringify(data),
        });
      }
      await fetchAll();
      showToast(editingProduct ? 'Saved' : addAnother ? 'Added. Add the next one.' : 'Saved');
      if (addAnother && !editingProduct) {
        setEditingProduct(null);
        return true;
      }
      setActiveModal(null);
      return true;
    } catch {
      showToast('Could not save. Check the connection and try again.');
      return false;
    }
  };

  const handleUploadImage = async (file: File): Promise<string> => {
    const { uploadURL, objectPath } = await apiRequest<{ uploadURL: string; objectPath: string }>(
      '/api/storage/uploads/request-url',
      {
        method: 'POST',
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType: file.type,
        }),
      }
    );
    const token = window.sessionStorage.getItem(ADMIN_TOKEN_KEY);
    const headers: Record<string, string> = { 'Content-Type': file.type };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const uploadRes = await fetch(uploadURL, {
      method: 'PUT',
      headers,
      body: file,
      credentials: 'include',
    });
    if (!uploadRes.ok) {
      throw new Error('Image upload failed');
    }
    return objectPath;
  };

  const handleSaveSettings = async (rawShopName: string, rawWhatsapp: string) => {
    const normalizedWa = normalizeWhatsapp(rawWhatsapp);
    try {
      const payload: ShopSettings = {
        shopName: rawShopName.trim() || DEFAULT_SHOP_NAME,
        whatsapp: normalizedWa,
      };
      await apiRequest('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      await fetchAll();
      setActiveModal(null);
      showToast('Settings saved');
    } catch {
      showToast('Could not save settings. Try again.');
    }
  };

  const ready = !loading;

  return (
    <div>
      <header className="app-header">
        <div className="brand">
          <h1>{shopTitle}</h1>
          <div className="sub">Product catalogue</div>
        </div>
        <div className="head-actions">
          {canInstall && (
            <button className="button install" type="button" onClick={handleInstallClick}>
              Install app
            </button>
          )}
          <button className="button" type="button" onClick={handleAdminButtonClick}>
            {adminAuthenticated ? 'Sign out' : 'Admin'}
          </button>
        </div>
      </header>

      <main className="wrap">
        {adminAuthenticated && (
          <div className="admin-bar">
            <button
              className="button primary"
              type="button"
              onClick={() => openProductModal(null)}
            >
              + Add product
            </button>
            <button
              className="button"
              type="button"
              onClick={() => setActiveModal('settings')}
            >
              Settings
            </button>
            <button className="button" type="button" onClick={handleExportCsv}>
              Export CSV
            </button>
          </div>
        )}

        <input
          className="search"
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value.trimStart())}
          placeholder="Search name, category or serial no."
          aria-label="Search products"
        />

        {categories.length > 0 && (
          <div className="chips">
            {['', ...categories].map((cat) => (
              <button
                key={cat || 'all'}
                type="button"
                className={`chip${selectedCategory === cat ? ' on' : ''}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat || 'All'}
              </button>
            ))}
          </div>
        )}

        {products.length > 0 && (
          <div className="count">
            {filteredProducts.length} of {products.length} products
          </div>
        )}

        <div className="tablewrap">
          {ready && !hasError && filteredProducts.length > 0 && (
            <table className="product-table">
              <thead>
                <tr>
                  <th className="image-col">Image</th>
                  <th>No.</th>
                  <th>Product</th>
                  <th className="right">Wholesale</th>
                  <th className="right">Retail</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((prod) => {
                  const rawImgUrl = resolveImageUrl(prod.img);
                  const imgUrl = failedImages[prod.id] ? '' : rawImgUrl;
                  const waUrl = buildWhatsappUrl(settings.whatsapp, prod);
                  return (
                    <tr key={prod.id} className={prod.inStock ? '' : 'row-out'}>
                      <td>
                        {imgUrl ? (
                          <img
                            className={`product-image${adminAuthenticated ? ' editable' : ''}`}
                            src={imgUrl}
                            alt={prod.name}
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setFailedImages((prev) => ({ ...prev, [prod.id]: true }))
                            }
                            onClick={() => {
                              if (adminAuthenticated) {
                                openProductModal(prod);
                              } else {
                                setLightboxSrc(imgUrl);
                                setActiveModal('lightbox');
                              }
                            }}
                          />
                        ) : adminAuthenticated ? (
                          <button
                            type="button"
                            className="no-image editable"
                            aria-label={`Add photo URL for ${prod.name}`}
                            onClick={() => openProductModal(prod)}
                          >
                            +
                          </button>
                        ) : (
                          <div className="no-image" aria-label="No product photo">
                            —
                          </div>
                        )}
                      </td>
                      <td className="serial">{formatSerial(prod.no)}</td>
                      <td>
                        <div className="product-name">{prod.name}</div>
                        <div className="meta">
                          {prod.category && <span className="tag">{prod.category}</span>}
                          {!prod.inStock && <span className="tag out">Out of stock</span>}
                          {waUrl && (
                            <a
                              className="wa-link"
                              href={waUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Enquire
                            </a>
                          )}
                        </div>
                        {adminAuthenticated && (
                          <div className="row-actions">
                            <button
                              type="button"
                              className="button"
                              aria-label={`Edit ${prod.name}`}
                              onClick={() => openProductModal(prod)}
                            >
                              Edit
                            </button>
                            <DeleteButton
                              productName={prod.name}
                              onDelete={() => handleDeleteProduct(prod)}
                            />
                          </div>
                        )}
                      </td>
                      <td className="price">{formatPrice(prod.wholesale)}</td>
                      <td className="price">{formatPrice(prod.retail)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {!ready && !hasError && (
            <div aria-label="Loading products">
              <div className="loading-skeleton" />
              <div className="loading-skeleton" />
              <div className="loading-skeleton" />
            </div>
          )}

          {hasError && (
            <div className="empty-state" role="alert">
              <div className="empty-mark">!</div>
              <strong>Could not load the catalogue</strong>
              Please check your connection and retry.
              <div className="retry-wrap">
                <button className="button" type="button" onClick={fetchAll}>
                  Retry
                </button>
              </div>
            </div>
          )}

          {ready && !hasError && filteredProducts.length === 0 && (
            <div className="empty-state">
              <div className="empty-mark">+</div>
              <strong>{products.length ? 'No products match.' : 'No products yet.'}</strong>
              {products.length
                ? 'Try another search or category.'
                : adminAuthenticated
                  ? 'Add your first product to get started.'
                  : 'Check back soon for available products.'}
            </div>
          )}
        </div>
      </main>

      {activeModal === 'login' && (
        <LoginModal enabled={adminEnabled} onClose={closeModal} onLogin={handleLogin} />
      )}

      {activeModal === 'product' && (
        <ProductModal
          key={editingProduct?.id || 'new'}
          product={editingProduct}
          categories={categories}
          onClose={closeModal}
          onSave={handleSaveProduct}
          onUploadImage={handleUploadImage}
          onMessage={showToast}
        />
      )}

      {activeModal === 'settings' && (
        <SettingsModal settings={settings} onClose={closeModal} onSave={handleSaveSettings} />
      )}

      {activeModal === 'install' && (
        <div
          className="modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="install-title">
            <h2 id="install-title">Add to Home Screen</h2>
            <ol className="steps">
              <li>Tap the Share button in Safari, or the menu in Chrome.</li>
              <li>Choose Add to Home Screen.</li>
              <li>Tap Add. The shop icon appears on your home screen.</li>
            </ol>
            <div className="form-actions">
              <button className="button primary" type="button" onClick={closeModal}>
                Got it
              </button>
            </div>
          </section>
        </div>
      )}

      {activeModal === 'lightbox' && (
        <div
          className="modal lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Product photo preview"
          onClick={closeModal}
        >
          <img src={lightboxSrc} alt="Product" referrerPolicy="no-referrer" />
        </div>
      )}

      {toastMessage && (
        <div className="toast" role="status">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
