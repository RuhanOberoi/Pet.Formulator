# PetForm Pro — Production Deployment Package

Complete package to deploy PetForm Pro as a real, live website with:
- ✅ Working AI Builder (Anthropic API key kept secret on server)
- ✅ Email-based authentication with email verification
- ✅ Per-user cloud-saved formulas, ingredients, and AI history
- ✅ Custom domain with HTTPS

## 📁 What's in this package

| File | Purpose |
|------|---------|
| `index.html` | Main app (rename `petform-pro-5.html` to this) |
| `auth-confirm.html` | Email verification landing page |
| `vercel.json` | Vercel deployment configuration |
| `api/ai-proxy.js` | Serverless function — keeps API key secret |
| `supabase/schema.sql` | Database tables + security policies |
| `supabase/integration.js` | Frontend Supabase adapter |
| `PRODUCTION-SETUP.md` | **Full step-by-step deployment guide** |
| `README.md` | This file |

## 🚀 Quick Start

1. **Read** `PRODUCTION-SETUP.md` — it has every step
2. **Sign up** for Supabase (free), Vercel (free), Anthropic (pay-as-you-go)
3. **Configure** the three placeholder fields with your keys
4. **Deploy** to Vercel by pushing to GitHub
5. **Buy a domain** (~$10/year) and connect

**Total time:** 2-3 hours · **Total cost:** ~$11/year

## 🔑 The Three Things You Need

1. **Supabase Project URL + Anon Key** (free, from supabase.com)
2. **Anthropic API Key** (~$5-20/month usage, from console.anthropic.com)
3. **Domain name** (~$10/year, from Cloudflare or Namecheap)

## ⚙️ Architecture

```
   User's browser
         ↓
   Your domain (Vercel)
         ↓
   ┌─────────────────────────────────┐
   │  index.html (your app)          │
   │  + supabase/integration.js      │
   │  + auth-confirm.html            │
   └─────────────────────────────────┘
         ↓                    ↓
   /api/ai-proxy.js      Supabase
         ↓                    ↓
   Anthropic API        - Email Auth
                        - PostgreSQL DB
                        - Email verification
```

## 🛡️ Security Notes

- The `ANTHROPIC_API_KEY` lives only on Vercel's server, never in browser code
- Supabase Row Level Security (RLS) ensures users can only access their own data
- Email verification prevents fake signups
- HTTPS is automatic via Vercel
- Passwords are hashed by Supabase (bcrypt)

## 📊 What You Can See After Launch

- **Supabase Dashboard** → all users, all formulas, all ingredients
- **Vercel Analytics** → visits, performance, errors
- **Anthropic Console** → AI usage and costs
- **Optional: Plausible** → traffic, conversions

## 💰 Monetization Options

The setup guide includes a section on adding Stripe payments for a Free/Pro/Business tier model. ~30 lines of code to gate premium features after a 3-formula free tier.

---

**Built by Ruhan Oberoi** — For reference and educational purposes only.
