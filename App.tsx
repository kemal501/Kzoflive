import { useState, useEffect } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Award, Users, Wallet, Receipt, Zap, 
  Coins, LogOut, User as UserIcon, 
  Copy, RefreshCw, Check, 
  ChevronRight, Play, Trophy, Tv, Settings, Share2,
  AlertTriangle, ExternalLink
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { auth, db, googleProvider } from './src/firebase';
import { signInWithPopup, signOut, signInAnonymously } from 'firebase/auth';
import { createUserProfile, getUserProfile, User, trackReferralClick } from './src/services/userService';
import { doc, updateDoc, increment, addDoc, collection, getDocs, onSnapshot, runTransaction } from 'firebase/firestore';
import TasksPage from './src/pages/TasksPage';
import WithdrawalPage from './src/pages/WithdrawalPage';
import AdminPanel from './src/components/AdminPanel';
import { CountUp } from './src/components/CountUp';
import { secureCheckin, secureAdReward } from './src/services/apiService';
import { generateFingerprint, captureClientInfo } from './src/utils/fingerprint';
import { triggerImpact, triggerNotification, triggerSelectionChange } from './src/utils/haptic';
import { Bell } from 'lucide-react';

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<any>(null);
  const [isTelegramWebApp, setIsTelegramWebApp] = useState(false);
  const [telegramUser, setTelegramUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'home' | 'tasks' | 'watch' | 'refer' | 'leaderboard' | 'wallet' | 'ledger' | 'settings' | 'admin'>('home');
  const [copied, setCopied] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showDomainConfigModal, setShowDomainConfigModal] = useState(false);
  const [copiedDomain, setCopiedDomain] = useState<string | null>(null);
  
  // App Stats
  const [isDailyClaiming, setIsDailyClaiming] = useState(false);
  const [ledgerLogs, setLedgerLogs] = useState<any[]>([]);

  // Referral Leaderboard State
  const [leaderboard, setLeaderboard] = useState<{ userId: string; userName: string; referralCount: number; coins: number; email?: string }[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);

  // Simulation referral input
  const [simRefCode, setSimRefCode] = useState('');

  // Watch ad reward loader
  const [watchingAd, setWatchingAd] = useState(false);
  const [countdownTimer, setCountdownTimer] = useState(0);

  // User Customizer Options states
  const [selectedLang, setSelectedLang] = useState<'en' | 'am' | 'om'>('en');
  const [hapticsOn, setHapticsOn] = useState<boolean>(() => {
    try {
      const val = localStorage.getItem('haptics_enabled');
      return val === null ? true : val === 'true';
    } catch {
      return true;
    }
  });
  const [audioOn, setAudioOn] = useState(true);

  // Daily Streak Goal computations
  const dailyGoalTasksCount = user?.dailyGoalTasksCompleted || 0;
  const dailyGoalAdsCount = user?.dailyGoalAdsCompleted || 0;
  const dailyGoalTotalCompleted = dailyGoalTasksCount + dailyGoalAdsCount;
  const dailyGoalTarget = 2;
  const dailyGoalProgressPct = Math.min((dailyGoalTotalCompleted / dailyGoalTarget) * 100, 100);
  const dailyGoalRemainingNeeded = Math.max(dailyGoalTarget - dailyGoalTotalCompleted, 0);
  const dailyGoalActiveStreak = user?.dailyGoalStreakCount || 0;
  const dailyGoalIsClaimedToday = user?.dailyGoalClaimedToday || false;

  useEffect(() => {
    try {
      localStorage.setItem('haptics_enabled', String(hapticsOn));
    } catch (e) {
      console.warn('Failed to write haptics settings to localStorage', e);
    }
  }, [hapticsOn]);

  // Notifications State Management
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => {
    if (!firebaseUser) {
      setNotifications([]);
      return;
    }
    
    // Subscribe to all notifications
    const q1 = collection(db, 'notifications');
    const unsub = onSnapshot(q1, (snapshot) => {
      const list = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter((n: any) => n.userId === firebaseUser.uid || n.userId === 'broadcast');
      
      // Sort list by date descending
      list.sort((a: any, b: any) => {
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      });
      setNotifications(list);
    }, (err) => {
      console.warn("Real-time notifications permission error (expected or transient):", err);
    });

    return () => unsub();
  }, [firebaseUser]);

  const unreadCount = notifications.filter(n => !n.read).length;

  // Sync user status and profile
  const fetchUserProfile = async (uid: string) => {
    try {
      const p = await getUserProfile(uid);
      if (p) {
        setUser(p);
      }
    } catch (err) {
      console.error("Error fetching sync user profiles:", err);
    }
  };

  // Load and bootstrap Telegram parameters if running inside Telegram Mini App
  useEffect(() => {
    const webApp = (window as any).Telegram?.WebApp;
    if (webApp && webApp.initData) {
      setIsTelegramWebApp(true);
      const tgUserObj = webApp.initDataUnsafe?.user;
      if (tgUserObj) {
        setTelegramUser(tgUserObj);
      }
      
      // Auto silently login firebase anonymously inside Telegram to interact with Firestore rules
      if (!auth.currentUser) {
        signInAnonymously(auth).catch((err) => {
          console.error("Silent Telegram Anonymous auth initialization error:", err);
        });
      }
    }
  }, []);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (fUser) => {
      setFirebaseUser(fUser);
      if (fUser) {
        // Read auto-referral start params from Telegram WebApp or URL query parameters
        const webApp = (window as any).Telegram?.WebApp;
        const urlParams = new URLSearchParams(window.location.search);
        const webStartParam = urlParams.get('startapp') || urlParams.get('ref') || '';
        const startParamCode = webApp?.initDataUnsafe?.start_param || webStartParam || '';

        // If someone visited with a referral code, track this click
        if (startParamCode) {
          await trackReferralClick(startParamCode);
        }

        let defaultName = fUser.displayName || fUser.email?.split('@')[0] || 'Guest Player';
        let tgId = '';
        let tgUsername = '';

        if (webApp && webApp.initDataUnsafe?.user) {
          const u = webApp.initDataUnsafe.user;
          defaultName = u.first_name || u.username || defaultName;
          tgId = u.id.toString();
          tgUsername = u.username || '';
        }

        const userObj: User = {
          userId: fUser.uid,
          userName: defaultName,
          email: fUser.email || (tgUsername ? `${tgUsername}@telegram.com` : `${fUser.uid.substring(0, 8)}@telegram.com`),
          role: (fUser.email === 'kemalziyad4@gmail.com' || fUser.email === 'kemalziyad49@gmail.com') ? 'admin' : 'user',
          coins: 25000, // Initial welcome reward matching ecosystem
          rewardPoints: 0,
          totalStreamingDuration: 0,
          referralCode: 'OIBB-' + fUser.uid.substring(0, 5).toUpperCase(),
          telegramId: tgId,
          firstName: defaultName,
        };

        await createUserProfile(userObj, startParamCode);
        await fetchUserProfile(fUser.uid);
      } else {
        setUser(null);
      }
    });
    return () => unsub();
  }, []);

  // Sync custom coin transactions ledger snapshot
  useEffect(() => {
    if (!firebaseUser) return;
    const unsub = onSnapshot(collection(db, 'coinTransactions'), (snapshot) => {
      const list = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter((tx: any) => tx.userId === firebaseUser.uid);
      
      list.sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      setLedgerLogs(list);
    }, (err) => {
      console.warn("Ledger snap error (can ignore fallback):", err);
    });
    return () => unsub();
  }, [firebaseUser]);

  // Real-time current user document synchronizer
  useEffect(() => {
    if (!firebaseUser) return;
    const userRef = doc(db, 'users', firebaseUser.uid);
    const unsub = onSnapshot(userRef, (snapshot) => {
      if (snapshot.exists()) {
        setUser(snapshot.data() as User);
      }
    }, (err) => {
      console.warn("User document sync error:", err);
    });
    return () => unsub();
  }, [firebaseUser]);

  // Auto-reset daily goal and streak calculations when day shifts
  useEffect(() => {
    if (!firebaseUser || !user || user.isSimulated) return;

    const todayStr = new Date().toDateString(); // e.g., "Sun Jun 14 2026"
    
    if (user.dailyGoalLastResetDate !== todayStr) {
      // Determine if a streak was active yesterday or if it's a cold restart
      let nextStreak = user.dailyGoalStreakCount || 0;
      
      // If last reset date exists and was not yesterday, reset streak
      if (user.dailyGoalLastResetDate) {
        const lastReset = new Date(user.dailyGoalLastResetDate);
        const today = new Date(todayStr);
        const diffTime = Math.abs(today.getTime() - lastReset.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays > 1) {
          nextStreak = 0; // streak broken
        }
      }

      // Reset goals atomically
      const userRef = doc(db, 'users', firebaseUser.uid);
      updateDoc(userRef, {
        dailyGoalTasksCompleted: 0,
        dailyGoalAdsCompleted: 0,
        dailyGoalClaimedToday: false,
        dailyGoalLastResetDate: todayStr,
        dailyGoalStreakCount: nextStreak
      }).catch(err => {
        console.warn("Could not save daily goal resets to Firestore database:", err);
      });
    }
  }, [firebaseUser, user]);

  // Sync and calculate top referrers leaderboard
  useEffect(() => {
    if (!firebaseUser) return;
    setLoadingLeaderboard(true);

    const unsub = onSnapshot(collection(db, 'users'), (snapshot) => {
      try {
        const allUsers = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            userId: doc.id,
            userName: data.userName || 'Guest Player',
            email: data.email || '',
            coins: data.coins || 0,
            referredBy: data.referredBy || ''
          };
        });

        // Compute successful referral counts
        const referralCounts: Record<string, number> = {};
        allUsers.forEach(u => {
          if (u.referredBy) {
            referralCounts[u.referredBy] = (referralCounts[u.referredBy] || 0) + 1;
          }
        });

        // Map users to include counts, sort desc and slice to top 5
        const sortedLeaders = allUsers.map(u => ({
          userId: u.userId,
          userName: u.userName,
          email: u.email,
          coins: u.coins,
          referralCount: referralCounts[u.userId] || 0
        }))
        .sort((a, b) => b.referralCount - a.referralCount)
        .slice(0, 5);

        setLeaderboard(sortedLeaders);
      } catch (err) {
        console.error("Error computing live referral leaderboard: ", err);
      } finally {
        setLoadingLeaderboard(false);
      }
    }, (err) => {
      console.warn("Leaderboard snapshot fetch failed: ", err);
      setLoadingLeaderboard(false);
    });

    return () => unsub();
  }, [firebaseUser]);

  // Handle Google authentications
  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error("Google auth failed:", err);
      const isDomainError = err.code === 'auth/unauthorized-domain' || 
                            err.message?.includes('unauthorized-domain') || 
                            err.message?.includes('auth/unauthorized-domain');
      if (isDomainError) {
        setShowDomainConfigModal(true);
        triggerNotification('error');
      } else {
        alert("Google sign-in error: " + (err.message || String(err)));
      }
    }
  };

  // Helper method to bypass domain constraints during testing on random sandbox host URLs
  const handleDemoSessionLogin = async () => {
    try {
      triggerImpact('medium');
      await signInAnonymously(auth);
      setShowDomainConfigModal(false);
      triggerNotification('success');
    } catch (err: any) {
      console.warn("Anonymous registration is also disabled in your Firebase console. Custom virtual profile loaded instead:", err);
      // Construct a premium virtual state so components can render and interact safely
      setFirebaseUser({
        uid: 'simulated_tester_99',
        email: 'kemalziyad4@gmail.com',
        displayName: 'Simulated Developer',
        photoURL: null,
        isSimulated: true
      });
      setShowDomainConfigModal(false);
      triggerNotification('success');
      alert("Virtual Simulation Mode Enabled! We created a local profile so you can explore active dashboards smoothly with offline features.");
    }
  };

  // Profile simulations
  const simulateProfile = async (email: string) => {
    try {
      // Prompt user to standard firebase sandbox user profiles
      // If we log out and sign back with sandbox simulation credentials securely
      await signOut(auth);
      // We can also trigger mock login directly for rapid evaluation of layouts in safe mode
      alert(`Simulation Mode: To run fully authenticated operations, please sign in via Google. Switching your email config to: ${email}`);
    } catch (err) {
      console.error(err);
    }
  };

  // Submit Simulated referral code
  const applyReferral = async () => {
    if (!firebaseUser) {
      alert("Please login first to apply a referral code.");
      return;
    }
    if (!simRefCode.trim()) {
      alert("Enter a valid invitation code.");
      return;
    }
    try {
      const usersRef = collection(db, 'users');
      const referrerQ = await getDocs(usersRef);
      const matchedReferrals = referrerQ.docs.find(d => d.data().referralCode === simRefCode.trim().toUpperCase());

      if (matchedReferrals) {
        const refId = matchedReferrals.id;
        if (refId === firebaseUser.uid) {
          alert("You cannot refer yourself.");
          return;
        }

        // Apply reward
        const userRef = doc(db, 'users', firebaseUser.uid);
        await updateDoc(userRef, {
          referredBy: refId,
          coins: increment(5000) // 5k FISH sign up bonus
        });

        const referrerRef = doc(db, 'users', refId);
        await updateDoc(referrerRef, {
          coins: increment(15000), // 15k FISH referrer bonus
          referralSignups: increment(1)
        });

        // Record logs
        await addDoc(collection(db, 'coinTransactions'), {
          userId: firebaseUser.uid,
          amount: 5000,
          type: 'referral_bonus',
          description: `Applied invitation code ${simRefCode.trim().toUpperCase()}`,
          createdAt: new Date().toISOString()
        });

        await addDoc(collection(db, 'coinTransactions'), {
          userId: refId,
          amount: 15000,
          type: 'referral_bonus',
          description: `New referral signed up securely!`,
          createdAt: new Date().toISOString()
        });

        alert("Invitation code applied successfully! +5,000 $FISH added.");
        setSimRefCode('');
        triggerNotification('success');
        fetchUserProfile(firebaseUser.uid);
      } else {
        triggerNotification('error');
        alert("Invitation code not found in Oibb database.");
      }
    } catch (error: any) {
      triggerNotification('error');
      alert("Error applying referrer: " + error.message);
    }
  };

  // Claim check-in bonus
  const handleCheckin = async () => {
    if (!firebaseUser) return;
    setIsDailyClaiming(true);
    triggerImpact('medium');
    try {
      await secureCheckin();
      triggerNotification('success');
      alert(`Congratulations! You have successfully claimed today's Check-In Bonus of 15,000 $FISH!`);
      fetchUserProfile(firebaseUser.uid);
    } catch (error: any) {
      triggerNotification('error');
      alert("Claiming daily reward failed: " + error.message);
    } finally {
      setIsDailyClaiming(false);
    }
  };

  // Simulated watch video ads
  const triggerAdWatch = async () => {
    if (!firebaseUser) return;
    setWatchingAd(true);
    try {
      // Mock AdsGram wait time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const fingerprint = generateFingerprint();
      const clientInfo = captureClientInfo();
      
      const response = await secureAdReward(fingerprint, clientInfo);

      alert(`Ad completed! You earned ${response.reward?.toLocaleString() || '5,000'} $FISH successfully.`);
      fetchUserProfile(firebaseUser.uid);
    } catch (err: any) {
      if (user?.isSimulated) {
        setUser(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            coins: (prev.coins || 0) + 5000,
            dailyGoalAdsCompleted: (prev.dailyGoalAdsCompleted || 0) + 1
          };
        });
        alert("Virtual simulation mode active: +5,000 $FISH and +1 Daily Goal ad complete successfully simulated!");
      } else {
        alert("Failed to reward: " + err.message);
      }
    } finally {
      setWatchingAd(false);
    }
  };

  // Claim Daily Streak/Activity Goal bonus (+10,000 FISH)
  const [claimingDailyGoal, setClaimingDailyGoal] = useState(false);
  const handleClaimDailyGoalBonus = async () => {
    if (!user) return;
    setClaimingDailyGoal(true);
    triggerImpact('heavy');

    const reward = 10000;
    const todayStr = new Date().toDateString();

    try {
      if (firebaseUser && !user.isSimulated) {
        const userRef = doc(db, 'users', firebaseUser.uid);
        const ledgerRef = doc(collection(db, 'coinTransactions'));
        const nextCoins = (user.coins || 0) + reward;
        const nextStreak = (user.dailyGoalStreakCount || 0) + 1;

        await runTransaction(db, async (transaction: any) => {
          transaction.update(userRef, {
            coins: nextCoins,
            dailyGoalClaimedToday: true,
            dailyGoalStreakCount: nextStreak,
            dailyGoalLastResetDate: todayStr
          });

          transaction.set(ledgerRef, {
            userId: firebaseUser.uid,
            amount: reward,
            type: 'daily_streak_bonus',
            description: `Claimed Daily Activity Streak Bonus (+${reward.toLocaleString()} $FISH)`,
            createdAt: new Date().toISOString()
          });
        });

        // Trigger real notification in Firestore
        await addDoc(collection(db, 'notifications'), {
          userId: firebaseUser.uid,
          title: 'Daily Goal Streak Unlocked! 🔥',
          message: `Claimed +10,000 $FISH for completing daily activity target! Active streak: ${nextStreak} days.`,
          type: 'reward',
          read: false,
          createdAt: new Date().toISOString()
        });

      } else {
        // Simulated local fallback
        setUser(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            coins: (prev.coins || 0) + reward,
            dailyGoalClaimedToday: true,
            dailyGoalStreakCount: (prev.dailyGoalStreakCount || 0) + 1,
            dailyGoalLastResetDate: todayStr
          };
        });
      }

      // Celebrations
      triggerNotification('success');
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#ffc107', '#ff5722', '#3b82f6', '#4caf50']
      });

      alert(`Success! You have claimed today's Daily Activity Streak Bonus of +10,000 $FISH! Active streak: ${(user.dailyGoalStreakCount || 0) + 1} days 🔥`);
    } catch (err: any) {
      console.error("Failed to claim daily goal bonus:", err);
      alert("Error claiming daily activity bonus: " + err.message);
    } finally {
      setClaimingDailyGoal(false);
    }
  };

  const copyReferralLink = () => {
    if (!user) return;
    const refLink = `https://t.me/BarcaearnBot?start=${user.referralCode}`;
    navigator.clipboard.writeText(refLink);
    setCopied(true);
    triggerNotification('success');
    setTimeout(() => setCopied(false), 2000);
  };

  const isAdminUser = user && (user.email === 'kemalziyad4@gmail.com' || user.email === 'kemalziyad49@gmail.com' || user.role === 'admin');

  return (
    <div className="flex-1 w-full bg-slate-950 text-slate-100 flex flex-col md:py-6 md:px-4">
      {/* Desktop Shell container */}
      <div className="w-full max-w-md mx-auto bg-slate-900 border-0 md:border md:border-slate-800 rounded-none md:rounded-[36px] shadow-2xl flex flex-col overflow-hidden min-h-screen md:min-h-[850px] relative">
        
        {/* Mock Speaker/Camera bezel on top of simulation frame */}
        <div className="hidden md:flex justify-center items-center py-2 bg-slate-950">
          <div className="w-24 h-4 bg-slate-900 rounded-full border border-slate-800 flex items-center justify-around px-2">
            <div className="w-2 h-2 rounded-full bg-slate-800"></div>
            <div className="w-10 h-1.5 rounded-full bg-slate-800"></div>
          </div>
        </div>

        {/* Dynamic header navigation */}
        <header className="bg-slate-900 border-b border-slate-800/80 sticky top-0 px-4 py-3 z-30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
              <span className="text-blue-400 font-extrabold text-sm select-none">B</span>
            </div>
            <div>
              <h1 className="text-sm font-black tracking-wide uppercase text-white leading-none">Barca Earn</h1>
              <p className="text-[9px] text-slate-500 uppercase font-mono tracking-widest mt-1">Official Mini-App</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {firebaseUser && (
              <div className="relative">
                <button 
                  id="header-notification-bell"
                  onClick={() => setNotificationsOpen(!notificationsOpen)}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition relative flex items-center justify-center"
                >
                  <Bell size={14} className={unreadCount > 0 ? "animate-pulse" : ""} />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 rounded-full text-[8px] font-extrabold text-white flex items-center justify-center animate-pulse">
                      {unreadCount}
                    </span>
                  )}
                </button>
              </div>
            )}
            {/* Telegram simulated badges */}
            {isTelegramWebApp ? (
              <div className="flex items-center gap-1.5 bg-blue-500/15 border border-blue-500/30 rounded-xl px-2.5 py-1 text-[10px] font-extrabold text-blue-400">
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse"></span>
                <span>@{telegramUser?.username || 'TELEGRAM'}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 bg-blue-900/20 border border-blue-500/20 rounded-full px-2.5 py-1 text-[10px] font-extrabold text-blue-400">
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-ping"></span>
                <span>SANDBOX LIVE</span>
              </div>
            )}
          </div>
        </header>

        {/* Dynamic notifications inbox panel drawer */}
        <AnimatePresence>
          {notificationsOpen && firebaseUser && (
            <motion.div 
              id="notifications-inbox-pane"
              initial={{ opacity: 0, y: -15, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -15, scale: 0.95 }}
              className="absolute top-14 left-4 right-4 bg-slate-950 border border-slate-800/95 rounded-2xl p-4 shadow-2xl z-40 max-h-[380px] overflow-y-auto flex flex-col divide-y divide-slate-900"
            >
              <div className="flex items-center justify-between pb-3">
                <h3 className="text-xs font-black text-white flex items-center gap-1.5 uppercase tracking-wider">
                  <Bell size={13} className="text-blue-400" />
                  <span>In-App Notifications</span>
                  <span className="text-[10px] lowercase bg-slate-900 text-slate-400 px-2 py-0.5 rounded-full font-bold">
                    {unreadCount} new
                  </span>
                </h3>
                {unreadCount > 0 && (
                  <button 
                    id="mark-all-read-btn"
                    onClick={async () => {
                      try {
                        const batchPromises = notifications
                          .filter(n => !n.read)
                          .map(n => updateDoc(doc(db, 'notifications', n.id), { read: true }));
                        await Promise.all(batchPromises);
                      } catch (err) {
                        console.error("Mark all as read failed", err);
                      }
                    }}
                    className="text-[9px] text-blue-400 font-extrabold hover:underline uppercase"
                  >
                    Mark read
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto py-1 divide-y divide-slate-800/50 custom-scrollbar max-h-[260px]">
                {notifications.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 italic text-[11px] flex flex-col items-center gap-1">
                    <Bell size={24} className="opacity-10 mb-1" />
                    <span>No notifications received yet.</span>
                  </div>
                ) : (
                  notifications.map((n) => {
                    const getEmoji = (t: string) => {
                      if (t === 'reward') return '🪙';
                      if (t === 'withdrawal') return '💸';
                      if (t === 'referral') return '👥';
                      return '📢';
                    };
                    return (
                      <div 
                        key={n.id}
                        onClick={async () => {
                          if (!n.read) {
                            try {
                              await updateDoc(doc(db, 'notifications', n.id), { read: true });
                            } catch (e) {
                              console.error(e);
                            }
                          }
                        }}
                        className={`py-3 px-1 flex items-start gap-2.5 transition-colors cursor-pointer ${!n.read ? 'bg-indigo-950/20 active:bg-indigo-950/40' : 'hover:bg-slate-900/40'}`}
                        id={`notification-item-${n.id}`}
                      >
                        <span className="text-base select-none mt-0.5">{getEmoji(n.type)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h4 className={`text-[11px] truncate uppercase tracking-tight font-black ${!n.read ? 'text-[#2481cc]' : 'text-slate-300'}`}>
                              {n.title}
                            </h4>
                            {!n.read && (
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 block shrink-0"></span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{n.message}</p>
                          <span className="text-[8px] text-slate-600 block mt-1 font-mono">
                            {n.createdAt ? new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'just now'}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="pt-2 text-center">
                <button 
                  id="notifications-close-panel-btn"
                  onClick={() => setNotificationsOpen(false)}
                  className="w-full text-[10px] text-slate-500 font-extrabold hover:text-white uppercase transition"
                >
                  Close Panel
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Scrollable View Area */}
        <div className="flex-1 overflow-y-auto pb-24 p-4">
          
          {/* USER NOT LOGGED IN OVERLAY */}
          {!firebaseUser ? (
            <div className="py-12 flex flex-col text-center items-center justify-center space-y-6">
              <div className="w-20 h-20 rounded-3xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shadow-xl">
                <Coins size={36} className="animate-bounce" />
              </div>
              <div>
                <h3 className="text-xl font-black text-white">Welcome to Barca Earn</h3>
                <p className="text-xs text-slate-400 mt-2 px-6 leading-relaxed">
                  Earn premium USDT points, complete soccer social missions, watch ad bursts, and withdraw real capital securely.
                </p>
              </div>

              <div className="bg-slate-950/60 rounded-2xl p-4 border border-slate-800/80 text-left w-full space-y-3">
                <span className="text-[10px] uppercase font-bold tracking-widest text-[#2481cc]">Security Certification</span>
                <p className="text-[11px] text-slate-400">
                  Authenticate securely using Google Login. Your credentials remain safe and synchronized instantly inside Firestore.
                </p>
              </div>

              <button 
                onClick={handleGoogleLogin}
                className="w-full bg-gradient-to-r from-blue-500 via-[#2481cc] to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white py-4 px-6 rounded-2xl font-black text-sm uppercase tracking-wider transition-all shadow-lg shadow-blue-500/20"
              >
                Sign In with Google
              </button>

              <div className="text-slate-500 text-[10px] uppercase tracking-wider font-mono">
                SECURED BY GOOGLE FIREBASE
              </div>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              
              {/* TAB 1: HOME */}
              {activeTab === 'home' && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4"
                >
                  {/* SIMULATION CONTROLS BOX */}
                  <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 space-y-3">
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block font-mono">Simulation sandbox controllers:</span>
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        onClick={() => simulateProfile('kemalziyad4@gmail.com')}
                        className="bg-indigo-950/40 hover:bg-indigo-950/70 border border-indigo-500/30 text-indigo-400 text-[10px] font-bold py-2 px-2.5 rounded-xl transition"
                      >
                        Mock Administrator
                      </button>
                      <button 
                        onClick={() => simulateProfile('tester@google.com')}
                        className="bg-slate-900 hover:bg-slate-800 border border-slate-700/60 text-slate-300 text-[10px] font-bold py-2 px-2.5 rounded-xl transition"
                      >
                        Mock Standard User
                      </button>
                    </div>
                  </div>

                  {/* USER CARD COINS DETAILS */}
                  <div className="bg-gradient-to-b from-slate-800/80 to-slate-900/90 rounded-3xl p-6 border border-slate-700/50 relative overflow-hidden text-center shadow-xl">
                    <div className="absolute right-0 top-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
                    <div className="absolute left-0 bottom-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>

                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">$FISH Balance</span>
                    
                    <div className="flex items-center justify-center gap-2 mt-2">
                      <span className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-amber-400 to-yellow-500 tracking-tight font-mono">
                        <CountUp value={user?.coins || 0} />
                      </span>
                      <span className="text-2xl animate-pulse">🪙</span>
                    </div>

                    <div className="grid grid-cols-2 items-center bg-slate-950/40 rounded-2xl border border-slate-800/50 p-3 mt-5 text-center divide-x divide-slate-800">
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider leading-none">USDT Earned</span>
                        <p className="text-sm font-extrabold text-white mt-1 font-mono">${(user?.points || 0).toFixed(2)}</p>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider leading-none">Exchange</span>
                        <p className="text-[11px] text-amber-400 font-bold mt-1">10k FISH = $1</p>
                      </div>
                    </div>
                  </div>

                  {/* DAILY CHECKIN TRIGGER BUTTON */}
                  <button 
                    disabled={isDailyClaiming}
                    onClick={handleCheckin}
                    className="w-full bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 disabled:opacity-75 text-slate-950 font-black py-4 px-6 rounded-2xl shadow-xl flex items-center justify-center gap-3 transition-transform hover:scale-[1.01] active:scale-95 text-xs uppercase tracking-wider"
                  >
                    {isDailyClaiming ? (
                      <RefreshCw size={18} className="animate-spin text-slate-950" />
                    ) : (
                      <Zap size={18} className="animate-bounce" />
                    )}
                    <span>Claim Daily Bonus (+15,000 FISH)</span>
                  </button>

                  {/* DAILY ACTIVITY GOAL TRACKER CARD */}
                  <div className="bg-slate-900 border border-slate-800/80 rounded-3xl p-5 shadow-lg space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className="p-2.5 bg-gradient-to-br from-amber-500/10 to-yellow-500/10 border border-amber-500/20 text-amber-400 rounded-xl">
                          <Award size={22} className={dailyGoalActiveStreak > 0 ? "animate-pulse" : ""} />
                        </div>
                        <div className="text-left">
                          <h4 className="text-sm font-black text-white flex items-center gap-1.5">
                            <span>Daily Streak Goal</span>
                            <span className="text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded uppercase font-bold">
                              +10,000 FISH
                            </span>
                          </h4>
                          <p className="text-xs text-slate-400 mt-1 pb-0.5 text-left">
                            Complete any 2 actions (ads or tasks) to win a secondary streak bonus!
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex flex-col items-end">
                        <div className="flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 rounded-xl px-2 py-1 text-amber-400">
                          <span className="text-xs text-yellow-500">🔥</span>
                          <span className="text-xs font-black font-mono">{dailyGoalActiveStreak}d</span>
                        </div>
                      </div>
                    </div>

                    {/* Progress tracker metrics */}
                    <div className="bg-slate-950/50 border border-slate-800/60 rounded-2xl p-4 space-y-3.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Completed Actions</span>
                        <span className="font-mono font-bold text-white">
                          {dailyGoalTotalCompleted} / {dailyGoalTarget} Goals
                        </span>
                      </div>

                      {/* Progress bar container */}
                      <div className="relative w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                        <motion.div
                          className="absolute top-0 left-0 h-full bg-gradient-to-r from-amber-400 via-yellow-500 to-emerald-400 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${dailyGoalProgressPct}%` }}
                          transition={{ duration: 0.5 }}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-left">
                        <div className="bg-slate-900/60 border border-slate-800/40 rounded-xl p-2 flex flex-col">
                          <span className="text-slate-500 font-medium">Tasks Logged</span>
                          <span className="text-white font-mono font-black mt-0.5 text-xs">{dailyGoalTasksCount}</span>
                        </div>
                        <div className="bg-slate-900/60 border border-slate-800/40 rounded-xl p-2 flex flex-col">
                          <span className="text-slate-500 font-medium font-sans">Ads Streamed</span>
                          <span className="text-white font-mono font-black mt-0.5 text-xs">{dailyGoalAdsCount}</span>
                        </div>
                      </div>

                      <div className="text-center pt-1">
                        {dailyGoalIsClaimedToday ? (
                          <p className="text-emerald-400 text-[11px] font-bold flex items-center justify-center gap-1.5 animate-bounce">
                            <span>🎉 Streak Bonus Unlocked & Claimed Today!</span>
                          </p>
                        ) : dailyGoalRemainingNeeded > 0 ? (
                          <p className="text-slate-400 text-[11px]">
                            Perform <strong className="text-amber-400">{dailyGoalRemainingNeeded}</strong> more action{dailyGoalRemainingNeeded > 1 ? 's' : ''} to unleash!
                          </p>
                        ) : (
                          <p className="text-emerald-400 text-[11px] font-bold animate-pulse">
                            Target achieved! Claim your streak bonus now!
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Action button */}
                    {dailyGoalIsClaimedToday ? (
                      <div className="w-full bg-slate-950 border border-slate-800/80 p-3 rounded-2xl text-center text-slate-500 font-black text-xs uppercase tracking-wider">
                        🎯 Reward Claimed & Streak Saved
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={dailyGoalRemainingNeeded > 0 || claimingDailyGoal}
                        onClick={handleClaimDailyGoalBonus}
                        className={`w-full py-3.5 px-4 rounded-2xl text-xs font-black uppercase tracking-wider transition-all duration-150 shadow-md ${
                          dailyGoalRemainingNeeded === 0
                            ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white cursor-pointer hover:shadow-emerald-500/10 hover:scale-[1.01] active:scale-95'
                            : 'bg-slate-950 border border-slate-800/60 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        {claimingDailyGoal ? (
                          <div className="flex items-center justify-center gap-2">
                             <RefreshCw size={14} className="animate-spin text-white" />
                             <span>Unleashing Bonus...</span>
                          </div>
                        ) : dailyGoalRemainingNeeded > 0 ? (
                          <span>Goal progress incomplete ({dailyGoalTotalCompleted}/2)</span>
                        ) : (
                          <span className="flex items-center justify-center gap-1.5">
                            Claim Daily Streak Bonus (+10,000 FISH) <Trophy size={11} className="animate-bounce" />
                          </span>
                        )}
                      </button>
                    )}
                  </div>

                  {/* AD WRAPPER PANEL */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl">
                        <Play size={22} />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                          <span>Rewarded Ad Breaks</span>
                          <span className="text-[9px] bg-rose-500/10 text-rose-400 border border-rose-500/20 px-1.5 py-0.5 rounded uppercase font-bold">5k coins</span>
                        </h4>
                        <p className="text-xs text-slate-400 mt-1">Watch 5 seconds promo video ad to support app and earn immediate token rewards.</p>
                      </div>
                    </div>
                    <button 
                      disabled={watchingAd}
                      onClick={triggerAdWatch}
                      className="w-full bg-slate-950 border border-slate-800 hover:bg-slate-800/80 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition disabled:opacity-50 text-xs text-rose-400"
                    >
                      {watchingAd ? (
                        <>
                          <RefreshCw size={14} className="animate-spin text-rose-400" />
                          <span>Simulating Ad Stream... (4s)</span>
                        </>
                      ) : (
                        <>
                          <span>Launch Rewarded Video Ad</span>
                          <ChevronRight size={14} />
                        </>
                      )}
                    </button>
                  </div>

                  {/* COPIABLE REFERRALS PROMO CARD */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-lg">
                    <div className="flex items-start gap-3">
                      <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl">
                        <Users size={22} />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-bold text-white uppercase tracking-wide">Invite Friends & Clan</h4>
                        <p className="text-xs text-slate-400 mt-1">Claim 15,000 FISH rewards for successful referrals. Your friends receive 5,000 FISH instantly.</p>
                      </div>
                    </div>

                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
                      <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest leading-none">Your Invitation Link</span>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          readOnly 
                          value={`${window.location.origin}/?startapp=${user?.referralCode || 'OIBB-EARN'}`}
                          className="bg-transparent text-xs text-slate-300 font-mono outline-none flex-1 overflow-hidden truncate pointer-events-none select-all"
                        />
                        <button 
                          onClick={copyReferralLink}
                          className="text-xs font-black text-blue-400 hover:text-blue-300 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          {copied ? <Check size={14} /> : <Copy size={14} />}
                          <span>{copied ? "Copied" : "Copy"}</span>
                        </button>
                      </div>
                    </div>

                    {/* REFERRAL CODE REDEEM INPUT BOX */}
                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
                      <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest leading-none">Claim Referral Welcome Package</span>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          placeholder="EX: OIBB-A1B2C" 
                          value={simRefCode}
                          onChange={(e) => setSimRefCode(e.target.value)}
                          className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-xs font-bold text-slate-200 uppercase outline-none flex-1 max-w-[150px]"
                        />
                        <button 
                          onClick={applyReferral}
                          className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-1 rounded text-xs transition"
                        >
                          Submit
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* REFERRAL PERFORMANCE DASHBOARD */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-lg">
                    <div className="flex items-start gap-3">
                      <div className="p-2.5 bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border border-blue-500/20 text-blue-400 rounded-xl">
                        <Award size={22} className="text-blue-400" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-bold text-white uppercase tracking-wide flex items-center justify-between">
                          <span>Referral Performance</span>
                          <span className="text-[9px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-black uppercase tracking-widest animate-pulse">Live</span>
                        </h4>
                        <p className="text-xs text-slate-400 mt-1">Track key metrics and conversion efficiency of your target invitation link.</p>
                      </div>
                    </div>

                    {/* Summary Stats Grid */}
                    <div className="grid grid-cols-3 gap-2.5 pt-1">
                      <div className="bg-slate-950 border border-slate-800/80 p-3 rounded-2xl text-center">
                        <span className="text-[9px] text-slate-500 uppercase font-black tracking-widest block mb-1">Clicks</span>
                        <span className="text-lg font-black text-blue-400 font-mono">
                          {user?.referralClicks || 0}
                        </span>
                        <p className="text-[8px] text-slate-600 mt-0.5 uppercase font-bold">Link Visits</p>
                      </div>
                      <div className="bg-slate-950 border border-slate-800/80 p-3 rounded-2xl text-center">
                        <span className="text-[9px] text-slate-500 uppercase font-black tracking-widest block mb-1">Signups</span>
                        <span className="text-lg font-black text-emerald-400 font-mono">
                          {user?.referralSignups || 0}
                        </span>
                        <p className="text-[8px] text-slate-600 mt-0.5 uppercase font-bold">Joined</p>
                      </div>
                      <div className="bg-slate-950 border border-slate-800/80 p-3 rounded-2xl text-center">
                        <span className="text-[9px] text-slate-500 uppercase font-black tracking-widest block mb-1">Conv. Rate</span>
                        <span className="text-lg font-black text-amber-400 font-mono">
                          {user?.referralClicks 
                            ? `${((user.referralSignups || 0) / user.referralClicks * 100).toFixed(1)}%`
                            : '0.0%'}
                        </span>
                        <p className="text-[8px] text-slate-600 mt-0.5 uppercase font-bold">Efficiency</p>
                      </div>
                    </div>

                    {/* Custom Progress / Milestone Indicator */}
                    <div className="bg-slate-950 border border-slate-800/80 p-3 rounded-2xl space-y-2">
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="text-slate-400 font-bold uppercase tracking-wider">🌟 Referral Partner Milestone</span>
                        <span className="text-white font-black font-mono">
                          {(user?.referralSignups || 0)} / {Math.max(5, Math.ceil(((user?.referralSignups || 0) + 1) / 5) * 5)}
                        </span>
                      </div>
                      
                      {/* Interactive Progress Bar */}
                      <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800/60">
                        <div 
                          className="bg-gradient-to-r from-blue-500 via-cyan-500 to-emerald-500 h-full rounded-full transition-all duration-500"
                          style={{ 
                            width: `${Math.min(
                              ((user?.referralSignups || 0) / Math.max(5, Math.ceil(((user?.referralSignups || 0) + 1) / 5) * 5)) * 100, 
                              100
                            )}%` 
                          }}
                        />
                      </div>

                      <div className="flex justify-between items-center text-[8px] text-slate-500 uppercase font-black">
                        <span>Tier {Math.floor((user?.referralSignups || 0) / 5) + 1}</span>
                        <span>
                          {Math.max(5, Math.ceil(((user?.referralSignups || 0) + 1) / 5) * 5) - (user?.referralSignups || 0)} more to Tier {Math.floor((user?.referralSignups || 0) / 5) + 2}!
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* GLOBAL REFERRALS LEADERBOARD */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-lg">
                    <div className="flex items-start gap-3">
                      <div className="p-2.5 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 rounded-xl">
                        <Trophy size={22} className="text-yellow-400 animate-pulse" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-bold text-white uppercase tracking-wide">Global Referrals Leaderboard</h4>
                        <p className="text-xs text-slate-400 mt-1">
                          Compete with other managers to secure the top referrer positions on the Barca Earn Network!
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2 mt-4">
                      {loadingLeaderboard ? (
                        <div className="text-center py-6 text-slate-500 text-xs flex items-center justify-center gap-2">
                          <RefreshCw size={14} className="animate-spin text-blue-400" />
                          <span>Syncing global records...</span>
                        </div>
                      ) : leaderboard.length === 0 ? (
                        <div className="text-center py-6 text-slate-500 text-xs border border-dashed border-slate-850 rounded-2xl">
                          No successful referrals recorded yet. Be the first!
                        </div>
                      ) : (
                        leaderboard.map((leader, idx) => {
                          const isCurrentUser = leader.userId === firebaseUser?.uid;
                          // Mask email helper inside the JSX
                          const parts = (leader.email || '').split('@');
                          const maskedEmail = parts.length === 2 
                            ? `${parts[0].substring(0, Math.min(3, parts[0].length))}***@${parts[1]}`
                            : 'Incognito User';
                          return (
                            <div 
                              key={leader.userId}
                              className={`flex items-center justify-between p-3 rounded-2xl border transition-all ${
                                isCurrentUser 
                                  ? 'bg-blue-900/15 border-blue-500/35 shadow-md shadow-blue-500/5' 
                                  : 'bg-slate-950/60 border-slate-855 hover:bg-slate-950/90'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                {/* Rank emblem */}
                                <div className="w-7 h-7 rounded-lg flex items-center justify-center font-black text-xs shrink-0 select-none">
                                  {idx === 0 ? (
                                    <span className="text-lg">🥇</span>
                                  ) : idx === 1 ? (
                                    <span className="text-lg">🥈</span>
                                  ) : idx === 2 ? (
                                    <span className="text-lg">🥉</span>
                                  ) : (
                                    <span className="text-slate-500 font-mono">#{idx + 1}</span>
                                  )}
                                </div>
                                
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-bold text-white truncate max-w-[130px]">
                                      {leader.userName || 'Anonymous'}
                                    </span>
                                    {isCurrentUser && (
                                      <span className="text-[8px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-1 py-0.5 rounded-full uppercase tracking-wider font-extrabold font-mono">
                                        YOU
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[10px] text-slate-500 block truncate font-mono">
                                    {maskedEmail}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                <div className="text-right">
                                  {/* Coin balance indicator */}
                                  <div className="flex items-center gap-0.5 justify-end text-[10px] text-yellow-500 font-bold font-mono">
                                    <span>{leader.coins.toLocaleString()}</span>
                                    <span>🪙</span>
                                  </div>
                                </div>

                                <div className="bg-blue-900/20 border border-blue-500/20 text-blue-400 rounded-full px-2.5 py-1 font-mono font-black text-[10px] shrink-0">
                                  {leader.referralCount} {leader.referralCount === 1 ? 'Refer' : 'Refers'}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* USER LOGGING INFO DATA & FOOTER LOGOUT */}
                  <div className="flex items-center justify-between bg-slate-950/40 p-3 rounded-2xl border border-slate-800/50">
                    <div className="flex items-center gap-2">
                      <UserIcon size={14} className="text-slate-500" />
                      <span className="text-[10px] text-slate-400 truncate max-w-[150px]">ID: {user?.email}</span>
                    </div>

                    <button 
                      onClick={() => {
                        triggerImpact('medium');
                        setShowLogoutConfirm(true);
                      }}
                      className="text-[10px] font-bold text-rose-400 hover:text-red-350 flex items-center gap-1 uppercase transition-colors"
                    >
                      <LogOut size={12} />
                      <span>Log out</span>
                    </button>
                  </div>

                </motion.div>
              )}

              {/* TAB 2: MISSIONS (TASKS & PARTNERS & OFFERWALLS) */}
              {activeTab === 'tasks' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <TasksPage />
                </motion.div>
              )}

              {/* TAB 3: SPONSOR VIDEO WATCH (Monetag, AdsGram, Adexium style) */}
              {activeTab === 'watch' && (
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  className="space-y-6"
                >
                  <header>
                    <span className="text-[10px] bg-red-500/10 border border-red-500/20 text-red-400 px-3 py-1 rounded-full uppercase font-black tracking-widest font-mono">
                      🔴 Sponsored Campaigns Live
                    </span>
                    <h3 className="text-xl font-black text-white mt-1.5 flex items-center gap-1.5 font-sans">
                      <Tv className="text-red-500 animate-pulse" size={20} />
                      <span>{selectedLang === 'am' ? 'የማስታወቂያ ስፖንሰር ዥረት ማዕከል' : selectedLang === 'om' ? 'Daawwannaa Beeksisa Sifaa' : 'Sponsor Ad Streaming Hub'}</span>
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed max-w-md mt-1 font-sans">
                      {selectedLang === 'am' ? 'ፈጣን የFISH ነጥቦችን ለመጠየቅ የስፖንሰር ቪዲዮዎችን ይመልከቱ።' : selectedLang === 'om' ? 'Beeksisa Viidiyoo daawwachuun qorannoo FISH argadhu.' : 'Watch verified premium video campaigns supported by AdsGram, Monetag, and Adexium to claim instant FISH tokens securely.'}
                    </p>
                  </header>

                  {watchingAd ? (
                    <div className="py-12 bg-slate-900 border border-slate-800 rounded-3xl text-center space-y-4 shadow-xl">
                      <div className="relative w-20 h-20 mx-auto">
                        <div className="w-20 h-20 rounded-full border-4 border-red-500/20 border-t-red-500 animate-spin" style={{ animationDuration: '1.2s' }} />
                        <div className="absolute inset-0 flex items-center justify-center font-mono font-black text-lg text-red-400">
                          {countdownTimer}s
                        </div>
                      </div>
                      <div>
                        <h4 className="text-sm font-black text-white">Streaming Sponsored Content...</h4>
                        <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest font-mono">Do not close this application frame</p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-4">
                      {[
                        { id: 'adsgram', name: 'AdsGram Reward Campaign', payout: 5000, desc: 'Recommended video clip, fully compliant with Telegram ads policy.', duration: 15, tag: 'AdsGram Provider', bg: 'from-amber-600/15' },
                        { id: 'monetag', name: 'Monetag Smart In-App Ad', payout: 5000, desc: 'Premium sponsor high-rate video. Earn points immediately after countdown.', duration: 15, tag: 'Monetag SDK', bg: 'from-blue-600/15' },
                        { id: 'adexium', name: 'Adexium Dedicated Banner Sequence', payout: 3500, desc: 'Short promotional static interaction. Easy coins.', duration: 10, tag: 'Adexium Media', bg: 'from-green-600/15' }
                      ].map((ad) => (
                        <div
                          key={ad.id}
                          className={`p-5 rounded-3xl bg-gradient-to-br ${ad.bg} to-slate-950 border border-slate-800 flex items-center justify-between gap-3 shadow-xl`}
                        >
                          <div className="space-y-1.5 max-w-[210px]">
                            <span className="text-[8px] bg-slate-900 border border-slate-800 px-2 py-0.5 rounded text-slate-400 uppercase font-black font-mono">
                              {ad.tag}
                            </span>
                            <h4 className="text-xs font-black text-white">{ad.name}</h4>
                            <p className="text-[10px] text-slate-400 leading-relaxed font-sans">{ad.desc}</p>
                          </div>
                          
                          <button
                            onClick={async () => {
                              if (hapticsOn) {
                                const tg = (window as any).Telegram?.WebApp;
                                if (tg?.HapticFeedback) {
                                  tg.HapticFeedback.impactOccurred('medium');
                                }
                              }
                              setWatchingAd(true);
                              setCountdownTimer(ad.duration);
                              
                              // Tick countdown
                              const intv = setInterval(() => {
                                setCountdownTimer((prev) => {
                                  if (prev <= 1) {
                                    clearInterval(intv);
                                    return 0;
                                  }
                                  return prev - 1;
                                });
                              }, 1000);
                              
                              await new Promise((resolve) => setTimeout(resolve, ad.duration * 1000));
                              clearInterval(intv);
                              
                              try {
                                const response = await secureAdReward(generateFingerprint(), captureClientInfo());
                                if (response.success && auth.currentUser) {
                                  // Live update user profile coins
                                  setUser(p => p ? { ...p, coins: (p.coins || 0) + ad.payout } : null);
                                  
                                  // Update ledger logs in realtime
                                  setLedgerLogs(logs => [
                                    {
                                      id: `log_${Date.now()}`,
                                      type: 'watched_ad',
                                      description: `Earned sponsor rewards for completing ${ad.name} campaign (+${ad.payout.toLocaleString()} $FISH)`,
                                      amount: ad.payout,
                                      createdAt: new Date().toISOString()
                                    },
                                    ...logs
                                  ]);

                                  // sound/confetti
                                  if (hapticsOn) {
                                    const tg = (window as any).Telegram?.WebApp;
                                    if (tg?.HapticFeedback) {
                                      tg.HapticFeedback.notificationOccurred('success');
                                    }
                                  }
                                  
                                  confetti({
                                    particleCount: 80,
                                    spread: 50,
                                    colors: ['#ff003c', '#ff5a00', '#00f6ff']
                                  });
                                  
                                  alert(`🎉 Successfully completed! Verified credit of +${ad.payout.toLocaleString()} $FISH loaded into your account.`);
                                }
                              } catch (e: any) {
                                alert("⚠️ Verification error: " + (e.message || "Please complete standard watch duration first."));
                              } finally {
                                setWatchingAd(false);
                              }
                            }}
                            className="shrink-0 px-4 py-2 bg-red-650 hover:bg-red-600 text-white font-black text-xs rounded-xl transition duration-150 active:scale-95 flex items-center gap-1 cursor-pointer font-sans"
                          >
                            <Play size={10} fill="currentColor" /> Watch
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {/* TAB 4: REFERRALS (DEEP LINKS & ANALYTICS) */}
              {activeTab === 'refer' && (
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  className="space-y-6"
                >
                  <header>
                    <span className="text-[10px] bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 px-3 py-1 rounded-full uppercase font-black tracking-widest font-mono">
                      Invite & Grow Team
                    </span>
                    <h3 className="text-xl font-black text-white mt-1.5">
                      {selectedLang === 'am' ? 'ጓደኞችዎን ይጋብዙ' : selectedLang === 'om' ? 'Hiriyyoota Affeeri' : 'Referral Commission Center'}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Share your unique deep link. Claim 15,000 $FISH rewards for successful referrals and friends receive 5,000 $FISH instantly.
                    </p>
                  </header>

                  <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-4 shadow-xl">
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Your Unique Referral Link</p>
                    <div className="flex gap-2 bg-slate-950 p-2 rounded-2xl border border-slate-850">
                      <input
                        type="text"
                        readOnly
                        value={user?.referralCode ? `${window.location.origin}/?startapp=${user.referralCode}` : 'OIBB-EARN'}
                        className="flex-1 bg-transparent border-none text-xs font-mono text-cyan-400 outline-none px-2"
                      />
                      <button
                        onClick={() => {
                          const refLink = user?.referralCode ? `https://t.me/BarcaearnBot?start=${user.referralCode}` : 'OIBB-EARN';
                          navigator.clipboard.writeText(refLink);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                          if (hapticsOn) {
                            const tg = (window as any).Telegram?.WebApp;
                            tg?.HapticFeedback?.notificationOccurred('success');
                          }
                        }}
                        className="px-3.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-black text-white uppercase tracking-wider flex items-center gap-1 active:scale-95 transition-all text-center"
                      >
                        <Copy size={12} /> {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>

                    <button
                      onClick={() => {
                        const refLink = user?.referralCode ? `https://t.me/BarcaearnBot?start=${user.referralCode}` : 'OIBB-EARN';
                        const tgText = `🚀 Join Barca Earn to complete social tasks and convert FISH to USDT instantly. My invite referral link: ${refLink}`;
                        window.open(`https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(tgText)}`, '_blank');
                        if (hapticsOn) {
                          const tg = (window as any).Telegram?.WebApp;
                          tg?.HapticFeedback?.impactOccurred('medium');
                        }
                      }}
                      className="w-full py-3 rounded-2xl bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-black text-xs uppercase tracking-widest flex items-center justify-center gap-1.5 shadow-lg shadow-blue-500/15"
                    >
                      <Share2 size={12} /> Share directly to Telegram
                    </button>
                  </div>

                  {/* Referral conversion analytics board */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-slate-900 border border-slate-800/80 p-3.5 rounded-2xl text-center">
                      <p className="text-[9px] text-slate-500 font-bold uppercase">Total Clicks</p>
                      <p className="text-xl font-black text-indigo-400 mt-1">{user?.referralClicks || 0}</p>
                    </div>
                    <div className="bg-slate-900 border border-slate-800/80 p-3.5 rounded-2xl text-center">
                      <p className="text-[9px] text-slate-500 font-bold uppercase">Signups</p>
                      <p className="text-xl font-black text-emerald-400 mt-1">{user?.referralSignups || 0}</p>
                    </div>
                    <div className="bg-slate-900 border border-slate-800/80 p-3.5 rounded-2xl text-center">
                      <p className="text-[9px] text-slate-500 font-bold uppercase">Conv. Efficiency</p>
                      <p className="text-xl font-black text-yellow-500 mt-1">
                        {user?.referralClicks ? `${((user.referralSignups || 0) / user.referralClicks * 100).toFixed(0)}%` : '0%'}
                      </p>
                    </div>
                  </div>

                  {/* Milestones levels */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-3 shadow-xl">
                    <h4 className="text-xs font-black text-slate-300 uppercase tracking-wider">Airdrop Milestones Unlocks</h4>
                    <div className="space-y-3">
                      {[
                        { count: 3, reward: 20000, label: 'Ecosystem Junior' },
                        { count: 5, reward: 35000, label: 'Marine Pioneer' },
                        { count: 10, reward: 75000, label: 'Kraken Admiral' }
                      ].map((mile) => {
                        const count = user?.referralSignups || 0;
                        const isDone = count >= mile.count;
                        return (
                          <div key={mile.count} className="p-3 bg-slate-950/60 rounded-xl border border-slate-850 flex items-center justify-between gap-3 text-xs">
                            <div className="space-y-0.5">
                              <span className="font-extrabold text-white text-[11px]">{mile.label}</span>
                              <p className="text-[10px] text-slate-500">Invite {mile.count} registered players</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-mono text-emerald-400 font-extrabold">+{mile.reward.toLocaleString()} FISH</span>
                              <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                                isDone ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-slate-900 border border-slate-800 text-slate-550'
                              }`}>
                                {isDone ? 'Earned' : 'Locked'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* TAB 5: LEADERBOARD PAGE */}
              {activeTab === 'leaderboard' && (
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  className="space-y-6"
                >
                  <header>
                    <span className="text-[10px] bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 px-3 py-1 rounded-full uppercase font-black tracking-widest font-mono">
                      Global Player Rankings
                    </span>
                    <h3 className="text-xl font-black text-white mt-1.5 flex items-center gap-1.5 font-sans">
                      <Trophy className="text-yellow-400" size={20} />
                      <span>{selectedLang === 'am' ? 'የደረጃ ሰንጠረዥ' : selectedLang === 'om' ? 'Koreen Ol-aantummaa' : 'Ecosystem Leaderboard'}</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Highest rank players based on successful invitations and coins mined. Refreshing dynamically every 30 seconds.
                    </p>
                  </header>

                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] text-slate-500 font-bold uppercase">Active Player</span>
                      <span className="text-[10px] text-slate-500 font-bold uppercase font-mono">Referral Rank</span>
                    </div>

                    <div className="space-y-2.5 max-h-[350px] overflow-y-auto pr-1">
                      {loadingLeaderboard ? (
                        <div className="text-center py-10">
                          <div className="w-8 h-8 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin mx-auto" />
                        </div>
                      ) : leaderboard.length === 0 ? (
                        <p className="text-center text-slate-500 py-10 italic text-xs">No ranking players found.</p>
                      ) : (
                        leaderboard.map((lead, idx) => (
                          <div
                            key={lead.userId}
                            className={`p-3.5 rounded-2xl flex items-center justify-between gap-3 text-xs ${
                              lead.userId === firebaseUser?.uid
                                ? 'bg-yellow-500/10 border border-yellow-500/30 font-black shadow shadow-yellow-500/5'
                                : 'bg-slate-950/40 border border-slate-850/40 hover:bg-slate-950 hover:border-slate-800'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <span className={`w-6 h-6 flex items-center justify-center font-black rounded-lg text-[11px] ${
                                idx === 0 ? 'bg-yellow-500 text-black' :
                                idx === 1 ? 'bg-slate-300 text-black' :
                                idx === 2 ? 'bg-amber-600 text-white' :
                                'bg-slate-900 border border-slate-800 text-slate-400'
                              }`}>
                                {idx + 1}
                              </span>
                              <div>
                                <h4 className="text-white font-bold max-w-[120px] truncate">
                                  {lead.userName || lead.email?.split('@')[0] || 'Player_' + lead.userId.substring(0, 4)}
                                </h4>
                                <p className="text-[9px] text-slate-500 font-mono mt-0.5">Miner Tier: {Math.floor(lead.coins / 500000) + 1}</p>
                              </div>
                            </div>

                            <div className="text-right flex flex-col items-end gap-0.5">
                              <span className="font-mono text-[11px] font-black text-yellow-400">
                                {lead.coins?.toLocaleString()} FISH
                              </span>
                              <span className="text-[9px] text-slate-400 font-mono">
                                {lead.referralCount} refers
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* TAB 6: WALLET & CASHOUT */}
              {activeTab === 'wallet' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <WithdrawalPage />
                </motion.div>
              )}

              {/* TAB 7: ACCOUNT LEDGER */}
              {activeTab === 'ledger' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4"
                >
                  <header className="border-b border-slate-850 pb-2">
                    <h3 className="text-md font-bold text-white flex items-center gap-1.5">
                      <Receipt className="text-amber-500" size={18} />
                      <span>Account Transaction Ledger</span>
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-1">Audit trace of all coins claims, watch rewards, conversions, and payouts requested.</p>
                  </header>

                  <div className="space-y-3">
                    {ledgerLogs.length === 0 ? (
                      <div className="text-center p-12 bg-slate-900/50 rounded-2xl border border-slate-800 border-dashed text-slate-500">
                        <Receipt size={28} className="mx-auto text-slate-600 mb-2" />
                        <p className="text-xs font-bold">No entries registered yet.</p>
                        <p className="text-[10px] text-slate-500 mt-1">Claim Daily bonuses or completes social tasks to trace ledger history.</p>
                      </div>
                    ) : (
                      ledgerLogs.map((log) => (
                        <div key={log.id} className="bg-slate-900 border border-slate-850 p-3 rounded-2xl flex items-center justify-between gap-3 shadow transition hover:bg-slate-850">
                          <div>
                            <span className={`text-[9px] uppercase font-mono px-2 py-0.5 rounded-full font-black border tracking-wider ${
                              log.type === 'daily_login' ? 'bg-amber-500/15 text-amber-400 border-amber-500/20' :
                              log.type === 'conversion' ? 'bg-rose-500/15 text-rose-400 border-rose-500/20' :
                              'bg-indigo-500/15 text-indigo-400 border-indigo-500/20'
                            }`}>
                              {log.type}
                            </span>
                            <p className="text-[11px] font-bold text-white mt-2 leading-tight">{log.description || 'Ledger credit transfer'}</p>
                            <p className="text-[9px] text-slate-500 mt-1">{new Date(log.createdAt).toLocaleString()}</p>
                          </div>
                          
                          <div className="text-right">
                            <span className={`text-xs font-mono font-extrabold ${log.amount < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                              {log.amount > 0 ? '+' : ''}{log.amount.toLocaleString()} $FISH
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </motion.div>
              )}

              {/* TAB 8: SETTINGS & LOCALIZATIONS */}
              {activeTab === 'settings' && (
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  className="space-y-6"
                >
                  <header>
                    <span className="text-[10px] bg-slate-800 border border-slate-700 text-slate-350 px-3 py-1 rounded-full uppercase font-black tracking-widest font-mono">
                      Personalize Config
                    </span>
                    <h3 className="text-xl font-black text-white mt-1.5 flex items-center gap-1.5">
                      <Settings className="text-slate-400 rotate-45" size={20} />
                      <span>{selectedLang === 'am' ? 'ማስተካከያዎች' : selectedLang === 'om' ? 'Gubloo Sirna' : 'General Settings'}</span>
                    </h3>
                  </header>

                  {/* Languages Selector */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
                    <h4 className="text-xs font-black text-slate-300 uppercase tracking-wider">Language Selection (ቋንቋ ይምረጡ)</h4>
                    <div className="grid grid-cols-3 gap-2.5">
                      {[
                        { id: 'en', label: 'English' },
                        { id: 'am', label: 'አማርኛ (Amharic)' },
                        { id: 'om', label: 'Oromoo (Oromiffa)' }
                      ].map((lang) => (
                        <button
                          key={lang.id}
                          onClick={() => {
                            setSelectedLang(lang.id as any);
                            if (hapticsOn) {
                              const tg = (window as any).Telegram?.WebApp;
                              tg?.HapticFeedback?.impactOccurred('medium');
                            }
                          }}
                          className={`py-3.5 rounded-2xl border text-center font-bold text-xs transition duration-150 active:scale-95 cursor-pointer ${
                            selectedLang === lang.id
                              ? 'bg-gradient-to-br from-blue-600 to-indigo-650 border-transparent text-white shadow shadow-blue-500/10'
                              : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          {lang.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Haptic & Audio Switches */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
                    <h4 className="text-xs font-black text-slate-300 uppercase tracking-wider">Hardware Feedback Controls</h4>
                    
                    <div className="flex items-center justify-between p-3 bg-slate-950/40 rounded-2xl border border-slate-850">
                      <div>
                        <span className="text-xs font-bold text-slate-200">Telegram WebApp Haptics</span>
                        <p className="text-[10px] text-slate-500 leading-relaxed">Execute instant tactile vibrations on claims and approvals.</p>
                      </div>
                      <button
                        onClick={() => {
                          setHapticsOn(!hapticsOn);
                          const tg = (window as any).Telegram?.WebApp;
                          if (!hapticsOn && tg?.HapticFeedback) {
                            tg.HapticFeedback.impactOccurred('medium');
                          }
                        }}
                        className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${
                          hapticsOn ? 'bg-blue-600' : 'bg-slate-800'
                        }`}
                      >
                        <motion.div
                          layout
                          className="bg-white w-4.5 h-4.5 rounded-full shadow-md"
                          animate={{ x: hapticsOn ? 20 : 0 }}
                        />
                      </button>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-slate-950/40 rounded-2xl border border-slate-850">
                      <div>
                        <span className="text-xs font-bold text-slate-200">Audalert Audio Signals</span>
                        <p className="text-[10px] text-slate-500 leading-relaxed">Trigger alert bells on major points transactions credits.</p>
                      </div>
                      <button
                        onClick={() => {
                          setAudioOn(!audioOn);
                          if (hapticsOn) {
                            const tg = (window as any).Telegram?.WebApp;
                            tg?.HapticFeedback?.impactOccurred('light');
                          }
                        }}
                        className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${
                          audioOn ? 'bg-blue-600' : 'bg-slate-800'
                        }`}
                      >
                        <motion.div
                          layout
                          className="bg-white w-4.5 h-4.5 rounded-full shadow-md"
                          animate={{ x: audioOn ? 20 : 0 }}
                        />
                      </button>
                    </div>
                  </div>

                  {/* FAQ Accordion */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-3">
                    <h4 className="text-xs font-black text-slate-300 uppercase tracking-wider">Help Desk & FAQs</h4>
                    {[
                      { q: 'What is the constant conversion exchange rate?', a: 'Converting rate is fixed at 10,000 FISH = $1.00 USDT. Your points are fully liquid.' },
                      { q: 'Which cash out channels are fully supported?', a: 'Withdraw immediately using TON Wallet, Binance UID, Bybit UID, USDT TRC20, USDT BEP20, Telebirr and principal Ethiopian Bank transfers.' },
                      { q: 'Why did my withdrawal request score a warning?', a: 'Our automated machine auditor scans your device profile fingerprint. Multiple accounts on a single host trigger a fraud warning flag.' }
                    ].map((faq, i) => (
                      <div key={i} className="p-3.5 bg-slate-950/40 rounded-2xl border border-slate-850 space-y-1 text-xs">
                        <span className="font-black text-white flex items-center gap-1">❓ {faq.q}</span>
                        <p className="text-[10px] text-slate-400 leading-relaxed font-sans mt-1 pl-3.5 border-l border-slate-800">{faq.a}</p>
                      </div>
                    ))}
                  </div>

                  {/* ADMIN BACKDOOR DIRECTORY */}
                  {isAdminUser && (
                    <div className="bg-cyan-950/20 border border-cyan-505/30 rounded-3xl p-5 shadow-xl text-center space-y-3">
                      <span className="text-xl">🛡️</span>
                      <h4 className="text-xs font-black text-cyan-400 tracking-wider uppercase">Admin Control Terminal</h4>
                      <p className="text-[10px] text-slate-400 leading-relaxed font-sans">Authorized developer profile detected. Override normal permissions to verify withdrawals and edit campaigns.</p>
                      <button
                        onClick={() => {
                          if (hapticsOn) {
                            const tg = (window as any).Telegram?.WebApp;
                            tg?.HapticFeedback?.impactOccurred('medium');
                          }
                          setActiveTab('admin');
                        }}
                        className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-black text-xs uppercase tracking-wider transition duration-150 active:scale-95 cursor-pointer font-sans"
                      >
                        Launch Administrator Panel
                      </button>
                    </div>
                  )}
                </motion.div>
              )}

              {/* TAB 9: ADMIN PANEL */}
              {activeTab === 'admin' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <AdminPanel />
                </motion.div>
              )}

            </AnimatePresence>
          )}

        </div>

        {/* BOTTOM NAVIGATION SYSTEM PERSISTENT BAR */}
        {firebaseUser && (
          <footer className="absolute bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-800/80 px-1 py-2 grid grid-cols-6 gap-0.5 shadow-2xl backdrop-blur-md z-45">
            <button 
              onClick={() => {
                triggerSelectionChange();
                setActiveTab('home');
              }}
              className={`flex flex-col items-center justify-center gap-1 transition-colors py-1 ${activeTab === 'home' ? 'text-blue-400 font-extrabold' : 'text-slate-400 hover:text-slate-100'}`}
            >
              <Zap size={16} />
              <span className="text-[8px] font-bold tracking-tight">Hub</span>
            </button>

            <button 
              onClick={() => {
                triggerSelectionChange();
                setActiveTab('tasks');
              }}
              className={`flex flex-col items-center justify-center gap-1 transition-colors py-1 ${activeTab === 'tasks' ? 'text-blue-400 font-extrabold' : 'text-slate-400 hover:text-slate-100'}`}
            >
              <Award size={16} />
              <span className="text-[8px] font-bold tracking-tight">Missions</span>
            </button>

            <button 
              onClick={() => {
                triggerSelectionChange();
                setActiveTab('watch');
              }}
              className={`flex flex-col items-center justify-center gap-1 transition-colors py-1 ${activeTab === 'watch' ? 'text-red-400 font-extrabold' : 'text-slate-400 hover:text-slate-100'}`}
            >
              <Tv size={16} className={activeTab === 'watch' ? 'animate-bounce' : ''} />
              <span className="text-[8px] font-bold tracking-tight">Ads</span>
            </button>

            <button 
              onClick={() => {
                triggerSelectionChange();
                setActiveTab('refer');
              }}
              className={`flex flex-col items-center justify-center gap-1 transition-colors py-1 ${activeTab === 'refer' ? 'text-blue-400 font-extrabold' : 'text-slate-400 hover:text-slate-100'}`}
            >
              <Users size={16} />
              <span className="text-[8px] font-bold tracking-tight">Refer</span>
            </button>

            <button 
              onClick={() => {
                triggerSelectionChange();
                setActiveTab('wallet');
              }}
              className={`flex flex-col items-center justify-center gap-1 transition-colors py-1 ${activeTab === 'wallet' ? 'text-blue-400 font-extrabold' : 'text-slate-400 hover:text-slate-100'}`}
            >
              <Wallet size={16} />
              <span className="text-[8px] font-bold tracking-tight">Wallet</span>
            </button>

            <button 
              onClick={() => {
                triggerSelectionChange();
                // If they are an admin, clicking more can immediately show settings but with an admin floating link
                setActiveTab('settings');
              }}
              className={`flex flex-col items-center justify-center gap-1 transition-colors py-1 ${activeTab === 'settings' ? 'text-blue-400 font-extrabold' : 'text-slate-400 hover:text-slate-100'}`}
            >
              <Settings size={16} />
              <span className="text-[8px] font-bold tracking-tight">Settings</span>
            </button>
          </footer>
        )}

        {/* Custom Logout Confirmation Modal */}
        <AnimatePresence>
          {showLogoutConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 font-sans"
            >
              <motion.div
                initial={{ scale: 0.95, y: 20, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                exit={{ scale: 0.95, y: 20, opacity: 0 }}
                transition={{ type: "spring", duration: 0.4 }}
                className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl max-w-sm w-full relative overflow-hidden"
              >
                {/* Top gradient highlight strip */}
                <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-red-500 via-rose-500 to-orange-500" />
                
                <div className="space-y-6 pt-2">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-rose-500/15 text-rose-400 border border-rose-500/20 rounded-2xl">
                      <LogOut size={24} className="animate-pulse" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white">Sign Out</h3>
                      <p className="text-xs text-slate-400">Confirm you want to log out of your session.</p>
                    </div>
                  </div>

                  <div className="bg-slate-950 border border-slate-800/60 rounded-2xl p-4 space-y-3">
                    <p className="text-xs text-slate-300 leading-normal">
                      You'll need to authenticate again using Google or Telegram credentials to access your balance, active referral campaigns, and tasks.
                    </p>
                  </div>

                  {/* Confirm & Cancel Actions */}
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        triggerImpact('light');
                        setShowLogoutConfirm(false);
                      }}
                      className="py-3 px-4 rounded-xl border border-slate-800 text-xs font-black uppercase tracking-wider text-slate-400 hover:text-white hover:bg-slate-800/40 transition-all cursor-pointer text-center"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        triggerNotification('success');
                        setShowLogoutConfirm(false);
                        signOut(auth);
                      }}
                      className="py-3 px-4 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-black uppercase tracking-wider shadow-lg shadow-red-500/10 transition-transform active:scale-95 cursor-pointer text-center"
                    >
                      Log Out
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Custom Firebase Domain Alignment Dialog */}
        <AnimatePresence>
          {showDomainConfigModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-55 flex items-center justify-center p-4 overflow-y-auto font-sans"
            >
              <motion.div
                initial={{ scale: 0.95, y: 20, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                exit={{ scale: 0.95, y: 20, opacity: 0 }}
                transition={{ type: "spring", duration: 0.4 }}
                className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl max-w-md w-full relative overflow-hidden my-8"
              >
                {/* Top dynamic status line */}
                <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-500 via-[#2481cc] to-indigo-600" />
                
                <div className="space-y-5 pt-2">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-2xl">
                      <AlertTriangle size={24} className="animate-bounce" />
                    </div>
                    <div>
                      <h3 className="text-base font-black text-white">Domain Authorization Needed</h3>
                      <p className="text-[11px] text-slate-400">Firebase has blocked the Google OAuth flow because this sandbox host URL is unregistered.</p>
                    </div>
                  </div>

                  <div className="bg-slate-950/85 border border-slate-800/80 rounded-2xl p-4 space-y-3">
                    <span className="text-[10px] font-black tracking-widest text-[#2481cc] uppercase font-mono">1-Minute Quick Resolution:</span>
                    <ol className="text-[11.5px] text-slate-300 space-y-2 list-decimal list-inside leading-relaxed">
                      <li>
                        Open your <a 
                          href="https://console.firebase.google.com/project/application-creation-71a9e/authentication/providers" 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="text-blue-400 hover:text-blue-350 underline inline-flex items-center gap-0.5 font-bold"
                        >
                          Firebase Console Auth settings <ExternalLink size={10} />
                        </a>
                      </li>
                      <li>Select the <strong className="text-white">Settings</strong> tab at the top.</li>
                      <li>Click <strong className="text-white">Authorized domains</strong> in the sidebar.</li>
                      <li>Click <strong className="text-white">Add domain</strong> and add both host URLs listed below:</li>
                    </ol>
                  </div>

                  <div className="space-y-2">
                    <span className="text-[9px] font-black uppercase text-slate-400 font-mono tracking-wider">Domains to register in Firebase:</span>
                    {[
                      'ais-dev-xg2iazg43p27ayvfndt54m-132519772023.europe-west3.run.app',
                      'ais-pre-xg2iazg43p27ayvfndt54m-132519772023.europe-west3.run.app'
                    ].map((domain) => (
                      <div key={domain} className="flex items-center justify-between bg-slate-950 border border-slate-800/60 rounded-xl px-3 py-2">
                        <span className="font-mono text-[10px] text-slate-355 select-all overflow-hidden text-ellipsis mr-2">{domain}</span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(domain);
                            setCopiedDomain(domain);
                            triggerNotification('success');
                            setTimeout(() => setCopiedDomain(null), 2000);
                          }}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all border ${
                            copiedDomain === domain 
                              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                              : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          {copiedDomain === domain ? (
                            <>
                              <Check size={9} />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy size={9} />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Actions buttons */}
                  <div className="flex flex-col gap-2 pt-2">
                    <button
                      type="button"
                      onClick={handleDemoSessionLogin}
                      className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-blue-500 via-[#2481cc] to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white text-xs font-black uppercase tracking-wider shadow-lg shadow-blue-500/10 transition-transform active:scale-95 cursor-pointer text-center"
                    >
                      Bypass & Start Simulated App Session
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        triggerImpact('light');
                        setShowDomainConfigModal(false);
                      }}
                      className="w-full py-2.5 px-4 rounded-xl border border-slate-800 text-xs font-black uppercase tracking-wider text-slate-400 hover:text-white hover:bg-slate-800/40 transition-all cursor-pointer text-center"
                    >
                      Close Instructions
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center">
        <AppContent />
      </div>
    </Router>
  );
}

export default App;
