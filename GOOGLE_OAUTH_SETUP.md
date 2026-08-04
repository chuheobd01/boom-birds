# Google Sign-In + Netlify setup

## 1. Create a Google Web OAuth client

In Google Cloud Console, configure the OAuth consent screen and create an OAuth client with application type **Web application**.

Add these Authorized JavaScript origins:

- `http://localhost:8888`
- Your production origin, for example `https://your-site.netlify.app`
- Your custom domain, if one is connected

Copy the generated client ID ending in `.apps.googleusercontent.com`.

## 2. Configure Netlify

Open **Project configuration → Environment variables** and add:

```text
GOOGLE_CLIENT_ID=your_web_client_id.apps.googleusercontent.com
```

The same value is injected into the static HTML during build and used by the Netlify Function to verify Google's ID token. No Google client secret is required by this flow.

## 3. Run locally

Live Server can display the interface, but it cannot execute Netlify Functions or Netlify Blobs. Use Netlify Dev for the complete authentication flow:

```bash
npx netlify dev
```

Then open `http://localhost:8888`.

## Stored and public data

The private Netlify Blob record contains Google `sub`, email, name, avatar URL and timestamps. The public community response exposes only an anonymous Explorer ID, verification status and connection date. The currently authenticated user receives their own name, email and avatar in the immediate sign-in response.
