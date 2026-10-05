# Catalyst Capital - MLM & ROI Platform

Production-ready ROI and 3-Tier Multi-Level Marketing (MLM) platform for **Catalyst Capital**, designed according to the official promotional brochure and PDF specifications.

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
- Credited every 24 hours (automated daily midnight cron job or manual admin trigger).
- Directly credited to the user's **ROI Wallet**.
- Automatically marks investments as `completed` once all days are credited.

### 2. Referral Income (ROI of ROI)
Whenever a downline member receives their Daily ROI, upline sponsors receive a percentage of that daily payout:
- 🔥 **Level 1 (Directs)**: **10%** of downline's Daily ROI
- ✨ **Level 2**: **4%** of downline's Daily ROI
- ⚡ **Level 3**: **2%** of downline's Daily ROI

*Example:* If a Level 1 member is on Plan 6 ($6.00/day ROI), their sponsor receives **$0.60/day** every day!

### 3. Team Commission (One-Time Instant Commission)
Instant commission credited directly to the sponsor's **Commission Wallet** upon downline package activation:
- 🔥 **Level 1 (Directs)**: **6%** of package price
- ✨ **Level 2**: **2%** of package price
- ⚡ **Level 3**: **1%** of package price

*Example:* When a downline member activates Plan 6 ($350):
- Level 1 Sponsor gets **$21.00** (6%)
- Level 2 Sponsor gets **$7.00** (2%)
- Level 3 Sponsor gets **$3.50** (1%)

---

## 💳 Withdrawal Policy
- **Minimum Withdrawal**: **15 USDT**
- **Withdrawal Fee**: **0% (Zero Fee)**
- **Processing Time**: **0 hr - 24 hr**
- Supported Networks: USDT (TRC20 & BEP20)
- Auto refund on administrative rejection.

---

## 🛠 Tech Stack & Architecture

- **Backend**: Node.js & Express
- **Database**: Native in-process C-level SQLite (`node:sqlite`) — zero external database server required, fast and ACID compliant.
- **Frontend**: Responsive Single Page App (Tailwind CSS, Lucide icons, Chart.js).
- **Automation**: `node-cron` running daily ROI & referral distributions at 00:00 midnight.
- **Security**: Password hashing with `bcryptjs`, JWT token authentication with role guards.

---

## ⚡ Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Seed Database with Test MLM Tree
```bash
npm run seed
```

### 3. Run Automated Engine Test Suite
```bash
npm test
```

### 4. Start the Server
```bash
npm start
```
Open **[http://localhost:5000](http://localhost:5000)** in your browser!

---

## 👥 Demo Pre-Seeded Accounts

| Role | Username | Password | Sponsor | Active Plan | Referral Code |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Admin** | `admin` | `Password@123` | - | Master | `CATADMIN` |
| **Level 1** | `rahul` | `Password@123` | admin | Plan 6 ($350) | `CAT1001` |
| **Level 2** | `priya` | `Password@123` | rahul | Plan 5 ($225) | `CAT2002` |
| **Level 3** | `amit` | `Password@123` | priya | Plan 4 ($115) | `CAT3003` |
| **Level 3** | `neha` | `Password@123` | priya | Plan 1 ($25) | `CAT3004` |

*(Tip: In the top banner of the web application, you can click on the quick login buttons: "Admin", "Rahul (L1)", "Priya (L2)", "Amit (L3)" to seamlessly switch between accounts and test all features!)*

---

## 🔌 API Endpoints Reference

### Authentication
- `POST /api/auth/register` — Register with optional sponsor code
- `POST /api/auth/login` — Login with username/email & password
- `GET /api/auth/me` — Current user profile and wallet balances

### Investments
- `GET /api/investments/plans` — List the 6 predefined Catalyst Capital packages
- `POST /api/investments/purchase` — Activate package and trigger team commissions
- `GET /api/investments/my` — User active & past investments with progress

### MLM Network
- `GET /api/network/downline-stats` — Counts & volumes for Level 1, 2, and 3
- `GET /api/network/tree` — Hierarchical genealogy tree data
- `GET /api/network/direct-referrals` — Direct referrals list with earnings

### Wallet & Finance
- `GET /api/wallet/overview` — Deposit, ROI, Commission & withdrawable balances
- `POST /api/wallet/deposit` — Deposit USDT
- `POST /api/wallet/transfer` — Reinvest earnings to deposit wallet
- `POST /api/wallet/withdraw` — Request withdrawal (min 15 USDT, 0% fee)
- `GET /api/wallet/transactions` — Full audit ledger with type filter
- `GET /api/wallet/withdrawals` — User withdrawal history

### Admin Control Center
- `GET /api/admin/stats` — Platform KPI analytics
- `GET /api/admin/users` — Member directory & investments
- `POST /api/admin/adjust-balance` — Credit/debit user balances
- `GET /api/admin/withdrawals` — List pending withdrawal requests
- `POST /api/admin/withdrawals/:id/approve` — Approve with TX hash
- `POST /api/admin/withdrawals/:id/reject` — Reject with reason and auto-refund
- `POST /api/admin/trigger-daily-roi` — Trigger today's Daily ROI & Referral Income cycle
