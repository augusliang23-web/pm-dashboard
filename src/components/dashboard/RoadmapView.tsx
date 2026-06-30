'use client';

import { useMemo, useState } from 'react';
import { useDashboardStore } from '@/stores/dashboard';
import type { Project, QuarterlyMilestone, Week } from '@/types/dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Map, ChevronLeft, ChevronRight, Milestone, Target } from 'lucide-react';

// ── Helpers ──
const STATUS_STYLES: Record<string, string> = {
  green: 'border-green-500/50 bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400',
  yellow: 'border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20 text-yellow-700 dark:text-yellow-400',
  red: 'border-red-500/50 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400',
};

const STATUS_DOT: Record<string, string> = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
};

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'] as const;

function matchQuarter(qm: QuarterlyMilestone, year: number, quarter: string): boolean {
  // Match patterns like "Q1 2025", "2025-Q1", "Q1/2025", etc.
  const qPattern = new RegExp(`${quarter}[^\\d]*(\\d{4})`, 'i');
  const yPattern = new RegExp(`(\\d{4})[^\\d]*${quarter}`, 'i');
  const text = `${qm.quarter} ${qm.window} ${qm.goal}`.toLowerCase();

  const qMatch = text.match(qPattern);
  if (qMatch && parseInt(qMatch[1]) === year) return true;

  const yMatch = text.match(yPattern);
  if (yMatch && parseInt(yMatch[1]) === year) return true;

  // Fallback: if quarter string contains the Q label and year is present
  if (text.includes(quarter.toLowerCase()) && text.includes(String(year))) return true;

  return false;
}

// ── Quarter Lane Card ──
function QuarterLane({
  quarter,
  year,
  projects,
}: {
  quarter: string;
  year: number;
  projects: Project[];
}) {
  const quarterProjects = useMemo(() => {
    return projects.filter((p) =>
      (p.quarterlyMilestones || []).some((qm) => matchQuarter(qm, year, quarter))
    );
  }, [projects, year, quarter]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary text-xs font-bold">
          {quarter}
        </div>
        <h3 className="text-sm font-semibold">
          {quarter} {year}
        </h3>
        <Badge variant="secondary" className="text-[10px] ml-auto">
          {quarterProjects.length} project{quarterProjects.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      {quarterProjects.length === 0 ? (
        <div className="flex items-center justify-center h-20 rounded-lg border border-dashed border-border/50 text-xs text-muted-foreground">
          No projects mapped to this quarter
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {quarterProjects.map((p) => {
            const relevantQMs = (p.quarterlyMilestones || []).filter((qm) =>
              matchQuarter(qm, year, quarter)
            );
            return (
              <TooltipProvider key={p.code}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={`
                        rounded-lg border p-3 cursor-default transition-shadow hover:shadow-md
                        ${STATUS_STYLES[p.status] || 'border-border bg-muted/50'}
                      `}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${STATUS_DOT[p.status] || 'bg-muted-foreground'}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate">{p.name}</p>
                          {relevantQMs.length > 0 && (
                            <p className="text-xs mt-1 opacity-80 truncate">
                              <Target className="inline h-3 w-3 mr-0.5" />
                              {relevantQMs[0].goal || relevantQMs[0].window || 'Milestone planned'}
                            </p>
                          )}
                          {relevantQMs[0]?.window && (
                            <p className="text-[10px] mt-0.5 opacity-60 truncate">
                              {relevantQMs[0].window}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-2">
                            <Badge
                              variant="outline"
                              className="text-[9px] px-1.5 py-0"
                              style={{
                                borderColor:
                                  p.status === 'green' ? '#22c55e' : p.status === 'yellow' ? '#eab308' : '#ef4444',
                              }}
                            >
                              {p.status}
                            </Badge>
                            <span className="text-[10px] opacity-70">{p.progress}%</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <p className="font-semibold text-sm">{p.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Owner: {p.owner} · Progress: {p.progress}%
                    </p>
                    {relevantQMs.length > 0 && (
                      <div className="mt-1.5">
                        <p className="text-[10px] font-medium text-muted-foreground">Quarterly Milestones:</p>
                        {relevantQMs.map((qm, i) => (
                          <p key={i} className="text-xs">
                            • {qm.goal || qm.window}{' '}
                            {qm.status && (
                              <span className="text-muted-foreground">({qm.status})</span>
                            )}
                          </p>
                        ))}
                      </div>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Strategic Milestones Timeline ──
function StrategicTimeline({ weeks }: { weeks: Week[] }) {
  // Collect all milestone dates across all weeks
  const timelineItems = useMemo(() => {
    const items: Array<{
      name: string;
      date: string;
      project: string;
      status: string;
    }> = [];

    weeks.forEach((week) => {
      (week.projects || []).forEach((p) => {
        (p.milestones || []).forEach((m) => {
          if (m.date && m.name) {
            items.push({
              name: m.name,
              date: m.date,
              project: p.name,
              status: m.status,
            });
          }
        });
      });
    });

    // Sort by date
    items.sort((a, b) => a.date.localeCompare(b.date));
    return items;
  }, [weeks]);

  if (timelineItems.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 rounded-lg border border-dashed border-border/50 text-xs text-muted-foreground">
        No milestones found across all weeks
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Horizontal scroll container */}
      <div className="overflow-x-auto">
        <div className="flex gap-4 min-w-max pb-2">
          {timelineItems.map((item, idx) => (
            <div key={idx} className="flex items-start gap-3 w-[180px] shrink-0">
              {/* Timeline dot + line */}
              <div className="flex flex-col items-center">
                <div
                  className={`
                    h-3 w-3 rounded-full border-2 border-background shrink-0 z-10
                    ${item.status === 'done' ? 'bg-green-500' : item.status === 'at-risk' ? 'bg-yellow-500' : 'bg-muted-foreground/40'}
                  `}
                />
                {idx < timelineItems.length - 1 && (
                  <div className="w-0.5 flex-1 bg-border mt-1" />
                )}
              </div>
              {/* Content */}
              <div className="pb-4">
                <p className="text-xs font-semibold truncate">{item.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">{item.project}</p>
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">{item.date}</p>
                <Badge
                  variant="outline"
                  className="text-[9px] mt-1 px-1 py-0"
                >
                  {item.status || 'to-do'}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──
export default function RoadmapView() {
  const projects = useDashboardStore((s) => s.currentProjects());
  const allWeeks = useDashboardStore((s) => s.allWeeks);
  const activeRoadmapYear = useDashboardStore((s) => s.activeRoadmapYear);
  const setActiveRoadmapYear = useDashboardStore((s) => s.setActiveRoadmapYear);

  const currentYear = new Date().getFullYear();

  const selectedYear = activeRoadmapYear || currentYear;

  const handleYearChange = (direction: 'prev' | 'next') => {
    const newYear = direction === 'prev' ? selectedYear - 1 : selectedYear + 1;
    setActiveRoadmapYear(newYear);
  };

  // Projects that have any quarterly milestones
  const projectsWithQM = useMemo(
    () => projects.filter((p) => p.quarterlyMilestones && p.quarterlyMilestones.length > 0),
    [projects]
  );

  // Count projects per quarter
  const quarterCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    QUARTERS.forEach((q) => {
      counts[q] = projectsWithQM.filter((p) =>
        (p.quarterlyMilestones || []).some((qm) => matchQuarter(qm, selectedYear, q))
      ).length;
    });
    return counts;
  }, [projectsWithQM, selectedYear]);

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-2 flex-wrap">
          <Map className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Strategic Roadmap</h2>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleYearChange('prev')}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Select
              value={String(selectedYear)}
              onValueChange={(v) => setActiveRoadmapYear(parseInt(v, 10))}
            >
              <SelectTrigger className="w-[100px] h-8 text-sm font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => handleYearChange('next')}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Summary */}
        <div className="flex flex-wrap gap-2">
          {QUARTERS.map((q) => (
            <Badge key={q} variant="outline" className="text-xs">
              {q}: {quarterCounts[q]} project{quarterCounts[q] !== 1 ? 's' : ''}
            </Badge>
          ))}
        </div>

        {/* Quarter Lanes */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {QUARTERS.map((q) => (
            <Card key={q}>
              <CardContent className="p-4">
                <QuarterLane quarter={q} year={selectedYear} projects={projects} />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Strategic Initiatives Timeline */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Milestone className="h-4 w-4 text-muted-foreground" />
              Strategic Milestones Timeline
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <StrategicTimeline weeks={allWeeks} />
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}