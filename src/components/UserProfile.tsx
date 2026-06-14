import React, { useState, useEffect } from 'react';
import { signInWithPopup, signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, googleProvider, db } from '../firebase';
import { createUserProfile, getUserProfile, User, getReferredUsers, getFollowingList } from '../services/userService';

const UserProfile: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [referredUsers, setReferredUsers] = useState<User[]>([]);
  const [followingUsers, setFollowingUsers] = useState<User[]>([]);

  useEffect(() => {
    let unsubscribeDoc: () => void;
    
    const unsubscribeAuth = auth.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        let profile = await getUserProfile(firebaseUser.uid);
        if (!profile) {
          const urlParams = new URLSearchParams(window.location.search);
          const refCode = urlParams.get('ref') || undefined;
          profile = {
            userId: firebaseUser.uid,
            userName: firebaseUser.displayName || 'Anonymous',
            email: firebaseUser.email || '',
            role: 'user',
            coins: 0,
            rewardPoints: 0,
            totalStreamingDuration: 0,
          };
          await createUserProfile(profile, refCode);
        }
        
        // Listen for real-time updates to the user document
        unsubscribeDoc = onSnapshot(doc(db, 'users', firebaseUser.uid), async (docSnap) => {
          if (docSnap.exists()) {
            const updatedProfile = docSnap.data() as User;
            setUser(updatedProfile);
            
            if (updatedProfile.role === 'agent') {
              const referred = await getReferredUsers(updatedProfile.userId);
              setReferredUsers(referred);
            }

            // Fetch following list details
            const followingIds = await getFollowingList(updatedProfile.userId);
            const followingProfiles = await Promise.all(
              followingIds.map(id => getUserProfile(id))
            );
            setFollowingUsers(followingProfiles.filter(p => p !== null) as User[]);
          }
        }, (error) => {
          if (error.code !== 'permission-denied') {
            console.error("Error in user profile snapshot:", error);
          }
        });
      } else {
        setUser(null);
        setReferredUsers([]);
        setFollowingUsers([]);
        if (unsubscribeDoc) unsubscribeDoc();
      }
    });
    
    return () => {
      unsubscribeAuth();
      if (unsubscribeDoc) unsubscribeDoc();
    };
  }, []);

  const signIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      if (error && error.code === 'auth/popup-closed-by-user') {
        console.log("User profile sign-in popup closed by user.");
      } else {
        console.error("User profile sign-in error:", error);
      }
    }
  };
  const logOut = () => signOut(auth);

  const copyReferralCode = () => {
    if (user?.referralCode) {
      navigator.clipboard.writeText(user.referralCode);
      alert('Referral code copied to clipboard!');
    }
  };

  return (
    <div className="bg-slate-800 p-4 rounded-lg shadow-xl w-full max-w-md mt-8 text-white">
      {user ? (
        <>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-xl font-bold">Welcome, {user.userName}</h2>
            {user.role === 'admin' && <span className="bg-red-600 text-white text-xs px-2 py-1 rounded-full font-bold uppercase tracking-wider">Admin</span>}
            {user.role === 'moderator' && <span className="bg-purple-600 text-white text-xs px-2 py-1 rounded-full font-bold uppercase tracking-wider">Moderator</span>}
            {user.role === 'agent' && <span className="bg-green-600 text-white text-xs px-2 py-1 rounded-full font-bold uppercase tracking-wider">Agent</span>}
            {user.role === 'host' && <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded-full font-bold uppercase tracking-wider">Host</span>}
          </div>
          <div className="flex items-center gap-4 mb-2">
            <p className="font-semibold">Coins: <span className="text-yellow-400">{user.coins}</span></p>
            {(user.role === 'host' || user.role === 'agent') && (
              <p className="font-semibold">Points: <span className="text-green-400">{user.points || 0}</span></p>
            )}
            <p className="font-semibold">Followers: <span className="text-blue-400">{user.followersCount || 0}</span></p>
            <p className="font-semibold">Following: <span className="text-blue-400">{user.followingCount || 0}</span></p>
          </div>
          {(user.dailyRewardDays ?? 0) < 7 && (
            <p className="text-green-400 text-sm mt-1">
              🎁 New User Bonus: Stream daily to earn 15,000 coins! (Day {user.dailyRewardDays || 0}/7)
            </p>
          )}
          {user.referralCode && (
            <div className="mt-2 flex items-center gap-2">
              <p>Referral Code: <span className="font-mono bg-slate-700 px-2 py-1 rounded">{user.referralCode}</span></p>
              <button onClick={copyReferralCode} className="bg-blue-500 px-2 py-1 rounded text-sm">Copy</button>
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <button onClick={logOut} className="bg-red-600 px-4 py-2 rounded">Logout</button>
          </div>
          
          <div className="mt-6">
            <h3 className="text-lg font-bold">Following</h3>
            {followingUsers.length > 0 ? (
              <ul className="list-disc pl-5 mt-2">
                {followingUsers.map(u => (
                  <li key={u.userId} className="text-slate-300">
                    <span className="font-semibold text-white">{u.userName}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-slate-400 text-sm mt-1">Not following anyone yet.</p>}
          </div>

          {user.role === 'agent' && (
            <div className="mt-6">
              <h3 className="text-lg font-bold">Referred Users</h3>
              {referredUsers.length > 0 ? (
                <ul className="list-disc pl-5">
                  {referredUsers.map(u => <li key={u.userId}>{u.userName} ({u.email})</li>)}
                </ul>
              ) : <p>No users referred yet.</p>}
            </div>
          )}
        </>
      ) : (
        <div className="text-center">
          <h2 className="text-xl font-bold mb-4">Join the Community</h2>
          <p className="mb-4 text-slate-300">Create an account or log in to start streaming and earning rewards!</p>
          <button onClick={signIn} className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded font-bold w-full">
            Sign In / Create Account with Google
          </button>
        </div>
      )}
    </div>
  );
};

export default UserProfile;
