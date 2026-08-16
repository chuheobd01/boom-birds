# Deploy Eggoria to Vercel

The landing page, admin dashboard, Route Handlers, and PostgreSQL integration deploy as one Next.js project.

## Configuration

Import this repository into Vercel using the Next.js framework preset and add these environment variables:

```env
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
GOOGLE_CLIENT_ID=your_web_client_id.apps.googleusercontent.com
SESSION_SECRET=replace-with-a-long-random-secret
ADMIN_DASHBOARD_TOKEN=replace-with-another-long-random-secret
```

The `eggoria_users` table is created automatically on the first database request.

In Google Cloud Console, add the deployed domain to the OAuth Web Client's **Authorized JavaScript origins**. This Google Identity flow does not require a redirect URI.

After deployment:

- Landing page: `https://your-project.vercel.app/`
- Admin dashboard: `https://your-project.vercel.app/admin`

Redeploy after changing environment variables.
