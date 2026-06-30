'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Plus,
  Trash2,
  GripVertical,
  Save,
  X,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  type Project,
  type RiskActionPair,
  type MilestonePlan,
  type QuarterlyMilestone,
  type Visibility,
  type AttentionLevel,
  STATUS_LABELS,
  ATTENTION_MAP,
  PROJECT_MEMBER_TBD,
} from '@/types/dashboard';
import { useDashboardStore } from '@/stores/dashboard';

// ── Sortable Milestone Item ──
function SortableMilestoneItem({
  milestone,
  index,
  onChange,
  onRemove,
}: {
  milestone: MilestonePlan;
  index: number;
  onChange: (idx: number, field: keyof MilestonePlan, value: string) => void;
  onRemove: (idx: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: milestone.planId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3"
    >
      {/* Drag handle */}
      <button
        type="button"
        className="mt-1 cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
        aria-label={`Drag milestone ${index + 1}`}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
        {/* Name */}
        <div className="col-span-1 sm:col-span-2">
          <Label className="text-xs text-muted-foreground">Name</Label>
          <Input
            value={milestone.name}
            onChange={(e) => onChange(index, 'name', e.target.value)}
            placeholder="Milestone name"
            className="h-8 text-sm"
          />
        </div>

        {/* Status */}
        <div>
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={milestone.status} onValueChange={(v) => onChange(index, 'status', v)}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="to-do">To Do</SelectItem>
              <SelectItem value="in-progress">In Progress</SelectItem>
              <SelectItem value="done">Done</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Date */}
        <div className="col-span-1 sm:col-span-2">
          <Label className="text-xs text-muted-foreground">Date</Label>
          <Input
            type="date"
            value={milestone.date}
            onChange={(e) => onChange(index, 'date', e.target.value)}
            className="h-8 text-sm"
          />
        </div>

        {/* Remove */}
        <div className="flex items-end justify-end">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(index)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Modal Component ──
export default function ProjectEditModal() {
  const {
    isEditing,
    editingProjCode,
    isCreatingNew,
    currentWeek,
    pmList,
    currentRole,
    closeModal,
    saveProjEdit,
    deleteProject,
  } = useDashboardStore();

  const isAdmin = currentRole === 'admin';

  // ── Form State ──
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [owner, setOwner] = useState('');
  const [deputy, setDeputy] = useState('');
  const [customer, setCustomer] = useState('');
  const [location, setLocation] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('active');
  const [status, setStatus] = useState<string>('green');
  const [progress, setProgress] = useState(0);
  const [attention, setAttention] = useState<AttentionLevel>('watch');
  const [highlight, setHighlight] = useState('');
  const [weeklyActions, setWeeklyActions] = useState('');
  const [riskActions, setRiskActions] = useState<RiskActionPair[]>([]);
  const [milestones, setMilestones] = useState<MilestonePlan[]>([]);
  const [quarterlyMilestones, setQuarterlyMilestones] = useState<QuarterlyMilestone[]>([]);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // ── PM options (list + TBD) ──
  const pmOptions = useMemo(() => {
    const opts = [...pmList];
    if (!opts.includes(PROJECT_MEMBER_TBD)) opts.push(PROJECT_MEMBER_TBD);
    return opts.sort();
  }, [pmList]);

  // ── DnD sensors for milestones ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // ── Populate form from existing project ──
  useEffect(() => {
    if (!isEditing) return;

    if (isCreatingNew) {
      setName('');
      setCode('');
      setOwner('');
      setDeputy('');
      setCustomer('');
      setLocation('');
      setVisibility('active');
      setStatus('green');
      setProgress(0);
      setAttention('watch');
      setHighlight('');
      setWeeklyActions('');
      setRiskActions([{ risk: '', action: '', primary: true }]);
      setMilestones([]);
      setQuarterlyMilestones([]);
    } else {
      const week = currentWeek();
      const proj = week?.projects.find((p) => p.code === editingProjCode);
      if (proj) {
        setName(proj.name || '');
        setCode(proj.code || '');
        setOwner(proj.owner || '');
        setDeputy(proj.deputy || '');
        setCustomer(proj.customer || '');
        setLocation(proj.location || '');
        setVisibility(proj.visibility || 'active');
        setStatus(proj.status || 'green');
        setProgress(proj.progress || 0);
        setAttention(proj.attention || 'watch');
        setHighlight(proj.highlight || '');
        setWeeklyActions(proj.weeklyActions || '');
        setRiskActions(
          proj.riskActions && proj.riskActions.length > 0
            ? proj.riskActions.map((ra) => ({ ...ra }))
            : [{ risk: proj.risk || '', action: proj.next || '', primary: true }]
        );
        setMilestones(
          proj.milestones ? proj.milestones.map((m) => ({ ...m })) : []
        );
        setQuarterlyMilestones(
          proj.quarterlyMilestones
            ? proj.quarterlyMilestones.map((q) => ({ ...q }))
            : []
        );
      }
    }
    }, [isEditing, editingProjCode, isCreatingNew, currentWeek]);

  // ── Handlers ──
  const handleAddRiskAction = () => {
    setRiskActions((prev) => [
      ...prev,
      { risk: '', action: '', primary: prev.length === 0 },
    ]);
  };

  const handleRemoveRiskAction = (idx: number) => {
    setRiskActions((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      // Ensure first is always primary
      if (next.length > 0 && !next.some((ra) => ra.primary)) {
        next[0].primary = true;
      }
      return next;
    });
  };

  const handleRiskActionChange = (
    idx: number,
    field: 'risk' | 'action',
    value: string
  ) => {
    setRiskActions((prev) =>
      prev.map((ra, i) => (i === idx ? { ...ra, [field]: value } : ra))
    );
  };

  const handleRiskActionPrimary = (idx: number) => {
    setRiskActions((prev) =>
      prev.map((ra, i) => ({ ...ra, primary: i === idx }))
    );
  };

  const handleAddMilestone = () => {
    setMilestones((prev) => [
      ...prev,
      {
        planId: `ms-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: '',
        status: 'to-do',
        date: '',
        plan: '',
        history: [],
      },
    ]);
  };

  const handleMilestoneChange = (idx: number, field: keyof MilestonePlan, value: string) => {
    setMilestones((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, [field]: value } : m))
    );
  };

  const handleRemoveMilestone = (idx: number) => {
    setMilestones((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleMilestoneDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setMilestones((prev) => {
        const oldIdx = prev.findIndex((m) => m.planId === active.id);
        const newIdx = prev.findIndex((m) => m.planId === over.id);
        return arrayMove(prev, oldIdx, newIdx);
      });
    }
  };

  const handleAddQuarterlyMilestone = () => {
    setQuarterlyMilestones((prev) => [
      ...prev,
      { quarter: '', goal: '', window: '', status: '' },
    ]);
  };

  const handleRemoveQuarterlyMilestone = (idx: number) => {
    setQuarterlyMilestones((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleQuarterlyMilestoneChange = (
    idx: number,
    field: keyof QuarterlyMilestone,
    value: string
  ) => {
    setQuarterlyMilestones((prev) =>
      prev.map((q, i) => (i === idx ? { ...q, [field]: value } : q))
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveProjEdit(
        {
          name,
          code,
          owner,
          deputy,
          customer,
          location,
          visibility,
          status,
          progress: Math.max(0, Math.min(100, progress)),
          attention,
          highlight,
          weeklyActions,
          riskActions,
          milestones,
          quarterlyMilestones,
        },
        isCreatingNew
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    if (editingProjCode) {
      await deleteProject(editingProjCode);
    }
  };

  const handleVisibilityChange = (value: string) => {
    setVisibility(value as Visibility);
  };

  return (
    <>
      <Dialog open={isEditing} onOpenChange={(open) => { if (!open) closeModal(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle className="text-lg">
              {isCreatingNew ? 'New Project' : 'Edit Project'}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {isCreatingNew
                ? 'Fill in the details for the new project.'
                : `Editing project: ${code}`}
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="basic" className="flex flex-1 flex-col overflow-hidden">
            <TabsList className="mx-6 mt-4 grid w-auto grid-cols-4">
              <TabsTrigger value="basic">Basic Info</TabsTrigger>
              <TabsTrigger value="status">Status</TabsTrigger>
              <TabsTrigger value="content">Content</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {/* ════════════════ Tab 1: Basic Info ════════════════ */}
              <TabsContent value="basic" className="mt-4 space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* Name */}
                  <div className="sm:col-span-2">
                    <Label htmlFor="proj-name">Project Name</Label>
                    <Input
                      id="proj-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter project name"
                    />
                  </div>

                  {/* Code */}
                  <div>
                    <Label htmlFor="proj-code">Project Code</Label>
                    <Input
                      id="proj-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      disabled={!isCreatingNew}
                      placeholder="e.g. PRJ-001"
                      className={!isCreatingNew ? 'bg-muted' : ''}
                    />
                  </div>

                  {/* Customer */}
                  <div>
                    <Label htmlFor="proj-customer">Customer</Label>
                    <Input
                      id="proj-customer"
                      value={customer}
                      onChange={(e) => setCustomer(e.target.value)}
                      placeholder="Customer name"
                    />
                  </div>

                  {/* Owner */}
                  <div>
                    <Label>Owner</Label>
                    <Select value={owner} onValueChange={setOwner}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select owner" />
                      </SelectTrigger>
                      <SelectContent>
                        {pmOptions.map((pm) => (
                          <SelectItem key={pm} value={pm}>
                            {pm}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Deputy */}
                  <div>
                    <Label>Deputy</Label>
                    <Select value={deputy} onValueChange={setDeputy}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select deputy" />
                      </SelectTrigger>
                      <SelectContent>
                        {pmOptions.map((pm) => (
                          <SelectItem key={pm} value={pm}>
                            {pm}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Location */}
                  <div>
                    <Label htmlFor="proj-location">Location</Label>
                    <Input
                      id="proj-location"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="Project location"
                    />
                  </div>

                  {/* Visibility */}
                  <div>
                    <Label>Visibility</Label>
                    <Select value={visibility} onValueChange={handleVisibilityChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="hidden">Hidden</SelectItem>
                        <SelectItem value="archived">Archived</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </TabsContent>

              {/* ════════════════ Tab 2: Status ════════════════ */}
              <TabsContent value="status" className="mt-4 space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {/* RAG Status */}
                  <div>
                    <Label>RAG Status</Label>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="green">🟢 On Track</SelectItem>
                        <SelectItem value="yellow">🟡 At Risk</SelectItem>
                        <SelectItem value="red">🔴 Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Progress */}
                  <div>
                    <Label htmlFor="proj-progress">Progress (%)</Label>
                    <Input
                      id="proj-progress"
                      type="number"
                      min={0}
                      max={100}
                      value={progress}
                      onChange={(e) => setProgress(parseInt(e.target.value) || 0)}
                      className="tabular-nums"
                    />
                  </div>

                  {/* Attention */}
                  <div>
                    <Label>Attention Level</Label>
                    <Select
                      value={attention}
                      onValueChange={(v) => setAttention(v as AttentionLevel)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ATTENTION_MAP).map(([key, label]) => (
                          <SelectItem key={key} value={key}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </TabsContent>

              {/* ════════════════ Tab 3: Content ════════════════ */}
              <TabsContent value="content" className="mt-4 space-y-4">
                {/* Highlight */}
                <div>
                  <Label htmlFor="proj-highlight">Highlight</Label>
                  <Textarea
                    id="proj-highlight"
                    value={highlight}
                    onChange={(e) => setHighlight(e.target.value)}
                    placeholder="Key highlights for this week..."
                    rows={4}
                  />
                </div>

                {/* Weekly Actions */}
                <div>
                  <Label htmlFor="proj-weekly-actions">Weekly Key Actions</Label>
                  <Textarea
                    id="proj-weekly-actions"
                    value={weeklyActions}
                    onChange={(e) => setWeeklyActions(e.target.value)}
                    placeholder="Key actions planned this week..."
                    rows={4}
                  />
                </div>
              </TabsContent>

              {/* ════════════════ Tab 4: Details ════════════════ */}
              <TabsContent value="details" className="mt-4 space-y-6">
                {/* ── Risk/Action Pairs ── */}
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <Label className="text-sm font-semibold">Risk / Action Pairs</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddRiskAction}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add Pair
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {riskActions.map((ra, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border bg-muted/30 p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={ra.primary}
                              onCheckedChange={() => handleRiskActionPrimary(idx)}
                              aria-label="Mark as primary risk"
                            />
                            <span className="text-xs font-medium text-muted-foreground">
                              {ra.primary ? '⭐ Primary' : `Pair #${idx + 1}`}
                            </span>
                          </div>
                          {riskActions.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => handleRemoveRiskAction(idx)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <div>
                            <Label className="text-xs text-muted-foreground">Risk / Blocker</Label>
                            <Textarea
                              value={ra.risk}
                              onChange={(e) =>
                                handleRiskActionChange(idx, 'risk', e.target.value)
                              }
                              placeholder="Describe the risk or blocker..."
                              rows={2}
                              className="text-sm"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Next Action</Label>
                            <Textarea
                              value={ra.action}
                              onChange={(e) =>
                                handleRiskActionChange(idx, 'action', e.target.value)
                              }
                              placeholder="Planned next action..."
                              rows={2}
                              className="text-sm"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* ── Milestones (Draggable) ── */}
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <Label className="text-sm font-semibold">Milestones</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddMilestone}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add Milestone
                    </Button>
                  </div>

                  {milestones.length > 0 ? (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleMilestoneDragEnd}
                    >
                      <SortableContext
                        items={milestones.map((m) => m.planId)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="space-y-2">
                          {milestones.map((m, idx) => (
                            <SortableMilestoneItem
                              key={m.planId}
                              milestone={m}
                              index={idx}
                              onChange={handleMilestoneChange}
                              onRemove={handleRemoveMilestone}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      No milestones added yet.
                    </p>
                  )}
                </div>

                <Separator />

                {/* ── Quarterly Milestones ── */}
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <Label className="text-sm font-semibold">Quarterly Milestones</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddQuarterlyMilestone}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {quarterlyMilestones.map((q, idx) => (
                      <div
                        key={idx}
                        className="grid grid-cols-1 gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-4"
                      >
                        <div>
                          <Label className="text-xs text-muted-foreground">Quarter</Label>
                          <Input
                            value={q.quarter}
                            onChange={(e) =>
                              handleQuarterlyMilestoneChange(idx, 'quarter', e.target.value)
                            }
                            placeholder="e.g. Q3 2025"
                            className="h-8 text-sm"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <Label className="text-xs text-muted-foreground">Goal</Label>
                          <Input
                            value={q.goal}
                            onChange={(e) =>
                              handleQuarterlyMilestoneChange(idx, 'goal', e.target.value)
                            }
                            placeholder="Quarterly goal"
                            className="h-8 text-sm"
                          />
                        </div>
                        <div className="flex gap-1">
                          <div className="flex-1">
                            <Label className="text-xs text-muted-foreground">Window</Label>
                            <Input
                              value={q.window}
                              onChange={(e) =>
                                handleQuarterlyMilestoneChange(idx, 'window', e.target.value)
                              }
                              placeholder="e.g. Jul-Sep"
                              className="h-8 text-sm"
                            />
                          </div>
                          <div className="flex items-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => handleRemoveQuarterlyMilestone(idx)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                    {quarterlyMilestones.length === 0 && (
                      <p className="text-sm text-muted-foreground italic">
                        No quarterly milestones added yet.
                      </p>
                    )}
                  </div>
                </div>

                <Separator />

                {/* ── Admin Actions ── */}
                {isAdmin && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
                    <Label className="text-sm font-semibold text-destructive">
                      Admin Actions
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant={visibility === 'active' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setVisibility('active')}
                      >
                        Active
                      </Button>
                      <Button
                        type="button"
                        variant={visibility === 'hidden' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setVisibility('hidden')}
                      >
                        Hidden
                      </Button>
                      <Button
                        type="button"
                        variant={visibility === 'archived' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setVisibility('archived')}
                      >
                        Archived
                      </Button>
                    </div>
                    {!isCreatingNew && (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="mt-2"
                        onClick={() => setShowDeleteConfirm(true)}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        Delete Project
                      </Button>
                    )}
                  </div>
                )}
              </TabsContent>
            </div>

            {/* ── Footer ── */}
            <DialogFooter className="border-t px-6 py-4">
              <div className="flex w-full items-center justify-between">
                <div>
                  {isEditing && !isCreatingNew && (
                    <Badge variant="outline" className="text-xs">
                      {STATUS_LABELS[status] || status}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closeModal}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !name.trim() || !code.trim()}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </DialogFooter>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ── */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{name || code}</strong>? This action
              cannot be undone and will remove the project from the current week.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
