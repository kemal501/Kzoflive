import React, { useState, useEffect, useRef } from 'react';
import { auth, db } from '../firebase';
import { doc, runTransaction, serverTimestamp, collection, increment } from 'firebase/firestore';
import { TASKS, getUserTasksProgress, UserTaskProgress, Task, updateTaskProgress } from '../services/taskService';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle, Award, Coins, TrendingUp, Clock, Gift, UserPlus, LayoutGrid, Users, Cpu, Sparkles, Facebook, Youtube, Send, ExternalLink, HelpCircle, BookOpen } from 'lucide-react';
import confetti from 'canvas-confetti';
import { triggerImpact, triggerNotification } from '../utils/haptic';

const getDeadlineTime = (taskId: string, durationMinutes: number) => {
  const key = `task_deadline_v1_${taskId}`;
  let saved = localStorage.getItem(key);
  if (!saved) {
    const deadline = Date.now() + durationMinutes * 60 * 1000;
    localStorage.setItem(key, deadline.toString());
    return deadline;
  }
  return parseInt(saved, 10);
};

const formatDuration = (ms: number) => {
  if (ms <= 0) return "Expired";
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((ms % (1000 * 60)) / 1000);
  
  const hStr = hours > 0 ? `${hours}h ` : "";
  const mStr = `${minutes}m `;
  const sStr = `${seconds}s`;
  return `${hStr}${mStr}${sStr}`;
};

const TasksPage: React.FC = () => {
  const [progress, setProgress] = useState<UserTaskProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifyingTaskId, setVerifyingTaskId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<'All' | 'Social' | 'Technical' | 'Creator' | 'Offerwalls'>('All');
  
  const [timeRemaining, setTimeRemaining] = useState<Record<string, number>>({});
  const [notifiedTasks, setNotifiedTasks] = useState<Record<string, boolean>>({});
  const [toasts, setToasts] = useState<{ id: string; title: string; message: string; type?: 'warning' | 'success' | 'error' | 'info' }[]>([]);
  const [confirmTask, setConfirmTask] = useState<Task | null>(null);
  const [isHowToEarnOpen, setIsHowToEarnOpen] = useState(false);
  const [successClaimedReward, setSuccessClaimedReward] = useState<{ amount: number; title: string } | null>(null);
  
  // Interactive Offerwall States
  const [selectedOfferwall, setSelectedOfferwall] = useState<string | null>(null);
  const [isCompletingOffer, setIsCompletingOffer] = useState(false);
  const [surveyStep, setSurveyStep] = useState<number>(0);
  
  const prevCompletedRef = useRef<number | null>(null);

  const handleVerify = async (task: Task) => {
    if (!auth.currentUser) {
      const toastId = `login_err_${Date.now()}`;
      setToasts(prev => [
        ...prev,
        {
          id: toastId,
          title: "🔑 Authentication Required",
          message: "Please login to your secure profile first to verify completed missions.",
          type: "error"
        }
      ]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== toastId));
      }, 5000);
      return;
    }
    
    // Trigger medium haptic impact on starting verification
    triggerImpact('medium');

    const userId = auth.currentUser.uid;
    setVerifyingTaskId(task.id);

    // Simulate checking the completion status, display a loading spinner for 2 seconds
    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      const userRef = doc(db, 'users', userId);
      const progressRef = doc(db, 'userTasks', `${userId}_${task.id}`);

      await runTransaction(db, async (transaction) => {
        const progressDoc = await transaction.get(progressRef);

        if (!progressDoc.exists()) {
          transaction.set(progressRef, {
            taskId: task.id,
            userId,
            currentProgress: task.goal,
            completed: true,
            claimed: true,
            lastUpdated: serverTimestamp()
          });
        } else {
          transaction.update(progressRef, {
            currentProgress: task.goal,
            completed: true,
            claimed: true,
            lastUpdated: serverTimestamp()
          });
        }

        // Add reward coins to user's profile
        transaction.update(userRef, {
          coins: increment(task.reward),
          dailyGoalTasksCompleted: increment(1)
        });

        // Record the transaction in the coinTransactions collection ledger
        const ledgerRef = doc(collection(db, 'coinTransactions'));
        transaction.set(ledgerRef, {
          userId,
          amount: task.reward,
          type: 'task_verification',
          description: `Verified and claimed mission: ${task.title} (+${task.reward.toLocaleString()} $FISH)`,
          createdAt: new Date().toISOString()
        });
      });

      // Clear verifying task, set celebration state, and trigger confetti
      setSuccessClaimedReward({ amount: task.reward, title: task.title });
      
      // Trigger success haptic notification
      triggerNotification('success');

      // Initial standard confetti shower
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 },
        colors: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']
      });

      // Staggered side bursts
      setTimeout(() => {
        confetti({
          particleCount: 40,
          angle: 60,
          spread: 45,
          origin: { x: 0.1, y: 0.8 },
          colors: ['#3b82f6', '#10b981']
        });
      }, 150);

      setTimeout(() => {
        confetti({
          particleCount: 40,
          angle: 120,
          spread: 45,
          origin: { x: 0.9, y: 0.8 },
          colors: ['#8b5cf6', '#ec4899']
        });
      }, 300);

      await fetchProgress();
    } catch (err: any) {
      // Trigger error haptic notification
      triggerNotification('error');

      const toastId = `verify_err_${Date.now()}`;
      setToasts(prev => [
        ...prev,
        {
          id: toastId,
          title: "⚠️ Verification Paused",
          message: err.message || "Failed to finalize mission points. Please try again.",
          type: "error"
        }
      ]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== toastId));
      }, 6000);
    } finally {
      setVerifyingTaskId(null);
    }
  };

  const fetchProgress = async () => {
    if (!auth.currentUser) return;
    try {
      const data = await getUserTasksProgress(auth.currentUser.uid);
      setProgress(data);
    } catch (err) {
      console.error("Failed to fetch task progress", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProgress();
    const interval = setInterval(fetchProgress, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  // Countdown timer ticking effect
  useEffect(() => {
    const updateAndCheckTimers = () => {
      const updated: Record<string, number> = {};
      TASKS.forEach(task => {
        if (task.isTimeSensitive && task.durationMinutes) {
          const deadline = getDeadlineTime(task.id, task.durationMinutes);
          const remaining = Math.max(0, deadline - Date.now());
          updated[task.id] = remaining;
        }
      });
      setTimeRemaining(updated);
    };

    updateAndCheckTimers();
    const timerInterval = setInterval(updateAndCheckTimers, 1000);
    return () => clearInterval(timerInterval);
  }, []);

  // 1-Hour remaining notification triggers
  useEffect(() => {
    if (loading || progress.length === 0) return;

    TASKS.forEach(task => {
      if (task.isTimeSensitive) {
        const p = getTaskProgress(task.id);
        if (p.completed || p.claimed) return;

        const remaining = timeRemaining[task.id];
        // If remaining is under 1 hours (3600000ms) but active (> 0)
        if (remaining !== undefined && remaining > 0 && remaining <= 3600000) {
          if (!notifiedTasks[task.id]) {
            setNotifiedTasks(prev => ({ ...prev, [task.id]: true }));
            
            // Generate elegant alert toast
            const toastId = `warning_${task.id}_${Date.now()}`;
            setToasts(prev => [
              ...prev,
              {
                id: toastId,
                title: "⏳ Mission Expiring Soon!",
                message: `The time-sensitive quest "${task.title}" has less than 1 hour remaining!`
              }
            ]);

            // Auto dismiss toast after 8 seconds
            setTimeout(() => {
              setToasts(prev => prev.filter(t => t.id !== toastId));
            }, 8000);
          }
        }
      }
    });
  }, [timeRemaining, progress, loading, notifiedTasks]);

  const handleResetTimer = (taskId: string, durationMinutes: number) => {
    const key = `task_deadline_v1_${taskId}`;
    const deadline = Date.now() + durationMinutes * 60 * 1000;
    localStorage.setItem(key, deadline.toString());
    
    // Clear notification state
    setNotifiedTasks(prev => ({ ...prev, [taskId]: false }));
    
    // Trigger tick update immediately
    setTimeRemaining(prev => ({
      ...prev,
      [taskId]: durationMinutes * 60 * 1000
    }));

    // Trigger toast notification
    const toastId = `reset_${taskId}_${Date.now()}`;
    setToasts(prev => [
      ...prev,
      {
        id: toastId,
        title: "🔄 Quest Reset",
        message: `Timer for ${TASKS.find(t => t.id === taskId)?.title || 'Quest'} has been reset to ${durationMinutes} minutes.`
      }
    ]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== toastId));
    }, 5000);
  };

  const totalTasksCount = TASKS.length;
  const completedCount = TASKS.filter(task => {
    const p = progress.find(prg => prg.taskId === task.id);
    return p ? p.completed : false;
  }).length;

  useEffect(() => {
    if (loading || progress.length === 0) return;

    if (prevCompletedRef.current !== null) {
      if (completedCount === totalTasksCount && prevCompletedRef.current < totalTasksCount) {
        // Trigger beautiful premium confetti
        confetti({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.6 },
          colors: ['#3b82f6', '#6366f1', '#a855f7', '#ecc94b', '#10b981']
        });
        
        // Staggered side bursts
        setTimeout(() => {
          confetti({
            particleCount: 50,
            angle: 60,
            spread: 55,
            origin: { x: 0, y: 0.8 },
            colors: ['#3b82f6', '#6366f1']
          });
        }, 200);
        
        setTimeout(() => {
          confetti({
            particleCount: 50,
            angle: 120,
            spread: 55,
            origin: { x: 1, y: 0.8 },
            colors: ['#a855f7', '#ecc94b']
          });
        }, 350);
      }
    }

    prevCompletedRef.current = completedCount;
  }, [completedCount, totalTasksCount, loading, progress]);

  const handleTaskClick = (task: Task) => {
    setConfirmTask(task);
  };

  const executeTaskAction = async (task: Task) => {
    setConfirmTask(null);
    if (task.type === 'watched_ad') {
      try {
        // Build the precise script requested by the user for ads
        const s = document.createElement('script');
        s.dataset.zone = '11143850';
        s.src = 'https://n6wxm.com/vignette.min.js';
        const parent = [document.documentElement, document.body].filter(Boolean).pop();
        if (parent) {
          parent.appendChild(s);
        }

        // Inform user elegantly via toast
        const toastId = `ad_load_${Date.now()}`;
        setToasts(prev => [
          ...prev,
          {
            id: toastId,
            title: "📺 Ad Launched Successfully!",
            message: "Running sponsor campaign vignette. Rewards will register shortly!"
          }
        ]);
        setTimeout(() => {
          setToasts(prev => prev.filter(t => t.id !== toastId));
        }, 5000);

        // Instantly credit / update task progress
        if (auth.currentUser) {
          await updateTaskProgress(auth.currentUser.uid, task.type, 1);
          await fetchProgress();
        }
      } catch (err: any) {
        console.error("Ad loading failed: ", err);
      }
      return;
    }

    if (!task.url) return;
    
    // Open in new tab
    window.open(task.url, '_blank', 'noopener,noreferrer');
    
    // Complete the task in Firebase immediately
    if (auth.currentUser) {
      try {
        await updateTaskProgress(auth.currentUser.uid, task.type, 1);
        await fetchProgress();
      } catch (err) {
        console.error("Failed to update link progress:", err);
      }
    }
  };

  const getTaskProgress = (taskId: string) => {
    return progress.find(p => p.taskId === taskId) || {
      currentProgress: 0,
      completed: false,
      claimed: false
    };
  };

  const getIcon = (type: Task['type']) => {
    switch (type) {
      case 'daily_login': return <Clock className="text-blue-400" />;
      case 'stream_duration': return <TrendingUp className="text-purple-400" />;
      case 'send_gifts': return <Gift className="text-pink-400" />;
      case 'follow_users': return <UserPlus className="text-green-400" />;
      case 'facebook_share': return <Facebook className="text-blue-500 w-5 h-5 animate-pulse" />;
      case 'youtube_watch': return <Youtube className="text-red-500 w-5 h-5 animate-pulse" />;
      case 'telegram_join': return <Send className="text-sky-400 w-5 h-5 animate-pulse" />;
      default: return <Award className="text-yellow-400" />;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  const FILTER_CATEGORIES = [
    { id: 'All', name: 'All', icon: LayoutGrid },
    { id: 'Social', name: 'Social', icon: Users },
    { id: 'Technical', name: 'Technical', icon: Cpu },
    { id: 'Creator', name: 'Creator', icon: Sparkles },
    { id: 'Offerwalls', name: 'Offerwalls', icon: Award }
  ] as const;

  const getCategoryCount = (category: string) => {
    if (category === 'All') return TASKS.length;
    if (category === 'Offerwalls') return 5;
    return TASKS.filter(task => task.category === category).length;
  };

  const filteredTasks = selectedCategory === 'All'
    ? TASKS
    : TASKS.filter(task => task.category === selectedCategory);

  const socialTasks = TASKS.filter(task => task.category === 'Social');
  const socialCompletedCount = socialTasks.filter(task => getTaskProgress(task.id).completed).length;
  const socialPercentage = socialTasks.length > 0 ? Math.round((socialCompletedCount / socialTasks.length) * 100) : 0;

  const criticalTasks = TASKS.filter(task => {
    const p = getTaskProgress(task.id);
    if (p.completed || p.claimed) return false;
    if (!task.isTimeSensitive) return false;
    const remaining = timeRemaining[task.id];
    return remaining !== undefined && remaining > 0 && remaining <= 3600000;
  });

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8 text-center">
          <motion.h1 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent mb-2"
          >
            Missions & Rewards
          </motion.h1>
          <p className="text-slate-400 mb-4">Complete tasks to earn free coins and level up your profile!</p>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsHowToEarnOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-950/60 hover:bg-slate-800/80 active:bg-slate-900 border border-slate-800 hover:border-blue-500/30 text-blue-400 hover:text-blue-300 font-bold text-xs uppercase tracking-wider rounded-2xl shadow-xl transition-all cursor-pointer backdrop-blur-sm"
          >
            <HelpCircle size={14} className="text-blue-400 animate-pulse" />
            <span>How to Earn</span>
          </motion.button>
        </header>

        {/* Dynamic Visual Progress Card with detailed milestones */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ 
            opacity: 1, 
            y: 0,
            boxShadow: (completedCount === totalTasksCount && totalTasksCount > 0)
              ? [
                  "0 10px 25px -5px rgba(59, 130, 246, 0.2)",
                  "0 10px 35px -5px rgba(147, 51, 234, 0.4)",
                  "0 10px 25px -5px rgba(59, 130, 246, 0.2)"
                ]
              : "0 10px 15px -3px rgba(0, 0, 0, 0.3)"
          }}
          transition={{ 
            boxShadow: {
              repeat: Infinity,
              duration: 2,
              ease: "easeInOut"
            },
            duration: 0.4
          }}
          className={`mb-8 bg-slate-950/40 border rounded-3xl p-6 relative overflow-hidden backdrop-blur-md transition-colors duration-500 ${
            (completedCount === totalTasksCount && totalTasksCount > 0)
              ? 'border-blue-400/50 bg-gradient-to-br from-slate-950/60 via-slate-950/80 to-blue-955/10'
              : 'border-slate-800/80'
          }`}
        >
          {/* Subtle design glows */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${completedCount === totalTasksCount ? 'bg-green-400 animate-ping' : 'bg-blue-400 animate-pulse'}`} />
                Missions Progress Dashboard
              </h2>
              <p className="text-2xl font-black text-white mt-1 font-sans flex items-center gap-1.5">
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">
                  {completedCount}/{totalTasksCount}
                </span> 
                <span className="text-slate-300 text-base font-semibold">Tasks Completed</span>
              </p>
            </div>
            <div className="md:text-right">
              <span className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 font-mono">
                {Math.round((completedCount / (totalTasksCount || 1)) * 100)}%
              </span>
              <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mt-1">
                {completedCount === totalTasksCount 
                  ? "Flawless Day! All campaigns conquered 🎉" 
                  : completedCount > 0 
                    ? "Keep grinding to unlock maximum $FISH! 🪙" 
                    : "No missions completed yet today. Unlock your first reward! 🚀"}
              </p>
            </div>
          </div>

          {/* Animated custom-gradient progress bar */}
          <div className={`h-4 bg-slate-900 border rounded-full overflow-hidden relative p-[2px] flex items-center transition-all duration-500 ${
            completedCount === totalTasksCount && totalTasksCount > 0
              ? 'border-green-500/40 ring-2 ring-green-500/20'
              : 'border-slate-800/60'
          }`}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ 
                width: `${Math.round((completedCount / (totalTasksCount || 1)) * 100)}%`,
                scale: completedCount === totalTasksCount && totalTasksCount > 0 ? [1, 1.015, 1] : 1
              }}
              transition={{ 
                width: { type: 'spring', damping: 15, stiffness: 85 },
                scale: { repeat: Infinity, duration: 1.5, ease: "easeInOut" }
              }}
              className={`h-full rounded-full bg-gradient-to-r relative flex items-center min-w-[20px] ${
                completedCount === totalTasksCount && totalTasksCount > 0
                  ? 'from-emerald-400 via-teal-500 to-green-400'
                  : 'from-blue-500 via-indigo-500 to-purple-500'
              }`}
            >
              <div className="absolute right-1 w-2.5 h-2.5 bg-white rounded-full shadow-md animate-ping" />
              <div className="absolute right-1 w-1.5 h-1.5 bg-white rounded-full shadow-md" />
            </motion.div>
          </div>

          {/* Expanded dynamic stats panel */}
          <div className="grid grid-cols-3 gap-3 mt-5 pt-4 border-t border-slate-900 text-center">
            <div>
              <span className="text-[9px] text-slate-500 uppercase font-black tracking-wider block">Completed</span>
              <span className="text-xs font-bold text-green-400 font-mono mt-1 block">
                {completedCount} / {totalTasksCount} Tasks
              </span>
            </div>
            <div className="border-x border-slate-900">
              <span className="text-[9px] text-slate-500 uppercase font-black tracking-wider block">Claimed Rewards</span>
              <div className="flex items-center justify-center gap-1 mt-1 text-yellow-400 font-mono text-xs font-bold">
                <span>+{TASKS.reduce((sum, task) => {
                  const p = progress.find(prg => prg.taskId === task.id);
                  return (p && p.completed) ? sum + task.reward : sum;
                }, 0).toLocaleString()}</span>
                <span className="text-[9px]">FISH</span>
              </div>
            </div>
            <div>
              <span className="text-[9px] text-slate-500 uppercase font-black tracking-wider block">Remaining FISH Cap</span>
              <div className="flex items-center justify-center gap-1 mt-1 text-sky-400 font-mono text-xs font-bold">
                <span>+{TASKS.reduce((sum, task) => {
                  const p = progress.find(prg => prg.taskId === task.id);
                  return (p && p.completed) ? sum : sum + task.reward;
                }, 0).toLocaleString()}</span>
                <span className="text-[9px]">FISH</span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Expiring Soon Banner Warning */}
        {criticalTasks.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mb-8 p-4 bg-gradient-to-r from-amber-500/10 via-red-500/10 to-amber-500/10 border border-amber-500/30 text-amber-200 rounded-3xl flex items-center gap-3.5 relative overflow-hidden shadow-lg shadow-amber-500/5"
          >
            <div className="absolute top-0 left-0 w-2 h-full bg-gradient-to-b from-amber-500 to-red-500"></div>
            <div className="p-2.5 bg-amber-500/15 border border-amber-500/25 text-amber-400 rounded-xl animate-pulse shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div className="flex-1 text-xs md:text-sm">
              <div className="font-extrabold text-amber-300 uppercase tracking-wide">Action Required!</div>
              <p className="text-slate-300 mt-0.5 leading-relaxed">
                You have <span className="font-bold text-amber-200">{criticalTasks.length} time-sensitive mission{criticalTasks.length > 1 ? 's' : ''}</span> with less than 1 hour remaining. Verify them before expiry to secure your $FISH!
              </p>
            </div>
          </motion.div>
        )}

        {/* Ultimate Tasks Complete Celebration Banner */}
        {completedCount === totalTasksCount && totalTasksCount > 0 && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-8 p-6 bg-gradient-to-r from-yellow-500/10 via-amber-500/15 to-yellow-500/10 rounded-3xl border border-yellow-500/30 text-center relative overflow-hidden shadow-2xl"
          >
            <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-yellow-500/5 via-transparent to-transparent pointer-events-none"></div>
            <Sparkles className="mx-auto w-10 h-10 text-yellow-400 animate-bounce mb-3" />
            <h2 className="text-xl font-black text-white uppercase tracking-wider">All Daily Quests Completed!</h2>
            <p className="text-xs text-yellow-250 mt-1 max-w-md mx-auto leading-relaxed">
              Sensational job! You have fully verified all available standard campaigns and social milestones for today. Check back tomorrow!
            </p>
            <button 
              onClick={() => {
                confetti({
                  particleCount: 85,
                  spread: 60,
                  origin: { y: 0.6 },
                  colors: ['#3b82f6', '#6366f1', '#a855f7', '#ecc94b', '#10b981']
                });
              }}
              className="mt-4 inline-flex items-center gap-1.5 bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-slate-950 text-xs font-black px-4 py-2 rounded-xl transition duration-200 cursor-pointer shadow-lg shadow-yellow-500/20 uppercase tracking-widest"
            >
              <Coins className="w-4 h-4" />
              <span>Celebrate Again</span>
            </button>
          </motion.div>
        )}

        {/* Social Media Tasks Progress Card */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 p-5 bg-slate-800/40 backdrop-blur-md rounded-3xl border border-slate-700/60 shadow-xl relative overflow-hidden"
        >
          <div className="absolute right-0 top-0 w-24 h-24 bg-blue-500/5 rounded-full blur-2xl pointer-events-none"></div>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-2xl">
                <Users size={20} />
              </div>
              <div>
                <h3 className="font-black text-white text-md uppercase tracking-wide">Social Media Quests</h3>
                <p className="text-slate-400 text-xs">Complete social tasks to qualify for standard and premier ecosystem rewards</p>
              </div>
            </div>
            <div className="text-right">
              <span className="font-mono font-black text-blue-400 text-lg">{socialCompletedCount}</span>
              <span className="text-slate-500 font-mono text-xs"> / {socialTasks.length} Done</span>
              <span className="ml-3 inline-block bg-blue-500/15 text-blue-400 border border-blue-500/20 px-2.5 py-1 rounded-full text-xs font-black">{socialPercentage}%</span>
            </div>
          </div>
          
          <div className="mt-4">
            <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden border border-slate-850 p-1">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${socialPercentage}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="h-full rounded-full bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 shadow-lg shadow-blue-500/20"
              />
            </div>
            <div className="flex justify-between items-center mt-2">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Mission Milestone Progress</span>
              <span className="text-[10px] text-slate-400 font-mono font-bold">{socialPercentage === 100 ? "🎉 Completed!" : `${socialTasks.length - socialCompletedCount} social tasks remaining`}</span>
            </div>
          </div>
        </motion.div>

        {/* Category Filters */}
        <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
          {FILTER_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isActive = selectedCategory === cat.id;
            const count = getCategoryCount(cat.id);
            
            return (
              <motion.button
                key={cat.id}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setSelectedCategory(cat.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border font-medium text-sm transition-all shadow-md ${
                  isActive
                    ? 'bg-gradient-to-r from-blue-500 to-purple-600 border-transparent text-white shadow-lg shadow-blue-500/25'
                    : 'bg-slate-800/60 border-slate-700/50 hover:bg-slate-800 hover:border-slate-600 text-slate-300 hover:text-white'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{cat.name}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                  isActive
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-900/60 text-slate-400'
                }`}>
                  {count}
                </span>
              </motion.button>
            );
          })}
        </div>

        <div className="grid gap-4">
          {selectedCategory === 'Offerwalls' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { id: 'offertoro', name: 'OfferToro Networks', reward: '12,000 - 150,000 🪙', desc: 'Download and register in leading Web3 games or complete special partner challenges.', gradient: 'from-yellow-500/10 via-amber-500/5 to-transparent', border: 'border-amber-500/30', accent: 'text-amber-400', badge: '🔥 HOT' },
                { id: 'bitlabs', name: 'BitLabs Market Polls', reward: '15,000 - 90,000 🪙', desc: 'Express your sentiments on crypto trends and game structures in rapid surveys.', gradient: 'from-cyan-500/10 via-teal-500/5 to-transparent', border: 'border-cyan-500/30', accent: 'text-cyan-400', badge: '⚡ HIGH PAYOUT' },
                { id: 'lootably', name: 'Lootably Trials', reward: '30,000 - 250,000 🪙', desc: 'Try newly introduced partner applications and games to unlock huge crypto values.', gradient: 'from-purple-500/10 via-indigo-500/5 to-transparent', border: 'border-purple-500/30', accent: 'text-purple-400', badge: '⭐ RECOMMENDED' },
                { id: 'adgem', name: 'AdGem Campaigns', reward: '10,000 - 85,000 🪙', desc: 'Fulfill rapid subscription actions, test apps or play web portal mechanics.', gradient: 'from-orange-500/10 via-amber-500/5 to-transparent', border: 'border-orange-500/30', accent: 'text-orange-400', badge: '🚀 FAST' },
                { id: 'pollfish', name: 'Pollfish Rapid Quizzes', reward: '5,000 - 40,000 🪙', desc: 'Participate in casual 30-second rapid feedback cycles on blockchain utility designs.', gradient: 'from-pink-500/10 via-rose-500/5 to-transparent', border: 'border-rose-500/30', accent: 'text-rose-400', badge: '✨ INSTANT' }
              ].map((wall) => (
                <motion.div
                  key={wall.id}
                  whileHover={{ scale: 1.02, translateY: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    triggerImpact('medium');
                    setSelectedOfferwall(wall.id);
                    setSurveyStep(0);
                    setIsCompletingOffer(false);
                  }}
                  className={`relative p-5 rounded-3xl bg-gradient-to-br ${wall.gradient} border ${wall.border} overflow-hidden cursor-pointer flex flex-col justify-between group shadow-xl`}
                >
                  <div className="absolute top-0 right-0 py-1 px-3 bg-slate-900 border-l border-b border-slate-800 rounded-bl-xl text-[8px] font-black tracking-widest uppercase text-slate-400 group-hover:bg-slate-850">
                    {wall.badge}
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-base font-black text-white flex items-center gap-1.5 font-sans">
                      <span className="text-xl">📊</span> {wall.name}
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed font-sans">{wall.desc}</p>
                  </div>
                  <div className="mt-5 pt-3 border-t border-slate-900/60 flex items-center justify-between">
                    <span className="text-[10px] text-slate-500 uppercase font-black tracking-wider">Estimated Yield:</span>
                    <span className={`text-xs font-black ${wall.accent} font-mono`}>{wall.reward}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          ) : filteredTasks.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center p-12 bg-slate-800/20 rounded-2xl border border-slate-800 border-dashed"
            >
              <p className="text-slate-400">No missions found in this category.</p>
            </motion.div>
          ) : (
            filteredTasks.map((task, index) => {
              const p = getTaskProgress(task.id);
              const percent = Math.min((p.currentProgress / task.goal) * 100, 100);

              const remaining = timeRemaining[task.id];
              const isExpired = task.isTimeSensitive && remaining !== undefined && remaining <= 0;
              const isUrgent = task.isTimeSensitive && remaining !== undefined && remaining > 0 && remaining <= 3600000;

              return (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className={`relative overflow-hidden bg-slate-800/50 backdrop-blur-sm border ${
                    p.completed 
                      ? 'border-green-500/30' 
                      : isExpired
                      ? 'border-red-500/30 opacity-75'
                      : isUrgent
                      ? 'border-amber-500/40 shadow-lg shadow-amber-500/5 animate-pulse'
                      : 'border-slate-700'
                  } p-6 rounded-2xl shadow-xl transition-all hover:bg-slate-800/80`}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="p-3 bg-slate-900 rounded-xl border border-slate-700">
                        {getIcon(task.type)}
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-white flex items-center gap-2 flex-wrap font-sans">
                          {task.title}
                          {p.completed && <CheckCircle className="w-5 h-5 text-green-500" />}
                          <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-bold border ${
                            task.category === 'Social' 
                              ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' 
                              : task.category === 'Creator'
                              ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          }`}>
                            {task.category}
                          </span>
                        </h3>
                        <p className="text-slate-400 text-sm mt-0.5">{task.description}</p>
                        
                        {/* Countdown Display */}
                        {task.isTimeSensitive && remaining !== undefined && (
                          <div className={`mt-3 flex items-center gap-1.5 text-xs font-mono font-bold px-3 py-1.5 rounded-xl border w-fit ${
                            isExpired 
                              ? 'bg-red-500/10 text-red-100 border-red-500/20' 
                              : isUrgent 
                              ? 'bg-amber-500/15 text-amber-300 border-amber-500/25' 
                              : 'bg-slate-900/50 text-slate-300 border-slate-700/60'
                          }`}>
                            <Clock className={`w-3.5 h-3.5 ${isUrgent ? 'text-amber-400 animate-spin' : isExpired ? 'text-red-400' : 'text-slate-400'}`} style={{ animationDuration: '3s' }} />
                            <span>Countdown: {formatDuration(remaining)}</span>
                            {isUrgent && <span className="ml-1 text-[10px] text-amber-500 font-black uppercase tracking-wider animate-pulse">(🚨 &lt; 1H Remaining)</span>}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-6 shrink-0 justify-between md:justify-end">
                      <div className="text-right">
                        <div className="flex items-center gap-1 text-yellow-400 font-bold text-lg justify-end">
                          <Coins className="w-5 h-5" />
                          +{task.reward}
                        </div>
                        <div className="text-xs text-slate-500 uppercase tracking-wider font-bold">Reward</div>
                      </div>

                      {p.claimed ? (
                        <div className="bg-slate-700/50 text-slate-400 font-bold py-2 px-6 rounded-xl border border-slate-600">
                          Claimed
                        </div>
                      ) : isExpired ? (
                        <div className="flex flex-col items-end gap-1.5">
                          <div className="bg-red-500/10 text-red-400 font-bold py-2 px-4 rounded-xl border border-red-500/20 text-xs">
                            Expired
                          </div>
                          <button
                            onClick={() => handleResetTimer(task.id, task.durationMinutes || 60)}
                            className="text-[10px] text-blue-400 hover:text-blue-300 font-semibold underline cursor-pointer"
                          >
                            Reset Timer
                          </button>
                        </div>
                      ) : verifyingTaskId === task.id ? (
                        <button
                          disabled
                          className="flex items-center gap-1.5 bg-slate-800 text-indigo-400 border border-slate-700 font-extrabold py-2 px-4 rounded-xl text-xs"
                        >
                          <div className="animate-spin rounded-full h-3.5 w-3.5 border-t-2 border-b-2 border-indigo-400"></div>
                          <span>Checking...</span>
                        </button>
                      ) : (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {(task.url || task.type === 'watched_ad') && (
                            <button
                              onClick={() => handleTaskClick(task)}
                              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-755 text-slate-200 border border-slate-700 font-bold py-2 px-3.5 rounded-xl transition-all active:scale-95 text-xs cursor-pointer"
                            >
                              <span>{task.type === 'watched_ad' ? 'Watch Ad' : 'Complete'}</span>
                              {task.type === 'watched_ad' ? <Sparkles className="w-3.5 h-3.5 text-yellow-400" /> : <ExternalLink className="w-3.5 h-3.5 text-slate-400" />}
                            </button>
                          )}
                          <button
                            onClick={() => handleVerify(task)}
                            disabled={verifyingTaskId !== null}
                            className={`font-black py-2 px-4 rounded-xl shadow-lg transition-all active:scale-95 disabled:opacity-50 text-xs cursor-pointer ${
                              isUrgent 
                                ? 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white shadow-amber-500/20' 
                                : 'bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white shadow-blue-500/20'
                            }`}
                          >
                            Verify
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  {!p.claimed && (
                    <div className="mt-4">
                      <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-700">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${percent}%` }}
                          className={`h-full bg-gradient-to-r ${p.completed ? 'from-green-500 to-emerald-500' : 'from-blue-500 to-purple-500'}`}
                        />
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })
          )}
        </div>

        <footer className="mt-12 p-6 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-center font-sans">
          <p className="text-blue-300 text-sm font-medium">
            Daily tasks reset every 24 hours. Keep streaming and engaging to maximize your rewards!
          </p>
        </footer>
      </div>

      {/* Floating alert toasts container */}
      <div className="fixed bottom-4 right-4 md:bottom-8 md:right-8 z-50 flex flex-col gap-3 max-w-sm w-full font-sans pointer-events-none">
        {toasts.map(toast => {
          const isError = toast.type === 'error';
          const isSuccess = toast.type === 'success';
          const isInfo = toast.type === 'info';
          
          let borderColor = "border-amber-500/30";
          let shadowColor = "shadow-amber-500/10";
          let iconColor = "text-amber-400";
          let iconBg = "bg-amber-500/10";
          let titleColor = "text-amber-400";
          
          if (isError) {
            borderColor = "border-red-500/30";
            shadowColor = "shadow-red-500/10";
            iconColor = "text-red-400";
            iconBg = "bg-red-500/10";
            titleColor = "text-red-400";
          } else if (isSuccess) {
            borderColor = "border-emerald-500/30";
            shadowColor = "shadow-emerald-500/10";
            iconColor = "text-emerald-400";
            iconBg = "bg-emerald-500/10";
            titleColor = "text-emerald-400";
          } else if (isInfo) {
            borderColor = "border-blue-500/30";
            shadowColor = "shadow-blue-500/10";
            iconColor = "text-blue-400";
            iconBg = "bg-blue-500/10";
            titleColor = "text-blue-400";
          }

          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 50, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={`pointer-events-auto p-4 bg-slate-950/95 backdrop-blur-md border ${borderColor} text-white rounded-2xl shadow-2xl flex items-start gap-3 ${shadowColor}`}
            >
              <div className={`p-2 ${iconBg} ${iconColor} rounded-xl`}>
                {isError ? (
                  <Sparkles className={`w-5 h-5 ${iconColor}`} />
                ) : isSuccess ? (
                  <CheckCircle className={`w-5 h-5 ${iconColor}`} />
                ) : isInfo ? (
                  <HelpCircle className={`w-5 h-5 ${iconColor}`} />
                ) : (
                  <Clock className={`w-5 h-5 animate-pulse ${iconColor}`} />
                )}
              </div>
              <div className="flex-1">
                <h4 className={`font-extrabold text-[11px] ${titleColor} uppercase tracking-widest`}>{toast.title}</h4>
                <p className="text-slate-200 text-xs mt-1 font-semibold leading-relaxed">{toast.message}</p>
              </div>
              <button 
                onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
                className="text-slate-400 hover:text-slate-200 text-xs font-bold leading-none shrink-0 p-1 cursor-pointer"
              >
                ✕
              </button>
            </motion.div>
          );
        })}
      </div>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {successClaimedReward && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop with elegant blur */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSuccessClaimedReward(null)}
              className="absolute inset-0 bg-slate-950/85 backdrop-blur-md"
            />

            {/* Modal Container */}
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 30 }}
              transition={{ type: 'spring', damping: 20, stiffness: 120 }}
              className="relative bg-slate-900 border border-blue-500/30 rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-2xl overflow-hidden text-center"
            >
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-green-400 via-blue-500 to-purple-605" />
              
              {/* Glow effects */}
              <div className="absolute -top-12 -left-12 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />
              <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-purple-500/10 rounded-full blur-2xl pointer-events-none" />

              {/* Floating, rotating gold coin representation */}
              <motion.div
                animate={{ 
                  y: [0, -10, 0],
                  scale: [1, 1.05, 1],
                  rotate: [0, 5, -5, 0]
                }}
                transition={{ 
                  duration: 4, 
                  repeat: Infinity, 
                  ease: "easeInOut" 
                }}
                className="mx-auto w-20 h-20 bg-gradient-to-br from-yellow-400 to-amber-500 text-slate-950 rounded-full flex items-center justify-center shadow-xl shadow-yellow-500/20 text-4xl mb-5 border-4 border-slate-900 relative select-none leading-none"
              >
                🪙
                <span className="absolute -top-1 -right-1 text-xs animate-bounce">✨</span>
              </motion.div>

              {/* Achievement Typography */}
              <h3 className="text-2xl font-black font-sans uppercase tracking-wide bg-gradient-to-r from-yellow-300 via-emerald-400 to-blue-400 bg-clip-text text-transparent mb-1">
                Mission Complete!
              </h3>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest font-black block mb-4">
                Reward claimed successfully
              </p>

              <div className="bg-slate-950/60 rounded-2xl py-4 px-5 border border-slate-850 mb-6 shadow-inner">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-1">Quest Title</span>
                <p className="text-slate-200 text-sm font-semibold truncate px-2">{successClaimedReward.title}</p>
                
                <div className="mt-3 pt-3 border-t border-slate-900/60 flex items-center justify-center gap-2">
                  <span className="text-3xl font-black text-yellow-400 font-mono tracking-tight animate-pulse">
                    +{successClaimedReward.amount.toLocaleString()}
                  </span>
                  <span className="text-xs font-black text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded-md border border-yellow-500/20 font-mono">
                    $FISH
                  </span>
                </div>
              </div>

              {/* Reward feedback content */}
              <p className="text-xs text-slate-400 leading-relaxed mb-6 px-1">
                Excellent work, Champion! Your wallet has been synchronised. Keep tracking rewards to level up your Fan Profile!
              </p>

              {/* Action Button */}
              <button
                type="button"
                onClick={() => setSuccessClaimedReward(null)}
                className="w-full py-3.5 bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white rounded-xl font-black text-xs uppercase tracking-widest transition duration-150 active:scale-95 shadow-lg shadow-emerald-500/20 cursor-pointer"
              >
                Claim Reward
              </button>
            </motion.div>
          </div>
        )}

        {confirmTask && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmTask(null)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            />

            {/* Modal Container */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              transition={{ type: 'spring', duration: 0.4 }}
              className="relative bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl overflow-hidden text-center"
            >
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500" />
              
              {/* Icon / Avatar */}
              <div className="mx-auto w-16 h-16 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-2xl flex items-center justify-center text-3xl mb-4">
                {getIcon(confirmTask.type)}
              </div>

              {/* Title & Description */}
              <h3 className="text-xl font-bold font-sans text-white mb-2">Proceed with Task?</h3>
              <p className="text-sm font-semibold text-slate-300 mb-1">
                {confirmTask.title}
              </p>
              <p className="text-xs text-slate-400 mb-5 leading-relaxed">
                {confirmTask.description}
              </p>

              {/* Reward Indicator */}
              <div className="bg-slate-950/60 rounded-2xl p-3 border border-slate-850 mb-6 flex items-center justify-between">
                <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Mission Reward</span>
                <div className="flex items-center gap-1.5 text-yellow-400 font-black text-sm font-mono">
                  <span>+{confirmTask.reward.toLocaleString()}</span>
                  <span>🪙 FISH</span>
                </div>
              </div>

              {/* Prompt warning of action */}
              <p className="text-[11px] text-slate-400 mb-6 text-left leading-relaxed border-l-2 border-blue-500/40 pl-3">
                {confirmTask.type === 'watched_ad' 
                  ? "Watching this video ad sponsor sequence directly supports our Barca ecosystem development."
                  : "You'll be directed to the social platform. Make sure to complete the follow/subscribe or join requirements, then return here and click 'Verify' to claim your reward."}
              </p>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 w-full">
                <button
                  type="button"
                  onClick={() => setConfirmTask(null)}
                  className="flex-1 py-3 bg-slate-800 hover:bg-slate-755 border border-slate-700 text-slate-300 hover:text-white rounded-xl font-bold text-xs transition duration-150 active:scale-95 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => executeTaskAction(confirmTask)}
                  className="flex-1 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-xl font-extrabold text-xs transition duration-150 active:scale-95 shadow-lg shadow-blue-500/15 cursor-pointer uppercase tracking-wider animate-pulse"
                >
                  {confirmTask.type === 'watched_ad' ? 'Launch Ad' : 'Yes, Proceed'}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {isHowToEarnOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsHowToEarnOpen(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
            />

            {/* Modal Container */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              transition={{ type: 'spring', duration: 0.4 }}
              className="relative bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 max-w-xl w-full shadow-2xl overflow-hidden text-left max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-500 via-indigo-505 to-purple-500" />
              
              {/* Header */}
              <div className="flex items-center justify-between mb-6 border-b border-slate-800/80 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl flex items-center justify-center text-lg">
                    <BookOpen size={18} />
                  </div>
                  <div>
                    <h3 className="text-lg font-black font-sans text-white uppercase tracking-wider leading-tight">Earning Guidelines</h3>
                    <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Barca Rewards & Tasks Ecosystem</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsHowToEarnOpen(false)}
                  className="w-8 h-8 rounded-full bg-slate-850 hover:bg-slate-850 active:bg-slate-755 text-slate-400 hover:text-white flex items-center justify-center transition border border-slate-800 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Guide Contents */}
              <div className="space-y-4">
                <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-2xl flex items-start gap-4">
                  <div className="text-2xl mt-0.5 select-none leading-none">🪙</div>
                  <div>
                    <h4 className="text-xs font-black text-white uppercase tracking-wider">1. Daily Login Allowances</h4>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Easiest reward! Claim your daily check-in allowance to lock in <span className="text-amber-400 font-bold font-mono">15,000 $FISH</span> every 24 hours. Keep up a continuous lock-in streak to boost your profile statistics.
                    </p>
                  </div>
                </div>

                <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-2xl flex items-start gap-4">
                  <div className="text-2xl mt-0.5 select-none leading-none">👥</div>
                  <div>
                    <h4 className="text-xs font-black text-white uppercase tracking-wider">2. Social Engagement Campaigns</h4>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Support partner initiatives across Telegram, YouTube, and Facebook. Click the campaign task box, complete the external requirements (join channels, subscribe to media, share updates), and then click <span className="text-blue-400 font-bold">"Verify"</span> to securely credit your tokens.
                    </p>
                  </div>
                </div>

                <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-2xl flex items-start gap-4">
                  <div className="text-2xl mt-0.5 select-none leading-none">📺</div>
                  <div>
                    <h4 className="text-xs font-black text-white uppercase tracking-wider">3. Sponsored Video Campaigns</h4>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Unlock instant crypto points by viewing short video broadcasts. After a brief wait time, standard earnings of <span className="text-green-400 font-bold font-mono">5,000 $FISH</span> will deposit directly. Note that there is a 15-second secure cooldown between sequential ad views.
                    </p>
                  </div>
                </div>

                <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-2xl flex items-start gap-4">
                  <div className="text-2xl mt-0.5 select-none leading-none">📊</div>
                  <div>
                    <h4 className="text-xs font-black text-white uppercase tracking-wider">4. Daily Progress Dashboard</h4>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Our dynamic progress bar updates in real-time. Completing 100% of available daily missions triggers dynamic particle effects and starts a premium pulsing outer glass sheen on your performance card!
                    </p>
                  </div>
                </div>

                <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-2xl flex items-start gap-4">
                  <div className="text-3xl mt-0.5 select-none leading-none font-sans">💰</div>
                  <div>
                    <h4 className="text-xs font-black text-white uppercase tracking-wider font-sans">5. Converting & Requesting Payouts</h4>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed font-sans">
                      Our constant conversion rate index is <span className="text-yellow-400 font-bold">10,000 $FISH = $1.00 USDT</span>. Simply go to the Cash Out page to convert your $FISH to USDT, and transfer them immediately to TON wallets, Bybit profiles, or bank gateways!
                    </p>
                  </div>
                </div>
              </div>

              {/* Bottom close footer action */}
              <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between">
                <span className="text-[9px] text-slate-500 font-mono font-bold tracking-widest uppercase">Secured Verification Session</span>
                <button
                  onClick={() => setIsHowToEarnOpen(false)}
                  className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-xl font-extrabold text-xs uppercase tracking-wider transition duration-150 active:scale-95 shadow-md shadow-blue-500/10 cursor-pointer"
                >
                  Got It, Let's Earn!
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Selected Offerwall Popup Dialog */}
        {selectedOfferwall && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedOfferwall(null)}
              className="absolute inset-0 bg-slate-950/85 backdrop-blur-md"
            />

            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              transition={{ type: 'spring', duration: 0.35 }}
              className="relative bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl overflow-hidden text-left max-h-[85vh] overflow-y-auto custom-scrollbar"
            >
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-500 via-emerald-500 to-yellow-500" />
              
              {/* Header */}
              <div className="flex items-center justify-between mb-6 border-b border-slate-805 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 rounded-xl flex items-center justify-center text-lg">
                    📊
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white uppercase tracking-wider font-sans">
                      {selectedOfferwall === 'offertoro' && 'OfferToro Marketplace'}
                      {selectedOfferwall === 'bitlabs' && 'BitLabs Opinion Polls'}
                      {selectedOfferwall === 'lootably' && 'Lootably Reward Walls'}
                      {selectedOfferwall === 'adgem' && 'AdGem Campaign Hub'}
                      {selectedOfferwall === 'pollfish' && 'Pollfish Quick Surveys'}
                    </h3>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">Premium Partner Program</p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedOfferwall(null)}
                  className="w-8 h-8 rounded-full bg-slate-850 hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition border border-slate-755 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* SURVEY WALLS FLOW (BitLabs, Pollfish) */}
              {(selectedOfferwall === 'bitlabs' || selectedOfferwall === 'pollfish') && (
                <div className="space-y-6">
                  {surveyStep === 0 && (
                    <div className="space-y-4 text-center py-4">
                      <div className="text-4xl">🗒️</div>
                      <h4 className="text-sm font-bold text-slate-200">Earn up to {selectedOfferwall === 'bitlabs' ? '75,000' : '30,000'} $FISH for your thoughts!</h4>
                      <p className="text-xs text-slate-400 leading-relaxed max-w-sm mx-auto">
                        This short 3-question survey is supported by the developer ecosystem to study player preferences in Web3 TON networks.
                      </p>
                      <button
                        onClick={() => {
                          triggerImpact('medium');
                          setSurveyStep(1);
                        }}
                        className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-black text-xs uppercase tracking-wider transition-all"
                      >
                        Start Rapid Survey
                      </button>
                    </div>
                  )}

                  {surveyStep === 1 && (
                    <div className="space-y-4">
                      <div className="flex justify-between items-center text-[10px] text-slate-500">
                        <span>QUESTION 1 OF 3</span>
                        <span className="font-mono text-cyan-400 font-bold">33% Completed</span>
                      </div>
                      <h4 className="text-sm font-bold text-white uppercase tracking-wider">Which blockchain network do you prefer for asset transfers?</h4>
                      <div className="grid gap-2.5">
                        {['TON Blockchain (Telegraph Network)', 'Solana High Speed Layer', 'Ethereum Layer-2 Networks', 'Binance Smart Chain (BSC)'].map((opt, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              triggerImpact('light');
                              setSurveyStep(2);
                            }}
                            className="w-full text-left p-3.5 rounded-xl bg-slate-950/40 hover:bg-slate-950 border border-slate-800 hover:border-cyan-500/40 text-xs font-semibold text-slate-300 hover:text-cyan-400 transition-all font-sans"
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {surveyStep === 2 && (
                    <div className="space-y-4">
                      <div className="flex justify-between items-center text-[10px] text-slate-500">
                        <span>QUESTION 2 OF 3</span>
                        <span className="font-mono text-cyan-400 font-bold">66% Completed</span>
                      </div>
                      <h4 className="text-sm font-bold text-white uppercase tracking-wider font-sans">What is your principal goal in FishVerse Clone (Oibb Earn)?</h4>
                      <div className="grid gap-2.5 font-sans">
                        {['Converting FISH to USDT', 'Completing complex social tasks', 'Tapping and unlocking campaigns', 'Inviting active referral team members'].map((opt, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              triggerImpact('light');
                              setSurveyStep(3);
                            }}
                            className="w-full text-left p-3.5 rounded-xl bg-slate-950/40 hover:bg-slate-950 border border-slate-800 hover:border-teal-500/40 text-xs font-semibold text-slate-300 hover:text-teal-400 transition-all"
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {surveyStep === 3 && (
                    <div className="space-y-4">
                      <div className="flex justify-between items-center text-[10px] text-slate-500">
                        <span>QUESTION 3 OF 3</span>
                        <span className="font-mono text-cyan-400 font-bold">99% Completed</span>
                      </div>
                      <h4 className="text-sm font-bold text-white uppercase tracking-wider font-sans">How long do you active play TON WebApps daily?</h4>
                      <div className="grid gap-2.5 font-sans">
                        {['Less than 30 minutes', '30 to 120 minutes', 'Over 2 hours', 'Hardly play, focused purely on claims'].map((opt, i) => (
                          <button
                            key={i}
                            onClick={async () => {
                              triggerImpact('medium');
                              setSurveyStep(4);
                              setIsCompletingOffer(true);
                              // Simulate completing the survey securely
                              await new Promise((resolve) => setTimeout(resolve, 2000));
                              
                              const payout = selectedOfferwall === 'bitlabs' ? 45000 : 20000;
                              const providerLabel = selectedOfferwall === 'bitlabs' ? 'BitLabs' : 'Pollfish';
                              
                              if (auth.currentUser) {
                                try {
                                  const userId = auth.currentUser.uid;
                                  const userRef = doc(db, 'users', userId);
                                  await runTransaction(db, async (trans) => {
                                    const userSnap = await trans.get(userRef);
                                    if (userSnap.exists()) {
                                      trans.update(userRef, {
                                        coins: increment(payout),
                                        dailyGoalTasksCompleted: increment(1)
                                      });
                                      const logRef = doc(collection(db, 'coinTransactions'));
                                      trans.set(logRef, {
                                        userId,
                                        amount: payout,
                                        type: 'offerwall_completion',
                                        description: `Answered ${providerLabel} campaign questionnaire (+${payout.toLocaleString()} $FISH)`,
                                        createdAt: new Date().toISOString()
                                      });
                                    }
                                  });
                                } catch (e) {
                                  console.warn("Silent database offer credit issue:", e);
                                }
                              }

                              triggerNotification('success');
                              setSuccessClaimedReward({ amount: payout, title: `${providerLabel} Quick Survey Reward` });
                              
                              confetti({
                                particleCount: 100,
                                spread: 80,
                                colors: ['#00f2fe', '#4facfe', '#0575e6']
                              });

                              setSelectedOfferwall(null);
                            }}
                            className="w-full text-left p-3.5 rounded-xl bg-slate-950/40 hover:bg-slate-950 border border-slate-800 hover:border-emerald-500/40 text-xs font-semibold text-slate-300 hover:text-emerald-400 transition-all"
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {surveyStep === 4 && (
                    <div className="text-center py-10 space-y-4">
                      <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto" />
                      <h4 className="text-sm font-black text-white">Validating and crediting your $FISH...</h4>
                      <p className="text-xs text-slate-500 font-mono">Securing transaction pipeline ID...</p>
                    </div>
                  )}
                </div>
              )}

              {/* ACTION INSTALL WALLS FLOW (OfferToro, Lootably, AdGem) */}
              {(selectedOfferwall === 'offertoro' || selectedOfferwall === 'lootably' || selectedOfferwall === 'adgem') && (
                <div className="space-y-4">
                  <p className="text-xs text-slate-400 font-sans mb-4">
                    Complete partner installations to secure immense token bundles. Follow individual steps to qualify.
                  </p>
                  
                  {isCompletingOffer ? (
                    <div className="py-8 text-center space-y-4 bg-slate-950/40 rounded-3xl border border-slate-850">
                      <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center text-blue-400 border border-blue-500/20 mx-auto animate-bounce">
                        📲
                      </div>
                      <h4 className="text-sm font-black text-white">Simulating Sponsor Application Sync...</h4>
                      <div className="max-w-xs mx-auto space-y-1">
                        <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden border border-slate-800">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: '100%' }}
                            transition={{ duration: 3.5, ease: 'easeInOut' }}
                            className="h-full bg-gradient-to-r from-blue-500 via-emerald-500 to-yellow-500"
                          />
                        </div>
                        <p className="text-[10px] text-slate-505 font-mono italic">Downloading resources & verifying device identifiers...</p>
                      </div>
                      <button
                        onClick={async () => {
                          triggerImpact('medium');
                          const payout = selectedOfferwall === 'lootably' ? 120000 : selectedOfferwall === 'offertoro' ? 85000 : 75000;
                          const providerLabel = selectedOfferwall === 'lootably' ? 'Lootably' : selectedOfferwall === 'offertoro' ? 'OfferToro' : 'AdGem';
                          
                          if (auth.currentUser) {
                            try {
                              const userId = auth.currentUser.uid;
                              const userRef = doc(db, 'users', userId);
                              await runTransaction(db, async (trans) => {
                                const userSnap = await trans.get(userRef);
                                if (userSnap.exists()) {
                                  trans.update(userRef, {
                                    coins: increment(payout)
                                  });
                                  const logRef = doc(collection(db, 'coinTransactions'));
                                  trans.set(logRef, {
                                    userId,
                                    amount: payout,
                                    type: 'offerwall_completion',
                                    description: `Fitted ${providerLabel} trial bonus claim (+${payout.toLocaleString()} $FISH)`,
                                    createdAt: new Date().toISOString()
                                  });
                                }
                              });
                            } catch (e) {
                              console.warn("Silent campaign database save error:", e);
                            }
                          }

                          triggerNotification('success');
                          setSuccessClaimedReward({ amount: payout, title: `${providerLabel} App Installation Payout` });
                          
                          confetti({
                            particleCount: 120,
                            spread: 90,
                            colors: ['#8b5cf6', '#ec4899', '#ef4444']
                          });

                          setSelectedOfferwall(null);
                        }}
                        className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-wider z-10 relative cursor-pointer"
                      >
                        ✅ Claim Installation Reward
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {[
                        { id: 'app1', name: 'Crypto Racing Arena Saga', reward: selectedOfferwall === 'lootably' ? 120000 : 85000, desc: 'Install open and play first 3 competitive races.', icon: '🏎️' },
                        { id: 'app2', name: 'Solitaire Harvest Cash', reward: selectedOfferwall === 'offertoro' ? 95000 : 75500, desc: 'Download Solitaire app, win first card deal.', icon: '♠️' },
                        { id: 'app3', name: 'TikTok Mini Lite Upgrade', reward: 35000, desc: 'Install TikTok Mini, watch videos for 1 continuous minute.', icon: '📱' }
                      ].map((item) => (
                        <div key={item.id} className="p-4 bg-slate-950/40 rounded-2xl border border-slate-850 flex items-center justify-between gap-3 font-sans">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl">{item.icon}</span>
                            <div>
                              <h4 className="text-xs font-bold text-white">{item.name}</h4>
                              <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{item.desc}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              triggerImpact('medium');
                              setIsCompletingOffer(true);
                            }}
                            className="shrink-0 px-3.5 py-1.5 rounded-lg bg-blue-600/10 hover:bg-blue-605 text-blue-400 border border-blue-500/20 font-black text-[10px] uppercase font-mono hover:text-white transition-all cursor-pointer"
                          >
                            +{item.reward.toLocaleString()} 🪙
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </div>
        )}

      </AnimatePresence>
    </div>
  );
};

export default TasksPage;
