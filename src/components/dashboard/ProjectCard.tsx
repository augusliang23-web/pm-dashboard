'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  Pencil,
  AlertTriangle,
  ArrowRight,
  Flag,
  Eye,
  Milestone,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { Project } from '@/types/dashboard';
import { STATUS_LABELS, ATTENTION_MAP } from '@/types/dashboard';
import { useDashboardStore } from '@/stores/dashboard';

// ── Status color map ──
const STATUS_BORDER_COLOR: Record<string, string> = {
  green: 'border-l-green-500',
  yellow: 'border-l-amber-500',
  red: 'border-l-red-500',
  'to-do': 'border-l-gray-400',
  'in-progress': 'border-l-blue-400',
  done: 'border-l-green-500',
  'at-risk': 'border-l-amber-500',
};

const STATUS_DOT_COLOR: Record<string, string> = {
  green: 'bg-green-500',
  yellow: 'bg-amber-500',
  red: 'bg-red-500',
  'to-do': 'bg-gray-400',
  'in-progress': 'bg-blue-400',
  done: 'bg-green-500',
  'at-risk': 'bg-amber-500',
};

const RAG_EMOJI: Record<string, string> = {
  green: '🟢',
  yellow: '🟡',
  red: '🔴',
};

const ATTENTION_ICON_MAP: Record<string, React.ReactNode> = {
  action: <AlertTriangle className="h-3.5 w-3.5 text-red-600" />,
  monitor: <Eye className="h-3.5 w-3.5 text-amber-600" />,
  strategy: <Flag className="h-3.5 w-3.5 text-purple-600" />,
  watch: <Eye className="h-3.5 w-3.5 text-gray-500" />,
};

const ATTENTION_BADGE_VARIANT: Record<string, 'destructive' | 'outline' | 'secondary' | 'default'> = {
  action: 'destructive',
  monitor: 'outline',
  strategy: 'secondary',
  watch: 'outline',
};

interface ProjectCardProps {
  project: Project;
}

export default function ProjectCard({ project }: ProjectCardProps) {
  const openProjDetail = useDashboardStore((s) => s.openProjDetail);
  const openProjEdit = useDashboardStore((s) => s.openProjEdit);
  const canEdit = useDashboardStore((s) => s.canEdit);

  const statusLabel = STATUS_LABELS[project.status] || project.status;
  const attentionLabel = ATTENTION_MAP[project.attention] || project.attention;
  const borderColor = STATUS_BORDER_COLOR[project.status] || 'border-l-gray-400';
  const dotColor = STATUS_DOT_COLOR[project.status] || 'bg-gray-400';
  const ragEmoji = RAG_EMOJI[project.status] || '⚪';

  // Extract first risk & action from riskActions
  const riskActions = project.riskActions || [];
  const firstRisk = riskActions.length > 0 ? riskActions[0].risk : '';
  const firstAction = riskActions.length > 0 ? riskActions[0].action : '';
  // Fallback to legacy fields
  const riskText = firstRisk || project.risk || '';
  const actionText = firstAction || project.next || '';

  // Highlight text (first 2 lines, truncated)
  const highlightLines = (project.highlight || '')
    .split('\n')
    .filter(Boolean)
    .slice(0, 2)
    .join(' | ');

  // Milestone count
  const milestoneCount = project.milestones ? project.milestones.length : 0;

  // Progress bar color
  const progressColor =
    project.status === 'red'
      ? 'bg-red-500'
      : project.status === 'yellow'
      ? 'bg-amber-500'
      : 'bg-green-500';

  const hasEditPermission = canEdit(project);

  return (
    <TooltipProvider delayDuration={300}>
      <motion.div
        className={`
          group relative flex flex-col gap-3 rounded-xl border bg-card p-4
          shadow-sm transition-colors cursor-pointer
          border-l-4 ${borderColor}
          hover:shadow-md
        `}
        whileHover={{ y: -2, transition: { duration: 0.2 } }}
        onClick={() => openProjDetail(project.code)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openProjDetail(project.code);
          }
        }}
      >
        {/* ── Header Row: Name + Actions ── */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold leading-tight text-foreground">
              {project.name}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground font-mono">
              {project.code}
            </p>
          </div>

          {/* Edit button */}
          {hasEditPermission && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="flex-shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    openProjEdit(project.code);
                  }}
                  aria-label={`Edit ${project.name}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Edit Project</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* ── Status + RAG + Attention Row ── */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Status badge */}
          <Badge variant="outline" className="flex items-center gap-1.5 text-xs px-2 py-0.5">
            <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} />
            {statusLabel}
          </Badge>

          {/* RAG indicator */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-sm leading-none" role="img" aria-label={`RAG: ${statusLabel}`}>
                {ragEmoji}
              </span>
            </TooltipTrigger>
            <TooltipContent>RAG Status: {statusLabel}</TooltipContent>
          </Tooltip>

          {/* Attention badge */}
          <Badge variant={ATTENTION_BADGE_VARIANT[project.attention] || 'outline'} className="flex items-center gap-1 text-xs px-2 py-0.5">
            {ATTENTION_ICON_MAP[project.attention] || <Eye className="h-3.5 w-3.5" />}
            {attentionLabel}
          </Badge>
        </div>

        {/* ── Progress Bar ── */}
        <div className="flex items-center gap-2">
          <Progress value={project.progress || 0} className="h-1.5 flex-1" />
          <span className="text-xs font-medium text-muted-foreground tabular-nums w-8 text-right">
            {project.progress || 0}%
          </span>
        </div>

        {/* ── Main Content: Mobile Stack / Desktop Row ── */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
          {/* Left Column */}
          <div className="flex flex-col gap-2 min-w-0">
            {/* Owner + Deputy */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {project.owner || '—'}
              </span>
              {project.deputy && (
                <>
                  <Separator orientation="vertical" className="h-3 mx-1" />
                  <span>DP: {project.deputy}</span>
                </>
              )}
            </div>

            {/* Highlight */}
            {highlightLines && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {highlightLines}
                  </p>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="whitespace-pre-wrap text-xs">{project.highlight}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Right Column */}
          <div className="flex flex-col gap-2 min-w-0">
            {/* Risk/Blocker */}
            {riskText && (
              <div className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-500" />
                <p className="line-clamp-2 text-xs leading-relaxed text-red-600">
                  {riskText}
                </p>
              </div>
            )}

            {/* Next Action */}
            {actionText && (
              <div className="flex items-start gap-1.5">
                <ArrowRight className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {actionText}
                </p>
              </div>
            )}

            {/* Milestone count */}
            {milestoneCount > 0 && (
              <Badge variant="secondary" className="flex w-fit items-center gap-1 text-xs px-2 py-0.5">
                <Milestone className="h-3 w-3" />
                {milestoneCount} milestone{milestoneCount > 1 ? 's' : ''}
              </Badge>
            )}
          </div>
        </div>
      </motion.div>
    </TooltipProvider>
  );
}
