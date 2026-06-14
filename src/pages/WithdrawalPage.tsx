import React, { useState, useEffect } from 'react';
import { auth } from '../firebase';
import { getUserProfile, User } from '../services/userService';
import { getWithdrawalHistory, WithdrawalRequest } from '../services/withdrawalService';
import { CreditCard, History, CheckCircle, Clock, AlertCircle, ArrowRight, DollarSign, RefreshCw, Send, Coins } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { secureConvert, secureWithdraw } from '../services/apiService';
import { generateFingerprint, captureClientInfo } from '../utils/fingerprint';
import { triggerImpact, triggerNotification } from '../utils/haptic';

const EXCHANGE_RATE = 10000; // 10,000 FISH = $1 USDT
const MIN_CONVERSION = 10000; // Min 10,000 FISH to convert

const WithdrawalPage: React.FC = () => {
  const [userProfile, setUserProfile] = useState<User | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState<number>(10); // $10 USDT min
  const [convertAmount, setConvertAmount] = useState<number>(10000); // 10,000 FISH min
  const [activeSection, setActiveSection] = useState<'withdraw' | 'deposit'>('withdraw');
  
  const [payoutMethod, setPayoutMethod] = useState<string>('USDT TRC20');
  const [walletAddress, setWalletAddress] = useState<string>('');

  const [history, setHistory] = useState<WithdrawalRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [convertLoading, setConvertLoading] = useState(false);
  
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [convertSuccess, setConvertSuccess] = useState<string | null>(null);

  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const fetchUserData = async () => {
    if (auth.currentUser) {
      const profile = await getUserProfile(auth.currentUser.uid);
      setUserProfile(profile);
      const withdrawalHistory = await getWithdrawalHistory(auth.currentUser.uid);
      setHistory(withdrawalHistory);
    }
  };

  useEffect(() => {
    fetchUserData();
    const interval = setInterval(fetchUserData, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !userProfile) return;

    if (convertAmount < MIN_CONVERSION) {
      setConvertError(`Minimum conversion amount is ${MIN_CONVERSION.toLocaleString()} $FISH.`);
      return;
    }

    if (convertAmount > (userProfile.coins || 0)) {
      setConvertError("Insufficient $FISH Balance.");
      return;
    }

    setConvertLoading(true);
    setConvertError(null);
    setConvertSuccess(null);

    try {
      const fingerprint = generateFingerprint();
      const clientInfo = captureClientInfo();
      
      const response = await secureConvert(convertAmount, fingerprint, clientInfo);

      // Trigger success haptic notification
      triggerNotification('success');

      setConvertSuccess(`Successfully exchanged ${convertAmount.toLocaleString()} FISH for $${response.awardUsdt?.toFixed(2) || '0.00'} USDT!`);
      setConvertAmount(MIN_CONVERSION);
      fetchUserData();
    } catch (err: any) {
      // Trigger error haptic notification
      triggerNotification('error');

      setConvertError(err.message || "Failed to exchange FISH.");
    } finally {
      setConvertLoading(false);
    }
  };

  const promptWithdrawal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !userProfile) return;

    if (withdrawAmount < 10) {
      setError("Minimum withdrawal is $10 USDT.");
      return;
    }

    if (withdrawAmount > (userProfile.points || 0)) {
      setError("Insufficient USDT points balance.");
      return;
    }

    // Validation based on payout method (NOWPayments crypto networks only)
    if (!walletAddress.trim()) {
      setError(`Please enter your valid ${payoutMethod} recipient wallet address.`);
      return;
    }

    setError(null);
    setSuccess(null);
    
    // Trigger medium impact haptic on modal prompt
    triggerImpact('medium');

    setShowConfirmModal(true);
  };

  const handleConfirmWithdraw = async () => {
    if (!auth.currentUser || !userProfile) return;
    setShowConfirmModal(false);
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const fingerprint = generateFingerprint();
      const clientInfo = captureClientInfo();
      const finalDetails = walletAddress.trim();

      const response = await secureWithdraw(withdrawAmount, payoutMethod, finalDetails, fingerprint, clientInfo);
      
      // Trigger success haptic notification
      triggerNotification('success');

      setSuccess(`Withdrawal request submitted successfully! Risk Score: ${response.riskScore || 0}%.`);
      setWithdrawAmount(10);
      setWalletAddress('');
      fetchUserData();
    } catch (err: any) {
      // Trigger error haptic notification
      triggerNotification('error');

      setError(err.message || "Withdrawal failed.");
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const s = (status || '').toLowerCase();
    switch (s) {
      case 'completed':
        return (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shadow-sm shadow-emerald-500/5">
            <CheckCircle size={12} className="shrink-0" />
            <span className="text-[9px] font-black uppercase tracking-wider">Completed</span>
          </div>
        );
      case 'processing':
        return (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 shadow-sm shadow-blue-500/5 animate-pulse">
            <RefreshCw size={12} className="shrink-0 animate-spin" style={{ animationDuration: '3s' }} />
            <span className="text-[9px] font-black uppercase tracking-wider">Processing</span>
          </div>
        );
      case 'failed':
      case 'rejected':
        return (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/30 text-red-500 shadow-sm shadow-red-500/5">
            <AlertCircle size={12} className="shrink-0" />
            <span className="text-[9px] font-black uppercase tracking-wider">Rejected</span>
          </div>
        );
      case 'pending':
      default:
        return (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 shadow-sm shadow-yellow-500/5">
            <Clock size={12} className="shrink-0" />
            <span className="text-[9px] font-black uppercase tracking-wider">Pending</span>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Header and Balances */}
        <header className="space-y-6">
          <div>
            <span className="text-xs bg-cyan-600/20 text-cyan-400 px-3 py-1 rounded-full border border-cyan-500/30 uppercase font-black tracking-widest font-mono">Barca Clone Payout Hub</span>
            <h1 className="text-3xl font-bold mt-2 bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
              Exchange & Cash Out
            </h1>
            <p className="text-slate-400">Convert FISH to USDT instantly and request fast payouts.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl flex items-center justify-between shadow-xl">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-yellow-500/20 rounded-full flex items-center justify-center text-yellow-400 border border-yellow-500/30">
                  <Coins size={24} />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">FISH Balance ($FISH)</p>
                  <p className="text-3xl font-black text-yellow-500">{(userProfile?.coins || 0).toLocaleString()}</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl flex items-center justify-between shadow-xl">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center text-emerald-400 border border-emerald-500/30">
                  <DollarSign size={24} />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">USDT Wallet ($USDT)</p>
                  <p className="text-3xl font-black text-emerald-400">${(userProfile?.points || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Segmented Toggle Control */}
        <div className="flex bg-slate-900 border border-slate-800 p-1.5 rounded-2xl max-w-md mx-auto">
          <button
            onClick={() => setActiveSection('withdraw')}
            className={`flex-1 py-3 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
              activeSection === 'withdraw'
                ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-lg'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            💸 Convert & Cash Out
          </button>
          <button
            onClick={() => setActiveSection('deposit')}
            className={`flex-1 py-3 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
              activeSection === 'deposit'
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            💳 Deposit / Top Up
          </button>
        </div>

        <AnimatePresence mode="wait">
          {activeSection === 'withdraw' ? (
            <motion.div 
              key="withdraw-section"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="grid grid-cols-1 lg:grid-cols-2 gap-8"
            >
              
              {/* Exchange Engine */}
              <div className="space-y-8">
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4"
                >
                  <div className="flex items-center gap-2 text-yellow-500 font-bold">
                    <RefreshCw size={20} className="animate-spin" style={{ animationDuration: '8s' }} />
                    <h2>FISH to USDT Converter</h2>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Convert your minded $FISH tokens into liquid $USDT instantly. Official exchange rate is **{EXCHANGE_RATE.toLocaleString()} FISH = $1.00 USDT**.
                  </p>

                  <form onSubmit={handleConvert} className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs text-slate-400 font-semibold">Amount of FISH to Convert</label>
                      <div className="relative">
                        <input 
                          type="number" 
                          value={convertAmount}
                          onChange={(e) => setConvertAmount(parseInt(e.target.value) || 0)}
                          className={`w-full bg-slate-950 border rounded-xl p-4 text-lg font-bold outline-none transition-colors ${
                            convertAmount > (userProfile?.coins || 0) 
                              ? 'border-red-500/50 text-red-500 focus:border-red-500' 
                              : 'border-slate-800 text-yellow-500 focus:border-yellow-500'
                          }`}
                          min={MIN_CONVERSION}
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-emerald-400 font-bold">
                          = ${(convertAmount / EXCHANGE_RATE).toFixed(2)} USDT
                        </div>
                      </div>

                      {/* Real-time Validation Error */}
                      {convertAmount > (userProfile?.coins || 0) && (
                        <div className="text-xs text-red-400 font-semibold flex items-center gap-1.5 py-1">
                          <AlertCircle size={14} className="shrink-0" />
                          <span>Insufficient FISH balance. Exceeds by {(convertAmount - (userProfile?.coins || 0)).toLocaleString()} FISH.</span>
                        </div>
                      )}

                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>Min Convert: {MIN_CONVERSION.toLocaleString()} FISH</span>
                        <button 
                          type="button" 
                          onClick={() => setConvertAmount(userProfile?.coins || 0)}
                          className="text-yellow-500 font-bold hover:underline"
                        >
                          Use Max
                        </button>
                      </div>
                    </div>

                    <AnimatePresence>
                      {convertError && (
                        <motion.div 
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="p-3 bg-red-500/10 border border-red-500/50 rounded-xl text-red-500 text-xs flex items-center gap-2"
                        >
                          <AlertCircle size={14} />
                          {convertError}
                        </motion.div>
                      )}
                      {convertSuccess && (
                        <motion.div 
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="p-3 bg-emerald-500/10 border border-emerald-500/50 rounded-xl text-emerald-500 text-xs flex items-center gap-2"
                        >
                          <CheckCircle size={14} />
                          {convertSuccess}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <button 
                      type="submit"
                      disabled={convertLoading || convertAmount > (userProfile?.coins || 0) || convertAmount < MIN_CONVERSION}
                      className="w-full bg-yellow-600 hover:bg-yellow-500 text-black py-3 rounded-xl font-bold text-center flex items-center justify-center gap-2 transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {convertLoading ? (
                        <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin"></div>
                      ) : (
                        <>
                          {convertAmount > (userProfile?.coins || 0) ? "Insufficient FISH Balance" : "Convert to USDT"} <Send size={16} />
                        </>
                      )}
                    </button>
                  </form>
                </motion.div>

                {/* Withdrawal Form */}
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6"
                >
                  <div className="flex items-center gap-2 text-emerald-400 font-bold">
                    <CreditCard size={20} />
                    <h2>USDT Cash Out</h2>
                  </div>

                  <form onSubmit={promptWithdrawal} className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs text-slate-400 font-semibold">Amount to Withdraw ($USDT)</label>
                      <input 
                        type="number" 
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(parseInt(e.target.value) || 0)}
                        className={`w-full bg-slate-950 border rounded-xl p-4 text-xl font-bold outline-none transition-colors ${
                          withdrawAmount > (userProfile?.points || 0) 
                            ? 'border-red-500/50 text-red-500 focus:border-red-500' 
                            : 'border-slate-800 text-emerald-400 focus:border-emerald-400'
                        }`}
                        placeholder="Min $10 USDT"
                        min={10}
                      />

                      {/* Real-time Validation Error */}
                      {withdrawAmount > (userProfile?.points || 0) && (
                        <div className="text-xs text-red-400 font-semibold flex items-center gap-1.5 py-1">
                          <AlertCircle size={14} className="shrink-0" />
                          <span>Insufficient USDT balance. Exceeds by ${(withdrawAmount - (userProfile?.points || 0)).toFixed(2)} USDT.</span>
                        </div>
                      )}

                      <p className="text-[10px] text-slate-500 italic">Minimum cash out limit is $10.00 USDT.</p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-slate-400 font-semibold">Select Payout Channel</label>
                      <select
                        value={payoutMethod}
                        onChange={(e) => {
                          setPayoutMethod(e.target.value);
                          setWalletAddress('');
                        }}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm focus:border-emerald-500 outline-none text-white font-medium"
                      >
                        <option value="USDT TRC20">USDT (TRC20 Wallet Network)</option>
                        <option value="USDT BEP20">USDT (BEP20 BSC Network)</option>
                        <option value="TON Wallet">TON Wallet Address</option>
                        <option value="Binance UID">Binance User ID (UID)</option>
                        <option value="Bybit UID">Bybit User ID (UID)</option>
                        <option value="Telebirr">Telebirr Mobile Money</option>
                        <option value="Ethiopian Banks">Ethiopian Banks (CBE / Awash / Dashen ...)</option>
                      </select>
                    </div>

                    {/* Conditional Fields based on payout method */}
                    <div className="space-y-2">
                      <label className="text-xs text-slate-500 font-bold uppercase tracking-wider">
                        {payoutMethod.includes('UID') ? 'Exchange Account UID' : payoutMethod === 'Telebirr' ? 'Telebirr Account Number (Phone)' : payoutMethod === 'Ethiopian Banks' ? 'Bank Account Details' : 'Recipient Crypto Wallet Address'}
                      </label>
                      <div className="relative">
                        <textarea 
                          value={walletAddress}
                          onChange={(e) => setWalletAddress(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm focus:border-emerald-500 outline-none font-mono text-emerald-400 min-h-[70px] resize-none"
                          placeholder={
                            payoutMethod === 'TON Wallet' ? 'Enter stable TON Wallet Address (e.g. UQ...)' :
                            payoutMethod === 'USDT TRC20' ? 'Enter TRC-20 Address (starts with T...)' :
                            payoutMethod === 'USDT BEP20' ? 'Enter BEP-20 Address (starts with 0x...)' :
                            payoutMethod === 'Binance UID' ? 'Enter your Binance User ID (UID) (e.g. 58392109)' :
                            payoutMethod === 'Bybit UID' ? 'Enter your Bybit User ID (UID) (e.g. 7483011)' :
                            payoutMethod === 'Telebirr' ? 'Enter Telebirr registered phone number (e.g. 0912345678)' :
                            'Format: Bank Name | Account Holder | Account Number (e.g. CBE | Aster Kebede | 1000123456789)'
                          }
                        />
                      </div>
                    </div>

                    <AnimatePresence>
                      {error && (
                        <motion.div 
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="p-3 bg-red-500/10 border border-red-500/50 rounded-xl text-red-500 text-xs flex items-center gap-2"
                        >
                          <AlertCircle size={14} />
                          {error}
                        </motion.div>
                      )}
                      {success && (
                        <motion.div 
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="p-3 bg-emerald-500/10 border border-emerald-500/50 rounded-xl text-emerald-500 text-xs flex items-center gap-2"
                        >
                          <CheckCircle size={14} />
                          {success}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <button 
                      type="submit"
                      disabled={loading || withdrawAmount > (userProfile?.points || 0) || withdrawAmount < 10}
                      className="w-full bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-500 hover:to-emerald-500 text-white py-4 rounded-xl font-black text-lg shadow-lg shadow-blue-500/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {loading ? (
                        <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      ) : (
                        <>
                          {withdrawAmount > (userProfile?.points || 0) ? "Insufficient USDT Balance" : "Submit Cash Out Request"} <ArrowRight size={20} />
                        </>
                      )}
                    </button>
                  </form>
                </motion.div>
              </div>

              {/* History Column */}
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col h-[700px]"
              >
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold">
                    <History size={20} />
                    <h2>Withdrawal Logs</h2>
                  </div>
                  <span className="text-[10px] bg-slate-800 border border-slate-700 px-2 py-1 rounded text-slate-400 uppercase font-black font-mono">Live Logs</span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                  {history.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-2 py-24">
                      <DollarSign size={48} className="opacity-10 animate-bounce" style={{ animationDuration: '3s' }} />
                      <p className="text-sm italic">No withdrawal requests yet.</p>
                    </div>
                  ) : (
                    history.map((req) => (
                      <div key={req.id} className="bg-slate-950/50 border border-slate-800/40 p-4 rounded-2xl flex items-center justify-between hover:bg-slate-950 transition-all">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-black text-emerald-400">${req.amount.toFixed(2)} USDT</span>
                          </div>
                          <div className="flex flex-col text-[10px] text-slate-400">
                            <span>Method: {req.bankName}</span>
                            <span className="font-mono text-slate-500 truncate max-w-[180px]">{req.accountNumber}</span>
                            <span className="text-slate-600">{req.createdAt?.toDate ? new Date(req.createdAt.toDate()).toLocaleDateString() : new Date().toLocaleDateString()}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {getStatusBadge(req.status)}
                          {req.processedAt && (
                            <span className="text-[8px] text-slate-600 italic">
                              Done
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            </motion.div>
          ) : (
            <motion.div 
              key="deposit-section"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6 flex flex-col items-center justify-center text-center max-w-lg mx-auto"
            >
              <div className="space-y-2">
                <div className="inline-flex p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full mb-2">
                  <Coins size={28} className="animate-pulse" />
                </div>
                <h2 className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">Instant Coins Deposit Store</h2>
                <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                  Support the platform and top up your account instantly. Select your payment amount and crypto asset below via NOWPayments gateway.
                </p>
              </div>

              <div className="w-full flex justify-center overflow-x-auto py-2">
                <iframe 
                  src="https://nowpayments.io/embeds/payment-widget?iid=5338855378" 
                  width="410" 
                  height="696" 
                  frameBorder="0" 
                  scrolling="no" 
                  style={{ overflowY: 'hidden', maxWidth: '100%', borderRadius: '16px' }}
                  title="NOWPayments Deposit Widget"
                  id="nowpayments-widget-iframe"
                >
                  Can't load widget
                </iframe>
              </div>

              <p className="text-[10px] text-slate-500 leading-relaxed font-mono">
                SECURE TRANSACTION PORTAL POWERED BY NOWPAYMENTS.IO
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {showConfirmModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 20, opacity: 0 }}
              transition={{ type: "spring", duration: 0.4 }}
              className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl max-w-md w-full relative overflow-hidden"
            >
              {/* Visual highlights */}
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-500 via-cyan-500 to-emerald-500" />
              
              <div className="space-y-6 pt-2">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 rounded-2xl">
                    <CreditCard size={24} className="animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Confirm Cash Out</h3>
                    <p className="text-xs text-slate-400">Please review your withdrawal request details.</p>
                  </div>
                </div>

                {/* Summary Details */}
                <div className="bg-slate-950 border border-slate-800/60 rounded-2xl p-4 space-y-4 font-sans">
                  <div className="flex justify-between items-baseline border-b border-slate-800/60 pb-3">
                    <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Amount</span>
                    <span className="text-2xl font-black text-emerald-400 font-mono">${withdrawAmount.toFixed(2)} <span className="text-xs text-slate-400 font-sans">USDT</span></span>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Payout Channel</span>
                    <div className="bg-slate-900/60 border border-slate-800 p-2.5 rounded-xl text-xs font-semibold text-white">
                      {payoutMethod}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Destination Address</span>
                    <div className="bg-slate-900/60 border border-slate-800 p-2.5 rounded-xl font-mono text-xs text-blue-400 select-all break-all leading-normal">
                      {walletAddress}
                    </div>
                  </div>
                </div>

                {/* Warning Footer */}
                <div className="flex items-start gap-2.5 bg-yellow-500/5 border border-yellow-500/20 p-3.5 rounded-2xl text-[11px] text-yellow-300 leading-normal">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <p>
                    Ensure the destination address is absolutely correct. Transactions on the blockchain are **unalterable** and **irreversible**.
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(false)}
                    className="py-3 px-4 rounded-xl border border-slate-800 text-xs font-black uppercase tracking-wider text-slate-400 hover:text-white hover:bg-slate-800/40 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmWithdraw}
                    className="py-3 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-500 hover:to-emerald-500 text-white text-xs font-black uppercase tracking-wider shadow-lg shadow-blue-500/10 transition-transform active:scale-95"
                  >
                    Confirm Payout
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default WithdrawalPage;
