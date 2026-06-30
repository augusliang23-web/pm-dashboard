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
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDashboardStore, getRiskActionPairs } from '@/stores/dashboard';
import type { Project, MilestonePlan, QuarterlyMilestone, RiskActionPair } from '@/types/dashboard';
import { STATUS_LABELS } from '@/types/dashboard';
import {
  User,
  UserCircle,
  MapPin,
  Lightbulb,
  ListTodo,
  AlertTriangle,
  Pencil,
  CircleDot,
  Target,
} from 'lucide-react';

// ── Status color helpers ──
function statusColor(status: string): string {
  switch (status) {
    case 'green':
    case 'done':
      return 'bg-emerald-500';
    case 'yellow':
    case 'at-risk':
    case 'in-progress':
      return 'bg-amber-400';
    case 'red':
    case 'blocked':
      return 'bg-red-500';
    default:
      return 'bg-gray-300';
  }
}

function milestoneStatusDot(status: string) {
  let color = 'bg-gray-300';
  if (status === 'done') color = 'bg-emerald-500';
  else if (status === 'in-progress') color = 'bg-amber-400';
  else if (status === 'to-do') color = 'bg-gray-300';
  return (
    <span
      className={`inline-block size-3 rounded-full shrink-0 ${color}`}
      title={status}
    />
  );
}

function statusBadge(status: string) {
  const label = STATUS_LABELS[status] || status;
  let variant: 'default' | 'outline' | 'secondary' = 'outline';
  let cls = '';
  if (status === 'green' || status === 'done') {
    variant = 'default';
    cls = 'bg-emerald-600 hover:bg-emerald-700';
  } else if (status === 'yellow' || status === 'at-risk' || status === 'in-progress') {
    variant = 'default';
    cls = 'bg-amber-500 hover:bg-amber-600';
  } else if (status === 'red' || status === 'blocked') {
    variant = 'default';
    cls = 'bg-red-600 hover:bg-red-700';
  }
  return (
    <Badge variant={variant} className={cls}>
      {label}
    </Badge>
  );
}

function progressColor(progress: number, status: string) {
  if (status === 'red') return '[&>[data-slot=progress-indicator]]:bg-red-500';
  if (status === 'yellow') return '[&>[data-slot=progress-indicator]]:bg-amber-500';
  return '';
}

export default function ProjectDetailModal() {
  const showProjDetail = useDashboardStore((s) => s.showProjDetail);
  const closeModal = useDashboardStore((s) => s.closeModal);
  const openProjEdit = useDashboardStore((s) => s.openProjEdit);
  const canEdit = useDashboardStore((s) => s.canEdit);
  const currentWeek = useDashboardStore((s) => s.currentWeek);

  const project = useMemo(() => {
    const week = currentWeek();
    if (!week || !showProjDetail) return null;
    return week.projects.find((p) => p.code === showProjDetail) || null;
  }, [currentWeek, showProjDetail]);

  const riskActionPairs: RiskActionPair[] = useMemo(() => {
    if (!project) return [];
    return getRiskActionPairs(project);
  }, [project]);

  const handleEdit = () => {
    if (showProjDetail) {
      openProjEdit(showProjDetail);
      closeModal();
    }
  };

  if (!project) {
    return (
      <Dialog open={!!showProjDetail} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Project Not Found</DialogTitle>
            <DialogDescription>The selected project could not be found.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const hasEditPermission = canEdit(project);

  return (
    <Dialog open={!!showProjDetail} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-lg leading-tight">
                {project.name}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {project.code}
                </span>
              </DialogTitle>
              <div className="flex items-center gap-2 mt-1.5">
                {statusBadge(project.status)}
                <span className="text-xs text-muted-foreground">
                  {project.progress}% complete
                </span>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Progress bar */}
        <Progress
          value={project.progress}
          className={`h-2 ${progressColor(project.progress, project.status)}`}
        />

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-6 pb-2">
            {/* Owner / Deputy / Customer / Location grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <InfoCard icon={<User className="size-3.5" />} label="Owner" value={project.owner} />
              <InfoCard icon={<UserCircle className="size-3.5" />} label="Deputy" value={project.deputy} />
              <InfoCard icon={<Target className="size-3.5" />} label="Customer" value={project.customer} />
              <InfoCard icon={<MapPin className="size-3.5" />} label="Location" value={project.location} />
            </div>

            <Separator />

            {/* Highlight */}
            {project.highlight && (
              <section>
                <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Lightbulb className="size-4" />
                  Highlight
                </h3>
                <p className="text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-3">
                  {project.highlight}
                </p>
              </section>
            )}

            {/* Weekly Key Actions */}
            {project.weeklyActions && (
              <section>
                <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                  <ListTodo className="size-4" />
                  Weekly Key Actions
                </h3>
                <p className="text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-3">
                  {project.weeklyActions}
                </p>
              </section>
            )}

            <Separator />

            {/* Risk / Action pairs */}
            {riskActionPairs.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="size-4" />
                  Risks &amp; Actions
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>Risk</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="w-24">Primary</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {riskActionPairs.map((ra, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                        <TableCell className="text-sm whitespace-pre-wrap">{ra.risk}</TableCell>
                        <TableCell className="text-sm whitespace-pre-wrap">{ra.action}</TableCell>
                        <TableCell>
                          {ra.primary && (
                            <Badge variant="secondary" className="text-[10px]">Primary</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            )}

            <Separator />

            {/* Milestones Timeline */}
            {project.milestones && project.milestones.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                  <CircleDot className="size-4" />
                  Milestones
                </h3>
                <div className="relative space-y-0">
                  {project.milestones.map((ms: MilestonePlan, i: number) => (
                    <div key={ms.planId || i} className="flex gap-3 pb-4 last:pb-0">
                      {/* Vertical line + dot */}
                      <div className="flex flex-col items-center">
                        {milestoneStatusDot(ms.status)}
                        {i < project.milestones.length - 1 && (
                          <div className="w-px flex-1 bg-border mt-1" />
                        )}
                      </div>
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{ms.name || 'Untitled'}</span>
                          {ms.date && (
                            <span className="text-xs text-muted-foreground">{ms.date}</span>
                          )}
                        </div>
                        {ms.plan && (
                          <p className="text-xs text-muted-foreground mt-0.5">{ms.plan}</p>
                        )}
                        <Badge
                          variant="outline"
                          className="text-[10px] mt-1"
                        >
                          {ms.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Quarterly Milestones */}
            {project.quarterlyMilestones && project.quarterlyMilestones.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Target className="size-4" />
                  Quarterly Milestones
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quarter</TableHead>
                      <TableHead>Goal</TableHead>
                      <TableHead>Window</TableHead>
                      <TableHead className="w-24">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {project.quarterlyMilestones.map((qm: QuarterlyMilestone, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm font-medium">{qm.quarter}</TableCell>
                        <TableCell className="text-sm whitespace-pre-wrap">{qm.goal}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{qm.window}</TableCell>
                        <TableCell>{statusBadge(qm.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          {hasEditPermission && (
            <Button onClick={handleEdit}>
              <Pencil className="size-4 mr-1.5" />
              Edit
            </Button>
          )}
          <Button variant="outline" onClick={closeModal}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Small info card ──
function InfoCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-muted/50 rounded-md p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className="text-sm font-medium truncate" title={value}>
        {value || '—'}
      </p>
    </div>
  );
}
