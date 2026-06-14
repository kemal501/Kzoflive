import express from 'express';
import admin from 'firebase-admin';
import verifyJWT from '../middleware/verifyJWT.js';
import requireAdmin from '../middleware/requireAdmin.js';
import { processRealPayment } from '../services/paymentService.js';

const router = express.Router();

// Middleware block: Ensure that only verified administrators can call these routes
router.use(verifyJWT);
router.use(requireAdmin);

// Helper for logger tracking
async function logAdminAction(adminId, action, targetId) {
  const db = admin.firestore();
  await db.collection('adminLogs').add({
    adminId,
    action,
    targetId,
    timestamp: new Date().toISOString()
  });
}

// 1. View & Search users database
router.get('/users', async (req, res) => {
  const db = admin.firestore();
  const { search } = req.query;

  try {
    let queryRef = db.collection('users');
    let usersSnap = await queryRef.get();
    let users = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (search && search.trim()) {
      const criteria = search.trim().toLowerCase();
      users = users.filter(u => 
        (u.username && u.username.toLowerCase().includes(criteria)) ||
        (u.telegramId && u.telegramId.includes(criteria)) ||
        (u.firstName && u.firstName.toLowerCase().includes(criteria))
      );
    }

    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Database failed reading accounts' });
  }
});

// Helper to fetch admin role safely
function getAdminRole(req) {
  return req.adminUser?.role || req.user?.role || 'admin';
}

// Helper to create notifications
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
    console.error('Error auto-creating user notification:', err);
  }
}

// 2. Fetch all Withdrawal requests (checking both collections)
router.get('/withdrawals', async (req, res) => {
  const db = admin.firestore();
  const { status } = req.query;

  try {
    // Read from both possible collections for backward/forward compatibility
    const requestsSnap = await db.collection('withdrawalRequests').orderBy('createdAt', 'desc').get();
    let requests = requestsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Fallback if empty to legacy withdrawals collection
    if (requests.length === 0) {
      const legacySnap = await db.collection('withdrawals').orderBy('createdAt', 'desc').get();
      requests = legacySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    if (status) {
      requests = requests.filter(r => r.status === status);
    }

    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: 'Database failed loading withdrawals requests' });
  }
});

// 3. Approve a withdrawal request
// Route explicitly requested: POST /api/admin/withdrawals/:id/approve
router.post('/withdrawals/:id/approve', async (req, res) => {
  const { id } = req.params;
  const db = admin.firestore();
  const adminId = req.user.id || req.user.telegramId;
  const adminRole = getAdminRole(req);

  // Enforce finance privileges!
  const allowedRoles = ['super_admin', 'superadmin', 'admin', 'finance_admin'];
  if (!allowedRoles.includes(adminRole)) {
    return res.status(403).json({ error: `Permission Denied: Your admin role '${adminRole}' cannot manage finances.` });
  }

  // Check both possible collections for the doc
  let withdrawalRef = db.collection('withdrawalRequests').doc(id);

  try {
    let docSnap = await withdrawalRef.get();
    if (!docSnap.exists) {
      withdrawalRef = db.collection('withdrawals').doc(id);
      docSnap = await withdrawalRef.get();
      if (!docSnap.exists) {
        throw new Error('Withdrawal request entry not found in databases');
      }
    }

    const withdrawData = docSnap.data();
    if (withdrawData.status !== 'pending') {
      throw new Error('Withdrawal request has already been finalized/settled');
    }

    // Call real payment integration!
    console.log(`[PAYMENT TRIGGER] Dispatching real payment for request ${id} via gateway...`);
    const payoutResult = await processRealPayment({ id, ...withdrawData });
    console.log(`[PAYMENT TRIGGER] Payout successfully resolved! TxId/Hash: ${payoutResult.transactionId}`);

    await db.runTransaction(async (transaction) => {
      // Update state with gateway details and actual transaction hash
      transaction.update(withdrawalRef, {
        status: 'completed',
        approvedAt: new Date().toISOString(),
        transactionId: payoutResult.transactionId,
        gatewayDetails: payoutResult.gatewayResponse || {}
      });

      // Update the transaction records state
      const userTxRef = db.collection('coinTransactions').doc();
      transaction.set(userTxRef, {
        userId: withdrawData.userId,
        amount: -parseFloat(withdrawData.amount),
        type: 'withdrawal_success',
        transactionId: payoutResult.transactionId,
        createdAt: new Date().toISOString()
      });
    });

    // Write audit trail
    await logAdminAction(adminId, 'APPROVED_WITHDRAWAL', id);

    // Dynamic user notification with real transaction reference ID
    await createNotification(
      withdrawData.userId,
      'Withdrawal Approved! 💰',
      `Your payout of $${withdrawData.amount} USDT has been fully approved and disbursed via ${withdrawData.bankName || 'Selected Channel'}. Reference Hash: ${payoutResult.transactionId.substring(0, 12)}...`,
      'withdrawal'
    );

    res.json({ 
      message: 'Withdrawal approved and processed via live payment gateway successfully',
      transactionId: payoutResult.transactionId
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Approval state transaction rejected' });
  }
});

// 4. Reject a withdrawal request (Refunds coins back to balance)
// Route explicitly requested: POST /api/admin/withdrawals/:id/reject
router.post('/withdrawals/:id/reject', async (req, res) => {
  const { id } = req.params;
  const db = admin.firestore();
  const adminId = req.user.id || req.user.telegramId;
  const adminRole = getAdminRole(req);

  // Enforce finance privileges!
  const allowedRoles = ['super_admin', 'superadmin', 'admin', 'finance_admin'];
  if (!allowedRoles.includes(adminRole)) {
    return res.status(403).json({ error: `Permission Denied: Your admin role '${adminRole}' cannot manage finances.` });
  }

  let withdrawalRef = db.collection('withdrawalRequests').doc(id);

  try {
    let docSnap = await withdrawalRef.get();
    if (!docSnap.exists) {
      withdrawalRef = db.collection('withdrawals').doc(id);
      docSnap = await withdrawalRef.get();
      if (!docSnap.exists) {
        throw new Error('Withdrawal request not found in databases');
      }
    }

    const withdrawData = docSnap.data();
    if (withdrawData.status !== 'pending') {
      throw new Error('Withdrawal is already completed or locked');
    }

    const userRef = db.collection('users').doc(withdrawData.userId);

    await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) {
        throw new Error('Target user account not found');
      }

      const userData = userSnap.data();
      const refundPoints = parseFloat(withdrawData.amount) || 0;

      // Refund USDT balance
      transaction.update(userRef, {
        points: (userData.points || 0) + refundPoints,
        usdtBalance: (userData.usdtBalance || 0) + refundPoints
      });

      // Reject withdrawal details
      transaction.update(withdrawalRef, {
        status: 'rejected',
        approvedAt: new Date().toISOString()
      });

      // Record transaction history refund
      const userTxRef = db.collection('coinTransactions').doc();
      transaction.set(userTxRef, {
        userId: withdrawData.userId,
        amount: refundPoints,
        type: 'withdrawal_refund',
        createdAt: new Date().toISOString()
      });
    });

    // Write audit trail
    await logAdminAction(adminId, 'REJECTED_WITHDRAWAL', id);

    // Dynamic user notification
    await createNotification(
      withdrawData.userId,
      'Withdrawal Rejected ❌',
      `Your payout request of $${withdrawData.amount} USDT via ${withdrawData.bankName} was declined. Funds reverted.`,
      'withdrawal'
    );

    res.json({ message: 'Withdrawal rejected and coins refunded' });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Rejection transaction rejected' });
  }
});

// Broadcast Announcements route
router.post('/broadcast', async (req, res) => {
  const { title, message } = req.body;
  if (!title || !message) {
    return res.status(400).json({ error: 'Title and message details are required.' });
  }

  const adminId = req.user.id || req.user.telegramId;
  const adminRole = getAdminRole(req);

  // Enforce support, content or super admins
  const allowedRoles = ['super_admin', 'superadmin', 'admin', 'content_admin', 'support_admin'];
  if (!allowedRoles.includes(adminRole)) {
    return res.status(403).json({ error: `Permission Denied: Admin role '${adminRole}' cannot broadcast.` });
  }

  try {
    const db = admin.firestore();
    await db.collection('notifications').add({
      userId: 'broadcast',
      title,
      message,
      type: 'announcement',
      read: false,
      createdAt: new Date().toISOString()
    });

    await logAdminAction(adminId, 'BROADCAST_ANNOUNCEMENT', 'all');

    res.json({ success: true, message: 'Announcement broadcasted successfully to all users.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to broadcast announcement.' });
  }
});

// 5. Create new task (campaign)
router.post('/tasks', async (req, res) => {
  const { title, reward, taskType, taskUrl } = req.body;
  const adminId = req.user.id || req.user.telegramId;

  if (!title || !reward || !taskType || !taskUrl) {
    return res.status(400).json({ error: 'Missing parameter names' });
  }

  const db = admin.firestore();
  try {
    const taskData = {
      title,
      reward: parseInt(reward),
      taskType,
      taskUrl,
      active: true,
      createdAt: new Date().toISOString()
    };

    const docRef = await db.collection('tasks').add(taskData);
    await logAdminAction(adminId, 'CREATED_TASK', docRef.id);

    res.json({ message: 'Task campaign added successfully', id: docRef.id });
  } catch (err) {
    res.status(500).json({ error: 'Database failed adding task' });
  }
});

// 6. Edit or toggle campaigns
router.patch('/tasks/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const adminId = req.user.id || req.user.telegramId;
  const updates = req.body;

  const db = admin.firestore();
  try {
    const cleanUpdates = {};
    if (updates.title !== undefined) cleanUpdates.title = updates.title;
    if (updates.reward !== undefined) cleanUpdates.reward = parseInt(updates.reward);
    if (updates.taskType !== undefined) cleanUpdates.taskType = updates.taskType;
    if (updates.taskUrl !== undefined) cleanUpdates.taskUrl = updates.taskUrl;
    if (updates.active !== undefined) cleanUpdates.active = parseBoolean(updates.active);

    await db.collection('tasks').doc(taskId).update(cleanUpdates);
    await logAdminAction(adminId, 'UPDATED_TASK', taskId);

    res.json({ message: 'Task updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Database failed updating campaign' });
  }
});

function parseBoolean(val) {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.toLowerCase() === 'true';
  return false;
}

// 7. Get admin action logs
router.get('/logs', async (req, res) => {
  const db = admin.firestore();
  try {
    const snap = await db.collection('adminLogs').orderBy('timestamp', 'desc').limit(100).get();
    const logs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Database failed reading history logs' });
  }
});

export default router;
