import admin from 'firebase-admin';

export default async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'User is not authenticated' });
  }

  // Admin access can be checked by JWT role, or verified directly against the `/admins` collection
  try {
    const db = admin.firestore();
    const adminRef = db.collection('admins').doc(req.user.uid || req.user.id || req.user.telegramId);
    const adminSnap = await adminRef.get();

    if (!adminSnap.exists || !adminSnap.data().active) {
      // Also fallback / check custom token role
      if (req.user.role === 'admin' || req.user.role === 'superadmin') {
        return next();
      }
      return res.status(403).json({ error: 'Access denied: Administration rights are required' });
    }

    req.adminUser = adminSnap.data();
    next();
  } catch (err) {
    console.error('Error verifying admin authorization:', err);
    return res.status(500).json({ error: 'Internal administrative authorization check failed' });
  }
};
