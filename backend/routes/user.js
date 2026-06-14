import express from 'express';
import admin from 'firebase-admin';
import jwt from 'jsonwebtoken';
import verifyTelegram from '../middleware/verifyTelegram.js';
import verifyJWT from '../middleware/verifyJWT.js';

const router = express.Router();

// Helper to generate a random referral code
function generateReferralCode() {
  return 'OIBB-' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

// 1. Authenticate & Sync User from Telegram Mini-App InitData
router.post('/auth', verifyTelegram, async (req, res) => {
  const tgUser = req.telegramUser;
  if (!tgUser || !tgUser.id) {
    return res.status(400).json({ error: 'Missing Telegram user data' });
  }

  const db = admin.firestore();
  const userId = `tg_${tgUser.id}`;
  const userRef = db.collection('users').doc(userId);

  try {
    let userDoc = await userRef.get();
    
    // Check if there is a referral start query parameter
    const startAppCode = req.body.startapp;

    if (!userDoc.exists) {
      // Newly created user
      const rCode = generateReferralCode();
      const newUserData = {
        telegramId: tgUser.id.toString(),
        username: tgUser.username || `user_${tgUser.id.toString().slice(0, 5)}`,
        firstName: tgUser.first_name || 'Telegram Guest',
        balance: 0,
        totalEarned: 0,
        referralCode: rCode,
        referredBy: '',
        referralCount: 0,
        createdAt: new Date().toISOString()
      };

      // Atomic Setup and Referral Application
      await db.runTransaction(async (transaction) => {
        // If referred by someone
        if (startAppCode && startAppCode.trim()) {
          const referrerQuery = db.collection('users').where('referralCode', '==', startAppCode.trim()).limit(1);
          const referrerSnap = await transaction.get(referrerQuery);
          
          if (!referrerSnap.empty) {
            const referrerDoc = referrerSnap.docs[0];
            const referrerData = referrerDoc.data();
            newUserData.referredBy = referrerDoc.id;

            // Apply immediate rewards (e.g. 500 coins to referrer, 200 to referred)
            const referrerReward = 500;
            const userReward = 200;

            newUserData.balance = userReward;
            newUserData.totalEarned = userReward;

            // Update Referrer
            transaction.update(referrerDoc.ref, {
              balance: (referrerData.balance || 0) + referrerReward,
              totalEarned: (referrerData.totalEarned || 0) + referrerReward,
              referralCount: (referrerData.referralCount || 0) + 1
            });

            // Log Referral Document
            const referralRef = db.collection('referrals').doc();
            transaction.set(referralRef, {
              referrerId: referrerDoc.id,
              referredUserId: userId,
              reward: referrerReward,
              createdAt: new Date().toISOString()
            });

            // Log Transaction for Referrer
            const referrerTxRef = db.collection('transactions').doc();
            transaction.set(referrerTxRef, {
              userId: referrerDoc.id,
              amount: referrerReward,
              type: 'referral_comm',
              createdAt: new Date().toISOString()
            });

            // Log Transaction for self
            const selfTxRef = db.collection('transactions').doc();
            transaction.set(selfTxRef, {
              userId: userId,
              amount: userReward,
              type: 'referral_sign_up',
              createdAt: new Date().toISOString()
            });
          }
        }

        // Set the user record
        transaction.set(userRef, newUserData);
      });

      // Fetch newly created
      userDoc = await userRef.get();
    }

    const userData = userDoc.data();

    // Create a local JWT representing the user's login session
    const token = jwt.sign(
      { 
        id: userId, 
        telegramId: userData.telegramId, 
        username: userData.username,
        role: userId === 'tg_123456789' ? 'admin' : 'user' // auto-grant mock user in dev admin power
      },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: userId, ...userData } });
  } catch (err) {
    console.error('Error in Telegram authentication transaction:', err);
    res.status(500).json({ error: 'Database session registration failed' });
  }
});

// 2. Fetch User Profile Details
router.get('/profile', verifyJWT, async (req, res) => {
  const db = admin.firestore();
  try {
    const userSnap = await db.collection('users').doc(req.user.id).get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: 'User profile not found' });
    }
    res.json(userSnap.data());
  } catch (err) {
    res.status(500).json({ error: 'Database error reading profile' });
  }
});

// Helper to trigger in-app notifications
async function createNotification(userId, title, message, type) {
  try {
    const db = admin.firestore();
    await db.collection('notifications').add({
      userId,
      title,
      message,
      type, // 'reward' | 'withdrawal' | 'referral' | 'announcement'
      read: false,
      createdAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error creating notification:', err);
  }
}

// 3. Claim Daily Check-In Reward
router.post('/checkin', verifyJWT, async (req, res) => {
  const db = admin.firestore();
  const userId = req.user.id;
  const userRef = db.collection('users').doc(userId);

  try {
    await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) {
        throw new Error('User profile does not exist');
      }

      const userData = userSnap.data();
      const lastCheckInStr = userData.lastCheckIn; 
      const now = new Date();

      if (lastCheckInStr) {
        const lastCheckInDate = new Date(lastCheckInStr);
        const hoursPassed = (now - lastCheckInDate) / (1000 * 60 * 60);
        if (hoursPassed < 24) {
          throw new Error('Daily login bonus already claimed within the last 24 hours');
        }
      }

      const reward = 15000; // 15,000 FISH daily bonus as displayed in UI

      // Update User Check-In Time and Balance
      transaction.update(userRef, {
        coins: (userData.coins || 0) + reward,
        balance: (userData.balance || 0) + reward,
        totalEarned: (userData.totalEarned || 0) + reward,
        lastCheckIn: now.toISOString(),
        lastRewardDate: now.toISOString().split('T')[0]
      });

      // Write Transaction Log
      const txRef = db.collection('coinTransactions').doc();
      transaction.set(txRef, {
        userId,
        amount: reward,
        type: 'daily_login',
        description: `Claimed Daily Check-In Bonus (+${reward.toLocaleString()} $FISH)`,
        createdAt: now.toISOString()
      });
    });

    // Send notifications to user
    await createNotification(userId, 'Check-In Bonus Credited! 🪙', 'Successfully claimed daily logging allowance of +15,000 $FISH.', 'reward');

    res.json({ message: 'Daily check-in claimed successfully', rewardAmount: 15000 });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Check-in transaction expired' });
  }
});

// Convert FISH to USDT server-side
router.post('/convert', verifyJWT, async (req, res) => {
  const { amount, fingerprint, clientInfo } = req.body;
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Valid convert FISH amount is required.' });
  }

  const EXCHANGE_RATE = 10000; // 10,000 FISH = $1 USDT
  const db = admin.firestore();
  const userId = req.user.id;
  const userRef = db.collection('users').doc(userId);

  try {
    let successResult = 0;
    await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) {
        throw new Error('User account not found');
      }

      const userData = userSnap.data();
      const currentCoins = userData.coins || 0;

      if (currentCoins < amount) {
        throw new Error('Insufficient $FISH token balance.');
      }

      const awardUsdt = amount / EXCHANGE_RATE;
      successResult = awardUsdt;

      transaction.update(userRef, {
        coins: currentCoins - amount,
        balance: (userData.balance || 0) - amount,
        points: (userData.points || 0) + awardUsdt,
        usdtBalance: (userData.usdtBalance || 0) + awardUsdt
      });

      const txRef = db.collection('coinTransactions').doc();
      transaction.set(txRef, {
        userId,
        amount: -amount,
        type: 'conversion',
        description: `Exchanged ${amount.toLocaleString()} FISH for $${awardUsdt.toFixed(2)} USDT`,
        createdAt: new Date().toISOString()
      });
    });

    // Create Notification
    await createNotification(userId, 'Exchange Successful! 💰', `You swapped ${amount.toLocaleString()} FISH for $${successResult.toFixed(2)} USDT.`, 'reward');

    // Run rapid exchange rate limits or check fingerprint
    if (clientInfo && (clientInfo.isEmulator || clientInfo.headless)) {
      await db.collection('fraud_reports').add({
        userId,
        trigger: clientInfo.isEmulator ? 'emulator_detected_conversion' : 'headless_detected_conversion',
        score: clientInfo.isEmulator ? 40 : 50,
        fingerprint: fingerprint || 'none',
        timestamp: new Date().toISOString()
      });
    }

    res.json({ success: true, message: 'Exchange finished successfully!', awardUsdt: successResult });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Exchanging tokens failed.' });
  }
});

// Ad Completed Video Reward securely
router.post('/ad-reward', verifyJWT, async (req, res) => {
  const { fingerprint, clientInfo } = req.body;
  const db = admin.firestore();
  const userId = req.user.id;
  const userRef = db.collection('users').doc(userId);

  let isAbuse = false;
  try {
    const reward = 5000;

    await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) {
        throw new Error('User profile missing');
      }

      const userData = userSnap.data();
      const lastAdWatchStr = userData.lastAdWatch;
      const now = new Date();

      if (lastAdWatchStr) {
        const lastWatch = new Date(lastAdWatchStr);
        const secPassed = (now - lastWatch) / 1000;
        if (secPassed < 15) { // Minimum 15s between ads to prevent speedrunning
          isAbuse = true;
          throw new Error('Rate-limit notice: Video ads cannot be completed that quickly. Standard video ads are 15s+ duration.');
        }
      }

      // Update balance
      transaction.update(userRef, {
        coins: (userData.coins || 0) + reward,
        balance: (userData.balance || 0) + reward,
        totalEarned: (userData.totalEarned || 0) + reward,
        lastAdWatch: now.toISOString(),
        dailyGoalAdsCompleted: (userData.dailyGoalAdsCompleted || 0) + 1
      });

      // Write ledger log
      const txRef = db.collection('coinTransactions').doc();
      transaction.set(txRef, {
        userId,
        amount: reward,
        type: 'watched_ad',
        description: `Watched sponsored campaign ad (Verified via Secure Server Session)`,
        createdAt: now.toISOString()
      });
    });

    // Create reward notification
    await createNotification(userId, 'Ad Bonus Received! 📺', `Claimed +5k $FISH for viewing premium campaign video clip.`, 'reward');

    res.json({ success: true, message: 'Rewarded successfully!', reward });
  } catch (err) {
    if (isAbuse) {
      // Log ad abuse fraud report
      await db.collection('fraud_reports').add({
        userId,
        trigger: 'ad_watch_speedrunning_abuse',
        score: 30,
        fingerprint: fingerprint || 'unknown',
        details: JSON.stringify({ reason: 'Completed ad watch too quickly (< 15 seconds)' }),
        timestamp: new Date().toISOString()
      });
    }
    res.status(400).json({ error: err.message || 'Ad reward validation failed' });
  }
});

// 4. Submit Withdrawal Request (with fully integrated server-side Fraud Detection)
router.post('/withdraw', verifyJWT, async (req, res) => {
  const { amount, method, address, fingerprint, clientInfo } = req.body;
  
  if (!amount || amount <= 0 || !method || !address) {
    return res.status(400).json({ error: 'Invalid parameters. Amount, Method and Target are required.' });
  }

  const db = admin.firestore();
  const userId = req.user.id;
  const userRef = db.collection('users').doc(userId);

  try {
    // Perform server side Fraud Detection
    let riskScore = 0;
    const triggers = [];

    if (clientInfo) {
      if (clientInfo.isEmulator) {
        riskScore += 40;
        triggers.push('Emulator Detected');
      }
      if (clientInfo.headless) {
        riskScore += 50;
        triggers.push('Headless Browser');
      }
      if (clientInfo.vpnEnabled) {
        riskScore += 20;
        triggers.push('VPN Connection Flag');
      }
    }

    // Capture Duplicate Fingerprints
    if (fingerprint && fingerprint !== 'none') {
      const duplicateUsersSnap = await db.collection('users')
        .where('deviceFingerprint', '==', fingerprint)
        .get();
      
      const distinctUsers = duplicateUsersSnap.docs.filter((d) => d.id !== userId);
      if (distinctUsers.length > 0) {
        riskScore += 35;
        triggers.push(`Duplicate fingerprint (Used by ${distinctUsers.length} other accounts)`);
      }
    }

    // Check balance and execute withdrawal
    await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) {
        throw new Error('User profile missing');
      }

      const userData = userSnap.data();
      const currentPoints = userData.points || 0;

      if (currentPoints < amount) {
        throw new Error('Insufficient USDT points to process withdrawal request');
      }

      // Check if user is already banned
      if (userData.isBanned) {
        throw new Error('Your user account has been frozen due to security violations.');
      }

      // Deduct from Balance
      transaction.update(userRef, {
        points: currentPoints - amount,
        usdtBalance: (userData.usdtBalance || 0) - amount
      });

      // Track fingerprint on user Document
      if (fingerprint) {
        transaction.update(userRef, {
          deviceFingerprint: fingerprint
        });
      }

      // Create withdrawalRequest document (the client React App's exact target)
      const withdrawalRef = db.collection('withdrawalRequests').doc();
      transaction.set(withdrawalRef, {
        userId,
        amount: parseFloat(amount),
        currencyAmount: parseFloat(amount),
        currency: 'USD',
        bankName: method,
        accountNumber: address,
        accountName: userData.firstName || userData.username || 'Standard Client',
        status: 'pending',
        riskScore,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Create negative transaction log
      const txRef = db.collection('coinTransactions').doc();
      transaction.set(txRef, {
        userId,
        amount: -parseFloat(amount),
        type: 'withdrawal_hold',
        description: `Cash CashOut processing of $${amount} USDT to ${method}`,
        createdAt: new Date().toISOString()
      });
    });

    // Write Fraud report if risk is discovered
    if (riskScore > 0) {
      await db.collection('fraud_reports').add({
        userId,
        trigger: triggers.join(', '),
        score: riskScore,
        fingerprint: fingerprint || 'unknown',
        details: JSON.stringify(clientInfo || {}),
        timestamp: new Date().toISOString()
      });

      // Auto bann/freeze accounts with massive fraud score (> 80)
      if (riskScore >= 80) {
        await userRef.update({ isBanned: true });
        await createNotification(userId, 'Account Suspended ⚠️', 'Your account has been audited and frozen due to emulator or duplicate proxy abuse indicators.', 'announcement');
      }
    }

    // Create Notification
    await createNotification(userId, 'Cash Out Received Index 💸', `Your request of $${amount} USDT via ${method} is in review. Risk calculation score: ${riskScore}%.`, 'withdrawal');

    res.json({ message: 'Withdrawal request submitted successfully', riskScore });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Withdrawal submission failed' });
  }
});

// 5. Fetch Account Transactions Log
router.get('/transactions', verifyJWT, async (req, res) => {
  const db = admin.firestore();
  try {
    const snaps = await db.collection('coinTransactions')
      .where('userId', '==', req.user.id)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const txs = snaps.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json(txs);
  } catch (err) {
    res.status(500).json({ error: 'Database error reading transactions history' });
  }
});

export default router;
