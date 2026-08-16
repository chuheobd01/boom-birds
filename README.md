# Eggoria

Eggoria is a Next.js 16 App Router application for the Eggoria waitlist. It includes the animated landing page, Google Identity sign-in, referral tracking, Neon PostgreSQL persistence, signed sessions, and an admin dashboard.

## Local development

Create `.env.local`:

```env
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
GOOGLE_CLIENT_ID=your_web_client_id.apps.googleusercontent.com
SESSION_SECRET=replace-with-a-long-random-secret
ADMIN_DASHBOARD_TOKEN=replace-with-another-long-random-secret
```

Then run:

```bash
npm install
npm run dev
```

- Landing page: `http://localhost:3000`
- Admin dashboard: `http://localhost:3000/admin`

## Verification

```bash
npm run lint
npm run build
```
