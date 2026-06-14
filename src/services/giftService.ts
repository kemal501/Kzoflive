import { db } from '../firebase';
import { 
  collection, 
  doc, 
  runTransaction, 
  serverTimestamp 
} from 'firebase/firestore';
import { updateTaskProgress } from './taskService';

export interface Gift {
  senderId: string;
  receiverId: string;
  giftType: string;
  coinValue: number;
  roomId?: string;
  createdAt: any;
}

export const sendGift = async (senderId: string, receiverId: string, giftType: string, coinValue: number, roomId?: string) => {
  const senderRef = doc(db, 'users', senderId);
  const receiverRef = doc(db, 'users', receiverId);

  await runTransaction(db, async (transaction) => {
    const senderDoc = await transaction.get(senderRef);
    const receiverDoc = await transaction.get(receiverRef);

    if (!senderDoc.exists()) throw new Error("Sender not found");
    if (!receiverDoc.exists()) throw new Error("Receiver not found");

    const senderCoins = senderDoc.data().coins || 0;
    if (senderCoins < coinValue) throw new Error("Insufficient coins");

    const receiverCoins = receiverDoc.data().coins || 0;
    const senderTotalSpent = (senderDoc.data().totalSpent || 0) + coinValue;
    
    // Simple level logic: Level 1 at first gift, then every 1000 coins spent
    const newGifterLevel = senderTotalSpent > 0 ? Math.floor(senderTotalSpent / 1000) + 1 : 0;

    // Update balances
    transaction.update(senderRef, { 
      coins: senderCoins - coinValue,
      totalSpent: senderTotalSpent,
      gifterLevel: newGifterLevel
    });
    transaction.update(receiverRef, { coins: receiverCoins + coinValue });

    // Log gift
    const giftRef = doc(collection(db, 'gifts'));
    transaction.set(giftRef, {
      senderId,
      receiverId,
      giftType,
      coinValue,
      roomId: roomId || null,
      createdAt: serverTimestamp()
    });

    // Log transactions
    const senderTransRef = doc(collection(db, 'coinTransactions'));
    transaction.set(senderTransRef, {
      userId: senderId,
      amount: -coinValue,
      type: 'gift',
      createdAt: serverTimestamp()
    });

    const receiverTransRef = doc(collection(db, 'coinTransactions'));
    transaction.set(receiverTransRef, {
      userId: receiverId,
      amount: coinValue,
      type: 'gift',
      createdAt: serverTimestamp()
    });

    // Task: Send Gifts
    // We can't await inside transaction, but we can do it after or use transaction.update if we had a progress doc
  });

  // Task: Send Gifts
  await updateTaskProgress(senderId, 'send_gifts', 1);
};
