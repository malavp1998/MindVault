# MindVault Slack Integration — Production Deployment Guide

Since your MindVault backend is hosted on **Render**, you don't need `ngrok` for production. Your Render URL will act as the public webhook that Slack communicates with.

Here are the complete steps to deploy and test your new Slack integration.

## Step 1: Push Code to GitHub
The recent code changes added the Slack event listeners (`slack.py`), updated `models.py`, and added the Slack SDK to `requirements.txt`.
First, commit and push these changes to your GitHub branch. Render will automatically detect the push, rebuild, and deploy the latest version of your backend.

## Step 2: Update the Production Database
We added a `slack_user_id` column to the `User` model to link Slack users to MindVault accounts. Because FastAPI's `Base.metadata.create_all()` does not automatically alter existing tables, you need to add this column to your production database (e.g., in Neon's SQL Editor):

```sql
ALTER TABLE users ADD COLUMN slack_user_id VARCHAR(128) UNIQUE;
CREATE INDEX ix_users_slack_user_id ON users (slack_user_id);
```

## Step 3: Create the Slack App
1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App** (from scratch).
2. Name it "MindVault" and select your workspace.
3. On the left sidebar, click **OAuth & Permissions**. Scroll down to **Scopes > Bot Token Scopes** and add:
   - `app_mentions:read`
   - `channels:history`
   - `chat:write`
   - `im:history`
   - `im:read`
   - `im:write`
4. Scroll to the top and click **Install to Workspace**.
5. Once installed, copy the **Bot User OAuth Token** (starts with `xoxb-`).
6. Go back to **Basic Information** on the left menu, scroll down to **App Credentials**, and copy the **Signing Secret**.

## Step 4: Add Environment Variables to Render
1. Go to your Render Dashboard and select your MindVault Backend Web Service.
2. Go to **Environment** on the left menu.
3. Add the two new environment variables you got from Slack:
   - `SLACK_BOT_TOKEN="xoxb-your-bot-token"`
   - `SLACK_SIGNING_SECRET="your-signing-secret"`
4. Click **Save Changes** (this will trigger a restart on Render so the variables take effect).

## Step 5: Connect Slack to Your Render URL
1. Wait for your Render backend to finish deploying.
2. Go back to your Slack App settings at [api.slack.com/apps](https://api.slack.com/apps) and click **Event Subscriptions** on the left.
3. Toggle "Enable Events" to **On**.
4. In the **Request URL** field, paste your Render backend URL with `/slack/events` added to the end.
   - Example: `https://mindvault-backend-xxxx.onrender.com/slack/events`
   - *Slack will immediately ping this URL. If your backend is successfully live on Render, it will display "Verified ✅" in green.*
5. Still under Event Subscriptions, scroll down to **Subscribe to bot events** and click "Add Bot User Event". Add these two:
   - `app_mention`
   - `message.im`
6. Click **Save Changes** at the bottom. (Slack might prompt you to reinstall the app—do so if asked).

## Step 6: Test It in Slack
Your production integration is now live! Open your Slack workspace:
1. Find your **MindVault** bot under the "Apps" section in the left sidebar (or search for it).
2. Send it a Direct Message to test the **Saving Intent**:
   > *"Save this tip: MindVault can now listen to Slack events locally or in production via Render."*
3. The bot will automatically reply, letting you know it's saving to your vault.
4. Next, test the **Search/Chat Intent**:
   > *"What did I just say about listening to Slack events?"*
5. The bot will query your production `pgvector` database and reply directly in the thread with the synthesized answer.
