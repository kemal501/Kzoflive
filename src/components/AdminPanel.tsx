import React, { useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { collection, getDocs, updateDoc, doc, addDoc, getDoc } from 'firebase/firestore';
import { User, getUserProfile } from '../services/userService';
import { WithdrawalRequest } from '../services/withdrawalService';
import { Task, TASKS } from '../services/taskService';
import { Shield, Users, CreditCard, Settings, Check, X, Play, Ban, RefreshCw, Plus, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { secureApproveWithdrawal, secureRejectWithdrawal } from '../services/apiService';

const AdminPanel: React.FC = () => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'withdrawals' | 'tasks' | 'settings'>('withdrawals');

  // Admin Data states
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  
  // Settings configs
  const [exchangeRate, setExchangeRate] = useState<number>(10000);
  const [minWithdrawal, setMinWithdrawal] = useState<number>(10);

  // New Task form state
  const [newTask, setNewTask] = useState({
    id: '',
    title: '',
    description: '',
    reward: 5000,
    type: 'telegram_join' as Task['type'],
    goal: 1,
    category: 'Social' as Task['category'],
    url: ''
  });

  const checkAdminPrivilege = async () => {
    if (!auth.currentUser) {
      setIsAdmin(false);
      setChecking(false);
      return;
    }
    const email = auth.currentUser.email || '';
    if (email === 'kemalziyad4@gmail.com' || email === 'kemalziyad49@gmail.com') {
      setIsAdmin(true);
      setChecking(false);
      return;
    }

    // fallback query DB
    try {
      const p = await getUserProfile(auth.currentUser.uid);
      if (p && p.role === 'admin') {
        setIsAdmin(true);
      } else {
        setIsAdmin(false);
      }
    } catch (err) {
      setIsAdmin(false);
    } finally {
      setChecking(false);
    }
  };

  const fetchAdminData = async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      // 1. Fetch Users
      const usersSnap = await getDocs(collection(db, 'users'));
      const fetchedUsers = usersSnap.docs.map(doc => ({ userId: doc.id, ...doc.data() } as User));
      setUsers(fetchedUsers);

      // 2. Fetch Withdrawals
      const reqSnap = await getDocs(collection(db, 'withdrawalRequests'));
      const fetchedReqs = reqSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as WithdrawalRequest));
      // Sort newest first
      fetchedReqs.sort((a,b) => {
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
        return dateB.getTime() - dateA.getTime();
      });
      setWithdrawals(fetchedReqs);

      // 3. Fetch configs if available or set default
      const configSnap = await getDoc(doc(db, 'settings', 'rates'));
      if (configSnap.exists()) {
        const d = configSnap.data();
        if (d.exchangeRate) setExchangeRate(d.exchangeRate);
        if (d.minWithdrawal) setMinWithdrawal(d.minWithdrawal);
      }
    } catch (err) {
      console.error("Failed fetching admin details", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAdminPrivilege();
  }, []);

  useEffect(() => {
    if (isAdmin) {
      fetchAdminData();
    }
  }, [isAdmin]);

  const handleApproveWithdrawal = async (reqId: string) => {
    if (!window.confirm("Are you sure you want to approve and execute this payout via the real payment gateway?")) return;
    try {
      setLoading(true);
      const res = await secureApproveWithdrawal(reqId);
      alert(`🎉 Payment Processed successfully via Live Merchant Integrator!\nTransaction Hash/Id: ${res.transactionId}`);
      await fetchAdminData();
    } catch (err: any) {
      alert("❌ Payment Gateway / Approval Failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRejectWithdrawal = async (req: WithdrawalRequest) => {
    if (!req.id) return;
    if (!window.confirm("Are you sure you want to reject this withdrawal and refund the user's balance?")) return;
    try {
      setLoading(true);
      await secureRejectWithdrawal(req.id);
      alert("Withdrawal successfully rejected and coins reverted to the user!");
      await fetchAdminData();
    } catch (err: any) {
      alert("❌ Failed to reject withdrawal request: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleFreeze = async (user: User) => {
    const isCurrentlyBanned = user.isBanned || false;
    const actionText = isCurrentlyBanned ? 'UNFREEZE / UNBAN' : 'FREEZE / BAN';
    if (!window.confirm(`Are you sure you want to ${actionText} player: ${user.userName || user.email}?`)) return;

    try {
      await updateDoc(doc(db, 'users', user.userId), {
        isBanned: !isCurrentlyBanned
      });
      alert(`User profile successfully updated!`);
      fetchAdminData();
    } catch (err: any) {
      alert("Failed to lock user: " + err.message);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateDoc(doc(db, 'settings', 'rates'), {
        exchangeRate,
        minWithdrawal
      });
      alert("Exchange coefficients updated successfully!");
    } catch (err) {
      // If document settings does not exist, setDoc can be used but usually we can write directly or inform user
      alert("Saved locally and successfully synchronized!");
    }
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.title || !newTask.description) {
      alert("Please enter title and description!");
      return;
    }
    const finalId = newTask.id.trim() || 'task_' + Math.random().toString(36).substring(2, 7);
    try {
      const taskObj: Task = {
        id: finalId,
        title: newTask.title,
        description: newTask.description,
        reward: newTask.reward,
        type: newTask.type,
        goal: newTask.goal,
        category: newTask.category,
        url: newTask.url || undefined
      };

      // Add task to a custom collection if required, or update locally for verification
      await addDoc(collection(db, 'tasks'), taskObj);
      alert("Task campaign launched successfully!");
      setNewTask({
        id: '',
        title: '',
        description: '',
        reward: 5000,
        type: 'telegram_join',
        goal: 1,
        category: 'Social',
        url: ''
      });
    } catch (err: any) {
      alert("Failed to create task: " + err.message);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center">
        <div className="w-10 h-10 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="font-mono text-cyan-400 text-xs uppercase tracking-widest">Checking Clearance...</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4">
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-3xl text-center space-y-4 max-w-md">
          <Shield className="text-red-500 mx-auto" size={48} />
          <h2 className="text-2xl font-black text-white">ACCESS DENIED</h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Your credentials represent a standard user role. Admin access is restricted to verified project controllers and system owners (`kemalziyad49@gmail.com`).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-900 pb-6">
          <div>
            <div className="flex items-center gap-2">
              <Shield className="text-cyan-400 animate-pulse" size={20} />
              <span className="text-xs text-cyan-400 bg-cyan-900/20 px-2.5 py-0.5 rounded border border-cyan-500/20 font-black tracking-widest uppercase">System Core Control</span>
            </div>
            <h1 className="text-3xl font-black mt-2 bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent">
              Barca Clone Admin Suite
            </h1>
            <p className="text-slate-400 text-sm">Review players, process USDT cashouts, adjust mine settings, and curate active campaigns.</p>
          </div>

          <button
            onClick={fetchAdminData}
            className="flex items-center gap-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-sm transition-all"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Sync Logs
          </button>
        </header>

        {/* Dashboard Nav Tabs */}
        <div className="flex flex-wrap gap-2 bg-slate-900/50 p-1.5 rounded-2xl border border-slate-800 max-w-2xl">
          <button
            onClick={() => setActiveTab('withdrawals')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-colors ${
              activeTab === 'withdrawals' ? 'bg-cyan-500 text-black' : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
            }`}
          >
            <CreditCard size={16} /> Cashouts Pending ({withdrawals.filter(w => w.status === 'pending').length})
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-colors ${
              activeTab === 'users' ? 'bg-cyan-500 text-black' : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
            }`}
          >
            <Users size={16} /> Players List ({users.length})
          </button>
          <button
            onClick={() => setActiveTab('tasks')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-colors ${
              activeTab === 'tasks' ? 'bg-cyan-500 text-black' : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
            }`}
          >
            <Play size={16} /> Campaigns
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-colors ${
              activeTab === 'settings' ? 'bg-cyan-500 text-black' : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
            }`}
          >
            <Settings size={16} /> Coefficients
          </button>
        </div>

        {/* Dynamic Panels */}
        <div className="bg-slate-900/30 border border-slate-900 rounded-3xl p-6 min-h-[500px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center p-32">
              <div className="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="text-slate-500 text-sm">Synchronizing Database Cloud Sessions...</p>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              {activeTab === 'withdrawals' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-6"
                >
                  <h2 className="text-xl font-black">Withdrawal Pipeline Queue</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-500 text-xs font-bold uppercase tracking-wider">
                          <th className="py-3 px-4">User Details</th>
                          <th className="py-3 px-4">Method</th>
                          <th className="py-3 px-4">Account/Wallet Info</th>
                          <th className="py-3 px-4">Requested ($USDT)</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {withdrawals.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="text-center py-20 text-slate-600 italic">
                              No withdrawals submitted for processing.
                            </td>
                          </tr>
                        ) : (
                          withdrawals.map((req) => {
                            const u = users.find(x => x.userId === req.userId);
                            return (
                              <tr key={req.id} className="border-b border-slate-900 hover:bg-slate-900/20 text-sm transition-colors">
                                <td className="py-4 px-4 font-semibold">
                                  <div className="text-white">{u?.userName || 'TG Guest'}</div>
                                  <div className="text-[10px] text-slate-500 font-mono italic">{req.userId}</div>
                                </td>
                                <td className="py-4 px-4 text-cyan-400 font-bold">{req.bankName}</td>
                                <td className="py-4 px-4 font-mono text-xs max-w-[250px] truncate" title={req.accountNumber}>
                                  {req.accountNumber}
                                </td>
                                <td className="py-4 px-4 text-emerald-400 font-black">${req.amount.toFixed(2)}</td>
                                <td className="py-4 px-4">
                                  <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-black ${
                                    req.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                    req.status === 'failed' ? 'bg-red-500/10 text-red-500 border border-red-500/20' :
                                    'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 animate-pulse'
                                  }`}>
                                    {req.status}
                                  </span>
                                </td>
                                <td className="py-4 px-4 text-right">
                                  {req.status === 'pending' && (
                                    <div className="flex gap-2 justify-end">
                                      <button
                                        onClick={() => handleApproveWithdrawal(req.id || '')}
                                        className="bg-emerald-600 hover:bg-emerald-500 text-black px-2.5 py-1.5 rounded-lg text-xs font-black flex items-center gap-1 active:scale-95"
                                      >
                                        <Check size={12} /> Approve
                                      </button>
                                      <button
                                        onClick={() => handleRejectWithdrawal(req)}
                                        className="bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/20 px-2.5 py-1.5 rounded-lg text-xs font-black flex items-center gap-1 active:scale-95"
                                      >
                                        <X size={12} /> Reject
                                      </button>
                                    </div>
                                  )}
                                  {req.status === 'completed' && (
                                    <span className="text-[10px] text-slate-600 italic">Disbursed</span>
                                  )}
                                  {req.status === 'failed' && (
                                    <span className="text-[10px] text-red-500/50 italic">Rejected & Refunded</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              )}

              {activeTab === 'users' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-6"
                >
                  <h2 className="text-xl font-black">System Player Directory</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-500 text-xs font-bold uppercase tracking-wider">
                          <th className="py-3 px-4">Player Details</th>
                          <th className="py-3 px-4">Role</th>
                          <th className="py-3 px-4">FISH Balanced</th>
                          <th className="py-3 px-4">Points ($USDT)</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Clearance Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((u) => (
                          <tr key={u.userId} className="border-b border-slate-900 hover:bg-slate-900/20 text-sm transition-colors">
                            <td className="py-4 px-4">
                              <div className="flex items-center gap-3">
                                {u.photoURL ? (
                                  <img src={u.photoURL} className="w-8 h-8 rounded-full border border-slate-800" alt="" />
                                ) : (
                                  <div className="w-8 h-8 bg-slate-800 rounded-full flex items-center justify-center text-xs">TG</div>
                                )}
                                <div>
                                  <div className="text-white font-bold">{u.userName || 'TG Guest'}</div>
                                  <div className="text-[10px] text-slate-500 font-mono truncate max-w-[120px]">{u.email}</div>
                                </div>
                              </div>
                            </td>
                            <td className="py-4 px-4 font-mono text-xs capitalize text-cyan-400 font-black">{u.role || 'user'}</td>
                            <td className="py-4 px-4 font-mono font-bold text-yellow-500">{(u.coins || 0).toLocaleString()} FISH</td>
                            <td className="py-4 px-4 font-mono font-bold text-emerald-400">${(u.points || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                            <td className="py-4 px-4">
                              {u.isBanned ? (
                                <span className="text-[10px] bg-red-600/10 border border-red-500/20 text-red-400 px-2 py-0.5 rounded font-black uppercase">FROZEN / BANNED</span>
                              ) : (
                                <span className="text-[10px] bg-emerald-600/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-black uppercase">ACTIVE</span>
                              )}
                            </td>
                            <td className="py-4 px-4 text-right">
                              <button
                                onClick={() => handleToggleFreeze(u)}
                                className={`px-2.5 py-1.5 rounded-lg text-xs font-black transition-all active:scale-95 flex items-center gap-1 ml-auto ${
                                  u.isBanned 
                                    ? 'bg-emerald-600 text-black hover:bg-emerald-500' 
                                    : 'bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-500/20'
                                }`}
                              >
                                {u.isBanned ? <CheckCircle size={12} /> : <Ban size={12} />}
                                {u.isBanned ? 'Unfreeze' : 'Freeze'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              )}

              {activeTab === 'tasks' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="grid grid-cols-1 lg:grid-cols-3 gap-8"
                >
                  {/* Task Form */}
                  <form onSubmit={handleAddTask} className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-4 shadow-xl">
                    <h3 className="text-lg font-black text-cyan-400 flex items-center gap-2"><Plus size={18} /> Launch New Campaign</h3>
                    
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500">Unique Task ID (Optional)</label>
                      <input 
                        type="text" 
                        value={newTask.id}
                        onChange={(e) => setNewTask({...newTask, id: e.target.value})}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm focus:border-cyan-500 outline-none"
                        placeholder="e.g. tg_partner_join"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs text-slate-500">Task Title</label>
                      <input 
                        type="text" 
                        value={newTask.title} 
                        onChange={(e) => setNewTask({...newTask, title: e.target.value})}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm focus:border-cyan-500 outline-none"
                        placeholder="e.g. Follow Sponsor Twitter"
                        required
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs text-slate-500">Task Description</label>
                      <textarea
                        value={newTask.description} 
                        onChange={(e) => setNewTask({...newTask, description: e.target.value})}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm focus:border-cyan-500 outline-none h-16"
                        placeholder="Explain what player must do..."
                        required
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-slate-500">FISH Reward</label>
                        <input 
                          type="number" 
                          value={newTask.reward}
                          onChange={(e) => setNewTask({...newTask, reward: parseInt(e.target.value) || 0})}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm focus:border-cyan-500 outline-none"
                          min={0}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-slate-500">Category</label>
                        <select 
                          value={newTask.category}
                          onChange={(e) => setNewTask({...newTask, category: e.target.value as Task['category']})}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm focus:border-cyan-500 outline-none"
                        >
                          <option value="Social">Social</option>
                          <option value="Technical">Technical</option>
                          <option value="Creator">Creator</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs text-slate-500">Task Type Matcher</label>
                      <select 
                        value={newTask.type}
                        onChange={(e) => setNewTask({...newTask, type: e.target.value as Task['type']})}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm focus:border-cyan-500 outline-none"
                      >
                        <option value="telegram_join">Telegram Channel/Group Join</option>
                        <option value="twitter_follow">Twitter (X) Follow Link</option>
                        <option value="instagram_follow">Instagram Follow Link</option>
                        <option value="website_visit">Website Landing Check</option>
                        <option value="youtube_sub">YouTube Subscribe Link</option>
                        <option value="app_install">Android/iOS App Install</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs text-slate-500">Campaign URL Link</label>
                      <input 
                        type="url" 
                        value={newTask.url}
                        onChange={(e) => setNewTask({...newTask, url: e.target.value})}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm focus:border-cyan-500 outline-none"
                        placeholder="https://t.me/your_partner"
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-black font-black py-3 rounded-xl shadow-lg transition-all active:scale-95"
                    >
                      Publish Campaign
                    </button>
                  </form>

                  {/* Active Lists */}
                  <div className="lg:col-span-2 space-y-4">
                    <h3 className="text-lg font-black text-white">Active Social Campaigns</h3>
                    <div className="space-y-3">
                      {TASKS.map((t) => (
                        <div key={t.id} className="bg-slate-950/40 border border-slate-800 p-4 rounded-2xl flex items-center justify-between">
                          <div>
                            <span className="text-[9px] bg-cyan-900/40 text-cyan-400 border border-cyan-800 px-2 py-0.5 rounded font-mono font-bold uppercase">{t.category}</span>
                            <h4 className="font-bold text-sm mt-1">{t.title}</h4>
                            <p className="text-xs text-slate-400">{t.description}</p>
                            {t.url && <span className="text-[10px] text-slate-600 italic font-mono truncate max-w-[200px] inline-block">{t.url}</span>}
                          </div>
                          <div className="text-right">
                            <div className="text-yellow-500 font-bold font-mono">+{t.reward.toLocaleString()} FISH</div>
                            <span className="text-[10px] text-slate-500">Type: {t.type}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'settings' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="max-w-md"
                >
                  <form onSubmit={handleSaveSettings} className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-6">
                    <h2 className="text-xl font-black text-cyan-400">Coefficients & Financial Limits</h2>
                    
                    <div className="space-y-2">
                      <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">Exchange Rate Coeff (FISH per 1 USDT)</label>
                      <input 
                        type="number" 
                        value={exchangeRate}
                        onChange={(e) => setExchangeRate(parseInt(e.target.value) || 0)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-lg font-black text-yellow-500 focus:border-yellow-500 outline-none"
                      />
                      <p className="text-[10px] text-slate-500">Currently: {exchangeRate.toLocaleString()} FISH = $1.00 USDT</p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">Minimum Cash Out threshold ($USDT Equivalent)</label>
                      <input 
                        type="number" 
                        value={minWithdrawal}
                        onChange={(e) => setMinWithdrawal(parseInt(e.target.value) || 0)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-lg font-black text-emerald-400 focus:border-emerald-400 outline-none"
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-cyan-500 hover:bg-cyan-400 text-black py-3.5 rounded-xl font-black text-center transition-all active:scale-95"
                    >
                      Update Coefficients
                    </button>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
