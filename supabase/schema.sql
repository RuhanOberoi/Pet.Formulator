-- ============================================================
-- PetForm Pro — Supabase Database Schema
-- ============================================================
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- This creates all the tables and security policies you need.
-- ============================================================

-- Profiles table — extends auth.users with PetForm Pro fields
-- Auth users are created automatically by Supabase Auth
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  avatar TEXT DEFAULT '🐾',
  organisation TEXT DEFAULT '',
  formula_count INTEGER DEFAULT 0,
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'business')),
  created_at TIMESTAMPTZ DEFAULT now(),
  last_login TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Formulas — the recipes users save
CREATE TABLE IF NOT EXISTS public.formulas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  species TEXT NOT NULL,
  life_stage TEXT NOT NULL,
  food_format TEXT NOT NULL,
  standard TEXT,
  recipe JSONB NOT NULL,         -- ingredient list + amounts
  ing_costs JSONB DEFAULT '{}',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Custom ingredients — each user's private ingredient catalog
CREATE TABLE IF NOT EXISTS public.custom_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ingredient_id TEXT NOT NULL,    -- the slug used in formulas (e.g. "my_chicken")
  name TEXT NOT NULL,
  category TEXT DEFAULT 'Custom',
  cost NUMERIC DEFAULT 0,
  color TEXT DEFAULT '#10b981',
  nutrients JSONB NOT NULL,
  source TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, ingredient_id)
);

-- Custom medical profiles
CREATE TABLE IF NOT EXISTS public.custom_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  requirements JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- AI conversation history (optional — for restoring chats)
CREATE TABLE IF NOT EXISTS public.ai_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('builder', 'analyser')),
  messages JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- User preferences (defaults like species, food format)
CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferences JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS) — critical for multi-user data
-- ============================================================
-- These policies ensure users can ONLY access their own data.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formulas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read/update their own profile
CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Formulas: full CRUD on own formulas only
CREATE POLICY "Users can read own formulas" ON public.formulas
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own formulas" ON public.formulas
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own formulas" ON public.formulas
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own formulas" ON public.formulas
  FOR DELETE USING (auth.uid() = user_id);

-- Custom ingredients: full CRUD on own
CREATE POLICY "Users can read own ingredients" ON public.custom_ingredients
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own ingredients" ON public.custom_ingredients
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own ingredients" ON public.custom_ingredients
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own ingredients" ON public.custom_ingredients
  FOR DELETE USING (auth.uid() = user_id);

-- Custom profiles: full CRUD on own
CREATE POLICY "Users can read own profiles" ON public.custom_profiles
  FOR ALL USING (auth.uid() = user_id);

-- AI history: full CRUD on own
CREATE POLICY "Users can read own ai history" ON public.ai_history
  FOR ALL USING (auth.uid() = user_id);

-- Preferences: full CRUD on own
CREATE POLICY "Users can manage own preferences" ON public.user_preferences
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- TRIGGERS — auto-create profile on signup, update timestamps
-- ============================================================

-- When a new user signs up via Supabase Auth, create their profile row
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, avatar, organisation)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'avatar', '🐾'),
    COALESCE(NEW.raw_user_meta_data->>'organisation', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_formulas_updated_at BEFORE UPDATE ON public.formulas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER update_ai_history_updated_at BEFORE UPDATE ON public.ai_history
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER update_preferences_updated_at BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- INDEXES for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_formulas_user_id ON public.formulas(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_ingredients_user_id ON public.custom_ingredients(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_profiles_user_id ON public.custom_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_history_user_id ON public.ai_history(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
