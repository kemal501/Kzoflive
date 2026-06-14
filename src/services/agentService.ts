import { db } from '../firebase';
import { 
  collection, 
  doc, 
  query, 
  where, 
  getDocs, 
  runTransaction, 
  serverTimestamp,
  addDoc
} from 'firebase/firestore';

export const inviteHost = async (agentId: string, hostId: string) => {
  const invitationRef = collection(db, 'agentInvitations');
  await addDoc(invitationRef, {
    agentId,
    hostId,
    status: 'pending',
    createdAt: serverTimestamp()
  });
};

export const acceptInvitation = async (invitationId: string, hostId: string, agentId: string) => {
  const invitationRef = doc(db, 'agentInvitations', invitationId);
  const hostRef = doc(db, 'users', hostId);

  await runTransaction(db, async (transaction) => {
    transaction.update(invitationRef, { status: 'accepted' });
    transaction.update(hostRef, { referredBy: agentId });
  });
};

export const checkBDSalaryEligibility = async (agentId: string) => {
  // Find all users referred by this agent
  const usersRef = collection(db, 'users');
  const q = query(usersRef, where('referredBy', '==', agentId));
  const querySnapshot = await getDocs(q);

  const referredUsers = querySnapshot.docs.map(doc => doc.data());
  
  // Filter those who became agents
  const hostsWhoBecameAgents = referredUsers.filter(user => user.role === 'agent');

  return hostsWhoBecameAgents.length >= 15;
};

export const claimBDSalary = async (agentId: string) => {
  const isEligible = await checkBDSalaryEligibility(agentId);
  if (!isEligible) throw new Error("Not eligible for BD salary. Need 15 hosts who became agents.");

  const agentRef = doc(db, 'users', agentId);
  const salaryAmountInCoins = 5000; // Assuming 1 USD = 100 coins, so 50 USD = 5000 coins

  await runTransaction(db, async (transaction) => {
    const agentDoc = await transaction.get(agentRef);
    if (!agentDoc.exists()) throw new Error("Agent not found");

    const currentCoins = agentDoc.data().coins || 0;
    transaction.update(agentRef, { coins: currentCoins + salaryAmountInCoins });

    const transactionRef = doc(collection(db, 'coinTransactions'));
    transaction.set(transactionRef, {
      userId: agentId,
      amount: salaryAmountInCoins,
      type: 'salary',
      createdAt: serverTimestamp()
    });
  });

  return salaryAmountInCoins;
};
