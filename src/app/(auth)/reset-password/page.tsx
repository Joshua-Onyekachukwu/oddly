"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);

    // Give the user a moment to read the confirmation, then send them on
    setTimeout(() => {
      router.push("/dashboard");
      router.refresh();
    }, 2000);
  };

  if (success) {
    return (
      <div className="w-full max-w-[400px] px-[16px] text-center">
        <div className="inline-flex items-center justify-center w-[64px] h-[64px] rounded-[16px] bg-[#BFFF00]/10 mb-[24px]">
          <i className="ri-checkbox-circle-line text-[28px] text-[#1B2A4A]"></i>
        </div>
        <h1 className="font-display text-[24px] font-bold text-[#0A0F1C] mb-[8px]">
          Password updated
        </h1>
        <p className="text-[14px] text-gray-500 mb-[24px]">
          Your password has been reset successfully. Redirecting you to your
          dashboard…
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-[8px] font-display font-semibold text-[14px] rounded-full bg-[#1B2A4A] text-white py-[12px] px-[24px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#243B53] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2"
        >
          Go to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[400px] px-[16px]">
      <div className="text-center mb-[32px]">
        <Link href="/" className="inline-flex items-center gap-[8px] mb-[24px]">
          <span className="font-display font-bold text-[24px] tracking-[-0.02em] text-[#0A0F1C] lg:hidden">
            ODDLY
          </span>
        </Link>
        <h1 className="font-display text-[24px] font-bold text-[#0A0F1C] mb-[8px]">
          Set a new password
        </h1>
        <p className="text-[14px] text-gray-500">
          Choose a strong password for your account.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-[16px]">
        {error && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-[12px] p-[12px] flex items-center gap-[8px]"
          >
            <i className="ri-error-warning-line text-[16px] text-red-500"></i>
            <span className="text-[13px] text-red-600">{error}</span>
          </div>
        )}

        <div>
          <label htmlFor="password" className="block text-[13px] font-medium text-[#0A0F1C] mb-[6px]">
            New password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            required
            minLength={8}
            className="w-full h-[44px] rounded-[12px] border border-gray-200 bg-white px-[14px] text-[14px] text-[#0A0F1C] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A] focus:ring-offset-2 transition-all"
            autoComplete="new-password"
            disabled={loading}
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-[13px] font-medium text-[#0A0F1C] mb-[6px]">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat your password"
            required
            minLength={8}
            className="w-full h-[44px] rounded-[12px] border border-gray-200 bg-white px-[14px] text-[14px] text-[#0A0F1C] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A] focus:ring-offset-2 transition-all"
            autoComplete="new-password"
            disabled={loading}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full h-[44px] rounded-[12px] bg-[#1B2A4A] text-white font-display font-semibold text-[14px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#243B53] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-[8px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2"
        >
          {loading ? (
            <>
              <div className="w-[16px] h-[16px] border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              Updating...
            </>
          ) : (
            "Update password"
          )}
        </button>
      </form>

      <p className="text-center text-[13px] text-gray-500 mt-[24px]">
        <Link href="/login" className="font-medium text-[#1B2A4A] hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
