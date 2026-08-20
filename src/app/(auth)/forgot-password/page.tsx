"use client";

import React, { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!email) {
      setError("Please enter your email address");
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });

    if (resetError) {
      setError(resetError.message);
      setLoading(false);
      return;
    }

    setSubmitted(true);
    setLoading(false);
  };

  if (submitted) {
    return (
      <div className="w-full max-w-[400px] px-[16px] text-center">
        <div className="inline-flex items-center justify-center w-[64px] h-[64px] rounded-[16px] bg-[#BFFF00]/10 mb-[24px]">
          <i className="ri-mail-send-line text-[28px] text-[#1B2A4A]"></i>
        </div>
        <h1 className="font-display text-[24px] font-bold text-[#0A0F1C] mb-[8px]">
          Check your email
        </h1>
        <p className="text-[14px] text-gray-500 mb-[24px]">
          We&apos;ve sent password reset instructions to <strong>{email}</strong>.
          Follow the link to set a new password.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-[8px] font-display font-semibold text-[14px] rounded-full bg-[#1B2A4A] text-white py-[12px] px-[24px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#243B53] active:scale-[0.97]"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[400px] px-[16px]">
      <div className="text-center mb-[32px]">
        <Link href="/" className="inline-flex items-center gap-[8px] mb-[24px]">
          <span className="font-display font-bold text-[24px] tracking-[-0.02em] text-[#0A0F1C]">
            ODDLY
          </span>
        </Link>
        <h1 className="font-display text-[24px] font-bold text-[#0A0F1C] mb-[8px]">
          Forgot your password?
        </h1>
        <p className="text-[14px] text-gray-500">
          Enter your email and we&apos;ll send you a link to reset it.
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

        <button
          type="submit"
          disabled={loading}
          className="w-full h-[44px] rounded-[12px] bg-[#1B2A4A] text-white font-display font-semibold text-[14px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#243B53] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-[8px]"
        >
          {loading ? (
            <>
              <div className="w-[16px] h-[16px] border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              Sending...
            </>
          ) : (
            "Send reset link"
          )}
        </button>
      </form>

      <p className="text-center text-[13px] text-gray-500 mt-[24px]">
        Remember your password?{" "}
        <Link href="/login" className="font-medium text-[#1B2A4A] hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
