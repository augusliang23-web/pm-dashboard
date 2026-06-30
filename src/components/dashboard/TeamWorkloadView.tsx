'use client';

import { useMemo } from 'react';
import { useDashboardStore } from '@/stores/dashboard';
import type { Project } from '@/types/dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Users } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts';

const STATUS_COLORS = {
  green: '#22c55e',
  yellow: '#eab308',
  red: '#ef4444',
};

// ── Per-owner aggregation ──
interface OwnerStats {
  owner: string;
  total: number;
  greenCount: number;
  yellowCount: number;
  redCount: number;
  avgProgress: number;
  onTrackPct: number;
  atRiskPct: number;
  completionRate: number;
}

function computeOwnerStats(projects: Project[], pmList: string[]): OwnerStats[] {
  const map = new Map<string, Project[]>();
  projects.forEach((p) => {
    const o = p.owner || 'TBD';
    const list = map.get(o) || [];
    list.push(p);
    map.set(o, list);
  });

  return pmList
    .map((name) => {
      const projs = map.get(name) || [];
      if (projs.length === 0)
        return {
          owner: name,
          total: 0,
          greenCount: 0,
          yellowCount: 0,
          redCount: 0,
          avgProgress: 0,
          onTrackPct: 0,
          atRiskPct: 0,
          completionRate: 0,
        };
      const green = projs.filter((p) => p.status === 'green').length;
      const yellow = projs.filter((p) => p.status === 'yellow').length;
      const red = projs.filter((p) => p.status === 'red').length;
      const avgProg = projs.reduce((s, p) => s + p.progress, 0) / projs.length;
      return {
        owner: name,
        total: projs.length,
        greenCount: green,
        yellowCount: yellow,
        redCount: red,
        avgProgress: Math.round(avgProg),
        onTrackPct: Math.round((green / projs.length) * 100),
        atRiskPct: Math.round(((yellow + red) / projs.length) * 100),
        completionRate: Math.round(avgProg),
      };
    })
    .filter((s) => s.total > 0);
}

// ── Main Component ──
export default function TeamWorkloadView() {
  const projects = useDashboardStore((s) => s.currentProjects());
  const pmList = useDashboardStore((s) => s.pmList);

  const ownerStats = useMemo(() => computeOwnerStats(projects, pmList), [projects, pmList]);

  // Bar chart data
  const barData = useMemo(
    () =>
      ownerStats.map((s) => ({
        name: s.owner.split('@')[0] || s.owner,
        OnTrack: s.greenCount,
        'At Risk': s.yellowCount,
        Critical: s.redCount,
      })),
    [ownerStats]
  );

  // Radar chart data
  const radarData = useMemo(
    () =>
      ownerStats.map((s) => ({
        name: s.owner.split('@')[0] || s.owner,
        'On Track %': s.onTrackPct,
        'At Risk %': s.atRiskPct,
        'Completion Rate': s.completionRate,
      })),
    [ownerStats]
  );

  // Heatmap table data: members × status categories
  const heatmapData = useMemo(
    () => ({
      members: ownerStats,
      categories: [
        { key: 'green', label: 'On Track', color: 'bg-green-500' },
        { key: 'yellow', label: 'At Risk', color: 'bg-yellow-500' },
        { key: 'red', label: 'Critical', color: 'bg-red-500' },
      ],
      maxCount: Math.max(1, ...ownerStats.map((s) => Math.max(s.greenCount, s.yellowCount, s.redCount))),
    }),
    [ownerStats]
  );

  // Project assignment matrix
  const assignmentMatrix = useMemo(
    () =>
      projects.map((p) => ({
        name: p.name,
        code: p.code,
        owner: p.owner || 'TBD',
        deputy: p.deputy || 'TBD',
        status: p.status,
        progress: p.progress,
      })),
    [projects]
  );

  const totalProjects = projects.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Team Workload</h2>
        <Badge variant="outline" className="ml-auto text-xs">
          {pmList.length} members · {totalProjects} projects
        </Badge>
      </div>

      {ownerStats.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Users className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm">No team members with assigned projects</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Row 1: Bar Chart + Radar Chart */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Grouped Bar Chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Projects by Status per Member</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={barData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      allowDecimals={false}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="OnTrack" stackId="a" fill={STATUS_COLORS.green} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="At Risk" stackId="a" fill={STATUS_COLORS.yellow} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Critical" stackId="a" fill={STATUS_COLORS.red} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Radar Chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Performance Radar</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                    <PolarGrid stroke="hsl(var(--border))" />
                    <PolarAngleAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <PolarRadiusAxis
                      angle={90}
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <Radar
                      name="On Track %"
                      dataKey="On Track %"
                      stroke="#22c55e"
                      fill="#22c55e"
                      fillOpacity={0.2}
                    />
                    <Radar
                      name="At Risk %"
                      dataKey="At Risk %"
                      stroke="#eab308"
                      fill="#eab308"
                      fillOpacity={0.15}
                    />
                    <Radar
                      name="Completion Rate"
                      dataKey="Completion Rate"
                      stroke="#3b82f6"
                      fill="#3b82f6"
                      fillOpacity={0.1}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: 12,
                      }}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Row 2: Heatmap Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Workload Heatmap</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[140px]">Team Member</TableHead>
                      <TableHead className="w-[80px] text-center">Total</TableHead>
                      {heatmapData.categories.map((cat) => (
                        <TableHead key={cat.key} className="text-center">
                          {cat.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {heatmapData.members.map((member) => (
                      <TableRow key={member.owner}>
                        <TableCell className="font-medium text-sm">{member.owner}</TableCell>
                        <TableCell className="text-center font-semibold">{member.total}</TableCell>
                        {heatmapData.categories.map((cat) => {
                          const count = member[`${cat.key}Count` as keyof OwnerStats] as number;
                          const intensity = heatmapData.maxCount > 0 ? count / heatmapData.maxCount : 0;
                          const bgOpacity = count === 0 ? 0 : 0.15 + intensity * 0.6;
                          return (
                            <TableCell key={cat.key} className="text-center">
                              <span
                                className={`
                                  inline-flex items-center justify-center
                                  min-w-[2rem] h-7 rounded-md text-xs font-semibold
                                  ${cat.color}
                                `}
                                style={{ opacity: count === 0 ? 0.2 : 1 + intensity * 0.5 }}
                              >
                                {count}
                              </span>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Row 3: Project Assignment Matrix */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Project Assignment Matrix</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="w-[200px]">Project</TableHead>
                      <TableHead className="w-[120px]">Owner</TableHead>
                      <TableHead className="w-[120px]">Deputy</TableHead>
                      <TableHead className="w-[80px]">Status</TableHead>
                      <TableHead className="w-[80px] text-right">Progress</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignmentMatrix.map((row) => (
                      <TableRow key={row.code}>
                        <TableCell className="font-medium text-sm">{row.name}</TableCell>
                        <TableCell className="text-sm">{row.owner}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.deputy}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="text-[10px]"
                            style={{
                              borderColor: STATUS_COLORS[row.status as keyof typeof STATUS_COLORS] || '#94a3b8',
                              color: STATUS_COLORS[row.status as keyof typeof STATUS_COLORS] || '#94a3b8',
                            }}
                          >
                            {row.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">{row.progress}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}