# Deploy Boom Birds to Vercel

The landing page, admin dashboard, API functions, and PostgreSQL integration are deployed as one Vercel project.

## 1. Create the Vercel project

1. Push this repository to GitHub.
2. In Vercel, choose **Add New → Project**.
3. Import the Boom Birds repository.
4. Keep the project root as `./`.
5. Vercel reads `vercel.json` automatically. Do not select the Next.js preset manually.

The production build runs `node scripts/build-static.mjs` and publishes `dist`.

## 2. Add PostgreSQL

Create a Neon PostgreSQL database, either from the Vercel Marketplace or at Neon. Copy its pooled connection string.

In **Vercel → Project → Settings → Environment Variables**, add:

```env
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
```

The `eggoria_users` table is created automatically on the first API request.

## 3. Add application secrets

Add these variables for Production, Preview, and Development as needed:

```env
GOOGLE_CLIENT_ID=your_web_client_id.apps.googleusercontent.com
ADMIN_DASHBOARD_TOKEN=replace-with-a-long-random-secret
```

## 4. Update Google OAuth

In Google Cloud Console, open the OAuth Web Client and add the Vercel domain to **Authorized JavaScript origins**:

```text
https://your-project.vercel.app
```

Add the custom production domain too if one is used. This Google Identity flow does not require a redirect URI.

## 5. Deploy and open

Redeploy after adding environment variables.

```text
Landing page: https://your-project.vercel.app/
Dashboard:    https://your-project.vercel.app/dashboard.html
```

Use the value of `ADMIN_DASHBOARD_TOKEN` to sign in to the dashboard.

## Local Vercel development

Create `.env.local` without committing it:

```env
DATABASE_URL=...
GOOGLE_CLIENT_ID=...
ADMIN_DASHBOARD_TOKEN=...
```

Then run:

```powershell
npx vercel dev
```

Open `http://localhost:3000` and `http://localhost:3000/dashboard.html`.

## Important migration note

Existing records in Netlify Blobs are not copied automatically. New Google connections are written to PostgreSQL. Export and import the old records separately if they must be preserved.
