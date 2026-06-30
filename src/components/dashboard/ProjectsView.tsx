'use client';

import React, { useMemo, useState } from 'react';
import {
  LayoutGrid,
  Columns3,
  TableIcon,
  Plus,
  Inbox,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  GripVertical,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { useDashboardStore } from '@/stores/dashboard';
import type { Project } from '@/types/dashboard';
import { STATUS_LABELS } from '@/types/dashboard';

// ── Constants ──
const STATUS_BG: Record<string, string> = {
  green: 'bg-[#88C9AC]/20 text-[#2D7A54]',
  yellow: 'bg-[#E4CC8F]/20 text-[#92700C]',
  red: 'bg-[#E39A9A]/20 text-[#B91C1C]',
  'to-do': 'bg-[#C4C4C4]/20 text-[#6B7280]',
  'in-progress': 'bg-[#A8C8E8]/20 text-[#2563EB]',
  done: 'bg-[#88C9AC]/20 text-[#2D7A54]',
  'at-risk': 'bg-[#E4CC8F]/20 text-[#92700C]',
};

const KANBAN_COLUMNS: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: 'green', label: 'On Track', statuses: ['green', 'done'] },
  { key: 'yellow', label: 'At Risk', statuses: ['yellow', 'at-risk'] },
  { key: 'red', label: 'Critical', statuses: ['red'] },
];

type ViewMode = 'grid' | 'kanban' | 'table';
type SortField = 'name' | 'owner' | 'status' | 'progress' | 'attention' | 'next';
type SortDir = 'asc' | 'desc';

// ── Sortable Grid Item ──
function SortableGridItem({ project, onClick }: { project: Project; onClick: () => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.code, data: { type: 'project', project } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  const statusColor =
    project.status === 'red'
      ? 'border-l-[#E39A9A]'
      : project.status === 'yellow'
        ? 'border-l-[#E4CC8F]'
        : 'border-l-[#88C9AC]';

  return (
    <div ref={setNodeRef} style={style}>
      <Card
        className={`cursor-pointer border-l-4 ${statusColor} bg-white transition-shadow hover:shadow-md`}
        onClick={onClick}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="truncate text-sm font-semibold">{project.name}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{project.owner || 'Unassigned'}</p>
            </div>
            <button
              className="mt-1 cursor-grab touch-none text-muted-foreground hover:text-foreground"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          </div>
          {/* Progress bar */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span>{project.progress}%</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${project.progress}%`,
                  backgroundColor:
                    project.status === 'red'
                      ? '#E39A9A'
                      : project.status === 'yellow'
                        ? '#E4CC8F'
                        : '#88C9AC',
                }}
              />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <Badge
              variant="secondary"
              className={`text-[10px] ${STATUS_BG[project.status] || ''}`}
            >
              {STATUS_LABELS[project.status] || project.status}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Kanban Card ──
function KanbanCard({ project }: { project: Project }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.code, data: { type: 'project', project } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  const statusColor =
    project.status === 'red'
      ? 'border-l-[#E39A9A]'
      : project.status === 'yellow'
        ? 'border-l-[#E4CC8F]'
        : 'border-l-[#88C9AC]';

  return (
    <div ref={setNodeRef} style={style}>
      <Card
        className={`border-l-4 ${statusColor} bg-white transition-shadow hover:shadow-md`}
      >
        <CardContent className="p-3">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <h4 className="truncate text-sm font-medium">{project.name}</h4>
              <p className="mt-0.5 text-xs text-muted-foreground">{project.owner || 'Unassigned'}</p>
            </div>
            <button
              className="mt-0.5 cursor-grab touch-none text-muted-foreground hover:text-foreground"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          </div>
          {/* Progress bar */}
          <div className="mt-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${project.progress}%`,
                  backgroundColor:
                    project.status === 'red'
                      ? '#E39A9A'
                      : project.status === 'yellow'
                        ? '#E4CC8F'
                        : '#88C9AC',
                }}
              />
            </div>
            <p className="mt-0.5 text-right text-[10px] text-muted-foreground">
              {project.progress}%
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Kanban Column ──
function KanbanColumn({
  title,
  projectIds,
  allProjectsMap,
}: {
  title: string;
  projectIds: string[];
  allProjectsMap: Map<string, Project>;
}) {
  const items = projectIds
    .map((id) => allProjectsMap.get(id))
    .filter(Boolean) as Project[];

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
          {items.length}
        </span>
      </div>
      <div className="space-y-3 rounded-lg border border-dashed border-muted-foreground/25 bg-muted/30 p-3 min-h-[120px]">
        <SortableContext items={projectIds} strategy={verticalListSortingStrategy}>
          {items.map((project) => (
            <KanbanCard key={project.code} project={project} />
          ))}
        </SortableContext>
        {items.length === 0 && (
          <div className="flex h-16 items-center justify-center text-xs text-muted-foreground">
            No projects
          </div>
        )}
      </div>
    </div>
  );
}

// ── Drag Overlay Card ──
function DragOverlayCard({ project }: { project: Project }) {
  return (
    <Card className="border-l-4 border-l-primary bg-white shadow-lg">
      <CardContent className="p-3">
        <h4 className="text-sm font-medium">{project.name}</h4>
        <p className="text-xs text-muted-foreground">{project.owner || 'Unassigned'}</p>
      </CardContent>
    </Card>
  );
}

// ── Mini Progress Bar (for table) ──
function MiniProgressBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(100, Math.max(0, value))}%`,
            backgroundColor:
              value >= 70
                ? '#88C9AC'
                : value >= 40
                  ? '#E4CC8F'
                  : '#E39A9A',
          }}
        />
      </div>
      <span className="text-xs text-muted-foreground w-8 text-right">{value}%</span>
    </div>
  );
}

// ── Table Sort Header ──
function SortableTableHead({
  label,
  field,
  sortField,
  sortDir,
  onSort,
}: {
  label: string;
  field: SortField;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
}) {
  const isActive = sortField === field;
  return (
    <TableHead
      className="cursor-pointer select-none hover:bg-muted/50"
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        {isActive ? (
          sortDir === 'asc' ? (
            <ArrowUp className="h-3 w-3 text-foreground" />
          ) : (
            <ArrowDown className="h-3 w-3 text-foreground" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />
        )}
      </div>
    </TableHead>
  );
}

// ── Empty State ──
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Inbox className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">No projects found</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        There are no projects to display. Create a new project to get started.
      </p>
    </div>
  );
}

// ── Main Component ──
export default function ProjectsView() {
  const allWeeks = useDashboardStore((s) => s.allWeeks);
  const currentProjects = useDashboardStore((s) => s.currentProjects);
  const currentRole = useDashboardStore((s) => s.currentRole);
  const reorderProjects = useDashboardStore((s) => s.reorderProjects);
  const openProjEdit = useDashboardStore((s) => s.openProjEdit);
  const openProjDetail = useDashboardStore((s) => s.openProjDetail);

  const projects = currentProjects();

  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [activeId, setActiveId] = useState<string | null>(null);

  // ── Can create projects (admin/pm only) ──
  const canCreate = currentRole === 'admin' || currentRole === 'pm';

  // ── Sensors ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  // ── All project codes for sortable context ──
  const projectCodes = useMemo(() => projects.map((p) => p.code), [projects]);

  // ── Kanban groupings ──
  const kanbanGroups = useMemo(() => {
    const projectMap = new Map(projects.map((p) => [p.code, p]));
    return KANBAN_COLUMNS.map((col) => ({
      key: col.key,
      label: col.label,
      ids: projects
        .filter((p) => col.statuses.includes(p.status))
        .map((p) => p.code),
      projectMap,
    }));
  }, [projects]);

  // ── Sorted projects for table view ──
  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;
      switch (sortField) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'owner':
          aVal = a.owner.toLowerCase();
          bVal = b.owner.toLowerCase();
          break;
        case 'status':
          aVal = a.status;
          bVal = b.status;
          break;
        case 'progress':
          aVal = a.progress;
          bVal = b.progress;
          break;
        case 'attention':
          aVal = a.attention;
          bVal = b.attention;
          break;
        case 'next':
          aVal = (a.next || '').toLowerCase();
          bVal = (b.next || '').toLowerCase();
          break;
        default:
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [projects, sortField, sortDir]);

  // ── Active project for drag overlay ──
  const activeProject = useMemo(() => {
    if (!activeId) return null;
    return projects.find((p) => p.code === activeId) || null;
  }, [activeId, projects]);

  // ── Sort handler ──
  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  // ── Grid drag end: reorder ──
  function handleGridDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = projectCodes.indexOf(active.id as string);
    const newIndex = projectCodes.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrder = arrayMove(projectCodes, oldIndex, newIndex);
    reorderProjects(newOrder);
  }

  // ── Kanban drag end: move between columns (status change) ──
  async function handleKanbanDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const activeCode = active.id as string;
    const overId = over.id as string;

    // Find which column the item was dropped into
    // We use the column container id (format: "col-{status}")
    if (overId.startsWith('col-')) {
      const targetStatus = overId.replace('col-', '');
      if (targetStatus !== 'green' && targetStatus !== 'yellow' && targetStatus !== 'red') return;

      const { allWeeks, currentWeekIdx, currentUser } = useDashboardStore.getState();
      const week = allWeeks[currentWeekIdx];
      if (!week) return;

      const project = week.projects.find((p) => p.code === activeCode);
      if (!project || project.status === targetStatus) return;

      // Update status directly
      project.status = targetStatus;
      useDashboardStore.setState({ allWeeks: [...allWeeks] });
      // Persist
      week.lastModifiedBy = currentUser?.email || '';
      try {
        const fb = await import('@/services/firebase');
        await fb.saveWeek(week);
        useDashboardStore.getState().showToast('Project status updated');
      } catch {
        useDashboardStore.getState().showToast('Failed to update status');
      }
      return;
    }

    // If dropped on another project card within same column, reorder within column
    const oldIndex = projectCodes.indexOf(activeCode);
    const newIndex = projectCodes.indexOf(overId);
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrder = arrayMove(projectCodes, oldIndex, newIndex);
    reorderProjects(newOrder);
  }

  // ── Common drag handlers ──
  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  // ── Render ──
  if (projects.length === 0) {
    return (
      <div className="space-y-4">
        {/* Header bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {canCreate && (
              <Button size="sm" onClick={() => openProjEdit(null, true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                New Project
              </Button>
            )}
          </div>
        </div>
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header Bar ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {canCreate && (
            <Button size="sm" onClick={() => openProjEdit(null, true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              New Project
            </Button>
          )}
        </div>
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(val) => {
            if (val) setViewMode(val as ViewMode);
          }}
          variant="outline"
          size="sm"
          className="ml-auto"
        >
          <ToggleGroupItem value="grid" aria-label="Grid view">
            <LayoutGrid className="h-4 w-4" />
            <span className="ml-1.5 hidden sm:inline">Grid</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="kanban" aria-label="Kanban view">
            <Columns3 className="h-4 w-4" />
            <span className="ml-1.5 hidden sm:inline">Kanban</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="table" aria-label="Table view">
            <TableIcon className="h-4 w-4" />
            <span className="ml-1.5 hidden sm:inline">Table</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* ── Grid Mode ── */}
      {viewMode === 'grid' && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleGridDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={projectCodes} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <SortableGridItem
                  key={project.code}
                  project={project}
                  onClick={() => openProjDetail(project.code)}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeProject ? <DragOverlayCard project={activeProject} /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* ── Kanban Mode ── */}
      {viewMode === 'kanban' && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleKanbanDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {kanbanGroups.map((group) => (
              <div key={group.key} id={`col-${group.key}`} className="rounded-xl">
                <KanbanColumn
                  title={group.label}
                  projectIds={group.ids}
                  allProjectsMap={group.projectMap}
                />
              </div>
            ))}
          </div>
          <DragOverlay>
            {activeProject ? <DragOverlayCard project={activeProject} /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* ── Table Mode ── */}
      {viewMode === 'table' && (
        <Card className="bg-white">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead
                    label="Name"
                    field="name"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableTableHead
                    label="Owner"
                    field="owner"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableTableHead
                    label="Status"
                    field="status"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableTableHead
                    label="Progress"
                    field="progress"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableTableHead
                    label="Attention"
                    field="attention"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableTableHead
                    label="Risk"
                    field="next"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <TableHead>Next Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedProjects.map((project) => (
                  <TableRow
                    key={project.code}
                    className="cursor-pointer"
                    onClick={() => openProjDetail(project.code)}
                  >
                    <TableCell className="font-medium max-w-[200px]">
                      <span className="truncate block">{project.name}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {project.owner || 'Unassigned'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] ${STATUS_BG[project.status] || ''}`}
                      >
                        {STATUS_LABELS[project.status] || project.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <MiniProgressBar value={project.progress} />
                    </TableCell>
                    <TableCell>
                      <span className="text-xs capitalize text-muted-foreground">
                        {project.attention}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <span className="truncate block text-xs text-muted-foreground">
                        {project.risk
                          ? project.risk.split('\n')[0]
                          : '—'}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <span className="truncate block text-xs text-muted-foreground">
                        {project.next
                          ? project.next.split('\n')[0]
                          : '—'}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
