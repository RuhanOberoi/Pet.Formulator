# PetForm Pro — Production Deployment Guide

Complete walkthrough to deploy PetForm Pro as a real website with:
- Working AI Builder (with secure API key handling)
- Real email-based authentication with email verification
- Per-user cloud-saved formulas (Supabase database)
- Custom domain with HTTPS

**Total time:** 2-3 hours · **Total cost:** ~$11/year (just the domain)

---

## What You're Building

```
[User's browser]
       ↓
[Your domain: petformpro.com]
       ↓
[Vercel — hosts your HTML + serverless functions]
       ↓ (for AI requests)
[/api/ai-proxy] → [Anthropic API]  (server-side, key hidden)
       ↓ (for data)
[Supabase] → [PostgreSQL DB + Email Auth + Email verification]
```

---

## Files in This Package

```
production/
├── index.html              ← Your main app (rename petform-pro-5.html to this)
├── auth-confirm.html       ← Email verification landing page
├── vercel.json             ← Vercel configuration
├── api/
│   └── ai-proxy.js         ← Serverless function for Claude API
├── supabase/
│   ├── schema.sql          ← Database tables and security
│   └── integration.js      ← Frontend Supabase adapter
└── PRODUCTION-SETUP.md     ← This file
```

---

## Step 1 — Create Supabase Project (15 minutes)

1. Go to **https://supabase.com** and sign up (free, no credit card)
2. Click **"New Project"**
3. Choose:
   - **Name:** `petform-pro`
   - **Database password:** generate a strong one and save it
   - **Region:** closest to your target users (e.g. `us-east-1` or `eu-west-1`)
   - **Plan:** Free (covers up to 50,000 monthly active users)
4. Wait ~2 minutes for project creation

5. **Get your API keys:**
   - Go to **Settings → API**
   - Copy your **Project URL** (e.g. `https://abcdefgh.supabase.co`)
   - Copy your **`anon` public key** (this is safe to put in browser code)
   - Save both — you'll need them in Steps 3 and 4

6. **Set up the database schema:**
   - Go to **SQL Editor → New Query**
   - Open `production/supabase/schema.sql` from this package
   - Copy the entire contents and paste into Supabase SQL Editor
   - Click **"Run"** — should see "Success. No rows returned"

7. **Configure Email Authentication:**
   - Go to **Authentication → Providers**
   - Make sure **Email** is enabled (it is by default)
   - Toggle **"Confirm email"** to ON (this enforces email verification)

8. **Configure URLs:**
   - Go to **Authentication → URL Configuration**
   - **Site URL:** set to your production domain (e.g. `https://petformpro.com`)
     - For initial testing, you can use Vercel's auto URL like `https://petform-pro.vercel.app`
   - **Redirect URLs:** add `https://yourdomain.com/**` and `https://*.vercel.app/**`

9. **Customize the verification email** (optional but recommended):
   - Go to **Authentication → Email Templates → Confirm signup**
   - Replace the default with this branded version:

```html
<h2>Welcome to PetForm Pro! 🐾</h2>
<p>Hi {{ .UserMetaData.name }},</p>
<p>Thanks for signing up. Please verify your email address by clicking the button below:</p>
<p><a href="{{ .ConfirmationURL }}" style="background:#f0a500;color:#000;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:bold;display:inline-block;">Verify My Email</a></p>
<p>Or copy this link: {{ .ConfirmationURL }}</p>
<p>If you didn't create this account, you can safely ignore this email.</p>
<hr>
<p style="color:#666;font-size:12px;">PetForm Pro — Built by Ruhan Oberoi<br>For reference and educational purposes only.</p>
```

---

## Step 2 — Get an Anthropic API Key (5 minutes)

1. Go to **https://console.anthropic.com/**
2. Sign up or log in
3. Navigate to **API Keys → Create Key**
4. Name it `petform-pro-production`
5. Copy the key (starts with `sk-ant-...`) — **save it securely, it won't be shown again**
6. Add billing: **Settings → Billing → add a credit card**
7. **Set spending limits:** Settings → Limits → add a $20/month cap initially
   - Each AI Builder call costs ~$0.005-0.01
   - You can serve ~2,000-4,000 AI requests/month for $20

---

## Step 3 — Update Configuration in Code

Three files need your Supabase credentials. **Open each and replace placeholders:**

### `production/auth-confirm.html` (line ~108)
```javascript
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';     // ← paste from Step 1.5
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY-HERE';              // ← paste from Step 1.5
```

### `production/supabase/integration.js` (line ~22)
```javascript
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';     // ← paste from Step 1.5
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY-HERE';              // ← paste from Step 1.5
```

### `production/index.html`

**Add this line in the `<head>` section, BEFORE the main `<script>` tag:**
```html
<script src="/supabase/integration.js"></script>
```

This loads Supabase and overrides the local DB layer with cloud calls automatically.

**You also need to update the auth UI** to call the new email-based Supabase methods.
The simplest path: keep your current auth screens but replace the `createUser()` and `loginUser()` functions inside the `UserGate` component to call `window.supabaseAuth.signUp()` and `window.supabaseAuth.signIn()` instead.

A drop-in replacement for the two functions is at the bottom of this guide (Section "Auth Function Replacements").

---

## Step 4 — Deploy to Vercel (10 minutes)

### 4a. Push to GitHub
1. Create a free GitHub account if you don't have one
2. Create a new **private repo** called `petform-pro`
3. Open a terminal in the `production/` folder and run:
```bash
git init
git add .
git commit -m "Initial deployment"
git remote add origin https://github.com/YOUR-USERNAME/petform-pro.git
git push -u origin main
```

### 4b. Deploy to Vercel
1. Go to **https://vercel.com** and sign up (use GitHub login — easiest)
2. Click **"Add New Project"**
3. Select your `petform-pro` GitHub repo
4. **Framework preset:** Other
5. **Root directory:** leave as `.`
6. **Build command:** leave empty
7. **Output directory:** leave empty
8. Click **"Deploy"**

### 4c. Add environment variables
Once deployed:
1. Go to **Settings → Environment Variables**
2. Add:
   - **Name:** `ANTHROPIC_API_KEY` · **Value:** `sk-ant-...` (your key from Step 2)
   - **Name:** `ALLOWED_ORIGIN` · **Value:** `https://yourdomain.com` (or your `*.vercel.app` URL)
3. Click **"Save"**
4. Go to **Deployments** tab → click "..." on latest → **Redeploy** (so env vars apply)

---

## Step 5 — Connect Custom Domain (10 minutes)

### 5a. Buy a domain
- **Cloudflare Registrar** (cheapest, ~$10/year, no upsells): https://www.cloudflare.com/products/registrar/
- **Namecheap**: https://namecheap.com (also good)

Suggested names:
- `petformpro.com`
- `petformulator.com`
- `pawfeed.app`

### 5b. Connect in Vercel
1. Vercel → **Settings → Domains**
2. Add your domain (e.g. `petformpro.com`)
3. Vercel will show you DNS records to add at your registrar:
   - For root domain: an `A` record pointing to `76.76.21.21`
   - For `www`: a `CNAME` pointing to `cname.vercel-dns.com`
4. Add these in your registrar's DNS settings
5. Wait 5-30 minutes for DNS propagation
6. Vercel auto-provisions HTTPS — you'll see a green lock 🔒

### 5c. Update Supabase
Now go back to Supabase → **Authentication → URL Configuration**:
- Change **Site URL** to your real domain: `https://petformpro.com`
- Add to **Redirect URLs:** `https://petformpro.com/**`

---

## Step 6 — Test Everything

1. Visit `https://petformpro.com`
2. **Sign up** with a real email
3. **Check your inbox** — you should receive the verification email
4. **Click the link** → it should take you to your `auth-confirm.html` page showing "Email verified!"
5. **Sign in** with your credentials
6. **Test the AI Builder** — should work now (uses your Vercel proxy, not direct API)
7. **Create a formula and save it**
8. **Sign out, sign in from a different device** — your data should be there!

---

## Where to See Your Data

### User signups, formulas, ingredients
- **Supabase Dashboard → Table Editor**
- Click `profiles` to see all users
- Click `formulas` to see all saved recipes
- Click `custom_ingredients` to see user-created ingredients

### Run analytics queries
- **Supabase → SQL Editor**
- Try: `SELECT COUNT(*) FROM profiles;` (total users)
- `SELECT COUNT(*) FROM formulas;` (total formulas saved)
- `SELECT plan, COUNT(*) FROM profiles GROUP BY plan;` (users by plan)

### See AI usage and costs
- **Anthropic Console → Usage**
- Shows daily request counts and total spend

### See website traffic
Add **Plausible Analytics** ($9/mo, GDPR compliant):
1. Sign up at https://plausible.io
2. Add your domain
3. Paste their script tag in your `index.html` `<head>`
4. See visitors, top pages, devices, countries in real-time

---

## Auth Function Replacements

Replace the `createUser` and `loginUser` functions in your `index.html` UserGate component with these:

```javascript
// REPLACE the existing createUser function
const createUser = async () => {
  setError('');
  if (!name.trim()) return setError('Please enter your full name.');
  if (!validEmail(email.trim())) return setError('Please enter a valid email address.');
  if (password.length < 6) return setError('Password must be at least 6 characters.');
  if (password !== password2) return setError('Passwords do not match.');

  setBusy(true);
  try {
    const result = await window.supabaseAuth.signUp({
      email: email.trim().toLowerCase(),
      password,
      name: name.trim(),
      avatar,
      organisation: org.trim(),
    });

    setBusy(false);

    if (result.needsEmailConfirmation) {
      // Show "check your email" screen instead of logging in directly
      setError(''); // clear errors
      alert(`✅ Account created!\n\nWe just sent a verification email to ${email}.\n\nPlease check your inbox (and spam folder) and click the confirmation link to activate your account.\n\nYou can then sign in.`);
      setScreen('login');
    } else {
      // If email confirmation is disabled in Supabase, log in directly
      const user = await window.supabaseAuth.getCurrentUser();
      onLogin(user);
    }
  } catch (e) {
    setBusy(false);
    if (e.message.includes('already registered')) {
      setError('An account with this email already exists. Please sign in instead.');
    } else {
      setError(e.message || 'Failed to create account.');
    }
  }
};

// REPLACE the existing loginUser function
const loginUser = async () => {
  setError('');
  if (!validEmail(email.trim())) return setError('Please enter a valid email address.');
  if (!password) return setError('Please enter your password.');

  setBusy(true);
  try {
    await window.supabaseAuth.signIn({
      email: email.trim().toLowerCase(),
      password,
    });
    const user = await window.supabaseAuth.getCurrentUser();
    setBusy(false);
    if (user) {
      onLogin(user);
    } else {
      setError('Failed to load profile. Please try again.');
    }
  } catch (e) {
    setBusy(false);
    setError(e.message || 'Sign in failed.');
  }
};
```

---

## Monetization Setup (Optional, Week 2)

### Add Stripe payments
1. Sign up at **https://stripe.com**
2. Create three products in Stripe Dashboard:
   - **Free** — $0
   - **Pro** — $14/month (billing → recurring)
   - **Business** — $49/month
3. Use **Stripe Checkout** for the simplest integration
4. After successful payment, Stripe webhooks call a Vercel function that updates `profiles.plan` in Supabase
5. Gate features in your code: `if (user.plan === 'free' && formulas.length >= 3) showUpgradeModal();`

The Vercel function for the Stripe webhook is ~30 lines — let me know if you want it.

---

## Costs Breakdown

| Item | Cost | Notes |
|------|------|-------|
| Domain | $10/year | Cloudflare or Namecheap |
| Vercel hosting | Free | Free tier covers 100GB bandwidth/month |
| Supabase | Free | Up to 50k MAU, 500MB database, 2GB bandwidth |
| Anthropic API | Pay-as-you-go | ~$0.005-0.01 per AI request |
| Plausible Analytics | $9/month (optional) | Or use Google Analytics free |
| **Total to launch** | **~$11/year** | Plus AI usage as you grow |

---

## Quick Troubleshooting

**"AI service not configured" error:**
- Check `ANTHROPIC_API_KEY` is set in Vercel environment variables
- Redeploy after adding (Settings → Deployments → ... → Redeploy)

**Email verification not arriving:**
- Check spam folder
- Supabase → Authentication → Logs → see if email send was attempted
- Free tier limits: 30 emails/hour. Upgrade to Pro for higher limits, or use a custom SMTP server (Authentication → Settings → SMTP)

**"Email already registered":**
- Go to Supabase → Authentication → Users → delete the test user
- Or use a different email

**Users created but profile row missing:**
- Check the trigger `on_auth_user_created` ran during schema setup
- Re-run the schema.sql

---

## Need Help?

If you hit any issues with:
- The Supabase integration code
- The Stripe payment flow
- A specific error you're seeing

Just describe what you tried and what error you got — I can write the fix.

**Built by Ruhan Oberoi** — For reference and educational purposes only.
