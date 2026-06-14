import React, { useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { User } from '../services/userService';

const EarningsPage: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let unsubscribeDoc: () => void;
    
    const unsubscribeAuth = auth.onAuthStateChanged((firebaseUser) => {
      if (firebaseUser) {
        unsubscribeDoc = onSnapshot(doc(db, 'users', firebaseUser.uid), (docSnap) => {
          if (docSnap.exists()) {
            setUser(docSnap.data() as User);
          }
        }, (error) => {
          if (error.code !== 'permission-denied') {
            console.error("Error in earnings user profile snapshot:", error);
          }
        });
      } else {
        setUser(null);
        if (unsubscribeDoc) unsubscribeDoc();
      }
    });
    
    return () => {
      unsubscribeAuth();
      if (unsubscribeDoc) unsubscribeDoc();
    };
  }, []);

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4">
        <h1 className="text-3xl font-bold mb-4">Earnings</h1>
        <p className="text-slate-400">Please sign in to view your earnings.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center p-8">
      <h1 className="text-3xl font-bold mb-8">Your Earnings Dashboard</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 w-full max-w-6xl">
        <div className="bg-slate-800 p-6 rounded-lg shadow-xl border border-yellow-500/20">
          <h2 className="text-2xl font-bold mb-4 flex items-center gap-2"><span className="text-yellow-400">🪙</span> Coins Balance</h2>
          <div className="flex items-center gap-4">
            <span className="text-4xl text-yellow-400 font-bold">{user.coins || 0}</span>
          </div>
          <p className="text-slate-400 mt-2 text-sm italic">
            Used for gifting and virtual items.
          </p>
        </div>

        <div className="bg-slate-800 p-6 rounded-lg shadow-xl border border-green-500/20">
          <h2 className="text-2xl font-bold mb-4 flex items-center gap-2"><span className="text-green-400">💵</span> Earnings (Points)</h2>
          <div className="flex items-center gap-4">
            <span className="text-4xl text-green-400 font-bold">{user.points || 0}</span>
            <span className="text-xl text-slate-300">pts</span>
          </div>
          <p className="text-slate-400 mt-2 text-sm italic">
            Equivalent to ${(user.points || 0).toFixed(2)} USD
          </p>
        </div>

        <div className="bg-slate-800 p-6 rounded-lg shadow-xl border border-blue-500/20">
          <h2 className="text-2xl font-bold mb-4 flex items-center gap-2"><span className="text-blue-400">📊</span> Streaming Stats</h2>
          <p className="text-lg">Total Duration: <span className="font-bold text-blue-400">{Math.floor((user.totalStreamingDuration || 0) / 3600)}h {Math.floor(((user.totalStreamingDuration || 0) % 3600) / 60)}m</span></p>
          <p className="text-lg mt-2">Followers: <span className="font-bold text-blue-400">{user.followersCount || 0}</span></p>
        </div>
      </div>

      <div className="w-full max-w-6xl mt-8">
        <div className="bg-slate-800 p-6 rounded-lg shadow-xl mb-8 flex flex-col items-center">
          <h2 className="text-2xl font-bold mb-4">Cash Out Earnings</h2>
          <p className="text-slate-400 mb-6 text-center max-w-md">
            Ready to withdraw your points? You can easily convert your points to USD and select your preferred withdrawal method securely in our withdrawal hub.
          </p>
          <a
            href="/withdraw"
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-full transition-shadow shadow-lg shadow-blue-500/20"
          >
            Go to Withdrawal Hub
          </a>
        </div>
      </div>
    </div>
  );
};

export default EarningsPage;
