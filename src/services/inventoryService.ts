import { db } from '../firebase';
import { 
  collection, 
  doc, 
  getDocs, 
  increment, 
  runTransaction, 
  serverTimestamp,
  query,
  orderBy
} from 'firebase/firestore';

export interface InventoryItem {
  id?: string;
  name: string;
  type: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  quantity: number;
  minedAt: any;
  metadata?: any;
}

export const getUserInventory = async (userId: string): Promise<InventoryItem[]> => {
  const inventoryRef = collection(db, 'inventories', userId, 'items');
  const q = query(inventoryRef, orderBy('minedAt', 'desc'));
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
};

export const mineAsset = async (userId: string) => {
  const assets = [
    { name: 'Iron Ore', type: 'ore', rarity: 'common' },
    { name: 'Gold Nugget', type: 'ore', rarity: 'rare' },
    { name: 'Emerald', type: 'gem', rarity: 'epic' },
    { name: 'Star Diamond', type: 'gem', rarity: 'legendary' },
    { name: 'Copper Wire', type: 'material', rarity: 'common' },
  ];

  const randomAsset = assets[Math.floor(Math.random() * assets.length)];
  const itemId = randomAsset.name.toLowerCase().replace(/\s+/g, '_');
  const itemRef = doc(db, 'inventories', userId, 'items', itemId);

  await runTransaction(db, async (transaction) => {
    const itemDoc = await transaction.get(itemRef);
    if (itemDoc.exists()) {
      transaction.update(itemRef, { 
        quantity: increment(1),
        lastMinedAt: serverTimestamp()
      });
    } else {
      transaction.set(itemRef, {
        ...randomAsset,
        quantity: 1,
        minedAt: serverTimestamp(),
        lastMinedAt: serverTimestamp()
      });
    }
  });

  return randomAsset;
};

export const tradeAsset = async (fromUserId: string, toUserId: string, itemId: string, quantity: number) => {
  const fromItemRef = doc(db, 'inventories', fromUserId, 'items', itemId);
  const toItemRef = doc(db, 'inventories', toUserId, 'items', itemId);

  await runTransaction(db, async (transaction) => {
    const fromDoc = await transaction.get(fromItemRef);
    if (!fromDoc.exists() || fromDoc.data().quantity < quantity) {
      throw new Error("Insufficient quantity to trade");
    }

    const itemData = fromDoc.data();
    const toDoc = await transaction.get(toItemRef);

    // Update sender
    if (itemData.quantity === quantity) {
      transaction.delete(fromItemRef);
    } else {
      transaction.update(fromItemRef, { quantity: increment(-quantity) });
    }

    // Update receiver
    if (toDoc.exists()) {
      transaction.update(toItemRef, { quantity: increment(quantity) });
    } else {
      transaction.set(toItemRef, {
        ...itemData,
        quantity: quantity,
        minedAt: serverTimestamp()
      });
    }
  });
};
