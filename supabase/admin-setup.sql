-- ============================================
-- ADMIN USER SETUP
-- ============================================
-- Run this AFTER creating your account through the signup page.
-- It grants admin access to your user.

-- ============================================
-- STEP 1: Create your account
-- ============================================
-- Go to http://localhost:3000/signup and create an account with:
--   Email: admin@oddly.ai
--   Password: Admin123!
--   Full Name: Admin User

-- ============================================
-- STEP 2: Run this SQL in Supabase SQL Editor
-- ============================================
-- Replace the email below with the one you used to sign up:

DO $$
DECLARE
  user_id UUID;
BEGIN
  SELECT id INTO user_id FROM auth.users WHERE email = 'admin@oddly.ai';
  IF user_id IS NOT NULL THEN
    UPDATE public.profiles SET role = 'admin' WHERE id = user_id;
    RAISE NOTICE 'Admin role granted to user %', user_id;
  ELSE
    RAISE NOTICE 'User not found. Please sign up first at http://localhost:3000/signup';
  END IF;
END $$;

-- ============================================
-- STEP 3: Verify (should show admin role)
-- ============================================
-- SELECT p.id, u.email, p.role, p.subscription_tier
-- FROM public.profiles p
-- JOIN auth.users u ON u.id = p.id;

-- ============================================
-- ALTERNATIVE: Create user directly via SQL
-- ============================================
-- If you want to create a user without the signup page:
-- (Only use this if Supabase email confirmation is disabled)

-- INSERT INTO auth.users (
--   instance_id,
--   id,
--   aud,
--   role,
--   email,
--   encrypted_password,
--   email_confirmed_at,
--   created_at,
--   updated_at,
--   confirmation_token,
--   recovery_token,
--   email_change_token_new,
--   email_change
-- ) VALUES (
--   '00000000-0000-0000-0000-000000000000',
--   gen_random_uuid(),
--   'authenticated',
--   'authenticated',
--   'admin@oddly.ai',
--   crypt('Admin123!', gen_salt('bf')),
--   now(),
--   now(),
--   now(),
--   '',
--   '',
--   '',
--   'admin@oddly.ai'
-- );

-- Then create the profile:
-- INSERT INTO public.profiles (id, role, display_name, subscription_tier)
-- VALUES (
--   (SELECT id FROM auth.users WHERE email = 'admin@oddly.ai'),
--   'admin',
--   'Admin User',
--   'elite'
-- );
