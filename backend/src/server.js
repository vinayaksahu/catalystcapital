require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('node:path');
const { initDatabase } = require('./db/database');
const { startRoiCron } = require('./cron/roiCron');
const { globalLimiter } = require('./middleware/rateLimiter');

// Route imports
const authRoutes = require('./routes/authRoutes');
const investmentRoutes = require('./routes/investmentRoutes');
const networkRoutes = require('./routes/networkRoutes');
const walletRoutes = require('./routes/walletRoutes');
const adminRoutes = require('./routes/adminRoutes');
const cronRoutes = require('./routes/cronRoutes');
const notificationRoutes = require('./routes/notificationRoutes');

const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 5000;

// Performance: Gzip/Deflate compression for JSON APIs and static responses
app.use(compression({
  threshold: 1024 // Only compress responses larger than 1KB
}));

// Security Hardening & Headers
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Global DDoS / Flood Rate Limiting for all API routes
app.use('/api/', globalLimiter);

// Lazy/On-demand database initialization middleware for serverless
let dbInitialized = false;
app.use(async (req, res, next) => {
  if (!dbInitialized) {
    try {
      await initDatabase();
      dbInitialized = true;
    } catch (err) {
      console.error('Failed to initialize database tables:', err);
    }
  }
  next();
});

// API Endpoints
app.use('/api/auth', authRoutes);
app.use('/api/investments', investmentRoutes);
app.use('/api/network', networkRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/notifications', notificationRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    system: 'Catalyst Capital MLM Platform',
    database: process.env.DATABASE_URL ? 'Neon Serverless Postgres' : 'SQLite (Local)',
    timestamp: new Date().toISOString()
  });
});

// Serve Frontend Static Assets with HTTP Caching
const rootPublic = path.join(__dirname, '..', '..', 'public');
const frontendPublic = path.join(__dirname, '..', '..', 'frontend', 'public');
const frontendPath = require('node:fs').existsSync(rootPublic) ? rootPublic : frontendPublic;

app.use(express.static(frontendPath, {
  maxAge: '1d',
  etag: true,
  setHeaders: (res, filePath) => {
    // HTML is not cached heavily so app updates apply immediately
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (filePath.match(/\.(png|jpg|jpeg|gif|webp|svg|ico)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable'); // 7 days for images
    } else if (filePath.match(/\.(css|js)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day for CSS/JS
    }
  }
}));

// Fallback to SPA index.html for frontend routing
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// If running in traditional server mode (not Vercel serverless)
if (!process.env.VERCEL) {
  initDatabase().then(() => {
    dbInitialized = true;
    startRoiCron();
    app.listen(PORT, () => {
      console.log(`====================================================`);
      console.log(`🚀 Catalyst Capital MLM Engine is running!`);
      console.log(`🌐 Server URL: http://localhost:${PORT}`);
      console.log(`📊 Mode: ${process.env.DATABASE_URL ? 'Neon Postgres' : 'Local SQLite'}`);
      console.log(`====================================================`);
    });
  }).catch(err => {
    console.error('Initialization error:', err);
  });
}

module.exports = app;
