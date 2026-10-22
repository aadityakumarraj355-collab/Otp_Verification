// server/server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import rateLimit from 'express-rate-limit';

// Resolve __dirname in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });
// Validate required environment variables
const requiredEnv = ['FIREBASE_PROJECT_ID', 'SMTP_USER', 'SMTP_PASS', 'OTP_SECRET'];
requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    console.error(`⚠️ Missing required env var: ${key}`);
    process.exit(1);
  }
});
const OTP_SECRET = process.env.OTP_SECRET; // will be used for HMAC

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1kb' })); // limit payload size

// Initialize Firebase Admin SDK
} else {
  // Initialize Firebase Admin SDK using service account JSON
  const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
  // Ensure the file exists before attempting to load it
  if (fs.existsSync(serviceAccountPath)) {
    try {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      console.log('✅ Firebase Admin initialized');
    } catch (e) {
      console.error('⚠️ Failed to initialize Firebase Admin with the provided service account.', e);
      process.exit(1);
    }
  } else {
    console.error('⚠️ Firebase service account file not found at', serviceAccountPath);
    process.exit(1);
  }
}

// In‑memory OTP store
// Structure: uid => { hash: Buffer, expiresAt: number, attempts: number, lastSentAt: number }
const otpStore = new Map();

// Nodemailer transporter (SMTP)
// Configure Nodemailer transporter
let transporter;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  const transportOptions = {
    // Prefer explicit host/port when supplied; otherwise use Gmail service
    ...(process.env.SMTP_HOST && {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false otherwise
    }),
    ...(process.env.SMTP_HOST ? {} : { service: 'gmail' }),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  };
  transporter = nodemailer.createTransport(transportOptions);
  // Verify transporter at startup – abort if it cannot connect
  transporter.verify((err) => {
    if (err) {
      console.error('❌ SMTP transporter verification failed:', err);
      process.exit(1);
    } else {
      console.log('✅ SMTP transporter verified and ready');
    }
  });
} else {
  console.warn('⚠️ SMTP credentials missing – OTP emails will not be sent');
}

// Helper: generate a 6‑digit OTP and a hash
function generateOtp() {
  const otp = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
  const hmac = crypto.createHmac('sha256', OTP_SECRET);
  hmac.update(otp);
  const hash = hmac.digest(); // Buffer
  return { otp, hash };
}

// Middleware: verify Firebase ID token
async function verifyIdToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch (e) {
    console.error('Invalid ID token', e);
    return res.status(401).json({ error: 'Invalid ID token' });
  }
}

// POST /api/otp/send
const otpLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  message: { error: 'Too many OTP requests, please try again later.' },
});
app.use('/api/otp/', otpLimiter);

app.post('/api/otp/send', verifyIdToken, async (req, res) => {
  try {
    const userRecord = await admin.auth().getUser(req.uid);
    if (userRecord.emailVerified) {
      return res.status(400).json({ error: 'Email already verified' });
    }
    const now = Date.now();
    const existing = otpStore.get(req.uid);
    if (existing && now - existing.lastSentAt < 60_000) {
      return res.status(429).json({ error: 'OTP resend cooldown – try again later' });
    }
    const { otp, hash } = generateOtp();
    // Store hash, expiry, reset attempts
    otpStore.set(req.uid, {
      hash,
      expiresAt: now + 10 * 60 * 1000, // 10 minutes
      attempts: 0,
      lastSentAt: now,
    });
    // Send email if transporter is configured
    if (transporter) {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: userRecord.email,
        subject: 'Your OTP code for OTP Verification App',
        text: `Your verification code is ${otp}. It is valid for 10 minutes.`,
      });
    } else {
      console.warn('⚠️ Transporter not configured – OTP not emailed');
    }
    return res.json({ success: true });
  } catch (e) {
    console.error('Error in /api/otp/send', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/otp/verify
app.post('/api/otp/verify', verifyIdToken, async (req, res) => {
  const { otp } = req.body;
  if (!otp || !/^[0-9]{6}$/.test(otp)) {
    return res.status(400).json({ error: 'Invalid OTP format' });
  }
  const entry = otpStore.get(req.uid);
  if (!entry) {
    return res.status(400).json({ error: 'No OTP request found' });
  }
  const now = Date.now();
  if (now > entry.expiresAt) {
    otpStore.delete(req.uid);
    return res.status(400).json({ error: 'OTP expired' });
  }
  // Compute hash of supplied OTP
  const hmac = crypto.createHmac('sha256', process.env.OTP_SECRET || 'default-secret');
  hmac.update(otp);
  const suppliedHash = hmac.digest();
  // Timing‑safe compare
  const match = crypto.timingSafeEqual(entry.hash, suppliedHash);
  if (!match) {
    entry.attempts += 1;
    if (entry.attempts >= 5) {
      otpStore.delete(req.uid);
      return res.status(400).json({ error: 'Maximum verification attempts exceeded' });
    }
    return res.status(400).json({ error: 'Incorrect OTP' });
  }
  // Success – mark email as verified in Firebase
  try {
    await admin.auth().updateUser(req.uid, { emailVerified: true });
    otpStore.delete(req.uid);
    return res.json({ success: true });
  } catch (e) {
    console.error('Failed to update user verification', e);
    return res.status(500).json({ error: 'Failed to verify email' });
  }
});

// GET /api/otp/status
app.get('/api/otp/status', verifyIdToken, async (req, res) => {
  try {
    const user = await admin.auth().getUser(req.uid);
    return res.json({ emailVerified: user.emailVerified });
  } catch (e) {
    console.error('Error fetching user status', e);
    return res.status(500).json({ error: 'Unable to fetch status' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Backend listening on http://localhost:${PORT}`);
});
