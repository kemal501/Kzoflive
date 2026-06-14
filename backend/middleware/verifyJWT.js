import jwt from 'jsonwebtoken';
import admin from 'firebase-admin';

export default async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Authorization header is missing' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Token is missing from Authorization header' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    req.user = decoded;
    return next();
  } catch (err) {
    // Fallback: Verify as a Firebase ID Token for web clients in the sandbox!
    try {
      const decodedFirebaseUser = await admin.auth().verifyIdToken(token);
      req.user = {
        id: decodedFirebaseUser.uid,
        uid: decodedFirebaseUser.uid,
        telegramId: decodedFirebaseUser.uid,
        email: decodedFirebaseUser.email,
        role: decodedFirebaseUser.role || 'user'
      };
      return next();
    } catch (fbErr) {
      return res.status(403).json({ error: 'Token is invalid, expired, or rejected by auth filters' });
    }
  }
};
