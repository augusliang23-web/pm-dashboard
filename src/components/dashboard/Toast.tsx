'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, X } from 'lucide-react';
import { useDashboardStore } from '@/stores/dashboard';

export default function Toast() {
  const toastMessage = useDashboardStore((s) => s.toastMessage);

  return (
    <div className="fixed bottom-4 right-4 z-[110] pointer-events-none">
      <AnimatePresence mode="wait">
        {toastMessage && (
          <motion.div
            key={toastMessage}
            initial={{ opacity: 0, y: 20, scale: 0.95, x: 10 }}
            animate={{ opacity: 1, y: 0, scale: 1, x: 0 }}
            exit={{ opacity: 0, y: 10, scale: 0.95, x: 20 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="pointer-events-auto flex items-center gap-3 rounded-lg border border-green-200 dark:border-green-800/60 bg-white dark:bg-gray-900 shadow-lg shadow-green-900/5 dark:shadow-black/20 px-4 py-3 min-w-[280px] max-w-[420px]"
          >
            {/* Green accent bar */}
            <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg bg-green-500" />

            {/* Icon */}
            <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-green-600 dark:text-green-400" />

            {/* Message */}
            <p className="flex-1 text-sm text-gray-700 dark:text-gray-300 leading-snug">
              {toastMessage}
            </p>

            {/* Close (decorative — auto-dismiss handled by store) */}
            <button
              className="shrink-0 rounded-md p-0.5 text-muted-foreground hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
              onClick={() => {
                // Force-clear via the store's timeout mechanism
                useDashboardStore.setState({ toastMessage: null });
              }}
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}