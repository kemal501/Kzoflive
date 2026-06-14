import express from 'express';
import admin from 'firebase-admin';
import verifyJWT from '../middleware/verifyJWT.js';

const router = express.Router();

// 1. Get List of Active Tasks
router.get('/', verifyJWT, async (req, res) => {
  const db = admin.firestore();
  try {
    // Read active campaigns
    const tasksSnap = await db.collection('tasks').where('active', '==', true).get();
    const tasks = tasksSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Read user completions to mark tasks as completed
    const completionsSnap = await db.collection('taskCompletions')
      .where('userId', '==', req.user.id)
      .get();
    
    const completedIds = completionsSnap.docs.map(doc => doc.data().taskId);

    // Merge completion state
    const processedTasks = tasks.map(task => ({
      ...task,
      completed: completedIds.includes(task.id)
    }));

    res.json(processedTasks);
  } catch (err) {
    console.error('Error fetching campaigns list:', err);
    res.status(500).json({ error: 'Database failed reading active tasks list' });
  }
});

// 2. Claim Campaign Task Reward (With double-reward prevention)
router.post('/:taskId/claim', verifyJWT, async (req, res) => {
  const { taskId } = req.params;
  const userId = req.user.id;

  const db = admin.firestore();
  const completionId = `${userId}__${taskId}`;
  const completionRef = db.collection('taskCompletions').doc(completionId);
  const userRef = db.collection('users').doc(userId);
  const taskRef = db.collection('tasks').doc(taskId);

  try {
    const successResult = await db.runTransaction(async (transaction) => {
      // 1. Check if user already finished this task
      const completionSnap = await transaction.get(completionRef);
      if (completionSnap.exists) {
        throw new Error('You have already claimed the reward for this task');
      }

      // 2. Read the campaign payout details
      const taskSnap = await transaction.get(taskRef);
      if (!taskSnap.exists || !taskSnap.data().active) {
        throw new Error('Task is not active or does not exist');
      }

      const taskData = taskSnap.data();
      const rewardCoins = parseInt(taskData.reward) || 0;

      // 3. Read user profile details
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) {
        throw new Error('User profile could not be verified');
      }

      const userData = userSnap.data();

      // 4. Update balance records
      transaction.update(userRef, {
        balance: (userData.balance || 0) + rewardCoins,
        totalEarned: (userData.totalEarned || 0) + rewardCoins
      });

      // 5. Register completion lock record
      transaction.set(completionRef, {
        userId,
        taskId,
        claimedAt: new Date().toISOString()
      });

      // 6. Record financial logs entry
      const txRef = db.collection('transactions').doc();
      transaction.set(txRef, {
        userId,
        amount: rewardCoins,
        type: `task_${taskData.taskType}`,
        createdAt: new Date().toISOString()
      });

      return rewardCoins;
    });

    res.json({ message: 'Task reward claimed successfully!', payout: successResult });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Verification pipeline rejected transaction' });
  }
});

export default router;
