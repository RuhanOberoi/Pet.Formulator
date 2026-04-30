// ============================================================
//  PetForm Pro — Supabase Integration
//  Add this <script> tag to your index.html BEFORE the main app script
// ============================================================
//
//  Setup:
//  1. Create project at https://supabase.com (free)
//  2. Dashboard → Settings → API → copy URL and anon key
//  3. Replace the values below
//  4. Authentication → Providers → enable Email
//  5. Authentication → Email Templates → customize confirmation email
//  6. Authentication → URL Configuration:
//       - Site URL: https://yourdomain.com
//       - Redirect URLs: https://yourdomain.com/**
//  7. Run schema.sql in Database → SQL Editor
// ============================================================

(function() {
  // === CONFIGURE THESE ===
  const SUPABASE_URL = 'https://hlyqgjnywzbdombrwbky.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhseXFnam55d3piZG9tYnJ3Ymt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MDQ0MTgsImV4cCI6MjA5MzA4MDQxOH0.oUW5O5iKn_3aazWXfSOQiR_7BM_BrBQ0_jqCQbj6_7c';

  // Load Supabase client from CDN
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
  script.onload = function() {
    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window._supabase = sb;

    // Override the DB object once the main app loads
    const wait = setInterval(() => {
      if (window.DB) {
        clearInterval(wait);
        installSupabaseAdapter(sb);
      }
    }, 100);

    // Failsafe: if DB never appears, install on a global hook
    window._installSupabaseAdapter = () => installSupabaseAdapter(sb);
  };
  document.head.appendChild(script);

  function installSupabaseAdapter(sb) {
    // ============================================================
    //  SIGN UP — sends verification email
    // ============================================================
    window.supabaseAuth = {
      async signUp({ email, password, name, avatar, organisation }) {
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: {
            data: { name, avatar, organisation },
            emailRedirectTo: window.location.origin + '/auth-confirm.html',
          },
        });
        if (error) throw error;
        return {
          user: data.user,
          // session is null until they click the email link
          needsEmailConfirmation: !data.session,
        };
      },

      async signIn({ email, password }) {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) {
          // Friendlier error message for unconfirmed emails
          if (error.message.includes('Email not confirmed') || error.message.includes('email_not_confirmed')) {
            throw new Error('Please verify your email first. Check your inbox for a confirmation link.');
          }
          throw error;
        }
        return data;
      },

      async signOut() {
        const { error } = await sb.auth.signOut();
        if (error) throw error;
      },

      async resendConfirmation(email) {
        const { error } = await sb.auth.resend({
          type: 'signup',
          email,
          options: { emailRedirectTo: window.location.origin + '/auth-confirm.html' },
        });
        if (error) throw error;
      },

      async resetPassword(email) {
        const { error } = await sb.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + '/auth-reset.html',
        });
        if (error) throw error;
      },

      async getCurrentUser() {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return null;
        // Pull profile data
        const { data: profile } = await sb
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        return profile ? { ...profile, supabaseUser: user } : null;
      },

      onAuthChange(callback) {
        return sb.auth.onAuthStateChange((event, session) => callback(event, session));
      },

      // Get session token for API calls (e.g. AI proxy)
      async getAccessToken() {
        const { data } = await sb.auth.getSession();
        return data?.session?.access_token || null;
      },
    };

    // ============================================================
    //  Replace DB methods with Supabase queries
    // ============================================================
    const DB = window.DB;

    DB.getUsers = async () => {
      // Not used in cloud mode — auth is handled by Supabase
      return {};
    };

    DB.setUsers = async () => { /* no-op */ };

    DB.getFormulas = async (userId) => {
      const { data, error } = await sb
        .from('formulas')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });
      if (error) { console.error(error); return []; }
      return data.map(f => ({
        id: f.id,
        name: f.name,
        species: f.species,
        lifeStage: f.life_stage,
        foodFormat: f.food_format,
        standard: f.standard,
        recipe: f.recipe,
        ingCosts: f.ing_costs,
        notes: f.notes,
        savedAt: f.created_at,
      }));
    };

    DB.setFormulas = async (userId, formulas) => {
      // Get existing formula IDs
      const { data: existing } = await sb.from('formulas').select('id').eq('user_id', userId);
      const existingIds = new Set((existing || []).map(f => f.id));
      const newIds = new Set(formulas.map(f => f.id));

      // Delete formulas no longer in the list
      const toDelete = [...existingIds].filter(id => !newIds.has(id));
      if (toDelete.length) {
        await sb.from('formulas').delete().in('id', toDelete);
      }

      // Upsert all current formulas
      const rows = formulas.map(f => ({
        id: typeof f.id === 'string' && f.id.length === 36 ? f.id : undefined, // valid UUID or let DB generate
        user_id: userId,
        name: f.name,
        species: f.species,
        life_stage: f.lifeStage,
        food_format: f.foodFormat,
        standard: f.standard,
        recipe: f.recipe,
        ing_costs: f.ingCosts || {},
        notes: f.notes || '',
      }));
      if (rows.length) {
        await sb.from('formulas').upsert(rows);
      }
    };

    DB.getCustomIngs = async (userId) => {
      const { data, error } = await sb
        .from('custom_ingredients')
        .select('*')
        .eq('user_id', userId);
      if (error) { console.error(error); return []; }
      return data.map(i => ({
        id: i.ingredient_id,
        name: i.name,
        cat: i.category,
        cost: parseFloat(i.cost) || 0,
        color: i.color,
        n: i.nutrients,
        source: i.source,
      }));
    };

    DB.setCustomIngs = async (userId, ings) => {
      // Wipe and replace (simplest; for incremental edits use upsert+delete by diff)
      await sb.from('custom_ingredients').delete().eq('user_id', userId);
      if (!ings.length) return;
      const rows = ings.map(i => ({
        user_id: userId,
        ingredient_id: i.id,
        name: i.name,
        category: i.cat || 'Custom',
        cost: i.cost || 0,
        color: i.color || '#10b981',
        nutrients: i.n,
        source: i.source || 'user',
      }));
      await sb.from('custom_ingredients').insert(rows);
    };

    DB.getCustomProfiles = async (userId) => {
      const { data, error } = await sb.from('custom_profiles').select('*').eq('user_id', userId);
      if (error) { console.error(error); return []; }
      return data.map(p => ({ id: p.id, name: p.name, reqs: p.requirements }));
    };

    DB.setCustomProfiles = async (userId, profiles) => {
      await sb.from('custom_profiles').delete().eq('user_id', userId);
      if (!profiles.length) return;
      const rows = profiles.map(p => ({
        user_id: userId,
        name: p.name,
        requirements: p.reqs,
      }));
      await sb.from('custom_profiles').insert(rows);
    };

    DB.getPrefs = async (userId) => {
      const { data } = await sb.from('user_preferences').select('preferences').eq('user_id', userId).single();
      return data ? data.preferences : {};
    };

    DB.setPrefs = async (userId, prefs) => {
      await sb.from('user_preferences').upsert({ user_id: userId, preferences: prefs });
    };

    DB.getAIHistory = async (userId) => {
      const { data } = await sb
        .from('ai_history')
        .select('messages')
        .eq('user_id', userId)
        .eq('type', 'analyser')
        .order('updated_at', { ascending: false })
        .limit(1);
      return (data && data[0]) ? data[0].messages : [];
    };

    DB.setAIHistory = async (userId, history) => {
      // Upsert most recent analyser conversation
      await sb.from('ai_history').upsert({
        user_id: userId,
        type: 'analyser',
        messages: history,
      }, { onConflict: 'user_id,type' });
    };

    DB.isCloud = () => true;

    console.log('[PetForm Pro] Supabase adapter installed — running in cloud mode');
  }
})();
