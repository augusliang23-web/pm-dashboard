'use client';

import React, { useState, type FormEvent } from 'react';
import { Loader2, Lock, Mail, ShieldCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useDashboardStore } from '@/stores/dashboard';

export default function LoginOverlay() {
  const handleLogin = useDashboardStore((s) => s.handleLogin);
  const isLoggingIn = useDashboardStore((s) => s.isLoggingIn);
  const loginError = useDashboardStore((s) => s.loginError);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    await handleLogin(email, password);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-slate-100 via-gray-50 to-slate-200 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      {/* Decorative background pattern */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-emerald-400/5 dark:bg-emerald-400/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-amber-400/5 dark:bg-amber-400/10 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-green-100/30 dark:bg-green-900/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md mx-4">
        {/* Login card */}
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-2xl shadow-gray-900/10 dark:shadow-black/30">
          {/* Header / Branding */}
          <div className="px-8 pt-8 pb-2 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br from-green-600 to-emerald-700 text-white shadow-lg shadow-green-600/20 mb-4">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              PM Dashboard
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              LITEON &mdash; Project Management System
            </p>
          </div>

          {/* Form */}
          <form onSubmit={onSubmit} className="px-8 pt-4 pb-8 space-y-5">
            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="login-email" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="login-email"
                  type="email"
                  placeholder="name@liteon.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 h-11 bg-gray-50/80 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700 focus:border-green-500 focus:ring-green-500/20"
                  disabled={isLoggingIn}
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="login-password" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="login-password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 h-11 bg-gray-50/80 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700 focus:border-green-500 focus:ring-green-500/20"
                  disabled={isLoggingIn}
                  autoComplete="current-password"
                  required
                />
              </div>
            </div>

            {/* Error message */}
            {loginError && (
              <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                {loginError}
              </div>
            )}

            {/* Login button */}
            <Button
              type="submit"
              disabled={isLoggingIn || !email || !password}
              className="w-full h-11 bg-green-600 hover:bg-green-700 text-white font-medium shadow-lg shadow-green-600/20 hover:shadow-green-600/30 transition-all"
            >
              {isLoggingIn ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Authenticating&hellip;
                </>
              ) : (
                'Sign In'
              )}
            </Button>

            {/* Forgot password */}
            <div className="text-center pt-1">
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-green-600 dark:hover:text-green-400 transition-colors"
                onClick={() => {
                  window.alert('Please contact your system administrator to reset your password.');
                }}
              >
                Forgot password?
              </button>
            </div>
          </form>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-muted-foreground/60">
          &copy; {new Date().getFullYear()} LITEON Technology Corporation. All rights reserved.
        </p>
      </div>
    </div>
  );
}