require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('node:path');
const { initDatabase } = require('./db/database');
const { startRoiCron } = require('./cron/roiCron');

// Route imports
const authRoutes = require('./routes/authRoutes');
const investmentRoutes = require('./routes/investmentRoutes');
const networkRoutes = require('./routes/networkRoutes');
const walletRoutes = require('./routes/walletRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Database & Tables
initDatabase();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Endpoints
app.use('/api/auth', authRoutes);
app.use('/api/investments', investmentRoutes);
app.use('/api/network', networkRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/admin', adminRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    system: 'Catalyst Capital MLM Platform',
    timestamp: new Date().toISOString()
  });
});

// Serve Frontend Static Assets
const frontendPath = path.join(__dirname, '..', '..', 'frontend', 'public');
app.use(express.static(frontendPath));

// Fallback to SPA index.html
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Start Background Cron
startRoiCron();

// Start Server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Catalyst Capital MLM Engine is running!`);
  console.log(`🌐 Server URL: http://localhost:${PORT}`);
  console.log(`📊 Mode: Production-ready with native SQLite`);
  console.log(`====================================================`);
});

module.exports = app;
