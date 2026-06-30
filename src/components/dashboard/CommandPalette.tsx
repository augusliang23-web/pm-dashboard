'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
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
  Plus,
  Search,
  Moon,
  Sun,
} from 'lucide-react';
import { useDashboardStore } from '@/stores/dashboard';
import { useTheme } from 'next-themes';
import type { ViewId } from '@/types/dashboard';

const VIEW_ITEMS: Array<{ id: ViewId; label: string; icon: React.ElementType }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'timeline', label: 'Timeline', icon: GanttChart },
  { id: 'risk', label: 'Risk Matrix', icon: ShieldAlert },
  { id: 'team', label: 'Team Workload', icon: Users },
  { id: 'roadmap', label: 'Roadmap', icon: Map },
  { id: 'activity', label: 'Activity Feed', icon: Activity },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const activeView = useDashboardStore((s) => s.activeView);
  const setActiveView = useDashboardStore((s) => s.setActiveView);
  const currentRole = useDashboardStore((s) => s.currentRole);
  const openWeekManagement = useDashboardStore((s) => s.openWeekManagement);
  const openStrategyLayer = useDashboardStore((s) => s.openStrategyLayer);
  const openPresenceUsage = useDashboardStore((s) => s.openPresenceUsage);
  const openChangePassword = useDashboardStore((s) => s.openChangePassword);
  const openProjEdit = useDashboardStore((s) => s.openProjEdit);
  const allWeeks = useDashboardStore((s) => s.allWeeks);
  const currentWeekIdx = useDashboardStore((s) => s.currentWeekIdx);
  const jumpToWeek = useDashboardStore((s) => s.jumpToWeek);
  const toggleReleaseWeek = useDashboardStore((s) => s.toggleReleaseWeek);
  const toggleVipPreview = useDashboardStore((s) => s.toggleVipPreview);
  const isAdminVipPreview = useDashboardStore((s) => s.isAdminVipPreview);
  const currentProjects = useDashboardStore((s) => s.currentProjects);

  // ⌘K shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const runCommand = useCallback(
    (command: () => void) => {
      setOpen(false);
      command();
    },
    []
  );

  const projects = currentProjects();
  const canCreate = currentRole === 'admin' || currentRole === 'pm';
  const currentWeek = allWeeks[currentWeekIdx];

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search views, projects, tools..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Views */}
        <CommandGroup heading="Views">
          {VIEW_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.id}
                value={`view ${item.label.toLowerCase()}`}
                onSelect={() => runCommand(() => setActiveView(item.id))}
                className={activeView === item.id ? 'bg-accent' : ''}
              >
                <Icon className="mr-2 h-4 w-4" />
                <span>{item.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        {/* Quick Actions */}
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => runCommand(() => setTheme(theme === 'dark' ? 'light' : 'dark'))}>
            {theme === 'dark' ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
            Toggle {theme === 'dark' ? 'Light' : 'Dark'} Mode
          </CommandItem>
          {canCreate && (
            <CommandItem onSelect={() => runCommand(() => openProjEdit(null, true))}>
              <Plus className="mr-2 h-4 w-4" />
              New Project
            </CommandItem>
          )}
          {currentWeek && (
            <CommandItem
              onSelect={() => runCommand(() => toggleReleaseWeek())}
            >
              <CalendarDays className="mr-2 h-4 w-4" />
              {currentWeek.isReleased ? 'Revert to Draft' : 'Release Week to VIP'}
            </CommandItem>
          )}
          {currentRole === 'admin' && (
            <CommandItem onSelect={() => runCommand(() => toggleVipPreview())}>
              <Search className="mr-2 h-4 w-4" />
              {isAdminVipPreview ? 'Exit VIP Preview' : 'Preview as VIP'}
            </CommandItem>
          )}
        </CommandGroup>

        <CommandSeparator />

        {/* Tools */}
        <CommandGroup heading="Tools">
          <CommandItem onSelect={() => runCommand(() => openWeekManagement())}>
            <CalendarDays className="mr-2 h-4 w-4" />
            Week Management
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => openStrategyLayer())}>
            <Target className="mr-2 h-4 w-4" />
            Strategy Layer
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => openPresenceUsage())}>
            <Wifi className="mr-2 h-4 w-4" />
            Presence Usage
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => openChangePassword())}>
            <Key className="mr-2 h-4 w-4" />
            Change Password
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Weeks */}
        <CommandGroup heading="Navigate to Week">
          {[...allWeeks].reverse().map((w) => {
            const idx = allWeeks.findIndex((aw) => aw.weekLabel === w.weekLabel);
            return (
              <CommandItem
                key={w.weekLabel}
                value={`week ${w.weekLabel.toLowerCase()} ${w.weekDate}`}
                onSelect={() => runCommand(() => jumpToWeek(idx))}
              >
                <CalendarDays className="mr-2 h-4 w-4" />
                <span>{w.weekLabel}</span>
                <span className="ml-2 text-xs text-muted-foreground">{w.weekDate}</span>
                {w.isReleased && (
                  <span className="ml-2 text-xs text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0 rounded">Released</span>
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>

        {/* Projects (quick search) */}
        {projects.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Projects">
              {projects.slice(0, 10).map((p) => (
                <CommandItem
                  key={p.code}
                  value={`project ${p.name.toLowerCase()} ${p.code.toLowerCase()} ${p.owner.toLowerCase()}`}
                  onSelect={() => runCommand(() => useDashboardStore.getState().openProjDetail(p.code))}
                >
                  <FolderKanban className="mr-2 h-4 w-4" />
                  <span>{p.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{p.code}</span>
                  <span
                    className={`ml-2 h-2 w-2 rounded-full ${
                      p.status === 'green' ? 'bg-green-500' : p.status === 'yellow' ? 'bg-yellow-500' : p.status === 'red' ? 'bg-red-500' : 'bg-gray-400'
                    }`}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
