import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import userRoutes from './routes/user.js';
import taskRoutes from './routes/tasks.js';
import adminRoutes from './routes/admin.js';
import { initTelegramBot } from './telegramBot.js';

const currentDir = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// 1. Initialize Firebase Admin Resiliently
let firebaseLoaded = false;
try {
  let appletConfig;
  try {
    const configPath = path.join(currentDir, '../firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      appletConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) {}

  const hasPrivateKey = process.env.FIREBASE_PRIVATE_KEY && 
                        process.env.FIREBASE_PRIVATE_KEY.includes('-----BEGIN PRIVATE KEY-----');
  if (hasPrivateKey && process.env.FIREBASE_CLIENT_EMAIL) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      })
    });
    firebaseLoaded = true;
    console.log('Firebase initialized via custom certificate credentials');
  } else if (appletConfig && appletConfig.projectId) {
    admin.initializeApp({
      projectId: appletConfig.projectId
    });
    firebaseLoaded = true;
    console.log('Firebase initialized fallback via Sandbox Project ID:', appletConfig.projectId);
  } else {
    admin.initializeApp();
    firebaseLoaded = true;
    console.log('Firebase initialized via native default application credentials');
  }
} catch (err) {
  console.warn('Resilient Firebase Init Warning:', err.message);
}

// 2. Setup Server Pipeline
const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// Security and Access control foundations
app.use(helmet({
  contentSecurityPolicy: false // Allow modern custom scripts and iframe mounts
}));
app.use(cors());
app.use(express.json());

// Apply global rate limiting to protect endpoints
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests from this IP. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

app.use('/api/user', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', firebase: firebaseLoaded });
});

// Seed Initial Admin and standard engagement tasks for immediate production test if required
app.post('/api/sys/seed', async (req, res) => {
  if (process.env.NODE_ENV === 'production' && req.body.secret !== process.env.JWT_SECRET) {
    return res.status(403).json({ error: 'Unauthorized seed invitation' });
  }

  try {
    const db = admin.firestore();
    
    // Seed standard mock admin uid for AI Studio simulations
    await db.collection('admins').doc('tg_123456789').set({
      telegramId: '123456789',
      role: 'superadmin',
      active: true
    });

    // Seed standard campaign tasks if missing
    const tasksSnap = await db.collection('tasks').get();
    if (tasksSnap.empty) {
      const demoTasks = [
        {
          title: 'Join Oibb Official Channel',
          reward: 500,
          taskType: 'channel_join',
          taskUrl: 'https://t.me/oibbofficial',
          active: true
        },
        {
          title: 'Watch Sponsored Video Ad',
          reward: 200,
          taskType: 'watch_ad',
          taskUrl: 'https://sponsor.example.com/ad',
          active: true
        },
        {
          title: 'Visit Oibb Earn Partner Hub',
          reward: 150,
          taskType: 'visit_website',
          taskUrl: 'https://oibb.io',
          active: true
        }
      ];

      for (const t of demoTasks) {
        await db.collection('tasks').add(t);
      }
    }

    res.json({ success: true, message: 'Simulated admin seeding finished!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve Admin Dashboard page routing
const adminDir = path.join(currentDir, '../admin');
app.use('/admin', express.static(adminDir));

// Full-Stack Express + Vite Integration
async function setupApps() {
  if (process.env.NODE_ENV !== 'production') {
    console.log('Mounting Vite middleware for full-stack integration in dev mode...');
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    console.log('Serving production-ready compiled React app from dist...');
    const distPath = path.resolve(currentDir, '../dist');
    app.use(express.static(distPath));
    
    // Keep index fallback for React SPA Routing
    app.get('/*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

setupApps().catch((err) => {
  console.error('Vite middleware initialization failure:', err);
});

// Start listening
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server executing successfully on http://0.0.0.0:${PORT}`);
  // Run bot engines
  initTelegramBot(app).catch((err) => {
    console.error('Error starting integrated Telegram Bot:', err);
  });
});

export default app;
