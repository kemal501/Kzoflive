import { doc, getDoc, setDoc, updateDoc, increment, query, where, getDocs, collection, deleteDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { updateTaskProgress } from './taskService';

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

export interface User {
  userId: string;
  userName: string;
  email: string;
  role: 'admin' | 'moderator' | 'host' | 'agent' | 'user';
  coins: number;
  points?: number; // Used for USD equivalent earnings (1 point = $1)
  agencyCode?: string;
  hostStatus?: 'none' | 'pending' | 'approved' | 'rejected';
  rewardPoints: number;
  totalStreamingDuration: number; // in seconds
  referralCode?: string;
  referredBy?: string;
  createdAt?: string;
  dailyRewardDays?: number;
  lastRewardDate?: string;
  followersCount?: number;
  followingCount?: number;
  gifterLevel?: number;
  totalSpent?: number;
  photoURL?: string;
  
  // Telegram Mini App additions for Barca Clone / FishVerse
  telegramId?: string;
  firstName?: string;
  isBanned?: boolean;
  fishBalance?: number;
  usdtBalance?: number;
  deviceFingerprint?: string;

  // Visual referral performance breakdown metrics
  referralClicks?: number;
  referralSignups?: number;
}

export const createUserProfile = async (user: User, referralCode?: string) => {
  const userRef = doc(db, 'users', user.userId);
  try {
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      const newUser = {
        ...user,
        createdAt: new Date().toISOString(),
        dailyRewardDays: 0,
        lastRewardDate: '',
        followersCount: 0,
        followingCount: 0,
        gifterLevel: 0,
        totalSpent: 0,
      };
      await setDoc(userRef, newUser);
      if (referralCode) {
        await processReferral(referralCode, user.userId);
      }
      // Daily Login Task
      await updateTaskProgress(user.userId, 'daily_login', 1);
    } else {
      // Check if it's a new day for daily login task
      const userData = userSnap.data() as User;
      const lastLogin = userData.lastRewardDate || '';
      const today = new Date().toISOString().split('T')[0];
      if (lastLogin !== today) {
        await updateTaskProgress(user.userId, 'daily_login', 1);
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${user.userId}`);
  }
};

export const getUserProfile = async (userId: string): Promise<User | null> => {
  const userRef = doc(db, 'users', userId);
  try {
    const userSnap = await getDoc(userRef);
    return userSnap.exists() ? (userSnap.data() as User) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${userId}`);
    return null;
  }
};

export const updateCoins = async (userId: string, amount: number) => {
  const userRef = doc(db, 'users', userId);
  try {
    await updateDoc(userRef, {
      coins: increment(amount),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${userId}`);
  }
};

export const updateHostStreamingDuration = async (userId: string, duration: number) => {
  const userRef = doc(db, 'users', userId);
  try {
    await updateDoc(userRef, {
      totalStreamingDuration: increment(duration),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${userId}`);
  }
};

export const awardAgentReferralReward = async (agentId: string, amount: number) => {
  const userRef = doc(db, 'users', agentId);
  try {
    await updateDoc(userRef, {
      coins: increment(amount),
      rewardPoints: increment(amount),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${agentId}`);
  }
};

export const processReferral = async (agentReferralCode: string, newHostId: string) => {
  const usersRef = collection(db, 'users');
  try {
    const q = query(usersRef, where('referralCode', '==', agentReferralCode));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      const agentDoc = querySnapshot.docs[0];
      const agentId = agentDoc.id;

      // Update agent rewards
      await updateDoc(doc(db, 'users', agentId), {
        rewardPoints: increment(1000), // Reward for referral
        coins: increment(1000),
        referralSignups: increment(1),
      });

      // Update new host referredBy
      await updateDoc(doc(db, 'users', newHostId), {
        referredBy: agentId,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'users');
  }
};

export const trackReferralClick = async (agentReferralCode: string) => {
  if (!agentReferralCode) return;
  
  // Prevent duplicate counts in the same session
  const sessionKey = `ref_click_${agentReferralCode}`;
  if (sessionStorage.getItem(sessionKey)) {
    return;
  }
  sessionStorage.setItem(sessionKey, 'true');

  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('referralCode', '==', agentReferralCode.toUpperCase()));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      const agentDoc = querySnapshot.docs[0];
      const agentId = agentDoc.id;
      await updateDoc(doc(db, 'users', agentId), {
        referralClicks: increment(1)
      });
      console.log(`[REFERRAL TRACKER] Successfully registered referral click for ${agentReferralCode}`);
    }
  } catch (error) {
    console.warn('Error tracking referral click:', error);
  }
};

export const getReferredUsers = async (agentId: string): Promise<User[]> => {
  const usersRef = collection(db, 'users');
  try {
    const q = query(usersRef, where('referredBy', '==', agentId));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => doc.data() as User);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'users');
    return [];
  }
};

export const processDailyReward = async (userId: string) => {
  const userRef = doc(db, 'users', userId);
  try {
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      const userData = userSnap.data() as User;
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      
      const dailyRewardDays = userData.dailyRewardDays || 0;
      const lastRewardDate = userData.lastRewardDate || '';
      
      // Check if user is eligible for the 7-day new user reward
      if (dailyRewardDays < 7 && lastRewardDate !== today) {
        await updateDoc(userRef, {
          coins: increment(15000),
          dailyRewardDays: increment(1),
          lastRewardDate: today
        });
        return true; // Reward granted
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${userId}`);
  }
  return false;
};

export const followUser = async (followerId: string, followingId: string) => {
  const followId = `${followerId}_${followingId}`;
  const followRef = doc(db, 'follows', followId);
  
  try {
    const followSnap = await getDoc(followRef);
    if (!followSnap.exists()) {
      await setDoc(followRef, {
        followerId,
        followingId,
        createdAt: new Date().toISOString()
      });
      
      await updateDoc(doc(db, 'users', followerId), {
        followingCount: increment(1)
      });
      
      await updateDoc(doc(db, 'users', followingId), {
        followersCount: increment(1)
      });

      // Task: Follow Users
      await updateTaskProgress(followerId, 'follow_users', 1);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `follows/${followId}`);
  }
};

export const unfollowUser = async (followerId: string, followingId: string) => {
  const followId = `${followerId}_${followingId}`;
  const followRef = doc(db, 'follows', followId);
  
  try {
    const followSnap = await getDoc(followRef);
    if (followSnap.exists()) {
      await deleteDoc(followRef);
      
      await updateDoc(doc(db, 'users', followerId), {
        followingCount: increment(-1)
      });
      
      await updateDoc(doc(db, 'users', followingId), {
        followersCount: increment(-1)
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `follows/${followId}`);
  }
};

export const checkIsFollowing = async (followerId: string, followingId: string): Promise<boolean> => {
  const followId = `${followerId}_${followingId}`;
  const followRef = doc(db, 'follows', followId);
  try {
    const followSnap = await getDoc(followRef);
    return followSnap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `follows/${followId}`);
    return false;
  }
};

export const getFollowingList = async (followerId: string): Promise<string[]> => {
  const followsRef = collection(db, 'follows');
  try {
    const q = query(followsRef, where('followerId', '==', followerId));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => doc.data().followingId);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'follows');
    return [];
  }
};

export const upgradeToAgent = async (userId: string) => {
  const userRef = doc(db, 'users', userId);
  try {
    await updateDoc(userRef, {
      role: 'agent'
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${userId}`);
  }
};
