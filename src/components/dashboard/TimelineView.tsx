'use client';

import { useMemo } from 'react';
import { useDashboardStore } from '@/stores/dashboard';
import type { Project, MilestonePlan } from '@/types/dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { GanttChart } from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
} from 'recharts';

// ── Helpers ──
function parseDate(d: string): Date | null {
  if (!d) return null;
  const ts = Date.parse(d);
  return isNaN(ts) ? null : new Date(ts);
}

function getMonthRange() {
  const now = new Date();
  const months: { key: string; label: string; date: Date }[] = [];
  // Last 6 months
  for (let i = -6; i <= 2; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const label = d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label, date: d });
  }
  return months;
}

const STATUS_COLORS: Record<string, string> = {
  green: '#22c55e',
  yellow: '#eab308',
  red: '#ef4444',
};
const STATUS_DARK: Record<string, string> = {
  green: '#15803d',
  yellow: '#a16207',
  red: '#b91c1c',
};

interface GanttBarData {
  name: string;
  code: string;
  status: string;
  progress: number;
  startIdx: number;
  endIdx: number;
  progressEndIdx: number;
  milestones: { idx: number; name: string; status: string }[];
}

function toGanttData(projects: Project[], months: ReturnType<typeof getMonthRange>): GanttBarData[] {
  return projects
    .map((p) => {
      const dates = p.milestones
        .map((m) => parseDate(m.date))
        .filter((d): d is Date => d !== null);
      if (dates.length === 0) return null;

      const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
      const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));

      // Find the month indices
      let startIdx = months.findIndex(
        (m) => m.date.getFullYear() === minDate.getFullYear() && m.date.getMonth() === minDate.getMonth()
      );
      let endIdx = months.findIndex(
        (m) => m.date.getFullYear() === maxDate.getFullYear() && m.date.getMonth() === maxDate.getMonth()
      );

      if (startIdx === -1) startIdx = 0;
      if (endIdx === -1) endIdx = months.length - 1;

      // Progress end: interpolate based on progress percentage within the bar span
      const span = endIdx - startIdx;
      const progressEndIdx = startIdx + (span * p.progress) / 100;

      // Milestone positions
      const msPositions = p.milestones
        .filter((m) => m.date)
        .map((m) => {
          const md = parseDate(m.date);
          if (!md) return null;
          const mIdx = months.findIndex(
            (mo) => mo.date.getFullYear() === md.getFullYear() && mo.date.getMonth() === md.getMonth()
          );
          if (mIdx === -1) return null;
          return { idx: mIdx, name: m.name, status: m.status };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      return {
        name: p.name || p.code,
        code: p.code,
        status: p.status,
        progress: p.progress,
        startIdx,
        endIdx,
        progressEndIdx,
        milestones: msPositions,
      };
    })
    .filter((x): x is GanttBarData => x !== null)
    .sort((a, b) => a.startIdx - b.startIdx || a.code.localeCompare(b.code));
}

// ── Custom Gantt Bar Shape ──
function GanttBarShape(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: GanttBarData;
  months: ReturnType<typeof getMonthRange>;
  barWidth: number;
}) {
  const { x = 0, y = 0, width: chartWidth = 800, height = 28, payload, months, barWidth } = props;
  if (!payload) return null;

  const monthWidth = chartWidth / months.length;
  const barX = x + payload.startIdx * monthWidth;
  const barFullWidth = (payload.endIdx - payload.startIdx + 1) * monthWidth;
  const progressWidth = (payload.progressEndIdx - payload.startIdx) * monthWidth;

  const baseColor = STATUS_COLORS[payload.status] || '#94a3b8';
  const darkColor = STATUS_DARK[payload.status] || '#64748b';
  const cy = y + height / 2;

  return (
    <g>
      {/* Background bar */}
      <rect
        x={barX}
        y={y + 2}
        width={barFullWidth}
        height={height - 4}
        rx={4}
        fill={baseColor}
        fillOpacity={0.3}
        stroke={baseColor}
        strokeWidth={1}
      />
      {/* Progress bar */}
      <rect
        x={barX}
        y={y + 2}
        width={Math.max(0, Math.min(progressWidth, barFullWidth))}
        height={height - 4}
        rx={4}
        fill={darkColor}
        fillOpacity={0.7}
      />
      {/* Milestone diamonds */}
      {payload.milestones.map((ms, i) => {
        const mx = x + ms.idx * monthWidth + monthWidth / 2;
        const diamondSize = 5;
        const msColor = ms.status === 'done' ? '#22c55e' : ms.status === 'at-risk' ? '#eab308' : '#94a3b8';
        return (
          <g key={i}>
            <polygon
              points={`${mx},${cy - diamondSize} ${mx + diamondSize},${cy} ${mx},${cy + diamondSize} ${mx - diamondSize},${cy}`}
              fill={msColor}
              stroke="#fff"
              strokeWidth={1.5}
            />
          </g>
        );
      })}
    </g>
  );
}

// ── TODAY Line ──
function TodayLine({ months, chartWidth, height }: { months: ReturnType<typeof getMonthRange>; chartWidth: number; height: number }) {
  const now = new Date();
  const currentMonth = months.findIndex(
    (m) => m.date.getFullYear() === now.getFullYear() && m.date.getMonth() === now.getMonth()
  );
  if (currentMonth === -1) return null;

  const monthWidth = chartWidth / months.length;
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const fraction = dayOfMonth / daysInMonth;
  const x = currentMonth * monthWidth + fraction * monthWidth;

  return (
    <line
      x1={x}
      y1={0}
      x2={x}
      y2={height}
      stroke="#ef4444"
      strokeWidth={2}
      strokeDasharray="6 3"
    />
  );
}

// ── Main Component ──
export default function TimelineView() {
  const projects = useDashboardStore((s) => s.currentProjects());
  const months = useMemo(() => getMonthRange(), []);

  const ganttData = useMemo(() => toGanttData(projects, months), [projects, months]);

  // Chart data for recharts (just to render axes, actual bars are custom)
  const chartData = months.map((m) => ({ name: m.label }));

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <GanttChart className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Project Timeline</h2>
          <Badge variant="outline" className="ml-auto text-xs">
            {ganttData.length} projects
          </Badge>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: STATUS_COLORS.green, opacity: 0.7 }} />
            On Track
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: STATUS_COLORS.yellow, opacity: 0.7 }} />
            At Risk
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: STATUS_COLORS.red, opacity: 0.7 }} />
            Critical
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rotate-45 rounded-sm bg-muted-foreground" />
            Milestone
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-0.5 border-l-2 border-dashed border-red-500" />
            TODAY
          </span>
        </div>

        <Card>
          <CardContent className="p-4">
            {/* Mobile: horizontal scroll wrapper */}
            <div className="overflow-x-auto">
              <div className="min-w-[700px]">
                {ganttData.length === 0 ? (
                  <div className="flex h-64 items-center justify-center text-muted-foreground">
                    No projects with milestone dates to display
                  </div>
                ) : (
                  <div className="relative" style={{ height: Math.max(300, ganttData.length * 48 + 60) }}>
                    {/* Y-axis: project names */}
                    <div
                      className="absolute left-0 top-0 z-10 bg-background"
                      style={{ width: 180, height: '100%' }}
                    >
                      <div className="h-[40px] flex items-center justify-end pr-2 text-xs font-medium text-muted-foreground border-b">
                        Project
                      </div>
                      {ganttData.map((d, i) => (
                        <div
                          key={d.code}
                          className="flex items-center pr-2 border-b border-border/30"
                          style={{ height: 48, top: 40 + i * 48 }}
                        >
                          <div className="min-w-0 flex-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <p className="truncate text-sm font-medium cursor-default">{d.name}</p>
                              </TooltipTrigger>
                              <TooltipContent side="left">
                                <p className="font-semibold">{d.name}</p>
                                <p className="text-xs text-muted-foreground">Progress: {d.progress}%</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <Badge
                            variant="outline"
                            className="ml-1.5 shrink-0 text-[10px] px-1.5 py-0"
                            style={{
                              borderColor: STATUS_COLORS[d.status] || '#94a3b8',
                              color: STATUS_COLORS[d.status] || '#94a3b8',
                            }}
                          >
                            {d.progress}%
                          </Badge>
                        </div>
                      ))}
                    </div>

                    {/* Chart area */}
                    <div className="absolute left-[180px] right-0 top-0" style={{ height: '100%' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={chartData}
                          margin={{ top: 10, right: 20, left: 0, bottom: 10 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" vertical={true} horizontal={false} stroke="hsl(var(--border))" />
                          <XAxis
                            dataKey="name"
                            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                            axisLine={{ stroke: 'hsl(var(--border))' }}
                            tickLine={false}
                            height={30}
                          />
                          <YAxis type="category" dataKey="name" hide />
                          <RechartsTooltip content={() => null} />
                          <Bar dataKey="name" fill="transparent" isAnimationActive={false} shape={(props: Record<string, unknown>) => (
                            <GanttBarShape
                              x={props.x as number}
                              y={props.y as number}
                              width={(props.width as number) || 600}
                              height={props.height as number}
                              payload={ganttData[props.index as number] || ganttData[0]}
                              months={months}
                              barWidth={0}
                            />
                          )} />
                          {/* TODAY vertical line via reference */}
                          {ganttData.length > 0 && (
                            <TodayLine months={months} chartWidth={600} height={ganttData.length * 48 + 60} />
                          )}
                        </BarChart>
                      </ResponsiveContainer>

                      {/* Overlay TODAY line (SVG-based for accuracy) */}
                      <svg className="pointer-events-none absolute inset-0" style={{ height: '100%' }}>
                        <TodayLineOverlay months={months} />
                      </svg>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}

// ── SVG Overlay for Today Line ──
function TodayLineOverlay({ months }: { months: ReturnType<typeof getMonthRange> }) {
  const now = new Date();
  const currentMonth = months.findIndex(
    (m) => m.date.getFullYear() === now.getFullYear() && m.date.getMonth() === now.getMonth()
  );
  if (currentMonth === -1) return null;

  // Use percentage-based positioning
  const fraction = now.getDate() / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const xPercent = ((currentMonth + fraction) / months.length) * 100;

  return (
    <g>
      <line
        x1={`${xPercent}%`}
        y1={40}
        x2={`${xPercent}%`}
        y2="100%"
        stroke="#ef4444"
        strokeWidth={2}
        strokeDasharray="6 3"
      />
      <rect
        x={`${xPercent - 3}%`}
        y={10}
        width="6%"
        height={22}
        rx={4}
        fill="#ef4444"
      />
      <text
        x={`${xPercent}%`}
        y={24}
        textAnchor="middle"
        fill="white"
        fontSize={10}
        fontWeight={700}
      >
        TODAY
      </text>
    </g>
  );
}