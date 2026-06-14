import React, { useState, useEffect } from 'react';
import { getUserInventory, mineAsset, tradeAsset, InventoryItem } from '../services/inventoryService';
import { auth } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Package, Pickaxe, Send, Info } from 'lucide-react';

const Inventory: React.FC = () => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [mining, setMining] = useState(false);
  const [trading, setTrading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [recipientId, setRecipientId] = useState('');
  const [tradeQuantity, setTradeQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchInventory = async () => {
    if (!auth.currentUser) return;
    try {
      const data = await getUserInventory(auth.currentUser.uid);
      setItems(data);
    } catch (err) {
      console.error("Error fetching inventory:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  const handleMine = async () => {
    if (!auth.currentUser) return;
    setMining(true);
    setError(null);
    setSuccess(null);
    try {
      const asset = await mineAsset(auth.currentUser.uid);
      setSuccess(`Mined: ${asset.name}!`);
      await fetchInventory();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMining(false);
    }
  };

  const handleTrade = async () => {
    if (!auth.currentUser || !selectedItem || !recipientId) return;
    setTrading(true);
    setError(null);
    setSuccess(null);
    try {
      await tradeAsset(auth.currentUser.uid, recipientId, selectedItem.id!, tradeQuantity);
      setSuccess(`Traded ${tradeQuantity} ${selectedItem.name} to ${recipientId}`);
      setSelectedItem(null);
      setRecipientId('');
      setTradeQuantity(1);
      await fetchInventory();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTrading(false);
    }
  };

  const getRarityColor = (rarity: string) => {
    switch (rarity) {
      case 'common': return 'text-slate-400';
      case 'rare': return 'text-blue-400';
      case 'epic': return 'text-purple-400';
      case 'legendary': return 'text-orange-400';
      default: return 'text-white';
    }
  };

  if (loading) return <div className="p-8 text-center text-white">Loading Inventory...</div>;

  return (
    <div className="bg-slate-800 p-6 rounded-xl shadow-2xl border border-slate-700 w-full max-w-4xl mx-auto mt-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Package className="text-blue-500" /> Digital Inventory
        </h2>
        <button
          onClick={handleMine}
          disabled={mining}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition-all disabled:opacity-50"
        >
          <Pickaxe size={18} className={mining ? 'animate-spin' : ''} />
          {mining ? 'Mining...' : 'Mine Asset'}
        </button>
      </div>

      {error && <p className="text-red-500 text-sm mb-4 bg-red-500/10 p-2 rounded border border-red-500/20">{error}</p>}
      {success && <p className="text-green-500 text-sm mb-4 bg-green-500/10 p-2 rounded border border-green-500/20">{success}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.length === 0 ? (
          <div className="col-span-full text-center py-12 bg-slate-900/50 rounded-lg border border-dashed border-slate-700">
            <p className="text-slate-500">Your inventory is empty. Start mining!</p>
          </div>
        ) : (
          items.map((item) => (
            <motion.div
              key={item.id}
              layoutId={item.id}
              onClick={() => setSelectedItem(item)}
              className={`p-4 bg-slate-900 rounded-lg border border-slate-700 cursor-pointer hover:border-blue-500 transition-all ${selectedItem?.id === item.id ? 'ring-2 ring-blue-500' : ''}`}
            >
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-bold text-white">{item.name}</h3>
                <span className="text-xs font-bold px-2 py-0.5 bg-slate-800 rounded uppercase tracking-wider">
                  x{item.quantity}
                </span>
              </div>
              <p className={`text-xs font-bold uppercase ${getRarityColor(item.rarity)}`}>{item.rarity}</p>
              <p className="text-xs text-slate-500 mt-1">{item.type}</p>
            </motion.div>
          ))
        )}
      </div>

      <AnimatePresence>
        {selectedItem && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="mt-8 p-6 bg-slate-900 rounded-xl border border-blue-500/30 shadow-inner"
          >
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-xl font-bold text-white">{selectedItem.name}</h3>
                <p className={`text-sm font-bold uppercase ${getRarityColor(selectedItem.rarity)}`}>{selectedItem.rarity} {selectedItem.type}</p>
              </div>
              <button onClick={() => setSelectedItem(null)} className="text-slate-500 hover:text-white">✕</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-slate-400 text-sm">
                  <Info size={16} />
                  <span>Mined on: {new Date(selectedItem.minedAt?.seconds * 1000).toLocaleDateString()}</span>
                </div>
                <div className="p-3 bg-slate-800 rounded text-slate-300 text-sm">
                  This is a {selectedItem.rarity} {selectedItem.type} asset. You can trade it with other users or keep it in your collection.
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-400 uppercase flex items-center gap-2">
                  <Send size={14} /> Trade Asset
                </h4>
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    placeholder="Recipient User ID..."
                    value={recipientId}
                    onChange={(e) => setRecipientId(e.target.value)}
                    className="bg-slate-800 p-2 rounded text-white text-sm border border-slate-700 outline-none focus:border-blue-500"
                  />
                  <div className="flex gap-2 items-center">
                    <input
                      type="number"
                      min="1"
                      max={selectedItem.quantity}
                      value={tradeQuantity}
                      onChange={(e) => setTradeQuantity(parseInt(e.target.value))}
                      className="bg-slate-800 p-2 rounded text-white text-sm border border-slate-700 outline-none focus:border-blue-500 w-20"
                    />
                    <button
                      onClick={handleTrade}
                      disabled={trading || !recipientId}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded font-bold text-sm disabled:opacity-50 transition-all"
                    >
                      {trading ? 'Trading...' : 'Send Trade'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Inventory;
