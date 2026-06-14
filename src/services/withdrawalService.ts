import { db } from '../firebase';
import { 
  collection, 
  doc, 
  runTransaction, 
  serverTimestamp,
  query,
  where,
  orderBy,
  getDocs,
  addDoc
} from 'firebase/firestore';

export interface WithdrawalRequest {
  id?: string;
  userId: string;
  amount: number; // points
  currencyAmount: number; // real money
  currency: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: any;
  processedAt?: any;
}

const POINT_TO_CURRENCY_RATE = 1.0; // 1 point = 1 USD

export const requestWithdrawal = async (
  userId: string, 
  amount: number, 
  bankDetails: { bankName: string; accountNumber: string; accountName: string }
) => {
  const userRef = doc(db, 'users', userId);

  return await runTransaction(db, async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) throw new Error("User not found");

    const currentPoints = userDoc.data().points || 0;
    if (currentPoints < amount) throw new Error("Insufficient points for withdrawal");
    if (amount < 50) throw new Error("Minimum withdrawal is 50 points");

    const currencyAmount = amount * POINT_TO_CURRENCY_RATE;

    // Deduct points
    transaction.update(userRef, { 
      points: currentPoints - amount 
    });

    // Create withdrawal request
    const withdrawalRef = collection(db, 'withdrawalRequests');
    const newRequest: Omit<WithdrawalRequest, 'id'> = {
      userId,
      amount,
      currencyAmount,
      currency: 'USD',
      ...bankDetails,
      status: 'pending',
      createdAt: serverTimestamp()
    };

    const docRef = await addDoc(withdrawalRef, newRequest);

    // Mock "Instant" processing for demo
    // In a real app, this would trigger a backend function or external API
    setTimeout(async () => {
      try {
        await updateDoc(doc(db, 'withdrawalRequests', docRef.id), {
          status: 'completed',
          processedAt: serverTimestamp()
        });
      } catch (e) {
        console.error("Mock processing failed", e);
      }
    }, 5000);

    return docRef.id;
  });
};

export const getWithdrawalHistory = async (userId: string): Promise<WithdrawalRequest[]> => {
  const q = query(
    collection(db, 'withdrawalRequests'),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc')
  );
  
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  } as WithdrawalRequest));
};

// Helper to update doc outside transaction for the mock
import { updateDoc } from 'firebase/firestore';
