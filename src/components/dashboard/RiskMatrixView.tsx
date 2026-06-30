'use client';

import { useMemo, useState } from 'react';
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
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { ShieldAlert, AlertTriangle, Info } from 'lucide-react';

// ── Risk level derivation ──
function deriveRiskPosition(project: Project): { likelihood: number; impact: number } {
  // Derive from status + progress
  if (project.status === 'red') {
    if (project.progress < 30) return { likelihood: 4, impact: 5 };
    if (project.progress < 60) return { likelihood: 4, impact: 4 };
    return { likelihood: 3, impact: 4 };
  }
  if (project.status === 'yellow') {
    if (project.progress < 40) return { likelihood: 3, impact: 3 };
    if (project.progress < 70) return { likelihood: 3, impact: 2 };
    return { likelihood: 2, impact: 2 };
  }
  // green
  if (project.progress > 80) return { likelihood: 1, impact: 1 };
  if (project.progress > 50) return { likelihood: 2, impact: 1 };
  return { likelihood: 2, impact: 2 };
}

// ── Cell color based on risk score ──
function cellColor(impact: number, likelihood: number): string {
  const score = impact * likelihood;
  if (score <= 4) return 'bg-green-500/70';
  if (score <= 9) return 'bg-yellow-400/70';
  if (score <= 15) return 'bg-orange-500/70';
  return 'bg-red-500/70';
}

function cellColorLabel(impact: number, likelihood: number): string {
  const score = impact * likelihood;
  if (score <= 4) return 'Low';
  if (score <= 9) return 'Medium';
  if (score <= 15) return 'High';
  return 'Critical';
}

const LIKELIHOOD_LABELS = ['', 'Negligible', 'Unlikely', 'Possible', 'Likely', 'Almost Certain'];
const IMPACT_LABELS = ['', 'Negligible', 'Minor', 'Moderate', 'Major', 'Catastrophic'];

// ── Main Component ──
export default function RiskMatrixView() {
  const projects = useDashboardStore((s) => s.currentProjects());
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);

  // Build grid: map "likelihood-impact" => projects
  const gridMap = useMemo(() => {
    const map = new Map<string, Project[]>();
    for (let i = 1; i <= 5; i++) {
      for (let j = 1; j <= 5; j++) {
        map.set(`${i}-${j}`, []);
      }
    }
    projects.forEach((p) => {
      const { likelihood, impact } = deriveRiskPosition(p);
      const key = `${likelihood}-${impact}`;
      const existing = map.get(key) || [];
      existing.push(p);
      map.set(key, existing);
    });
    return map;
  }, [projects]);

  // Projects with risk actions for the registry table
  const riskRegistry = useMemo(() => {
    return projects
      .filter((p) => {
        return (
          p.riskActions && p.riskActions.length > 0 && p.riskActions.some((ra) => ra.risk)
        );
      })
      .map((p) => ({
        name: p.name,
        code: p.code,
        status: p.status,
        primaryRisk: p.riskActions.find((ra) => ra.primary)?.risk || p.riskActions[0]?.risk || '',
        requiredAction: p.riskActions.find((ra) => ra.primary)?.action || p.riskActions[0]?.action || '',
        riskLevel: cellColorLabel(deriveRiskPosition(p).impact, deriveRiskPosition(p).likelihood),
      }));
  }, [projects]);

  const riskCounts = useMemo(() => {
    let low = 0, med = 0, high = 0, crit = 0;
    projects.forEach((p) => {
      const { impact, likelihood } = deriveRiskPosition(p);
      const score = impact * likelihood;
      if (score <= 4) low++;
      else if (score <= 9) med++;
      else if (score <= 15) high++;
      else crit++;
    });
    return { low, med, high, crit };
  }, [projects]);

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Risk Assessment Matrix</h2>
        </div>

        {/* Summary badges */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="border-green-500 text-green-700 bg-green-50 dark:bg-green-950/30">
            Low: {riskCounts.low}
          </Badge>
          <Badge variant="outline" className="border-yellow-500 text-yellow-700 bg-yellow-50 dark:bg-yellow-950/30">
            Medium: {riskCounts.med}
          </Badge>
          <Badge variant="outline" className="border-orange-500 text-orange-700 bg-orange-50 dark:bg-orange-950/30">
            High: {riskCounts.high}
          </Badge>
          <Badge variant="outline" className="border-red-500 text-red-700 bg-red-50 dark:bg-red-950/30">
            Critical: {riskCounts.crit}
          </Badge>
        </div>

        {/* Risk Matrix Grid */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Risk Matrix (Likelihood × Impact)</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            {/* Y axis label */}
            <div className="flex gap-2">
              {/* Y-axis label */}
              <div className="flex items-center">
                <span
                  className="text-xs font-medium text-muted-foreground writing-mode-vertical"
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                >
                  IMPACT →
                </span>
              </div>

              {/* Grid */}
              <div className="flex-1 overflow-x-auto">
                <div className="min-w-[500px]">
                  {/* X-axis label */}
                  <div className="mb-2 flex pl-12">
                    <span className="text-xs font-medium text-muted-foreground flex-1 text-center">
                      LIKELIHOOD →
                    </span>
                  </div>

                  {/* X-axis headers */}
                  <div className="flex pl-12 mb-1">
                    {LIKELIHOOD_LABELS.slice(1).map((label, i) => (
                      <div key={i} className="flex-1 text-center">
                        <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
                      </div>
                    ))}
                  </div>

                  {/* Rows: impact 5 (top) to 1 (bottom) */}
                  {[5, 4, 3, 2, 1].map((impact) => (
                    <div key={impact} className="flex items-stretch mb-1">
                      {/* Y-axis label */}
                      <div className="w-12 flex items-center justify-end pr-2">
                        <span className="text-[10px] font-medium text-muted-foreground text-right">
                          {IMPACT_LABELS[impact]}
                        </span>
                      </div>

                      {/* Cells */}
                      {[1, 2, 3, 4, 5].map((likelihood) => {
                        const key = `${likelihood}-${impact}`;
                        const cellProjects = gridMap.get(key) || [];
                        const isHovered = hoveredCell === key;
                        return (
                          <Tooltip key={key}>
                            <TooltipTrigger asChild>
                              <div
                                className={`
                                  flex-1 h-16 sm:h-20 border border-border/30 relative cursor-default
                                  transition-all ${cellColor(impact, likelihood)}
                                  ${isHovered ? 'ring-2 ring-primary ring-offset-1' : ''}
                                `}
                                onMouseEnter={() => setHoveredCell(key)}
                                onMouseLeave={() => setHoveredCell(null)}
                              >
                                {/* Score */}
                                <span className="absolute top-0.5 left-1 text-[9px] font-mono opacity-60">
                                  {impact * likelihood}
                                </span>

                                {/* Project dots */}
                                <div className="absolute inset-0 flex items-center justify-center gap-1 flex-wrap p-1">
                                  {cellProjects.map((p) => (
                                    <div
                                      key={p.code}
                                      className={`
                                        w-3 h-3 rounded-full border-2 border-white shadow-sm
                                        ${p.status === 'green' ? 'bg-green-600' : p.status === 'yellow' ? 'bg-yellow-500' : 'bg-red-500'}
                                      `}
                                    />
                                  ))}
                                </div>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              <p className="font-semibold text-xs">
                                {cellColorLabel(impact, likelihood)} (Score: {impact * likelihood})
                              </p>
                              {cellProjects.length > 0 ? (
                                <ul className="mt-1 space-y-0.5">
                                  {cellProjects.map((p) => (
                                    <li key={p.code} className="text-xs text-muted-foreground">
                                      {p.name}{' '}
                                      <span className="font-medium text-foreground">({p.progress}%)</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-xs text-muted-foreground mt-1">No projects in this zone</p>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Risk Action Registry Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              Risk Action Registry
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {riskRegistry.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Info className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">No risk actions defined for current projects</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[180px]">Project</TableHead>
                      <TableHead className="w-[80px]">Status</TableHead>
                      <TableHead className="w-[80px]">Risk Level</TableHead>
                      <TableHead>Primary Risk</TableHead>
                      <TableHead>Required Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {riskRegistry.map((r) => (
                      <TableRow key={r.code}>
                        <TableCell className="font-medium text-sm">{r.name}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="text-[10px]"
                            style={{
                              borderColor:
                                r.status === 'green' ? '#22c55e' : r.status === 'yellow' ? '#eab308' : '#ef4444',
                              color:
                                r.status === 'green' ? '#16a34a' : r.status === 'yellow' ? '#ca8a04' : '#dc2626',
                            }}
                          >
                            {r.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className="text-[10px]"
                          >
                            {r.riskLevel}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[250px] text-xs text-muted-foreground truncate">
                          {r.primaryRisk}
                        </TableCell>
                        <TableCell className="max-w-[250px] text-xs text-muted-foreground truncate">
                          {r.requiredAction || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}