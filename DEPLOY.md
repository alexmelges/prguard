# PRGuard Deployment Guide (for Alexandre)

## Step 1: Deploy to Railway (~2 minutes)

1. Go to https://railway.app — sign in with GitHub
2. Click "New Project" → "Deploy from GitHub repo"
3. Select `alexmelges/prguard`
4. Railway will auto-detect the Dockerfile
5. Add these environment variables in Railway dashboard:
   - `OPENAI_API_KEY` → (our key, I'll provide)
   - `APP_ID` → (from step 2)
   - `PRIVATE_KEY` → (from step 2)  
   - `WEBHOOK_SECRET` → (from step 2)
   - `NODE_ENV` → `production`
   - `LOG_LEVEL` → `info`
6. Railway gives you a URL like `https://prguard-production-xxxx.up.railway.app`
7. Add a persistent volume mounted at `/data` for SQLite

## Step 2: Register GitHub App (~1 minute)

1. Go to: https://github.com/settings/apps/new
2. Fill in:
   - **App name:** `prguard-bot`
   - **Homepage URL:** `https://github.com/alexmelges/prguard`
   - **Webhook URL:** `https://<your-railway-url>/api/github/webhooks`
   - **Webhook secret:** Generate one (e.g. `openssl rand -hex 20`)
3. Permissions:
   - Issues: **Read & Write**
   - Pull requests: **Read**
   - Checks: **Read**
   - Contents: **Read**
   - Metadata: **Read**
4. Subscribe to events:
   - ✅ Issues
   - ✅ Pull request
   - ✅ Check run
5. Click "Create GitHub App"
6. Note the **App ID** from the app settings page
7. Generate a **Private Key** (downloads a .pem file)
8. Copy these back to Railway env vars

## Step 3: Install on a repo

1. Go to `https://github.com/apps/prguard-bot/installations/new`
2. Select the repo(s) you want to protect
3. Done! PRGuard will analyze every new PR and issue.

## Step 4: Configure per-repo (optional)

Create `.github/prguard.yml` in the target repo:
```yaml
vision: "OpenClaw is a personal AI agent platform. PRs should focus on core functionality, stability, and developer experience. No vendor lock-in."
duplicate_threshold: 0.85
deep_review: true
trusted_users:
  - steipete
  - dependabot[bot]
```
