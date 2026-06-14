import React, { useState } from 'react';
import { collection, addDoc, doc, updateDoc, increment } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { User } from '../services/userService';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface Props {
  user: User;
}

const WithdrawalForm: React.FC<Props> = ({ user }) => {
  const [amount, setAmount] = useState<number>(5000);
  const [method, setMethod] = useState<string>('Bank Transfer');
  const [details, setDetails] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (amount < 5000) {
      setError('Minimum withdrawal is 5,000 coins (50 USD).');
      return;
    }

    if (user.coins < amount) {
      setError('Insufficient coins.');
      return;
    }

    if (!auth.currentUser) {
      setError('You must be logged in.');
      return;
    }

    if (!details.trim()) {
      setError(`Please provide your ${method} details.`);
      return;
    }

    setIsProcessing(true);

    try {
      // Deduct coins first
      const userRef = doc(db, 'users', auth.currentUser.uid);
      try {
        await updateDoc(userRef, {
          coins: increment(-amount)
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${auth.currentUser.uid}`);
      }

      // Then create the withdrawal request
      const path = 'withdrawalRequests';
      try {
        await addDoc(collection(db, path), {
          userId: auth.currentUser.uid,
          amount,
          method,
          details,
          status: 'completed', // Auto-complete for prototype
          processedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, path);
      }
      setSuccess('Withdrawal request submitted successfully.');
      setAmount(5000);
      setDetails('');
    } catch (err) {
      console.error(err);
      setError('Failed to submit request.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-slate-800 p-4 rounded-lg shadow-xl w-full max-w-md mt-8 text-white">
      <h2 className="text-xl font-bold mb-4">Request Withdrawal</h2>
      {error && <p className="text-red-500 mb-2">{error}</p>}
      {success && <p className="text-green-500 mb-2">{success}</p>}
      <label className="block mb-2">Amount (min 5,000):</label>
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value))}
        className="w-full p-2 mb-4 bg-slate-700 rounded text-white"
        min={5000}
        disabled={isProcessing}
      />
      <label className="block mb-2">Method:</label>
      <select
        value={method}
        onChange={(e) => setMethod(e.target.value)}
        className="w-full p-2 mb-4 bg-slate-700 rounded text-white"
        disabled={isProcessing}
      >
        <option value="Bank Transfer">Bank Transfer</option>
        <option value="PayPal">PayPal</option>
        <option value="Crypto">Crypto</option>
      </select>

      <label className="block mb-2">
        {method === 'Bank Transfer' ? 'Bank Details (Name, Account, Bank):' : 
         method === 'PayPal' ? 'PayPal Email:' : 
         'Wallet Address (USDT/TRC20):'}
      </label>
      <textarea
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        className="w-full p-2 mb-4 bg-slate-700 rounded text-white h-20"
        placeholder={method === 'Bank Transfer' ? 'John Doe, 12345678, Chase Bank' : 
                     method === 'PayPal' ? 'example@email.com' : 
                     'T...' }
        disabled={isProcessing}
      />

      <button type="submit" disabled={isProcessing} className="w-full bg-blue-600 p-2 rounded font-bold disabled:opacity-50">
        {isProcessing ? 'Processing...' : 'Submit Request'}
      </button>
    </form>
  );
};

export default WithdrawalForm;
