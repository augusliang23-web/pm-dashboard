'use client';

import React, { useState, useCallback, type ReactNode } from 'react';
import { useTheme } from 'next-themes';
import {
  LayoutDashboard,
  FolderKanban,
  GanttChart,
  ShieldAlert,
  Users,
  Map,
  Activity,
  CalendarDays,
  Target,
  Wifi,
  Key,
  LogOut,
  Search,
  Sun,
  Moon,
  Menu,
  X,
  ChevronDown,
  Eye,
  EyeOff,
  Filter,
  Send,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDashboardStore } from '@/stores/dashboard';
import type { ViewId, DashboardRole } from '@/types/dashboard';

// ── Navigation config ──
const NAV_ITEMS: Array<{ id: ViewId; label: string; icon: React.ElementType }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'timeline', label: 'Timeline', icon: GanttChart },
  { id: 'risk', label: 'Risk Matrix', icon: ShieldAlert },
  { id: 'team', label: 'Team Workload', icon: Users },
  { id: 'roadmap', label: 'Roadmap', icon: Map },
  { id: 'activity', label: 'Activity Feed', icon: Activity },
];

const TOOL_ITEMS: Array<{ label: string; icon: React.ElementType; action: string }> = [
  { label: 'Week Management', icon: CalendarDays, action: 'week' },
  { label: 'Strategy Layer', icon: Target, action: 'strategy' },
  { label: 'Presence Usage', icon: Wifi, action: 'presence' },
  { label: 'Change Password', icon: Key, action: 'password' },
];

// ── Status filter options ──
const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'green', label: 'On Track' },
  { value: 'yellow', label: 'At Risk' },
  { value: 'red', label: 'Critical' },
] as const;

// ── Role badge color mapping ──
const ROLE_STYLES: Record<DashboardRole, string> = {
  admin: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800',
  pm: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-800',
  vip: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800',
};

const ROLE_LABELS: Record<DashboardRole, string> = {
  admin: 'Admin',
  pm: 'PM',
  vip: 'VIP',
};

// ── Status dot color ──
function statusColor(status: string): string {
  switch (status) {
    case 'green':
      return 'bg-green-500';
    case 'yellow':
      return 'bg-yellow-500';
    case 'red':
      return 'bg-red-500';
    default:
      return 'bg-gray-400';
  }
}

interface DashboardShellProps {
  children: ReactNode;
}

export default function DashboardShell({ children }: DashboardShellProps) {
  // ── Store selectors ──
  const allWeeks = useDashboardStore((s) => s.allWeeks);
  const currentWeekIdx = useDashboardStore((s) => s.currentWeekIdx);
  const jumpToWeek = useDashboardStore((s) => s.jumpToWeek);
  const currentRole = useDashboardStore((s) => s.currentRole);
  const currentUser = useDashboardStore((s) => s.currentUser);
  const handleLogout = useDashboardStore((s) => s.handleLogout);
  const activeView = useDashboardStore((s) => s.activeView);
  const setActiveView = useDashboardStore((s) => s.setActiveView);
  const isAdminVipPreview = useDashboardStore((s) => s.isAdminVipPreview);
  const toggleVipPreview = useDashboardStore((s) => s.toggleVipPreview);
  const pmList = useDashboardStore((s) => s.pmList);
  const onlineUsers = useDashboardStore((s) => s.onlineUsers);
  const openWeekManagement = useDashboardStore((s) => s.openWeekManagement);
  const openStrategyLayer = useDashboardStore((s) => s.openStrategyLayer);
  const openPresenceUsage = useDashboardStore((s) => s.openPresenceUsage);
  const openChangePassword = useDashboardStore((s) => s.openChangePassword);
  const toggleReleaseWeek = useDashboardStore((s) => s.toggleReleaseWeek);

  // ── Local state ──
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  React.useEffect(() => setMounted(true), []);

  // ── Handlers ──
  const handleToolAction = useCallback(
    (action: string) => {
      setSidebarOpen(false);
      switch (action) {
        case 'week':
          openWeekManagement();
          break;
        case 'strategy':
          openStrategyLayer();
          break;
        case 'presence':
          openPresenceUsage();
          break;
        case 'password':
          openChangePassword();
          break;
      }
    },
    [openWeekManagement, openStrategyLayer, openPresenceUsage, openChangePassword]
  );

  const handleNavClick = useCallback(
    (viewId: ViewId) => {
      setActiveView(viewId);
      setSidebarOpen(false);
    },
    [setActiveView]
  );

  const isConnected = onlineUsers.length >= 0; // Presence-based; simplified

  const currentWeek = allWeeks[currentWeekIdx];

  return (
    <div className="min-h-screen flex flex-col bg-gray-50/50 dark:bg-gray-950">
      {/* ── Top Bar ── */}
      <header className="sticky top-0 z-40 flex items-center h-14 px-4 gap-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
        {/* Hamburger (mobile) */}
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden shrink-0"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label="Toggle sidebar"
        >
          {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>

        {/* Brand */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-600 to-emerald-700 flex items-center justify-center">
            <span className="text-white font-bold text-xs">PM</span>
          </div>
          <span className="hidden sm:inline text-sm font-semibold text-gray-900 dark:text-gray-100">
            PM Dashboard
          </span>
        </div>

        {/* Week selector */}
        <div className="flex-1 flex items-center justify-center max-w-xs mx-auto">
          <Select
            value={String(currentWeekIdx)}
            onValueChange={(val) => jumpToWeek(Number(val))}
          >
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue placeholder="Select week">
                {currentWeek
                  ? `${currentWeek.weekLabel} — ${currentWeek.weekDate}`
                  : 'No week'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {allWeeks.map((w, idx) => (
                <SelectItem key={w.weekLabel} value={String(idx)} className="text-xs">
                  {w.weekLabel} &mdash; {w.weekDate}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Right section */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Release button */}
          {currentWeek && (currentRole === 'admin') && (
            <Button
              variant={currentWeek.isReleased ? 'outline' : 'default'}
              size="sm"
              className={`h-7 text-[11px] gap-1.5 ${currentWeek.isReleased ? '' : 'bg-green-600 hover:bg-green-700'}`}
              onClick={() => toggleReleaseWeek()}
              title={currentWeek.isReleased ? 'Revert week to Draft' : 'Release week to VIP'}
            >
              {currentWeek.isReleased ? <Undo2 className="h-3 w-3" /> : <Send className="h-3 w-3" />}
              <span className="hidden sm:inline">{currentWeek.isReleased ? 'Revert' : 'Release'}</span>
            </Button>
          )}

          {/* Sync status */}
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-400'}`} />
            <span className="hidden md:inline">Synced</span>
          </div>

          {/* Role badge */}
          <Badge variant="outline" className={`text-[10px] font-semibold uppercase tracking-wider ${ROLE_STYLES[currentRole]}`}>
            {ROLE_LABELS[currentRole]}
          </Badge>

          {/* VIP preview toggle (admin only) */}
          {currentRole === 'admin' && (
            <Button
              variant={isAdminVipPreview ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-[11px] gap-1.5"
              onClick={toggleVipPreview}
              title={isAdminVipPreview ? 'Exit VIP Preview' : 'Preview as VIP'}
            >
              {isAdminVipPreview ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              <span className="hidden sm:inline">VIP</span>
            </Button>
          )}

          {/* Theme toggle */}
          {mounted && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <Sun className="h-4 w-4 text-amber-400" />
              ) : (
                <Moon className="h-4 w-4 text-gray-500" />
              )}
            </Button>
          )}

          {/* User email (desktop) */}
          <span className="hidden lg:block text-xs text-muted-foreground max-w-[160px] truncate">
            {currentUser?.email || ''}
          </span>

          {/* Logout */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-red-500"
            onClick={handleLogout}
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* ── Filter Bar ── */}
      <div className="sticky top-14 z-30 flex flex-wrap items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-1">
          <Filter className="h-3.5 w-3.5" />
          <span className="hidden sm:inline font-medium">Filters</span>
        </div>

        {/* Status filter */}
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger size="sm" className="w-[120px] h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                <span className="flex items-center gap-2">
                  {opt.value !== 'all' && (
                    <span className={`h-2 w-2 rounded-full ${statusColor(opt.value)}`} />
                  )}
                  {opt.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Owner filter */}
        <Select value={ownerFilter} onValueChange={setOwnerFilter}>
          <SelectTrigger size="sm" className="w-[140px] h-7 text-xs">
            <SelectValue placeholder="Owner" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All Owners</SelectItem>
            {pmList.map((pm) => (
              <SelectItem key={pm} value={pm} className="text-xs">
                {pm}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Search */}
        <div className="relative flex-1 min-w-[140px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-8 pr-3 text-xs bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700"
          />
        </div>
      </div>

      {/* ── Body: Sidebar + Content ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* ── Sidebar (custom Tailwind, NOT shadcn Sidebar) ── */}
        <aside
          className={`
            fixed lg:static inset-y-0 left-0 z-50
            w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800
            flex flex-col pt-14
            transform transition-transform duration-200 ease-in-out
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          `}
        >
          {/* Navigation section */}
          <nav className="flex-1 overflow-y-auto py-3 px-3">
            <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              Views
            </p>
            <ul className="space-y-0.5">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeView === item.id;
                return (
                  <li key={item.id}>
                    <button
                      onClick={() => handleNavClick(item.id)}
                      className={`
                        w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors
                        ${
                          isActive
                            ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
                        }
                      `}
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-green-600 dark:text-green-400' : ''}`} />
                      <span>{item.label}</span>
                      {isActive && (
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-green-500" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="my-4 mx-3 border-t border-gray-100 dark:border-gray-800" />

            <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              Tools
            </p>
            <ul className="space-y-0.5">
              {TOOL_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.action}>
                    <button
                      onClick={() => handleToolAction(item.action)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span>{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Sidebar footer */}
          <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
            <p className="text-[10px] text-muted-foreground/50 text-center">
              LITEON PM Dashboard v3.0T
            </p>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}