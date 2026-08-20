-- ============================================
-- ADMIN USER SETUP
-- ============================================
-- Run this AFTER creating your account through the signup page.
-- It grants admin access to your user.

-- Step 1: Find your user ID (replace email with yours)
-- SELECT id, email FROM auth.users WHERE email = 'your-email@example.com';

-- Step 2: Set your role to admin (replace the UUID with your user ID)
-- UPDATE public.profiles SET role = 'admin' WHERE id = 'YOUR_USER_ID_HERE';

-- ============================================
-- QUICK SETUP (run both at once)
-- ============================================
-- Replace 'your-email@example.com' below with your actual email:

DO $$
DECLARE
  user_id UUID;
BEGIN
  SELECT id INTO user_id FROM auth.users WHERE email = 'your-email@example.com';
  IF user_id IS NOT NULL THEN
    UPDATE public.profiles SET role = 'admin' WHERE id = user_id;
    RAISE NOTICE 'Admin role granted to user %', user_id;
  ELSE
    RAISE NOTICE 'User not found. Please sign up first.';
  END IF;
END $$;

-- ============================================
-- VERIFY (should show admin role)
-- ============================================
-- SELECT p.id, u.email, p.role, p.subscription_tier
-- FROM public.profiles p
-- JOIN auth.users u ON u.id = p.id;
