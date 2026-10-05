# Catalyst Capital - MLM & ROI Platform

Production-ready ROI and 3-Tier Multi-Level Marketing (MLM) platform for **Catalyst Capital**, designed according to the official promotional brochure and PDF specifications.

Supports serverless deployment on **Vercel** with **Neon Serverless PostgreSQL** database.

---

## 🚀 Key Plan Highlights

### 1. Investment Range
- **Minimum Joining**: $25 USDT
- **Maximum Joining**: $5000 USDT

### 2. Official Investment Packages (from Brochure)
| Plan | Investment | Duration | Daily ROI | Total Return | Return % |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Plan 1** | **$25** | 25 Days | **$0.50 USDT** | $12.50 USDT | +50% |
| **Plan 2** | **$35** | 60 Days | **$1.00 USDT** | $60.00 USDT | +171% |
| **Plan 3** | **$55** | 120 Days | **$1.50 USDT** | $180.00 USDT | +327% |
| **Plan 4** | **$115** | 7 Days | **$2.50 USDT** | $17.50 USDT | +15% |
| **Plan 5** | **$225** | 15 Days | **$4.50 USDT** | $67.50 USDT | +30% |
| **Plan 6** | **$350** | 25 Days | **$6.00 USDT** | $150.00 USDT | +43% |

---

## 💰 Income Streams

### 1. Daily ROI Income
- Credited every 24 hours.
- Supported via **Vercel Cron** (`/api/cron/daily-roi` schedule `0 0 * * *`) and Admin manual trigger.
- Directly credited to the user's **ROI Wallet**.

### 2. Referral Income (ROI of ROI)
Whenever a downline member receives their Daily ROI, upline sponsors receive:
- 🔥 **Level 1 (Directs)**: **10%** of downline's Daily ROI
- ✨ **Level 2**: **4%** of downline's Daily ROI
- ⚡ **Level 3**: **2%** of downline's Daily ROI

### 3. Team Commission (One-Time Instant Commission)
Instant commission credited directly to sponsor's **Commission Wallet** upon downline package activation:
- 🔥 **Level 1 (Directs)**: **6%** of package price
- ✨ **Level 2**: **2%** of package price
- ⚡ **Level 3**: **1%** of package price

---

## 💳 Withdrawal Policy
- **Minimum Withdrawal**: **15 USDT**
- **Withdrawal Fee**: **0% (Zero Fee)**
- **Processing Time**: **0 hr - 24 hr**
- Supported Networks: USDT (TRC20 & BEP20)

---

## ☁️ Deploying to Vercel with Neon PostgreSQL

### Step 1: Create a Free Neon PostgreSQL Database
1. Go to [Neon.tech](https://neon.tech) and create a free account.
2. Create a new Project named `catalystcapital`.
3. In the Neon Console Dashboard, copy your connection string (`DATABASE_URL`):
   ```
   postgresql://[user]:[password]@[endpoint].neon.tech/neondb?sslmode=require
   ```

### Step 2: Deploy on Vercel
1. Go to [Vercel.com](https://vercel.com) and click **"Add New Project"**.
2. Select your GitHub repository: `vinayaksahu/catalystcapital`.
3. In the **Environment Variables** section, add the following variables:
   - `DATABASE_URL`: `postgresql://[user]:[password]@[endpoint].neon.tech/neondb?sslmode=require`
   - `JWT_SECRET`: `your_random_secret_jwt_key_here`
   - `CRON_SECRET`: `your_random_cron_secret_token`
4. Click **Deploy**. Vercel will automatically build the project and launch the serverless function!

### Step 3: Initialize Database & Seed (One-time)
You can initialize your Neon database either automatically (it auto-creates tables on your first visit to your Vercel website) or by running locally:
```bash
# Add DATABASE_URL to your local .env file, then run:
npm run db:init
npm run seed
```

---

## 👥 Demo Pre-Seeded Accounts

| Role | Username | Password | Active Plan | Referral Code |
| :--- | :--- | :--- | :--- | :--- |
| **Admin** | `admin` | `Password@123` | Master Control | `CATADMIN` |
| **Level 1** | `rahul` | `Password@123` | Plan 6 ($350) | `CAT1001` |
| **Level 2** | `priya` | `Password@123` | Plan 5 ($225) | `CAT2002` |
| **Level 3** | `amit` | `Password@123` | Plan 4 ($115) | `CAT3003` |
| **Level 3** | `neha` | `Password@123` | Plan 1 ($25) | `CAT3004` |

---

## 💻 Local Development

```bash
# 1. Install dependencies
npm install

# 2. Run test engine
npm test

# 3. Start local server
npm start
```
Runs at **http://localhost:5000**
