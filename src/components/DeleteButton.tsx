import { useEffect, useRef, useState } from 'react';

interface DeleteButtonProps {
  onDelete: () => void;
  productName?: string;
}

export function DeleteButton({ onDelete, productName }: DeleteButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => window.clearTimeout(timerRef.current);
  }, []);

  return (
    <button
      type="button"
      className="button danger"
      aria-label={
        confirming
          ? productName
            ? `Tap again to delete ${productName}`
            : 'Tap again'
          : productName
            ? `Delete ${productName}`
            : 'Delete'
      }
      onClick={() => {
        if (confirming) {
          window.clearTimeout(timerRef.current);
          setConfirming(false);
          onDelete();
          return;
        }
        setConfirming(true);
        timerRef.current = window.setTimeout(() => setConfirming(false), 2500);
      }}
    >
      {confirming ? 'Tap again' : 'Delete'}
    </button>
  );
}
