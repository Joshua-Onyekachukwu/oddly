"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";

function checkPasswordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 1) return { score, label: "Weak", color: "bg-[#EF4444]" };
  if (score <= 2) return { score, label: "Fair", color: "bg-[#D97706]" };
  if (score <= 3) return { score, label: "Good", color: "bg-[#2563EB]" };
  return { score, label: "Strong", color: "bg-[#22c55e]" };
}

export default function SignupPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState({ score: 0, label: "", color: "" });

  const { signUp } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!fullName || !email || !password) {
      setError("Please fill in all fields");
      setLoading(false);
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      setLoading(false);
      return;
    }

    if (passwordStrength.score < 2) {
      setError("Please choose a stronger password");
      setLoading(false);
      return;
    }

    if (!acceptedTerms) {
      setError("Please accept the terms and conditions");
      setLoading(false);
      return;
    }

    const result = await signUp(email, password, fullName);

    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    if (result.needsVerification) {
      setNeedsVerification(true);
      setLoading(false);
      return;
    }

    router.push("/matches");
    router.refresh();
  };

  if (needsVerification) {
    return (
      <div className="w-full max-w-[400px] px-[16px] text-center">
        <div className="inline-flex items-center justify-center w-[64px] h-[64px] rounded-[16px] bg-[#BFFF00]/10 mb-[24px]">
          <i className="ri-mail-send-line text-[28px] text-[#1B2A4A]"></i>
        </div>
        <h1 className="font-display text-[24px] font-bold text-[#0A0F1C] mb-[8px]">
          Check your email
        </h1>
        <p className="text-[14px] text-gray-500 mb-[24px]">
          We&apos;ve sent a verification link to <strong>{email}</strong>.
          Click the link to activate your account.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-[8px] font-display font-semibold text-[14px] rounded-full bg-[#1B2A4A] text-white py-[12px] px-[24px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#243B53] active:scale-[0.97]"
        >
          Go to sign in
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
          Create your account
        </h1>
        <p className="text-[14px] text-gray-500">
          Start finding value bets with AI-powered predictions.
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
          <label htmlFor="fullName" className="block text-[13px] font-medium text-[#0A0F1C] mb-[6px]">
            Full name
          </label>
          <input
            id="fullName"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="John Doe"
            className="w-full h-[44px] rounded-[12px] border border-gray-200 bg-white px-[14px] text-[14px] text-[#0A0F1C] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A] focus:ring-offset-2 transition-all"
            autoComplete="name"
            disabled={loading}
          />
        </div>

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
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordStrength(checkPasswordStrength(e.target.value));
              }}
              placeholder="At least 8 characters"
              className="w-full h-[44px] rounded-[12px] border border-gray-200 bg-white px-[14px] pr-[44px] text-[14px] text-[#0A0F1C] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A] focus:ring-offset-2 transition-all"
              autoComplete="new-password"
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
          {password.length > 0 && (
            <div className="mt-[8px]">
              <div className="flex gap-[4px] mb-[4px]">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className={`h-[3px] flex-1 rounded-full transition-all duration-300 ${
                      i <= passwordStrength.score ? passwordStrength.color : "bg-gray-200"
                    }`}
                  />
                ))}
              </div>
              <span
                className={`text-[11px] font-medium ${
                  passwordStrength.score <= 1
                    ? "text-[#EF4444]"
                    : passwordStrength.score <= 2
                    ? "text-[#D97706]"
                    : "text-[#22c55e]"
                }`}
              >
                {passwordStrength.label}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-start gap-[8px]">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="w-[16px] h-[16px] mt-[2px] rounded border-gray-300 text-[#1B2A4A] focus:ring-[#1B2A4A]"
          />
          <span className="text-[12px] text-gray-500 leading-[1.5]">
            I agree to the{" "}
            <Link href="#" className="text-[#1B2A4A] hover:underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="#" className="text-[#1B2A4A] hover:underline">
              Privacy Policy
            </Link>
          </span>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full h-[44px] rounded-[12px] bg-[#1B2A4A] text-white font-display font-semibold text-[14px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#243B53] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-[8px]"
        >
          {loading ? (
            <>
              <div className="w-[16px] h-[16px] border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              Creating account...
            </>
          ) : (
            "Create account"
          )}
        </button>
      </form>

      <p className="text-center text-[13px] text-gray-500 mt-[24px]">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-[#1B2A4A] hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
