import React, { useState, useEffect } from 'react';
import { claimBDSalary, inviteHost, acceptInvitation } from '../services/agentService';
import { auth, db } from '../firebase';
import { collection, query, where, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import { getUserProfile, User, upgradeToAgent } from '../services/userService';

// Helper types
interface HostApplication {
  id: string;
  userId: string;
  agencyCode: string;
  hostType: string;
  roomCoverUrl: string;
  trialVideoUrl?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: any;
}

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

interface Invitation {
  id: string;
  agentId: string;
  hostId: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

const AgentDashboard: React.FC = () => {
  const [userProfile, setUserProfile] = useState<User | null>(null);
  const [isEligible, setIsEligible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [hostId, setHostId] = useState('');
  const [referralsCount, setReferralsCount] = useState(0);
  const [pendingInvitations, setPendingInvitations] = useState<Invitation[]>([]);
  const [hostApplications, setHostApplications] = useState<HostApplication[]>([]);

  useEffect(() => {
    if (!auth.currentUser) return;

    const fetchProfile = async () => {
      const profile = await getUserProfile(auth.currentUser!.uid);
      setUserProfile(profile);
    };
    fetchProfile();

    const qReferrals = query(collection(db, 'users'), where('referredBy', '==', auth.currentUser.uid));
    const unsubscribeReferrals = onSnapshot(qReferrals, (snapshot) => {
      const referredUsers = snapshot.docs.map(doc => doc.data());
      const hostsWhoBecameAgents = referredUsers.filter(user => user.role === 'agent');
      setReferralsCount(hostsWhoBecameAgents.length);
      setIsEligible(hostsWhoBecameAgents.length >= 15);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });

    const qInvites = query(collection(db, 'agentInvitations'), where('hostId', '==', auth.currentUser.uid), where('status', '==', 'pending'));
    const unsubscribeInvites = onSnapshot(qInvites, (snapshot) => {
      setPendingInvitations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Invitation)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'agentInvitations');
    });

    // We can filter by agency code locally since agent's code might map to their referralCode
    const unsubscribeApps = onSnapshot(query(collection(db, 'hostApplications'), where('status', '==', 'pending')), (snapshot) => {
       const apps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as HostApplication));
       setHostApplications(apps);
    }, (error) => {
       handleFirestoreError(error, OperationType.LIST, 'hostApplications');
    });

    return () => {
      unsubscribeReferrals();
      unsubscribeInvites();
      unsubscribeApps();
    };
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !hostId) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await inviteHost(auth.currentUser.uid, hostId);
      setSuccess(`Invitation sent to host ${hostId}`);
      setHostId('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptAndUpgrade = async (invitationId: string, agentId: string) => {
    if (!auth.currentUser) return;
    setLoading(true);
    setError(null);
    try {
      await acceptInvitation(invitationId, auth.currentUser.uid, agentId);
      await upgradeToAgent(auth.currentUser.uid);
      setSuccess("Successfully accepted invitation and upgraded to Agent role!");
      const profile = await getUserProfile(auth.currentUser.uid);
      setUserProfile(profile);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClaimSalary = async () => {
    if (!auth.currentUser) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const amount = await claimBDSalary(auth.currentUser.uid);
      setSuccess(`Successfully claimed BD salary of ${amount} coins (50 USD equivalent)`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApproveHost = async (app: HostApplication) => {
    setLoading(true);
    try {
      await updateDoc(doc(db, 'hostApplications', app.id), { status: 'approved' });
      await updateDoc(doc(db, 'users', app.userId), { 
        role: 'host', 
        hostStatus: 'approved',
        agencyCode: app.agencyCode,
        referredBy: auth.currentUser?.uid
      });
      setSuccess(`Host ${app.userId} approved successfully!`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!userProfile) return <div className="p-8 text-center text-white">Loading...</div>;

  // Assume agency code is their referral code or they manage the hardcoded one
  const myHostApplications = hostApplications.filter(app => app.agencyCode === userProfile?.referralCode || userProfile?.role === 'admin' || userProfile?.role === 'agent');

  return (
    <div className="bg-slate-800 p-6 rounded-xl shadow-2xl border border-slate-700 max-w-md w-full">
      <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
        <span className="text-blue-500">💼</span> Agent Dashboard
      </h2>
      
      {userProfile.role === 'agent' ? (
        <>
          <div className="mb-6 p-4 bg-slate-900 rounded-lg border border-slate-700">
            <h3 className="text-sm font-bold text-slate-400 uppercase mb-2">BD Salary Progress</h3>
            <div className="flex items-center justify-between mb-2">
              <span className="text-white font-bold">{referralsCount} / 15</span>
              <span className="text-xs text-slate-500">Hosts who became Agents</span>
            </div>
            <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-500" 
                style={{ width: `${Math.min((referralsCount / 15) * 100, 100)}%` }}
              />
            </div>
            {isEligible && (
              <button 
                onClick={handleClaimSalary}
                disabled={loading}
                className="mt-4 w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 rounded shadow-lg transition-all disabled:opacity-50"
              >
                {loading ? 'Claiming...' : 'Claim 50 USD Salary'}
              </button>
            )}
          </div>

          <form onSubmit={handleInvite} className="flex flex-col gap-4 mb-6">
            <h3 className="text-sm font-bold text-slate-400 uppercase">Invite New Host</h3>
            <div className="flex flex-col gap-1">
              <input 
                type="text" 
                value={hostId} 
                onChange={(e) => setHostId(e.target.value)}
                className="bg-slate-900 p-3 rounded text-white border border-slate-700 focus:border-blue-500 outline-none transition-colors"
                placeholder="Enter Host ID..."
                required
              />
            </div>
            <button 
              type="submit" 
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg shadow-lg transition-all disabled:opacity-50"
            >
              {loading ? 'Sending...' : 'Send Invitation'}
            </button>
          </form>

          {myHostApplications.length > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-bold text-slate-400 uppercase">Pending Host Applications</h3>
              {myHostApplications.map((app) => (
                <div key={app.id} className="bg-slate-900 p-4 rounded-lg border border-slate-700 flex flex-col gap-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-white text-sm font-bold">User: <span className="text-blue-400 font-mono">{app.userId.slice(0, 8)}...</span></p>
                      <p className="text-slate-500 text-xs">Type: {app.hostType}</p>
                    </div>
                    <button 
                      onClick={() => handleApproveHost(app)}
                      disabled={loading}
                      className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-3 py-2 rounded transition-all disabled:opacity-50"
                    >
                      Approve
                    </button>
                  </div>
                  <div className="text-xs text-slate-400 flex flex-col gap-1 mt-2">
                    <a href={app.roomCoverUrl} target="_blank" rel="noreferrer" className="text-purple-400 hover:underline">View Room Cover</a>
                    {app.trialVideoUrl && (
                      <a href={app.trialVideoUrl} target="_blank" rel="noreferrer" className="text-pink-400 hover:underline">Watch 10s Trial Video</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-slate-300 text-sm">You are currently a <span className="text-blue-400 font-bold uppercase">{userProfile.role}</span>. To become an Agent and earn BD salary, you must be invited by an existing Agent.</p>
          
          {pendingInvitations.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-bold text-slate-400 uppercase">Pending Invitations</h3>
              {pendingInvitations.map((invite: Invitation) => (
                <div key={invite.id} className="bg-slate-900 p-4 rounded-lg border border-slate-700 flex justify-between items-center">
                  <div>
                    <p className="text-white text-sm font-bold">Invitation from Agent</p>
                    <p className="text-slate-500 text-xs">{invite.agentId}</p>
                  </div>
                  <button 
                    onClick={() => handleAcceptAndUpgrade(invite.id, invite.agentId)}
                    disabled={loading}
                    className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-3 py-2 rounded transition-all disabled:opacity-50"
                  >
                    Accept & Become Agent
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/50 text-center">
              <p className="text-slate-500 text-sm italic">No pending invitations found.</p>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
      {success && <p className="text-green-500 text-sm mt-4">{success}</p>}
    </div>
  );
};

export default AgentDashboard;
