'use client';

import React, { useMemo } from 'react';
import {
  FolderKanban,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  Users,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useDashboardStore } from '@/stores/dashboard';
import type { Project } from '@/types/dashboard';

// ── Color Constants ──
const STATUS_COLORS = {
  green: '#88C9AC',
  yellow: '#E4CC8F',
  red: '#E39A9A',
  'to-do': '#C4C4C4',
} as const;

const STATUS_LABELS = {
  green: 'On Track',
  yellow: 'At Risk',
  red: 'Critical',
  'to-do': 'To Do',
} as const;

// ── Owner Color Palette ──
const OWNER_PALETTE = [
  '#88C9AC', '#E4CC8F', '#E39A9A', '#A8C8E8', '#C4B5E0',
  '#F0B89F', '#87C5D6', '#D4A5A5', '#B5C99A', '#E8C170',
];

// ── KPI Card Component ──
interface KpiCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
}

function KpiCard({ title, value, icon, iconBg, iconColor }: KpiCardProps) {
  return (
    <Card className="bg-white">
      <CardContent className="flex items-center gap-4 p-6">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: iconBg }}
        >
          <div style={{ color: iconColor }}>{icon}</div>
        </div>
        <div>
          <div className="text-3xl font-bold tracking-tight">{value}</div>
          <div className="text-sm text-muted-foreground">{title}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Donut Chart Center Label ──
function DonutCenterLabel({ total }: { total: number }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
      <span className="text-3xl font-bold">{total}</span>
      <span className="text-xs text-muted-foreground">Projects</span>
    </div>
  );
}

// ── Custom Tooltip ──
function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border bg-white p-2 shadow-sm">
      {label && <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>}
      {payload.map((item, i) => (
        <p key={i} className="text-xs" style={{ color: item.color }}>
          {item.name}: {item.value}
        </p>
      ))}
    </div>
  );
}

// ── Main Component ──
export default function OverviewView() {
  const allWeeks = useDashboardStore((s) => s.allWeeks);
  const currentProjects = useDashboardStore((s) => s.currentProjects);

  const projects = currentProjects();

  // ── KPI Counts ──
  const totalProjects = projects.length;
  const criticalCount = projects.filter((p) => p.status === 'red').length;
  const atRiskCount = projects.filter((p) => p.status === 'yellow').length;
  const onTrackCount = projects.filter((p) => p.status === 'green').length;

  // ── Donut Data ──
  const donutData = useMemo(() => {
    const statusCounts: Record<string, number> = {
      green: 0,
      yellow: 0,
      red: 0,
      'to-do': 0,
    };
    projects.forEach((p) => {
      const key = p.status === 'to-do' || p.status === 'in-progress' || p.status === 'done' || p.status === 'at-risk'
        ? p.status
        : statusCounts.hasOwnProperty(p.status) ? p.status : 'to-do';
      statusCounts[key] = (statusCounts[key] || 0) + 1;
    });
    return Object.entries(statusCounts)
      .filter(([, value]) => value > 0)
      .map(([key, value]) => ({
        name: STATUS_LABELS[key as keyof typeof STATUS_LABELS] || key,
        value,
        key,
      }));
  }, [projects]);

  // ── Weekly Trend Data (last 8 weeks) ──
  const weeklyTrendData = useMemo(() => {
    const weeks = allWeeks.slice(-8);
    return weeks.map((week) => {
      const projs = week.projects || [];
      return {
        week: week.weekLabel,
        'On Track': projs.filter((p) => p.status === 'green').length,
        'At Risk': projs.filter((p) => p.status === 'yellow').length,
        Critical: projs.filter((p) => p.status === 'red').length,
      };
    });
  }, [allWeeks]);

  // ── Owner Distribution Data ──
  const ownerData = useMemo(() => {
    const ownerMap = new Map<string, number>();
    projects.forEach((p) => {
      const owner = p.owner || 'Unassigned';
      ownerMap.set(owner, (ownerMap.get(owner) || 0) + 1);
    });
    return Array.from(ownerMap.entries())
      .map(([owner, count]) => ({
        name: owner === 'TBD' ? 'Unassigned' : owner,
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [projects]);

  // ── Owner bar data for horizontal stacked bar ──
  const ownerBarData = useMemo(() => {
    if (ownerData.length === 0) return [];
    return ownerData.map((item, i) => ({
      name: item.name,
      count: item.count,
      fill: OWNER_PALETTE[i % OWNER_PALETTE.length],
    }));
  }, [ownerData]);

  return (
    <div className="space-y-6">
      {/* ── KPI Cards Row ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total Projects"
          value={totalProjects}
          icon={<FolderKanban className="h-6 w-6" />}
          iconBg="#EEF2F5"
          iconColor="#475569"
        />
        <KpiCard
          title="Critical Issues"
          value={criticalCount}
          icon={<AlertTriangle className="h-6 w-6" />}
          iconBg="#FEE2E2"
          iconColor="#DC2626"
        />
        <KpiCard
          title="At Risk"
          value={atRiskCount}
          icon={<AlertCircle className="h-6 w-6" />}
          iconBg="#FEF3C7"
          iconColor="#D97706"
        />
        <KpiCard
          title="On Track"
          value={onTrackCount}
          icon={<CheckCircle className="h-6 w-6" />}
          iconBg="#DCFCE7"
          iconColor="#16A34A"
        />
      </div>

      {/* ── Charts Grid: 2 columns on desktop, 1 on mobile ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ── Portfolio Health Donut Chart ── */}
        <Card className="bg-white">
          <CardHeader>
            <CardTitle className="text-base">Portfolio Health</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            <div className="relative h-[280px] w-full">
              {donutData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={donutData}
                        cx="50%"
                        cy="50%"
                        innerRadius={70}
                        outerRadius={110}
                        paddingAngle={2}
                        dataKey="value"
                        stroke="none"
                      >
                        {donutData.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={STATUS_COLORS[entry.key as keyof typeof STATUS_COLORS] || '#C4C4C4'}
                          />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                      <Legend
                        verticalAlign="bottom"
                        iconType="circle"
                        iconSize={8}
                        formatter={(value: string) => (
                          <span className="text-xs text-muted-foreground">{value}</span>
                        )}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <DonutCenterLabel total={totalProjects} />
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  No project data available
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Weekly Trend Area Chart ── */}
        <Card className="bg-white">
          <CardHeader>
            <CardTitle className="text-base">Weekly Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px] w-full">
              {weeklyTrendData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={weeklyTrendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis
                      dataKey="week"
                      tick={{ fontSize: 11, fill: '#94A3B8' }}
                      axisLine={{ stroke: '#E5E7EB' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#94A3B8' }}
                      axisLine={{ stroke: '#E5E7EB' }}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="On Track"
                      stackId="1"
                      stroke="#88C9AC"
                      fill="#88C9AC"
                      fillOpacity={0.7}
                    />
                    <Area
                      type="monotone"
                      dataKey="At Risk"
                      stackId="1"
                      stroke="#E4CC8F"
                      fill="#E4CC8F"
                      fillOpacity={0.7}
                    />
                    <Area
                      type="monotone"
                      dataKey="Critical"
                      stackId="1"
                      stroke="#E39A9A"
                      fill="#E39A9A"
                      fillOpacity={0.7}
                    />
                    <Legend
                      verticalAlign="bottom"
                      iconType="circle"
                      iconSize={8}
                      formatter={(value: string) => (
                        <span className="text-xs text-muted-foreground">{value}</span>
                      )}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  No weekly data available
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Quick Stats: Owner Distribution ── */}
      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            Owner Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ownerData.length > 0 ? (
            <div className="space-y-3">
              {/* Stacked horizontal bar */}
              <div className="h-6 w-full overflow-hidden rounded-full bg-muted">
                <div className="flex h-full">
                  {ownerBarData.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-center transition-all duration-300"
                      style={{
                        width: `${(item.count / totalProjects) * 100}%`,
                        backgroundColor: item.fill,
                        minWidth: item.count > 0 ? '2px' : '0',
                      }}
                      title={`${item.name}: ${item.count} projects`}
                    />
                  ))}
                </div>
              </div>
              {/* Legend */}
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {ownerData.map((item, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-sm">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: OWNER_PALETTE[i % OWNER_PALETTE.length] }}
                    />
                    <span className="text-muted-foreground">{item.name}</span>
                    <span className="font-medium">{item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
              No owner data available
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
