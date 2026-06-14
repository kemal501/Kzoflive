import admin from 'firebase-admin';
import crypto from 'crypto';

// Helper to generate a random referral code
function generateReferralCode() {
  return 'OIBB-' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

/**
 * Helper to register or sync a Telegram User doc in Firestore database
 */
async function findOrCreateUser(tgUser, referralCode = '') {
  const db = admin.firestore();
  const userId = `tg_${tgUser.id}`;
  const userRef = db.collection('users').doc(userId);

  try {
    let userSnap = await userRef.get();
    if (userSnap.exists) {
      return { user: userSnap.data(), created: false };
    }

    const rCode = generateReferralCode();
    const newUserData = {
      userId: userId,
      userName: tgUser.first_name || tgUser.username || 'Player',
      telegramId: tgUser.id.toString(),
      username: tgUser.username || `user_${tgUser.id.toString().slice(0, 5)}`,
      firstName: tgUser.first_name || 'Telegram Guest',
      coins: 25000, // Matching App.tsx initial login reward
      balance: 25000,
      totalEarned: 25000,
      rewardPoints: 0,
      dailyRewardDays: 0,
      lastRewardDate: '',
      referralCode: rCode,
      referredBy: '',
      referralCount: 0,
      createdAt: new Date().toISOString()
    };

    // Execute atomic transction to support safe referrals matching user.js logic
    await db.runTransaction(async (transaction) => {
      if (referralCode && referralCode.trim()) {
        const uppercaseCode = referralCode.trim().toUpperCase();
        const referrerQuery = db.collection('users').where('referralCode', '==', uppercaseCode).limit(1);
        const referrerSnap = await transaction.get(referrerQuery);
        
        if (!referrerSnap.empty) {
          const referrerDoc = referrerSnap.docs[0];
          const referrerData = referrerDoc.data();
          
          if (referrerDoc.id !== userId) {
            newUserData.referredBy = referrerDoc.id;

            // Apply rewards matching Barca Earn ecosystem
            const referrerRewardCoins = 15000; // 15k FISH referrer bonus matching App.tsx!
            const userRewardCoins = 5000;      // 5k FISH sign-up bonus matching App.tsx!

            newUserData.coins += userRewardCoins;
            newUserData.balance += userRewardCoins;
            newUserData.totalEarned += userRewardCoins;

            // Update Referrer
            transaction.update(referrerDoc.ref, {
              coins: admin.firestore.FieldValue.increment(referrerRewardCoins),
              balance: admin.firestore.FieldValue.increment(referrerRewardCoins),
              totalEarned: admin.firestore.FieldValue.increment(referrerRewardCoins),
              referralCount: admin.firestore.FieldValue.increment(1)
            });

            // Log Referrer Transaction Log
            const referrerTxRef = db.collection('coinTransactions').doc();
            transaction.set(referrerTxRef, {
              userId: referrerDoc.id,
              amount: referrerRewardCoins,
              type: 'referral_bonus',
              description: `Referral signed up securely via Telegram bot! (+${referrerRewardCoins.toLocaleString()} $FISH)`,
              createdAt: new Date().toISOString()
            });

            // Log New User Transaction Log
            const selfTxRef = db.collection('coinTransactions').doc();
            transaction.set(selfTxRef, {
              userId: userId,
              amount: userRewardCoins,
              type: 'referral_bonus',
              description: `Applied match invitation code ${uppercaseCode}! (+${userRewardCoins.toLocaleString()} $FISH)`,
              createdAt: new Date().toISOString()
            });

            // Create notification for Referrer
            const notificationRef = db.collection('notifications').doc();
            transaction.set(notificationRef, {
              userId: referrerDoc.id,
              title: 'Successful Invite! 👥',
              message: `@${newUserData.username} signed up using your link! You earned +15,000 $FISH.`,
              type: 'referral',
              read: false,
              createdAt: new Date().toISOString()
            });
          }
        }
      }

      // Write user profile documentation
      transaction.set(userRef, newUserData);
    });

    userSnap = await userRef.get();
    return { user: userSnap.data(), created: true };
  } catch (err) {
    console.error('Error in Telegram Bot user transaction registration:', err);
    throw err;
  }
}

/**
 * Dynamic message sending helper
 */
async function telegramSendMessage(token, chatId, text, inlineKeyboard = null) {
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const body = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: false
    };

    if (inlineKeyboard) {
      body.reply_markup = {
        inline_keyboard: inlineKeyboard
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const result = await res.json();
    if (!result.ok) {
      console.warn('Telegram Send Message response error:', result);
    }
  } catch (error) {
    console.error('Fetch error during Telegram bot send message:', error);
  }
}

/**
 * Handles individual incoming telegram message payloads
 */
async function handleTelegramMessage(token, message) {
  if (!message || !message.chat || !message.text) return;

  const chatId = message.chat.id;
  const rawText = message.text.trim();
  const tgUser = message.from;

  if (!tgUser) return;

  // We parse commands like "/start OIBB-XYZ"
  const startMatch = rawText.match(/^\/start\s+(.*)/i);
  const isStart = rawText.toLowerCase().startsWith('/start');
  const isHelp = rawText.toLowerCase().startsWith('/help');
  const isBalance = rawText.toLowerCase().startsWith('/balance') || rawText.toLowerCase().startsWith('/profile');
  const isClaim = rawText.toLowerCase().startsWith('/claim') || rawText.toLowerCase().startsWith('/checkin');
  const isTasks = rawText.toLowerCase().startsWith('/tasks');

  try {
    let referralCode = '';
    if (startMatch && startMatch[1]) {
      referralCode = startMatch[1].trim();
    }

    // 1. Sync or register the user
    const { user, created } = await findOrCreateUser(tgUser, referralCode);

    // Bot Configuration URLs - Fallback to sandbox previews
    const devUrl = 'https://ais-dev-xg2iazg43p27ayvfndt54m-132519772023.europe-west3.run.app';
    const preUrl = 'https://ais-pre-xg2iazg43p27ayvfndt54m-132519772023.europe-west3.run.app';
    const appUrl = process.env.VITE_APP_URL || preUrl;

    const inlineKeyboard = [
      [
        { text: '🚀 Play Barca Earn MiniApp', web_app: { url: appUrl } }
      ],
      [
        { text: '👥 Invite Friends', url: `https://t.me/share/url?url=https://t.me/${message.via_bot?.username || 'BarcaEarnBot'}?start=${user.referralCode}&text=Get%2025,000%20%24FISH%20immediately%20by%20joining%20Barca%20Earn%20MiniApp!%20⚽️🪙` },
        { text: '📢 Community Channel', url: 'https://t.me/oibbofficial' }
      ]
    ];

    if (isStart) {
      let welcomeMsg = `👋 <b>Welcome to Barca Earn Bot, @${user.username || 'Player'}!</b> ⚽️🪙\n\n`;
      
      if (created) {
        welcomeMsg += `🎉 <i>Congratulations! You have been successfully registered into the Barca Earn ecosystem! A <b>Welcome Bonus of 25,000 $FISH</b> tokens has been credited to your balance!</i>\n\n`;
      } else {
        welcomeMsg += `👋 Welcome back, champion! Oibb servers linked successfully.\n\n`;
      }

      welcomeMsg += `⚽️ <b>What is Barca Earn?</b>\n`;
      welcomeMsg += `The premier Football Fan Engagement & Earning Mini App built directly for Telegram. Collect <b>$FISH</b> tokens by claiming daily check-ins, completing partner social campaigns, and viewing sponsored video clips.\n\n`;
      welcomeMsg += `📈 <b>Conversion Mechanics:</b>\n`;
      welcomeMsg += `• <b>10,000 $FISH = $1.00 USDT</b>\n`;
      welcomeMsg += `• Convert and withdraw instantly to TON wallets, cards, or Bybit!\n\n`;
      welcomeMsg += `🚀 Click the blue button below to launch the **Barca Earn WebApp** now!`;

      await telegramSendMessage(token, chatId, welcomeMsg, inlineKeyboard);
    } 
    else if (isHelp) {
      const helpMsg = `📖 <b>Barca Earn - Quick Guidelines & Bot Commands</b>\n\n` +
        `Use the commands below to interact directly with the bot:\n\n` +
        `• /start - Welcome text, registration, and play panel.\n` +
        `• /balance - Check live balance, referral count, and profile tier.\n` +
        `• /claim - Claim today's Check-In Bonus (+15k $FISH) instantly without loading app.\n` +
        `• /tasks - View available reward campaigns.\n` +
        `• /help - Open this instructions guide.\n\n` +
        `⚡️ <b>Quick Conversion Tip:</b>\n` +
        `All balances are preserved securely in Firestore database. Convert your FISH tokens inside the WebApp "Cash Out" menu to earn real USDT balances!`;

      await telegramSendMessage(token, chatId, helpMsg, inlineKeyboard);
    } 
    else if (isBalance) {
      const db = admin.firestore();
      // Fetch latest profile state to stay responsive
      const latestSnap = await db.collection('users').doc(`tg_${tgUser.id}`).get();
      const currentProfile = latestSnap.exists ? latestSnap.data() : user;

      const balanceMsg = `📊 <b>Your Barca Earn Wallet Profile</b>\n\n` +
        `👤 <b>Player:</b> @${currentProfile.username || tgUser.username || 'Player'}\n` +
        `🆔 <b>Telegram UID:</b> <code>${tgUser.id}</code>\n\n` +
        `🪙 <b>FISH Balance:</b> <code>${(currentProfile.coins || currentProfile.balance || 0).toLocaleString()} $FISH</code>\n` +
        `💰 <b>Converted Balance:</b> <code>$${(currentProfile.usdtBalance || currentProfile.points || 0).toFixed(4)} USDT</code>\n` +
        `👥 <b>Invites Count:</b> <code>${currentProfile.referralCount || 0} active friends</code>\n` +
        `🔗 <b>Personal Referral Code:</b> <code>${currentProfile.referralCode}</code>\n\n` +
        `👇 Tap the button below to launch the app or share with friends!`;

      await telegramSendMessage(token, chatId, balanceMsg, inlineKeyboard);
    } 
    else if (isClaim) {
      const db = admin.firestore();
      const userId = `tg_${tgUser.id}`;
      const userRef = db.collection('users').doc(userId);
      const now = new Date();
      const todayDateStr = now.toISOString().split('T')[0];

      let claimSuccess = false;
      let rewardAmount = 15000;

      try {
        await db.runTransaction(async (transaction) => {
          const userSnap = await transaction.get(userRef);
          if (!userSnap.exists) {
            throw new Error('Please type /start first to setup your profile.');
          }

          const userData = userSnap.data();
          const lastCheckInStr = userData.lastCheckIn; 
          
          if (lastCheckInStr) {
            const lastCheckInDate = new Date(lastCheckInStr);
            const hoursPassed = (now.getTime() - lastCheckInDate.getTime()) / (1000 * 60 * 60);
            if (hoursPassed < 24) {
              throw new Error('Daily check-in allowance already claimed today! Check back tomorrow.');
            }
          }

          transaction.update(userRef, {
            coins: (userData.coins || 0) + rewardAmount,
            balance: (userData.balance || 0) + rewardAmount,
            totalEarned: (userData.totalEarned || 0) + rewardAmount,
            lastCheckIn: now.toISOString(),
            lastRewardDate: todayDateStr,
            dailyRewardDays: admin.firestore.FieldValue.increment(1)
          });

          // Write coin transaction ledger record
          const txRef = db.collection('coinTransactions').doc();
          transaction.set(txRef, {
            userId: userId,
            amount: rewardAmount,
            type: 'daily_login',
            description: `Claimed Daily Check-In Bonus via Telegram bot (+${rewardAmount.toLocaleString()} $FISH)`,
            createdAt: now.toISOString()
          });

          // Send user notification too
          const notifyRef = db.collection('notifications').doc();
          transaction.set(notifyRef, {
            userId: userId,
            title: 'Bot Check-In Bonus Credited! 🪙',
            message: `Successfully claimed daily check-in allowance of +15,000 $FISH.`,
            type: 'reward',
            read: false,
            createdAt: now.toISOString()
          });

          claimSuccess = true;
        });

        if (claimSuccess) {
          const successMsg = `🪙 <b>Check-In Claim Successful!</b>\n\n` +
            `🎉 <i>Awesome, champion! You claimed your daily login allowance of <b>+15,000 $FISH</b> tokens directly through this chat screen!</i>\n\n` +
            `💸 Your updated balance has been synchronized. Use /balance to view your wallet.`;
          await telegramSendMessage(token, chatId, successMsg, inlineKeyboard);
        }
      } catch (err) {
        const errorMsg = `⚠️ <b>Claim Attempt Paused</b>\n\n` +
          `❌ <i>${err.message || 'Verification pipeline rejected transaction'}</i>\n\n` +
          `Keep checking in daily to maintain active stats!`;
        await telegramSendMessage(token, chatId, errorMsg, inlineKeyboard);
      }
    } 
    else if (isTasks) {
      const db = admin.firestore();
      
      // Fetch some campaigns from database
      const tasksSnap = await db.collection('tasks').limit(3).get();
      let campaignsMsg = `📋 <b>Outstanding Reward Campaigns List</b>\n\n` +
        `Complete these social missions to boost your pocket earnings instantly:\n\n`;

      if (tasksSnap.empty) {
        campaignsMsg += `• <b>Watch sponsored video ads</b> daily (+5,000 FISH per clip!)\n` +
          `• <b>Subscribe to Oibb Community Channel</b> (+500 FISH)\n` +
          `• <b>Invite your friends</b> (+15,000 FISH for each unique invite!)\n\n`;
      } else {
        tasksSnap.docs.forEach((d) => {
          const t = d.data();
          campaignsMsg += `• 🌟 <b>${t.title}</b>\n  🎁 Reward: <code>+${(t.reward || 0).toLocaleString()} FISH</code>\n  🔗 Url: <a href="${t.taskUrl}">${t.taskUrl}</a>\n\n`;
        });
      }

      campaignsMsg += `👇 Open the Barca Earn WebApp in the panel below, do missions, and click <b>Verify</b> to collect rewards!`;
      await telegramSendMessage(token, chatId, campaignsMsg, inlineKeyboard);
    }
  } catch (err) {
    console.error('Error handling Telegram message update logic:', err);
    await telegramSendMessage(token, chatId, '⚠️ <i>An internal error occurred while syncing your profile. Please try again soon.</i>');
  }
}

/**
 * Main initialization runner
 */
export async function initTelegramBot(app) {
  // Read token, falling back automatically to developer active token so everything is plug-and-play!
  const botToken = process.env.TELEGRAM_BOT_TOKEN && 
                   process.env.TELEGRAM_BOT_TOKEN !== '1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ-1234abcd'
                     ? process.env.TELEGRAM_BOT_TOKEN 
                     : '8400832028:AAFDGCXNYsgwYGkElMKPwF5n8CuvKyHfmvo';

  console.log(`[Telegram Bot] Preparing service...`);

  if (!botToken) {
    console.warn('[Telegram Bot] Missing token, skipped integration hook setup');
    return;
  }

  const shortenedToken = botToken.substring(0, 10) + '...' + botToken.slice(-6);
  console.log(`[Telegram Bot] Running with secure configured token: ${shortenedToken}`);

  // Register the Webhook api router endpoint directly on Express
  app.post('/api/telegram-webhook', async (req, res) => {
    try {
      const update = req.body;
      if (update && update.message) {
        await handleTelegramMessage(botToken, update.message);
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('Error processing webhook update:', err);
      // Always reply with 200 OK so Telegram doesn't queue and spam the endpoint on minor errors
      res.json({ ok: false, error: err.message });
    }
  });

  // Automatically attempt to register our application webhook URL on the Telegram server
  try {
    const sandboxUrl = 'https://ais-pre-xg2iazg43p27ayvfndt54m-132519772023.europe-west3.run.app';
    const currentHost = process.env.VITE_APP_URL || sandboxUrl;
    
    if (currentHost && !currentHost.includes('localhost') && !currentHost.includes('0.0.0.0')) {
      const webhookUrl = `${currentHost}/api/telegram-webhook`;
      console.log(`[Telegram Bot] Securely configuring webhook target url: ${webhookUrl}`);
      const setWebhookResponse = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
      const setWebhookResult = await setWebhookResponse.json();
      console.log('[Telegram Bot] Telegram API setWebhook response details:', setWebhookResult);
    }
  } catch (err) {
    console.warn('[Telegram Bot] Webhook URL registration was skipped (expected in local dev or offline):', err.message);
  }

  // Active Background Long-Polling Thread Fallback for dev servers/local runs!
  let lastUpdateId = 0;
  async function pollUpdates() {
    while (true) {
      try {
        const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=20`;
        const res = await fetch(url);
        const result = await res.json();
        
        if (result.ok && result.result && result.result.length > 0) {
          for (const update of result.result) {
            lastUpdateId = update.update_id;
            if (update.message) {
              await handleTelegramMessage(botToken, update.message);
            }
          }
        }
      } catch (err) {
        // Quietly fail as long-polling might have timeout errors or rate limits
        await new Promise(resolve => setTimeout(resolve, 8000));
      }
      // Brief pause to prevent CPU burn
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  // Spin off background polling loop so it remains active and responsive without blocking Express
  console.log('[Telegram Bot] Background Long-Polling fallbacks running smoothly...');
  pollUpdates().catch((err) => {
    console.error('[Telegram Bot] Core polling thread exception caught:', err);
  });
}
