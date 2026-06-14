# Oibb Earn - Telegram Mini App

A complete, production-ready, feature-rich Telegram Mini App where users complete engagement tasks (such as joining channels, watching ads, or visiting web pages) to earn coin rewards, invite referrals, and request secure cash withdrawals. Features a dedicated, secure administrator console with action audit logs, real-time metrics, user searching, and state-locked transactions.

## Project Structure

```text
Oibb Earn/
├── frontend/               # Telegram Mini Application client
│   ├── index.html          # Main application interface
│   ├── css/style.css       # Mobile-optimized dark-mode styling
│   └── js/app.js           # Navigation, auth simulation, and API handlers
├── admin/                  # Secure administrator console pages
│   ├── dashboard.html      # Overview statistics, charts, and global state
│   ├── users.html          # User accounts, search, balances, and history
│   ├── withdrawals.html    # Manage, approve, and reject withdrawal claims
│   ├── tasks.html          # Create, edit, and toggle engagement campaigns
│   └── logs.html           # Read-only admin activity audits
├── backend/                # Server-side environment (Node.js & Express)
│   ├── config/             # Firebase configuration
│   ├── middleware/         # Security and authentication pipelines
│   │   ├── verifyTelegram.js
│   │   ├── verifyJWT.js
│   │   └── requireAdmin.js
│   ├── routes/             # Back-end controllers
│   │   ├── user.js
│   │   ├── tasks.js
│   │   └── admin.js
│   └── server.js           # Server initializer and pipeline mount
├── firestore.rules         # Zero-Trust Attribute-Based Access rules
└── package.json            # Manifest file
```

---

## Technical Specifications

### Tech Stack
- **Frontend**: HTML5, Tailwind CSS, JavaScript (ES6+), Telegram WebApp SDK, Lucide Icons
- **Backend**: Node.js, Express.js, JSON Web Tokens (JWT), Helmet.js, Express Rate Limit
- **Database**: Firebase Firestore, Firebase Admin SDK

### Task System
Allows administrators to define campaigns with customizable payouts:
- **Join Telegram channel**
- **Visit website**
- **Watch rewarded ads**
- **Follow social media**
- **Daily login bonus** (staged on a 24-hour cycle)

### Withdrawal Gateways
Allows users to request cash out through five production integrations:
1. **TON** (The Open Network)
2. **USDT** (TRC-20)
3. **Bybit UID** (Internal transfer)
4. **Telebirr** (Mobile-money wallet placeholder)
5. **SantimPay** (Ethiopian fintech playground placeholder)

---

## Installation & Setup

### Prerequisites
1. Node.js (v18.0 or higher)
2. A Firebase Project with **Firestore Database** and **Authentication** enabled.
3. A Telegram Bot token (from [BotFather](https://t.me/BotFather)) to serve as validation key.

### Configuration
1. Clone the project and navigate to the root directory.
2. Create a `.env` file from the variables template:
   ```bash
   cp .env.example .env
   ```
3. Populate `.env` with your Firestore configuration, Telegram Bot credentials, and secret signing key:
   ```env
   PORT=3000
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_CLIENT_EMAIL=your-service-account-email
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
   TELEGRAM_BOT_TOKEN=your-telegram-bot-token
   JWT_SECRET=your-secure-jwt-signing-key
   NODE_ENV=production
   ```

### Running the App Locally
Install dependencies and launch the server:
```bash
npm install
npm run dev
```
The application will boot up and bind to `http://localhost:3000`.

---

## Security Framework

1. **Authentication Integrity**: All client requests to backend endpoints verify the standard Telegram Mini App verification checksum (`initData` hash check using `TELEGRAM_BOT_TOKEN`) and sign access via short-lived JWT.
2. **State Protection**: User coin balances are modified strictly server-side inside Firestore transactions to prevent double-spending or client-state tampering.
3. **Immortal Fields**: Primary user fields (`referredBy`, `createdAt`) are secured using write-once conditions in the Firestore database configuration.
4. **Audit Pipelines**: Every action executed by an administrator (such as approving/rejecting withdrawals, editing rewards) registers a lock-down record in the `/adminLogs` collection.
