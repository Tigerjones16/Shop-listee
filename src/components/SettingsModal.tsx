import { useState } from 'react';
import { DEFAULT_SHOP_NAME, type ShopSettings } from '../utils/catalogue';

interface SettingsModalProps {
  settings: ShopSettings;
  onClose: () => void;
  onSave: (shopName: string, whatsapp: string) => Promise<void>;
}

export function SettingsModal({ settings, onClose, onSave }: SettingsModalProps) {
  const [shopName, setShopName] = useState(settings.shopName || DEFAULT_SHOP_NAME);
  const [whatsapp, setWhatsapp] = useState(settings.whatsapp || '');
  const [saving, setSaving] = useState(false);

  return (
    <div
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <h2 id="settings-title">Shop settings</h2>

        <label className="field">
          Shop name
          <input
            value={shopName}
            maxLength={60}
            onChange={(e) => setShopName(e.target.value)}
          />
        </label>

        <label className="field">
          WhatsApp number with country code (optional)
          <input
            value={whatsapp}
            inputMode="tel"
            maxLength={20}
            placeholder="919876543210"
            onChange={(e) => setWhatsapp(e.target.value)}
          />
        </label>
        <div className="sub">
          With a WhatsApp number, customers see an Enquire button on every product.
        </div>

        <div className="form-actions">
          <button className="button ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onSave(shopName, whatsapp);
              setSaving(false);
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>
    </div>
  );
}
