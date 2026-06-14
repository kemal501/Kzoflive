import React, { useState } from 'react';
import { sendGift } from '../services/giftService';
import { auth } from '../firebase';

interface GiftPanelProps {
  receiverId: string;
  roomId?: string;
  onGiftSent?: (giftType: string) => void;
}

const GIFTS = [
  { type: '🌹 Rose', value: 10 },
  { type: '❤️ Heart', value: 50 },
  { type: '💎 Diamond', value: 100 },
  { type: '🚀 Rocket', value: 500 },
  { type: '👑 Crown', value: 1000 },
];

const GiftPanel: React.FC<GiftPanelProps> = ({ receiverId, roomId, onGiftSent }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendGift = async (giftType: string, coinValue: number) => {
    if (!auth.currentUser) return;

    setLoading(true);
    setError(null);

    try {
      await sendGift(auth.currentUser.uid, receiverId, giftType, coinValue, roomId);
      if (onGiftSent) onGiftSent(giftType);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-800 p-4 rounded-xl shadow-2xl border border-slate-700 w-full max-w-sm">
      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <span className="text-pink-500">🎁</span> Send a Gift
      </h3>
      <div className="grid grid-cols-3 gap-3">
        {GIFTS.map((gift) => (
          <button
            key={gift.type}
            onClick={() => handleSendGift(gift.type, gift.value)}
            disabled={loading}
            className="flex flex-col items-center gap-1 p-3 bg-slate-900 rounded-lg border border-slate-700 hover:border-pink-500 transition-all hover:scale-105 disabled:opacity-50"
          >
            <span className="text-2xl">{gift.type.split(' ')[0]}</span>
            <span className="text-xs text-slate-400 font-bold">{gift.value} 🪙</span>
          </button>
        ))}
      </div>
      {error && <p className="text-red-500 text-xs mt-3">{error}</p>}
    </div>
  );
};

export default GiftPanel;
