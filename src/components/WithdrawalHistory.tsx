import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { User } from '../services/userService';
import { CheckCircle, Clock, AlertCircle, RefreshCw } from 'lucide-react';

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

interface WithdrawalRequest {
  id: string;
  amount: number;
  status: string;
  method: string;
  details?: string;
  createdAt: string;
}

interface Props {
  user: User;
}

const WithdrawalHistory: React.FC<Props> = ({ user }) => {
  const [requests, setRequests] = useState<WithdrawalRequest[]>([]);

  const getStatusBadge = (status: string) => {
    const s = (status || '').toLowerCase();
    switch (s) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-black uppercase tracking-wider leading-none">
            <CheckCircle size={10} /> Completed
          </span>
        );
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-[10px] font-black uppercase tracking-wider leading-none animate-pulse">
            <RefreshCw size={10} className="animate-spin" style={{ animationDuration: '3s' }} /> Processing
          </span>
        );
      case 'failed':
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-500 text-[10px] font-black uppercase tracking-wider leading-none">
            <AlertCircle size={10} /> Rejected
          </span>
        );
      case 'pending':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-[10px] font-black uppercase tracking-wider leading-none">
            <Clock size={10} /> Pending
          </span>
        );
    }
  };

  useEffect(() => {
    if (user.role !== 'host' && user.role !== 'agent') return;

    const q = query(
      collection(db, 'withdrawalRequests'),
      where('userId', '==', auth.currentUser?.uid)
    );
    
    const path = 'withdrawalRequests';
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const reqs: WithdrawalRequest[] = [];
      snapshot.forEach((doc) => {
        reqs.push({ id: doc.id, ...doc.data() } as WithdrawalRequest);
      });
      setRequests(reqs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return () => unsubscribe();
  }, [user]);

  if (user.role !== 'host' && user.role !== 'agent') return null;

  return (
    <div className="bg-slate-800 p-4 rounded-lg shadow-xl w-full max-w-md mt-8 text-white">
      <h2 className="text-xl font-bold mb-4">Withdrawal History</h2>
      {requests.length === 0 ? (
        <p>No withdrawal requests found.</p>
      ) : (
        <ul>
          {requests.map((req) => (
            <li key={req.id} className="mb-2 border-b border-slate-700 pb-2">
              <p className="font-bold text-blue-400">{req.method}</p>
              <p>Amount: {req.amount} coins</p>
              {req.details && <p className="text-xs text-slate-400 italic">{req.details}</p>}
              <p className="flex items-center gap-2 mt-1">
                <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Status:</span>
                {getStatusBadge(req.status)}
              </p>
              <p className="text-xs text-slate-500">Date: {new Date(req.createdAt).toLocaleDateString()}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default WithdrawalHistory;
