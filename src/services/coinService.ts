import { db } from '../firebase';
import { 
  collection, 
  doc, 
  runTransaction, 
  serverTimestamp
} from 'firebase/firestore';

export interface CoinTransaction {
  userId: string;
  amount: number;
  type: 'purchase' | 'transfer' | 'gift' | 'salary';
  sellerId?: string;
  createdAt: any;
}

export const buyCoins = async (userId: string, amount: number, sellerId: string) => {
  const userRef = doc(db, 'users', userId);
  const sellerRef = doc(db, 'users', sellerId);

  await runTransaction(db, async (transaction) => {
    const userDoc = await transaction.get(userRef);
    const sellerDoc = await transaction.get(sellerRef);

    if (!userDoc.exists()) throw new Error("User not found");
    if (!sellerDoc.exists()) throw new Error("Seller not found");

    const sellerData = sellerDoc.data();
    if (sellerData.role !== 'coin_seller' && sellerData.role !== 'admin') {
      throw new Error("Unauthorized seller");
    }

    const currentCoins = userDoc.data().coins || 0;
    transaction.update(userRef, { coins: currentCoins + amount });

    const transactionRef = doc(collection(db, 'coinTransactions'));
    transaction.set(transactionRef, {
      userId,
      amount,
      type: 'purchase',
      sellerId,
      createdAt: serverTimestamp()
    });
  });
};

export const transferCoins = async (fromUserId: string, toUserId: string, amount: number) => {
  const fromRef = doc(db, 'users', fromUserId);
  const toRef = doc(db, 'users', toUserId);

  await runTransaction(db, async (transaction) => {
    const fromDoc = await transaction.get(fromRef);
    const toDoc = await transaction.get(toRef);

    if (!fromDoc.exists()) throw new Error("Sender not found");
    if (!toDoc.exists()) throw new Error("Receiver not found");

    const fromCoins = fromDoc.data().coins || 0;
    if (fromCoins < amount) throw new Error("Insufficient coins");

    const toCoins = toDoc.data().coins || 0;

    transaction.update(fromRef, { coins: fromCoins - amount });
    transaction.update(toRef, { coins: toCoins + amount });

    const transactionRef = doc(collection(db, 'coinTransactions'));
    transaction.set(transactionRef, {
      userId: fromUserId,
      amount: -amount,
      type: 'transfer',
      createdAt: serverTimestamp()
    });

    const receiveRef = doc(collection(db, 'coinTransactions'));
    transaction.set(receiveRef, {
      userId: toUserId,
      amount: amount,
      type: 'transfer',
      createdAt: serverTimestamp()
    });
  });
};
