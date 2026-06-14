import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, CheckCircle, Clock, Video, Camera } from 'lucide-react';
import { auth, db } from '../firebase';
import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';

const HostApplicationPage = () => {
  const [agencyCode, setAgencyCode] = useState('');
  const [hostType, setHostType] = useState('standard');
  const [roomCoverUrl, setRoomCoverUrl] = useState('');
  const [trialVideoUrl, setTrialVideoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'none' | 'pending' | 'approved' | 'rejected'>('none');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchStatus = async () => {
      if (auth.currentUser) {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          if (userDoc.data().hostStatus) {
            setStatus(userDoc.data().hostStatus);
          }
        }
      }
    };
    fetchStatus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agencyCode.trim()) {
      setError('Agency code is required.');
      return;
    }
    if (!roomCoverUrl) {
      setError('Room cover image is required.');
      return;
    }
    if ((hostType === 'singer' || hostType === 'quran') && !trialVideoUrl) {
      setError('Trial video is required for Singer and Quran host applications.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      
      const applicationData = {
        userId: auth.currentUser!.uid,
        agencyCode,
        hostType,
        roomCoverUrl,
        trialVideoUrl,
        status: 'pending',
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, 'hostApplications'), applicationData);
      await setDoc(doc(db, 'users', auth.currentUser!.uid), {
        hostStatus: 'pending',
        agencyCode
      }, { merge: true });

      setStatus('pending');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred during submission.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center max-w-2xl mx-auto w-full p-4 relative min-h-screen">
      <button 
        onClick={() => navigate(-1)} 
        className="absolute top-4 left-4 p-2 bg-slate-800 rounded-full hover:bg-slate-700 transition"
      >
        <ArrowLeft size={24} className="text-white" />
      </button>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full mt-12 bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-xl"
      >
        <h1 className="text-2xl font-bold text-white mb-2 text-center text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
          Agency Host Registration
        </h1>
        <p className="text-slate-400 text-sm text-center mb-6">
          Join our agency, complete daily tasks, and earn up to $500+ weekly.
        </p>

        {status === 'pending' ? (
          <div className="flex flex-col items-center justify-center py-10">
            <Clock size={64} className="text-yellow-500 mb-4 animate-pulse" />
            <h2 className="text-xl font-bold text-white mb-2">Application Under Review</h2>
            <p className="text-slate-400 text-center max-w-sm">
              Your application has been received and is currently being reviewed by the agency. Please wait for the system review results.
            </p>
          </div>
        ) : status === 'approved' ? (
          <div className="flex flex-col items-center justify-center py-10">
            <CheckCircle size={64} className="text-green-500 mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">You are a Host!</h2>
            <p className="text-slate-400 text-center max-w-sm mb-6">
              Congratulations! Your application was approved. You can now start earning points and withdrawing your salary weekly.
            </p>
            <button 
              onClick={() => navigate('/earnings')}
              className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-6 rounded-full transition-shadow shadow-lg shadow-purple-500/30"
            >
              Go to Earnings Dashboard
            </button>
          </div>
        ) : status === 'rejected' ? (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
             <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
                 <span className="text-red-500 font-bold text-2xl">X</span>
             </div>
             <h2 className="text-xl font-bold text-white">Application Rejected</h2>
             <p className="text-slate-400">Please review the requirements and reapply if applicable.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {error && <div className="bg-red-500/20 border border-red-500/50 text-red-400 p-3 rounded-lg text-sm">{error}</div>}
            
            <div className="flex flex-col">
              <label className="text-slate-300 text-sm font-semibold mb-1 uppercase tracking-wider">Agency Code *</label>
              <input 
                type="text" 
                placeholder="e.g. X618059"
                value={agencyCode} 
                onChange={(e) => setAgencyCode(e.target.value)} 
                className="bg-slate-800 border border-slate-700 text-white rounded-lg p-3 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition"
              />
              <p className="text-xs text-orange-400 mt-1">📌 No Agency Code = No Salary. Must fill valid code to receive payments.</p>
            </div>

            <div className="flex flex-col">
               <label className="text-slate-300 text-sm font-semibold mb-1 uppercase tracking-wider">Host Role *</label>
               <select 
                  value={hostType} 
                  onChange={(e) => setHostType(e.target.value)}
                  className="bg-slate-800 border border-slate-700 text-white rounded-lg p-3 outline-none focus:border-purple-500 transition"
               >
                 <option value="standard">Standard Host</option>
                 <option value="singer">Singer Host (+$10/Week Reward for passed trial)</option>
                 <option value="quran">Quran Host (+$10/Week Reward for passed trial)</option>
               </select>
            </div>

            <div className="flex flex-col">
              <label className="text-slate-300 text-sm font-semibold mb-1 flex items-center gap-2 uppercase tracking-wider">
                <Camera size={16} /> Room Cover Image URL *
              </label>
              <input 
                type="text" 
                placeholder="https://..."
                value={roomCoverUrl} 
                onChange={(e) => setRoomCoverUrl(e.target.value)} 
                className="bg-slate-800 border border-slate-700 text-white rounded-lg p-3 outline-none focus:border-purple-500 transition"
              />
              <p className="text-xs text-slate-500 mt-1">Please provide a URL to a 1:1 image for your room cover.</p>
            </div>

            {(hostType === 'singer' || hostType === 'quran') && (
              <div className="flex flex-col">
                <label className="text-slate-300 text-sm font-semibold mb-1 flex items-center gap-2 uppercase tracking-wider">
                  <Video size={16} /> 10-Second Trial Video URL *
                </label>
                <input 
                  type="text" 
                  placeholder="https://..."
                  value={trialVideoUrl} 
                  onChange={(e) => setTrialVideoUrl(e.target.value)} 
                  className="bg-slate-800 border border-slate-700 text-white rounded-lg p-3 outline-none focus:border-purple-500 transition"
                />
                <p className="text-xs text-purple-400 mt-1">Send a 10s trial video. If trial is passed, you get an additional $10 weekly reward!</p>
              </div>
            )}

            <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 mt-2 text-sm text-slate-300 flex flex-col gap-2">
               <h4 className="font-bold text-white mb-1">Ways of Earning</h4>
               <p>• <strong>Chatting / Video:</strong> Earn per minute</p>
               <p>• <strong>Gifts:</strong> Extra bonus from users</p>
               <p>• <strong>Tasks:</strong> $3 – $15 daily</p>
               <p className="text-green-400 font-bold">1 Point = $1</p>
            </div>

            <button 
              type="submit"
              disabled={loading}
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold py-4 rounded-xl shadow-lg transition disabled:opacity-50 mt-4 text-lg"
            >
              {loading ? 'Submitting...' : 'Submit Application'}
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
};

export default HostApplicationPage;
