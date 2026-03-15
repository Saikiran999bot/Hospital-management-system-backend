# MediCare+ Backend — README

## Overview

The backend (`server.js`) is a **Node.js + Express** REST API server deployed on **Render**. It handles all data operations, authentication, email notifications, AI suggestions, and serves as the single source of truth for both the patient portal and admin panel.

---

## Technology Stack

| Technology | Purpose |
|---|---|
| Node.js 18+ | Runtime |
| Express.js | HTTP server and routing |
| Supabase (PostgreSQL) | Database |
| Brevo | Transactional email |
| Gemini 2.5 Flash | AI home remedy suggestions |
| Twilio (optional) | WhatsApp notifications |
| Telegram Bot API (optional) | Telegram notifications |
| bcryptjs | Password hashing |
| jsonwebtoken | JWT authentication |
| uuid | Unique ID generation |

---

## Environment Variables

Set these in **Render → Environment** before deploying:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (backend only) |
| `JWT_SECRET` | Any long random string for signing tokens |
| `PORT` | Optional — Render sets this automatically |

All other API keys (Gemini, Brevo, Twilio, Telegram) are stored in the **Supabase `settings` table** and can be updated from the Admin Panel without redeploying.

---

## Running Locally

```bash
# Install dependencies
npm install

# Create a .env file with your environment variables
# (see Environment Variables section above)

# Start the server
npm start

# Development with auto-reload
npm run dev
```

Server runs on `http://localhost:3001` by default.

---

## API Reference

### Authentication

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/api/auth/register` | Register a new patient | None |
| POST | `/api/auth/login` | Login (patient or admin) | None |
| GET | `/api/auth/me` | Get current user profile | Token |

### Doctors

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| GET | `/api/doctors` | List all active doctors | None |
| GET | `/api/admin/doctors` | List all doctors (incl. inactive) | Admin |
| POST | `/api/admin/doctors` | Add a new doctor | Admin |
| PUT | `/api/admin/doctors/:id` | Update doctor details | Admin |
| DELETE | `/api/admin/doctors/:id` | Deactivate a doctor | Admin |
| PATCH | `/api/admin/doctors/:id/availability` | Toggle availability | Admin |

### Bookings

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/api/bookings` | Create a new appointment | Token |
| GET | `/api/bookings` | Get current user's bookings | Token |
| GET | `/api/admin/bookings` | Get all bookings | Admin |
| PATCH | `/api/admin/bookings/:id` | Update booking status | Admin |

### Users

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| GET | `/api/admin/users` | List all patients | Admin |
| PATCH | `/api/admin/users/:id` | Block/unblock a patient | Admin |

### Notifications (In-App)

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| GET | `/api/notifications` | Get notifications for current user | Token |
| PATCH | `/api/notifications/:id/read` | Mark notification as read | Token |
| POST | `/api/admin/notifications` | Send notification to user or all | Admin |

### AI

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/api/ai/suggest` | Get AI home remedy suggestion | Token |
| POST | `/api/admin/test-gemini` | Test Gemini API key | Admin |

### Email

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| GET | `/api/admin/email-logs` | View email send history | Admin |
| POST | `/api/admin/email-blast` | Send bulk email to patients | Admin |
| POST | `/api/admin/test-channel` | Test email/telegram/whatsapp | Admin |
| POST | `/api/admin/email-test-direct` | Full email diagnostic | Admin |
| GET | `/api/admin/debug-email` | Show Brevo config status | Admin |

### Offers

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| GET | `/api/offers` | List active offers (patient portal) | None |
| GET | `/api/admin/offers` | List all offers | Admin |
| POST | `/api/admin/offers` | Create new offer | Admin |
| PUT | `/api/admin/offers/:id` | Update offer | Admin |
| DELETE | `/api/admin/offers/:id` | Delete offer | Admin |
| PATCH | `/api/admin/offers/:id/toggle` | Toggle visibility | Admin |

### Settings

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| GET | `/api/settings` | Get all settings status | Admin |
| PUT | `/api/settings/:key` | Update a setting value | Admin |

### Stats & Health

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| GET | `/api/admin/stats` | Dashboard statistics | Admin |
| GET | `/health` | Health check | None |
| GET | `/` | API info | None |

---

## Database Schema

The following tables are required in Supabase:

| Table | Purpose |
|---|---|
| `users` | Patient and admin accounts |
| `doctors` | Doctor profiles and availability |
| `bookings` | Appointment records |
| `notifications` | In-app notifications |
| `settings` | API keys and configuration |
| `email_logs` | Record of every email sent |
| `offers` | Health packages and offers |

Run `supabase_schema.sql` in the Supabase SQL Editor to create all tables, indexes, and seed data.

---

## Notification Channels

The backend supports three notification channels. Each is optional and activates automatically once configured in the `settings` table via the Admin Panel:

| Channel | How it works |
|---|---|
| **Email (Brevo)** | Uses Brevo REST API via `fetch()` — no SMTP, no extra packages |
| **Telegram** | Sends to a bot group/channel via Telegram Bot API |
| **WhatsApp (Twilio)** | Sends via Twilio WhatsApp sandbox or verified number |

All channels are non-blocking — if one fails, the booking still succeeds and other channels still fire.

---

## AI — Gemini 2.5 Flash

- Uses the Gemini REST API directly via `fetch()` — no Google SDK installed
- Tries `gemini-2.5-flash-preview-04-17` first, falls back to `gemini-2.0-flash`
- If no API key is set, returns pre-written fallback remedies based on symptom keywords
- Remedies are stored back on the booking record in Supabase

---

## Settings Cache

The backend caches the `settings` table for **60 seconds** to avoid hitting Supabase on every request. When a setting is saved via the Admin Panel, the cache is immediately cleared so the new value is used on the next request.

---

## Deployment on Render

1. Push code to GitHub
2. Go to **render.com → New → Web Service**
3. Connect your GitHub repository
4. Set:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance Type:** Free
5. Add environment variables (see Environment Variables section)
6. Click **Deploy**

Render will redeploy automatically on every `git push` to the connected branch.

---

## CORS

The server accepts requests from any origin (`*`). This is intentional as both the patient portal and admin panel are served from Vercel and may be on different domains.

---

## Error Handling

- All `/api/*` routes force `Content-Type: application/json` — HTML error pages are never returned
- A catch-all 404 handler returns JSON instead of Express's default HTML
- A global error handler catches unhandled exceptions and returns structured JSON

---

## Dependencies

```json
{
  "express": "^4.18.2",
  "cors": "^2.8.5",
  "@supabase/supabase-js": "^2.39.3",
  "dotenv": "^16.3.1",
  "bcryptjs": "^2.4.3",
  "jsonwebtoken": "^9.0.2",
  "uuid": "^9.0.0"
}
```

No Gemini SDK, no Nodemailer, no Twilio SDK — all third-party services are called via `fetch()` using their REST APIs directly. This keeps the dependency list minimal and avoids common deployment issues.
