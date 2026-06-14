import { collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { updateCoins, getUserProfile, updateHostStreamingDuration, awardAgentReferralReward, processDailyReward } from './userService';

export interface RoomActivity {
  userId: string;
  roomType: 'video' | 'audio';
  startTime: Date;
  endTime: Date;
  duration: number; // in seconds
}

export const logRoomActivity = async (activity: RoomActivity) => {
  await addDoc(collection(db, 'roomActivities'), {
    ...activity,
    startTime: activity.startTime.toISOString(),
    endTime: activity.endTime.toISOString(),
  });

  // Process daily reward for new users
  await processDailyReward(activity.userId);

  // Calculate and award coins for host
  let coinsToAward = 0;
  if (activity.roomType === 'video' && activity.duration >= 7200) {
    coinsToAward = 10000;
  } else if (activity.roomType === 'audio' && activity.duration >= 3600) {
    coinsToAward = 15000;
  }

  if (coinsToAward > 0) {
    await updateCoins(activity.userId, coinsToAward);
  }

  // Handle referral rewards
  const hostProfile = await getUserProfile(activity.userId);
  if (hostProfile && hostProfile.referredBy) {
    const agentId = hostProfile.referredBy;
    const previousDuration = hostProfile.totalStreamingDuration || 0;
    const newDuration = previousDuration + activity.duration;
    
    await updateHostStreamingDuration(activity.userId, activity.duration);

    // Reward agent: $5 (50000 coins) for every 5 hours (18000s)
    const milestone = 18000;
    const previousMilestones = Math.floor(previousDuration / milestone);
    const newMilestones = Math.floor(newDuration / milestone);

    if (newMilestones > previousMilestones) {
      const rewardsToAward = (newMilestones - previousMilestones) * 50000;
      await awardAgentReferralReward(agentId, rewardsToAward);
    }
  }
};
