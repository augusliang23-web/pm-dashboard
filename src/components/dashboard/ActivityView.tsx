'use client';

import { useMemo, useState } from 'react';
import { useDashboardStore } from '@/stores/dashboard';
import type { Week } from '@/types/dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, FileText, GitCommit, Inbox, Filter } from 'lucide-react';

// ── Activity entry synthesized from week data ──
interface ActivityEntry {
  id: string;
  type: 'created' | 'updated' | 'released' | 'general';
  weekLabel: string;
  weekDate: string;
  modifiedBy: string;
  summary: string;
  projectCount: number;
  timestamp: string;
}

type FilterType = 'all' | 'created' | 'updated' | 'released';

function classifyActivity(week: Week, index: number, weeks: Week[]): ActivityEntry['type'] {
  if (week.isReleased) return 'released';
  // If it's the first week, classify as created
  if (index === 0) return 'created';
  // Compare project count with previous week
  const prev = weeks[index - 1];
  if (prev && week.projects.length > prev.projects.length) return 'created';
  return 'updated';
}

function synthesizeActivities(weeks: Week[]): ActivityEntry[] {
  // Sort weeks by label descending (newest first)
  const sorted = [...weeks].sort((a, b) => {
    const aNum = parseInt(a.weekLabel?.replace(/\D/g, '') || '0', 10);
    const bNum = parseInt(b.weekLabel?.replace(/\D/g, '') || '0', 10);
    return bNum - aNum;
  });

  // Build activities sorted descending
  const activities: ActivityEntry[] = [];
  const sortedAsc = [...weeks].sort((a, b) => {
    const aNum = parseInt(a.weekLabel?.replace(/\D/g, '') || '0', 10);
    const bNum = parseInt(b.weekLabel?.replace(/\D/g, '') || '0', 10);
    return aNum - bNum;
  });

  sortedAsc.forEach((week, index) => {
    const type = classifyActivity(week, index, sortedAsc);
    const projectCount = week.projects?.length || 0;

    // Build a summary from the week
    let summary = week.summary || '';
    if (!summary) {
      const greenCount = week.projects?.filter((p) => p.status === 'green').length || 0;
      const yellowCount = week.projects?.filter((p) => p.status === 'yellow').length || 0;
      const redCount = week.projects?.filter((p) => p.status === 'red').length || 0;
      const parts: string[] = [];
      if (greenCount > 0) parts.push(`${greenCount} on track`);
      if (yellowCount > 0) parts.push(`${yellowCount} at risk`);
      if (redCount > 0) parts.push(`${redCount} critical`);
      summary = parts.length > 0 ? parts.join(', ') : 'No status summary';
    }

    activities.push({
      id: week.weekLabel || `week-${index}`,
      type,
      weekLabel: week.weekLabel || `Week ${index + 1}`,
      weekDate: week.weekDate || '',
      modifiedBy: week.lastModifiedBy || 'Unknown',
      summary: summary.length > 120 ? summary.slice(0, 120) + '…' : summary,
      projectCount,
      timestamp: week.weekDate || new Date().toISOString(),
    });
  });

  // Return newest first
  return activities.reverse();
}

// ── Icons per type ──
function ActivityIcon({ type }: { type: ActivityEntry['type'] }) {
  switch (type) {
    case 'created':
      return <FileText className="h-4 w-4 text-green-500" />;
    case 'updated':
      return <GitCommit className="h-4 w-4 text-blue-500" />;
    case 'released':
      return <Clock className="h-4 w-4 text-orange-500" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function typeLabel(type: ActivityEntry['type']): string {
  switch (type) {
    case 'created': return 'Created';
    case 'updated': return 'Updated';
    case 'released': return 'Released';
    default: return 'General';
  }
}

function typeBadgeClass(type: ActivityEntry['type']): string {
  switch (type) {
    case 'created': return 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400 border-green-200 dark:border-green-800';
    case 'updated': return 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border-blue-200 dark:border-blue-800';
    case 'released': return 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400 border-orange-200 dark:border-orange-800';
    default: return '';
  }
}

// ── Main Component ──
export default function ActivityView() {
  const allWeeks = useDashboardStore((s) => s.allWeeks);
  const [filter, setFilter] = useState<FilterType>('all');

  const activities = useMemo(() => synthesizeActivities(allWeeks), [allWeeks]);

  const filteredActivities = useMemo(() => {
    if (filter === 'all') return activities;
    // 'released' matches isReleased
    // 'created' - first week or project count grew
    // 'updated' - everything else
    return activities.filter((a) => a.type === filter);
  }, [activities, filter]);

  const filterCounts = useMemo(() => {
    const counts: Record<FilterType, number> = { all: activities.length, created: 0, updated: 0, released: 0 };
    activities.forEach((a) => {
      if (a.type === 'created') counts.created++;
      else if (a.type === 'updated') counts.updated++;
      else if (a.type === 'released') counts.released++;
    });
    return counts;
  }, [activities]);

  const filterButtons: Array<{ key: FilterType; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'created', label: 'Created' },
    { key: 'updated', label: 'Updated' },
    { key: 'released', label: 'Released' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Clock className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Activity Feed</h2>
        <Badge variant="outline" className="ml-auto text-xs">
          {activities.length} entries
        </Badge>
      </div>

      {/* Filter Buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-4 w-4 text-muted-foreground" />
        {filterButtons.map((btn) => (
          <Button
            key={btn.key}
            variant={filter === btn.key ? 'default' : 'outline'}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setFilter(btn.key)}
          >
            {btn.label}
            <Badge
              variant="secondary"
              className="ml-1.5 text-[10px] px-1.5 py-0 h-4"
            >
              {filterCounts[btn.key]}
            </Badge>
          </Button>
        ))}
      </div>

      {/* Activity List */}
      {filteredActivities.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Inbox className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm font-medium">No activity entries</p>
            <p className="text-xs mt-1">
              {filter !== 'all'
                ? `No "${filter}" entries found. Try changing the filter.`
                : 'Activity will appear here as weeks are created and updated.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[19px] top-0 bottom-0 w-px bg-border" />

          <div className="space-y-3">
            {filteredActivities.map((entry, idx) => (
              <Card
                key={entry.id}
                className="relative transition-shadow hover:shadow-md"
              >
                <CardContent className="p-4 pl-12">
                  {/* Timeline dot */}
                  <div className="absolute left-3 top-5">
                    <div className="flex items-center justify-center h-[18px] w-[18px] rounded-full bg-background border-2 border-border">
                      <ActivityIcon type={entry.type} />
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Top row: week label + type badge */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">{entry.weekLabel}</span>
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${typeBadgeClass(entry.type)}`}>
                          {typeLabel(entry.type)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {entry.projectCount} project{entry.projectCount !== 1 ? 's' : ''}
                        </span>
                      </div>

                      {/* Summary */}
                      <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                        {entry.summary}
                      </p>
                    </div>

                    {/* Meta */}
                    <div className="shrink-0 text-right sm:text-right space-y-1">
                      {entry.weekDate && (
                        <p className="text-xs text-muted-foreground">{entry.weekDate}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground/70">
                        by {entry.modifiedBy}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}