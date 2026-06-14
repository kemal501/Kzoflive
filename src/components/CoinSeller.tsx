import React, { useState } from 'react';
import { buyCoins } from '../services/coinService';
import { auth } from '../firebase';

const CoinSeller: React.FC = () => {
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSell = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !userId || amount <= 0) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await buyCoins(userId, amount, auth.currentUser.uid);
      setSuccess(`Successfully sold ${amount} coins to user ${userId}`);
      setUserId('');
      setAmount(0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-800 p-6 rounded-xl shadow-2xl border border-slate-700 max-w-md w-full">
      <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
        <span className="text-yellow-500">🪙</span> Coin Seller Portal
      </h2>
      <form onSubmit={handleSell} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-slate-400 text-xs font-bold uppercase">User ID</label>
          <input 
            type="text" 
            value={userId} 
            onChange={(e) => setUserId(e.target.value)}
            className="bg-slate-900 p-3 rounded text-white border border-slate-700 focus:border-yellow-500 outline-none transition-colors"
            placeholder="Enter User ID..."
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-slate-400 text-xs font-bold uppercase">Amount</label>
          <input 
            type="number" 
            value={amount} 
            onChange={(e) => setAmount(parseInt(e.target.value))}
            className="bg-slate-900 p-3 rounded text-white border border-slate-700 focus:border-yellow-500 outline-none transition-colors"
            placeholder="Enter amount..."
            min="1"
            required
          />
        </div>
        <button 
          type="submit" 
          disabled={loading}
          className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-3 rounded-lg shadow-lg transition-all disabled:opacity-50"
        >
          {loading ? 'Processing...' : 'Sell Coins'}
        </button>
        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
        {success && <p className="text-green-500 text-sm mt-2">{success}</p>}
      </form>
    </div>
  );
};

export default CoinSeller;
