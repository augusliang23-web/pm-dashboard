'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useDashboardStore } from '@/stores/dashboard';

export default function Loader() {
  const loading = useDashboardStore((s) => s.loading);
  const loaderText = useDashboardStore((s) => s.loaderText);

  return (
    <AnimatePresence>
      {loading && (
        <motion.div
          key="dashboard-loader"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white/70 dark:bg-gray-950/70 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="flex flex-col items-center gap-4"
          >
            {/* Spinner */}
            <div className="relative">
              <Loader2 className="h-10 w-10 animate-spin text-green-600 dark:text-green-400" />
              <div className="absolute inset-0 h-10 w-10 rounded-full border-2 border-green-200/50 dark:border-green-800/30 animate-ping" />
            </div>

            {/* Text */}
            <motion.p
              initial={{ y: 6, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 6, opacity: 0 }}
              transition={{ duration: 0.2, delay: 0.1 }}
              className="text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {loaderText || 'Processing...'}
            </motion.p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}