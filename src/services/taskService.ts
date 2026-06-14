import { auth, db } from '../firebase';
import { 
  collection, 
  doc, 
  increment, 
  serverTimestamp,
  query,
  where,
  getDocs,
  runTransaction
} from 'firebase/firestore';

export interface Task {
  id: string;
  title: string;
  description: string;
  reward: number; // Reward in FISH/Coins
  type: 'daily_login' | 'stream_duration' | 'send_gifts' | 'follow_users' | 'facebook_share' | 'youtube_watch' | 'telegram_join' | 'twitter_follow' | 'instagram_follow' | 'website_visit' | 'youtube_sub' | 'app_install' | 'watched_ad';
  goal: number;
  category: 'Social' | 'Technical' | 'Creator' | 'Ads';
  url?: string;
  isTimeSensitive?: boolean;
  durationMinutes?: number;
}

export interface UserTaskProgress {
  taskId: string;
  userId: string;
  currentProgress: number;
  completed: boolean;
  claimed: boolean;
  lastUpdated: any;
}

export const TASKS: Task[] = [
  {
    id: 'daily_login',
    title: 'Daily Check-in',
    description: 'Claim your daily check-in rewards and streak multipliers!',
    reward: 5000,
    type: 'daily_login',
    goal: 1,
    category: 'Technical'
  },
  {
    id: 'fb_share_oroo',
    title: 'Share on Facebook',
    description: 'Share our official presentation campaign post on Facebook!',
    reward: 20000,
    type: 'facebook_share',
    goal: 1,
    category: 'Social',
    url: 'https://www.facebook.com/share/1CVdjT729i/'
  },
  {
    id: 'yt_watch_oroo_video',
    title: 'Watch YouTube Video Guide',
    description: 'Watch the featured presentation update on Youtube to learn how to optimize your mining!',
    reward: 25000,
    type: 'youtube_watch',
    goal: 1,
    category: 'Creator',
    url: 'https://youtu.be/lY4cEEiVBYA?si=dcPA07CWR2K4fuCF',
    isTimeSensitive: true,
    durationMinutes: 125
  },
  {
    id: 'tg_join_oroo_meme',
    title: 'Join Oroo Meme on Telegram',
    description: 'Subscribe to the official Oroo Meme channel on Telegram for priority drops!',
    reward: 18000,
    type: 'telegram_join',
    goal: 1,
    category: 'Social',
    url: 'https://t.me/oroo_meme',
    isTimeSensitive: true,
    durationMinutes: 45
  },
  {
    id: 'tg_join_barca',
    title: 'Join Barca Clone Community',
    description: 'Join our official Telegram Announcements channel for instant updates and claims!',
    reward: 15000,
    type: 'telegram_join',
    goal: 1,
    category: 'Social',
    url: 'https://t.me/barca_clone_io'
  },
  {
    id: 'tg_group_chat',
    title: 'Join Telegram Chat Group',
    description: 'Connect with thousands of fish miners and traders in our group chat!',
    reward: 12000,
    type: 'telegram_join',
    goal: 1,
    category: 'Social',
    url: 'https://t.me/barca_clone_chat'
  },
  {
    id: 'twitter_follow_barca',
    title: 'Follow Barca Clone on X',
    description: 'Follow our official X (Twitter) handle to stay ahead of the game!',
    reward: 10000,
    type: 'twitter_follow',
    goal: 1,
    category: 'Social',
    url: 'https://x.com/barca_clone'
  },
  {
    id: 'instagram_follow_barca',
    title: 'Like our Instagram Post',
    description: 'Check out and like our latest featured updates and match alerts on Instagram!',
    reward: 8000,
    type: 'instagram_follow',
    goal: 1,
    category: 'Social',
    url: 'https://www.instagram.com/p/DPbn1IHDPfW/?utm_source=ig_web_copy_link'
  },
  {
    id: 'visit_partner_web',
    title: 'Explore Partner Marketplace',
    description: 'Visit our principal partner web platform to explore upcoming offers.',
    reward: 7000,
    type: 'website_visit',
    goal: 1,
    category: 'Technical',
    url: 'https://barcapartner-marketplace.io',
    isTimeSensitive: true,
    durationMinutes: 90
  },
  {
    id: 'yt_sub_channel',
    title: 'Subscribe to YT Official',
    description: 'Subscribe to our official YouTube channel for special gift codes and guides!',
    reward: 11000,
    type: 'youtube_sub',
    goal: 1,
    category: 'Creator',
    url: 'https://youtube.com/c/barca_clone_official'
  },
  {
    id: 'install_sponsor_app',
    title: 'Download and Install Game',
    description: 'Install our featured sponsor Web3 app to claim massive initial rewards!',
    reward: 25000,
    type: 'app_install',
    goal: 1,
    category: 'Technical',
    url: 'https://play.google.com/store/apps/details?id=com.barcasponsor.game'
  },
  {
    id: 'watch_daily_ad',
    title: 'Watch Ad & Earn FISH',
    description: 'Watch a highly-rewarding sponsor ad break (Credits via AdsGram/Monetag)',
    reward: 1000,
    type: 'watched_ad',
    goal: 1,
    category: 'Ads',
    isTimeSensitive: true,
    durationMinutes: 240
  },
  {
    id: 'stream_10m',
    title: 'Streamer Apprentice',
    description: 'Stream for at least 10 minutes',
    reward: 15000,
    type: 'stream_duration',
    goal: 600, // 600 seconds = 10 minutes
    category: 'Creator'
  },
  {
    id: 'send_5_gifts',
    title: 'Generous Giver',
    description: 'Send 5 gifts to your favorite streamers',
    reward: 5000,
    type: 'send_gifts',
    goal: 5,
    category: 'Social'
  },
  {
    id: 'follow_3_users',
    title: 'Social Butterfly',
    description: 'Follow 3 new users',
    reward: 2000,
    type: 'follow_users',
    goal: 3,
    category: 'Social'
  }
];

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

export const updateTaskProgress = async (userId: string, type: Task['type'], incrementBy: number) => {
  const tasksOfType = TASKS.filter(t => t.type === type);
  
  for (const task of tasksOfType) {
    const progressRef = doc(db, 'userTasks', `${userId}_${task.id}`);
    
    try {
      await runTransaction(db, async (transaction) => {
        const progressDoc = await transaction.get(progressRef);
        
        if (!progressDoc.exists()) {
          transaction.set(progressRef, {
            taskId: task.id,
            userId,
            currentProgress: incrementBy,
            completed: incrementBy >= task.goal,
            claimed: false,
            lastUpdated: serverTimestamp()
          });
        } else {
          const data = progressDoc.data() as UserTaskProgress;
          if (data.completed) return;

          const newProgress = data.currentProgress + incrementBy;
          const isCompleted = newProgress >= task.goal;
          
          transaction.update(progressRef, {
            currentProgress: newProgress,
            completed: isCompleted,
            lastUpdated: serverTimestamp()
          });
        }
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `userTasks/${userId}_${task.id}`);
    }
  }
};

export const getUserTasksProgress = async (userId: string): Promise<UserTaskProgress[]> => {
  const path = 'userTasks';
  try {
    const q = query(collection(db, path), where('userId', '==', userId));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => doc.data() as UserTaskProgress);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
};

export const claimTaskReward = async (userId: string, taskId: string) => {
  const progressRef = doc(db, 'userTasks', `${userId}_${taskId}`);
  const userRef = doc(db, 'users', userId);
  const task = TASKS.find(t => t.id === taskId);

  if (!task) throw new Error("Task not found");

  try {
    return await runTransaction(db, async (transaction) => {
      const progressDoc = await transaction.get(progressRef);
      if (!progressDoc.exists()) throw new Error("No progress found for this task");

      const data = progressDoc.data() as UserTaskProgress;
      if (!data.completed) throw new Error("Task not completed yet");
      if (data.claimed) throw new Error("Reward already claimed");

      transaction.update(progressRef, { claimed: true });
      transaction.update(userRef, { coins: increment(task.reward) });
      
      return task.reward;
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `userTasks/${userId}_${taskId}`);
  }
};
