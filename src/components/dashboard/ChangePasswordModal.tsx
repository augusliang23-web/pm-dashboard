'use client';

import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useDashboardStore } from '@/stores/dashboard';
import { changePassword } from '@/services/firebase';
import { KeyRound, Eye, EyeOff, Loader2 } from 'lucide-react';

export default function ChangePasswordModal() {
  const showChangePassword = useDashboardStore((s) => s.showChangePassword);
  const closeModal = useDashboardStore((s) => s.closeModal);
  const currentUser = useDashboardStore((s) => s.currentUser);
  const showToast = useDashboardStore((s) => s.showToast);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const resetForm = useCallback(() => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setShowCurrent(false);
    setShowNew(false);
    setShowConfirm(false);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    closeModal();
  }, [resetForm, closeModal]);

  const validate = useCallback((): boolean => {
    if (!currentPassword) {
      setError('Current password is required.');
      return false;
    }
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return false;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return false;
    }
    if (currentPassword === newPassword) {
      setError('New password must be different from current password.');
      return false;
    }
    setError('');
    return true;
  }, [currentPassword, newPassword, confirmPassword]);

  const handleSubmit = useCallback(async () => {
    if (!validate()) return;
    if (!currentUser) {
      setError('No authenticated user found. Please log in again.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await changePassword(currentUser, currentPassword, newPassword);
      showToast('Password updated successfully');
      handleClose();
    } catch (err) {
      const message = (err as Error).message || '';
      if (message.includes('auth/wrong-password') || message.includes('auth/invalid-credential')) {
        setError('Current password is incorrect.');
      } else if (message.includes('auth/too-many-requests')) {
        setError('Too many attempts. Please wait and try again.');
      } else if (message.includes('auth/weak-password')) {
        setError('New password is too weak. Use at least 6 characters.');
      } else {
        setError('Failed to update password. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [validate, currentUser, currentPassword, newPassword, showToast, handleClose]);

  const passwordToggle = (
    field: 'current' | 'new' | 'confirm'
  ) => {
    const show =
      field === 'current' ? showCurrent : field === 'new' ? showNew : showConfirm;
    const toggle =
      field === 'current'
        ? () => setShowCurrent(!showCurrent)
        : field === 'new'
          ? () => setShowNew(!showNew)
          : () => setShowConfirm(!showConfirm);
    return (
      <button
        type="button"
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        onClick={toggle}
        tabIndex={-1}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    );
  };

  return (
    <Dialog open={showChangePassword} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5" />
            Change Password
          </DialogTitle>
          <DialogDescription>
            Update your account password. You will need to enter your current password to confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current Password */}
          <div className="space-y-1.5">
            <label htmlFor="current-password" className="text-sm font-medium">
              Current Password
            </label>
            <div className="relative">
              <Input
                id="current-password"
                type={showCurrent ? 'text' : 'password'}
                placeholder="Enter current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={loading}
                autoComplete="current-password"
              />
              {passwordToggle('current')}
            </div>
          </div>

          <Separator />

          {/* New Password */}
          <div className="space-y-1.5">
            <label htmlFor="new-password" className="text-sm font-medium">
              New Password
            </label>
            <div className="relative">
              <Input
                id="new-password"
                type={showNew ? 'text' : 'password'}
                placeholder="At least 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={loading}
                autoComplete="new-password"
              />
              {passwordToggle('new')}
            </div>
            {newPassword.length > 0 && newPassword.length < 6 && (
              <p className="text-xs text-amber-500">
                Password must be at least 6 characters.
              </p>
            )}
          </div>

          {/* Confirm New Password */}
          <div className="space-y-1.5">
            <label htmlFor="confirm-password" className="text-sm font-medium">
              Confirm New Password
            </label>
            <div className="relative">
              <Input
                id="confirm-password"
                type={showConfirm ? 'text' : 'password'}
                placeholder="Re-enter new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
                autoComplete="new-password"
              />
              {passwordToggle('confirm')}
            </div>
            {confirmPassword.length > 0 && newPassword !== confirmPassword && (
              <p className="text-xs text-red-500">
                Passwords do not match.
              </p>
            )}
          </div>

          {/* Error Display */}
          {error && (
            <div className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !currentPassword || !newPassword || !confirmPassword}>
            {loading ? (
              <>
                <Loader2 className="size-4 mr-1.5 animate-spin" />
                Updating...
              </>
            ) : (
              'Update'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
