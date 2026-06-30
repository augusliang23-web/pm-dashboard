'use client';

import { useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDashboardStore } from '@/stores/dashboard';
import {
  Wifi,
  WifiOff,
  Users,
  Clock,
  Database,
  TrendingUp,
} from 'lucide-react';
import type { PresenceDoc } from '@/types/dashboard';
import { PRESENCE_CONSTANTS } from '@/types/dashboard';

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export default function PresenceUsageModal() {
  const showPresenceUsage = useDashboardStore((s) => s.showPresenceUsage);
  const closeModal = useDashboardStore((s) => s.closeModal);
  const presenceDocs = useDashboardStore((s) => s.presenceDocs);
  const onlineUsers = useDashboardStore((s) => s.onlineUsers);
  const pmList = useDashboardStore((s) => s.pmList);
  const allWeeks = useDashboardStore((s) => s.allWeeks);

  const now = Date.now();
  const idleWindow = PRESENCE_CONSTANTS.IDLE_TIMEOUT;

  const online = useMemo(
    () => presenceDocs.filter((d) => d.online && !d.idle && now - d.lastSeen < idleWindow),
    [presenceDocs, now]
  );

  const idle = useMemo(
    () => presenceDocs.filter((d) => d.online && d.idle && now - d.lastSeen < idleWindow * 3),
    [presenceDocs, now]
  );

  const offline = useMemo(
    () => presenceDocs.filter((d) => !d.online || now - d.lastSeen >= idleWindow * 3),
    [presenceDocs, now]
  );

  // Firestore usage estimation
  const weekCount = allWeeks.length || 1;
  const projectCount = useMemo(() => {
    const week = allWeeks[allWeeks.length - 1];
    return week?.projects?.length || 0;
  }, [allWeeks]);

  const estimatedReads = useMemo(() => {
    return weekCount * (projectCount + 10) * 4; // rough: 4 reads per poll cycle per project
  }, [weekCount, projectCount]);

  const estimatedWrites = useMemo(() => {
    return weekCount * (projectCount * 2 + 5); // rough: edits + system writes
  }, [weekCount, projectCount]);

  const baseline = PRESENCE_CONSTANTS.SIX_WEEK_BASELINE;

  return (
    <Dialog open={showPresenceUsage} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wifi className="size-5" />
            Presence & Usage Monitor
          </DialogTitle>
          <DialogDescription>
            Real-time team presence status and Firestore usage estimation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 -mx-6 px-6 overflow-y-auto max-h-[60vh]">
          {/* Status Summary */}
          <div className="grid grid-cols-3 gap-3">
            <Card className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
              <CardContent className="p-3 text-center">
                <div className="flex items-center justify-center gap-1.5 text-green-700 dark:text-green-400">
                  <Wifi className="h-4 w-4" />
                  <span className="text-lg font-bold">{online.length}</span>
                </div>
                <p className="text-[10px] text-green-600 dark:text-green-500 mt-1">Online</p>
              </CardContent>
            </Card>
            <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
              <CardContent className="p-3 text-center">
                <div className="flex items-center justify-center gap-1.5 text-amber-700 dark:text-amber-400">
                  <Clock className="h-4 w-4" />
                  <span className="text-lg font-bold">{idle.length}</span>
                </div>
                <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-1">Idle</p>
              </CardContent>
            </Card>
            <Card className="bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700">
              <CardContent className="p-3 text-center">
                <div className="flex items-center justify-center gap-1.5 text-gray-500 dark:text-gray-400">
                  <WifiOff className="h-4 w-4" />
                  <span className="text-lg font-bold">{offline.length}</span>
                </div>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Offline</p>
              </CardContent>
            </Card>
          </div>

          {/* Team Members Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                Team Members
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">Member</TableHead>
                    <TableHead className="w-[80px] text-center">Status</TableHead>
                    <TableHead className="w-[100px] text-right">Last Seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {presenceDocs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-8">
                        No presence data available
                      </TableCell>
                    </TableRow>
                  ) : (
                    presenceDocs
                      .sort((a, b) => b.lastSeen - a.lastSeen)
                      .map((doc, i) => {
                        const isOnline = doc.online && !doc.idle && now - doc.lastSeen < idleWindow;
                        const isIdle = doc.online && (doc.idle || now - doc.lastSeen >= idleWindow);
                        const name = doc.name || `User ${i + 1}`;
                        const timeSince = formatDuration(now - doc.lastSeen);

                        return (
                          <TableRow key={i}>
                            <TableCell className="font-medium text-sm">{name}</TableCell>
                            <TableCell className="text-center">
                              <Badge
                                variant="outline"
                                className={`text-[10px] ${
                                  isOnline
                                    ? 'border-green-500 text-green-700 bg-green-50 dark:bg-green-950/30 dark:text-green-400'
                                    : isIdle
                                    ? 'border-amber-500 text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400'
                                    : 'border-gray-400 text-gray-500 bg-gray-50 dark:bg-gray-800/50 dark:text-gray-400'
                                }`}
                              >
                                {isOnline ? 'Online' : isIdle ? 'Idle' : 'Offline'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">
                              {timeSince} ago
                            </TableCell>
                          </TableRow>
                        );
                      })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Firestore Usage Estimation */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                Firestore Usage Estimation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md bg-muted/50 p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Weeks Tracked</p>
                  <p className="text-lg font-bold mt-1">{weekCount}</p>
                </div>
                <div className="rounded-md bg-muted/50 p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Active Projects</p>
                  <p className="text-lg font-bold mt-1">{projectCount}</p>
                </div>
                <div className="rounded-md bg-muted/50 p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Est. Reads</p>
                  <p className="text-lg font-bold mt-1">{estimatedReads.toLocaleString()}</p>
                </div>
                <div className="rounded-md bg-muted/50 p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Est. Writes</p>
                  <p className="text-lg font-bold mt-1">{estimatedWrites.toLocaleString()}</p>
                </div>
              </div>

              {/* Baseline comparison */}
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <TrendingUp className="h-3.5 w-3.5" />
                  6-Week Baseline (W22-W26)
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Reads:</span>
                    <span className="font-medium">{baseline.reads.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Writes:</span>
                    <span className="font-medium">{baseline.writes.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Daily Write Quota:</span>
                    <span className="font-medium">{PRESENCE_CONSTANTS.WRITES_PER_DAY.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={closeModal}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
