"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { signIn } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/matches";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!email || !password) {
      setError("Please fill in all fields");
      setLoading(false);
      return;
    }

    const result = await signIn(email, password);

    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    router.push(redirect);
    router.refresh();
  };

  return (
    <div className="w-full max-w-[400px] px-[16px]">
      <div className="text-center mb-[32px]">
        <Link href="/" className="inline-flex items-center gap-[8px] mb-[24px]">
          <span className="font-display font-bold text-[24px] tracking-[-0.02em] text-[#0A0F1C]">
            ODDLY
          </span>
        </Link>
        <h1 className="font-display text-[24px] font-bold text-[#0A0F1C] mb-[8px]">
          Welcome back
        </h1>
        <p className="text-[14px] text-gray-500">
          Sign in to access your predictions and value bets.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-[16px]">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-[12px] p-[12px] flex items-center gap-[8px]">
            <i className="ri-error-warning-line text-[16px] text-red-500"></i>
            <span className="text-[13px] text-red-600">{error}</span>
          </div>
        )}

        <div>
          <label htmlFor="email" className="block text-[13px] font-medium text-[#0A0F1C] mb-[6px]">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full h-[44px] rounded-[12px] border border-gray-200 bg-white px-[14px] text-[14px] text-[#0A0F1C] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A] focus:ring-offset-2 transition-all"
            autoComplete="email"
            disabled={loading}
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-[13px] font-medium text-[#0A0F1C] mb-[6px]">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="w-full h-[44px] rounded-[12px] border border-gray-200 bg-white px-[14px] pr-[44px] text-[14px] text-[#0A0F1C] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A] focus:ring-offset-2 transition-all"
              autoComplete="current-password"
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-[12px] top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              tabIndex={-1}
            >
              <i className={`${showPassword ? "ri-eye-off-line" : "ri-eye-line"} text-[18px]`}></i>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-[8px]">
            <input
              type="checkbox"
              className="w-[16px] h-[16px] rounded border-gray-300 text-[#1B2A4A] focus:ring-[#1B2A4A]"
            />
            <span className="text-[13px] text-gray-500">Remember me</span>
          </label>
          <Link
            href="/forgot-password"
            className="text-[13px] font-medium text-[#1B2A4A] hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full h-[44px] rounded-[12px] bg-[#1B2A4A] text-white font-display font-semibold text-[14px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#243B53] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-[8px]"
        >
          {loading ? (
            <>
              <div className="w-[16px] h-[16px] border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              Signing in...
            </>
          ) : (
            "Sign in"
          )}
        </button>
      </form>

      <p className="text-center text-[13px] text-gray-500 mt-[24px]">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-medium text-[#1B2A4A] hover:underline">
          Sign up free
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-[400px] px-[16px] text-center py-[60px]">
          <div className="w-[24px] h-[24px] border-2 border-gray-300 border-t-[#1B2A4A] rounded-full animate-spin mx-auto"></div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
