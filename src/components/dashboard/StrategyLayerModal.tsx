'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDashboardStore } from '@/stores/dashboard';
import { saveWeek } from '@/services/firebase';
import { Target, Plus, Trash2, Save, Loader2 } from 'lucide-react';
import type { StrategyLayer, StrategicTrack } from '@/types/dashboard';

export default function StrategyLayerModal() {
  const showStrategyLayer = useDashboardStore((s) => s.showStrategyLayer);
  const closeModal = useDashboardStore((s) => s.closeModal);
  const currentWeek = useDashboardStore((s) => s.currentWeek);
  const allWeeks = useDashboardStore((s) => s.allWeeks);
  const currentWeekIdx = useDashboardStore((s) => s.currentWeekIdx);
  const currentUser = useDashboardStore((s) => s.currentUser);
  const showToast = useDashboardStore((s) => s.showToast);
  const showLoader = useDashboardStore((s) => s.showLoader);
  const hideLoader = useDashboardStore((s) => s.hideLoader);

  const [saving, setSaving] = useState(false);
  const [activeTrack, setActiveTrack] = useState('all');
  const [tracks, setTracks] = useState<StrategicTrack[]>([{ id: 'all', label: 'All Projects', description: 'All projects' }]);
  const [quarterGoals, setQuarterGoals] = useState<Record<string, string[]>>({});
  const [projectMap, setProjectMap] = useState<Record<string, { businessObjective: string; checkpoint: string }>>({});

  const week = currentWeek();

  // Initialize from week data
  useMemo(() => {
    if (week?.strategyLayer) {
      const sl = week.strategyLayer;
      if (sl.tracks?.length > 0) setTracks(sl.tracks);
      if (sl.activeTrack) setActiveTrack(sl.activeTrack);
      if (sl.quarterGoals) setQuarterGoals(sl.quarterGoals);
      if (sl.projectMap) setProjectMap(sl.projectMap);
    }
  }, [week?.strategyLayer]);

  const projects = week?.projects || [];

  const handleSave = useCallback(async () => {
    if (!week || !currentUser) return;
    setSaving(true);
    try {
      const strategyLayer: StrategyLayer = {
        activeTrack,
        tracks,
        quarterGoals,
        executiveMilestoneTimeline: week.strategyLayer?.executiveMilestoneTimeline || { title: '', quarters: [], rows: [], phases: [] },
        projectMap,
      };
      week.strategyLayer = strategyLayer;
      week.lastModifiedBy = currentUser.email || '';
      await saveWeek(week);
      useDashboardStore.setState({ allWeeks: [...allWeeks], showStrategyLayer: false });
      showToast('Strategy layer saved');
    } catch {
      showToast('Failed to save strategy layer');
    } finally {
      setSaving(false);
    }
  }, [week, currentUser, activeTrack, tracks, quarterGoals, projectMap, allWeeks, showToast]);

  const handleAddTrack = useCallback(() => {
    const id = `track-${Date.now()}`;
    setTracks([...tracks, { id, label: 'New Track', description: '' }]);
  }, [tracks]);

  const handleRemoveTrack = useCallback((id: string) => {
    if (id === 'all') return;
    setTracks(tracks.filter((t) => t.id !== id));
  }, [tracks]);

  const handleUpdateTrack = useCallback((id: string, field: 'label' | 'description', value: string) => {
    setTracks(tracks.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
  }, [tracks]);

  const handleUpdateProjectMap = useCallback((code: string, field: 'businessObjective' | 'checkpoint', value: string) => {
    setProjectMap((prev) => ({
      ...prev,
      [code]: { ...(prev[code] || {}), [field]: value },
    }));
  }, []);

  return (
    <Dialog open={showStrategyLayer} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="size-5" />
            Strategy Layer
          </DialogTitle>
          <DialogDescription>
            Define strategic tracks, quarterly goals, and project-level business objectives.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <Tabs defaultValue="tracks" className="w-full">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="tracks">Strategic Tracks</TabsTrigger>
              <TabsTrigger value="projects">Project Mapping</TabsTrigger>
              <TabsTrigger value="goals">Quarter Goals</TabsTrigger>
            </TabsList>

            <TabsContent value="tracks" className="space-y-4 mt-4">
              {/* Active track selector */}
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-muted-foreground">Active Track:</label>
                <Select value={activeTrack} onValueChange={setActiveTrack}>
                  <SelectTrigger className="w-[200px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {tracks.map((t) => (
                      <SelectItem key={t.id} value={t.id} className="text-xs">
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Track list */}
              <div className="space-y-3">
                {tracks.map((track) => (
                  <div key={track.id} className="flex items-start gap-2 rounded-lg border p-3">
                    <div className="flex-1 space-y-2">
                      <Input
                        value={track.label}
                        onChange={(e) => handleUpdateTrack(track.id, 'label', e.target.value)}
                        className="h-8 text-sm"
                        placeholder="Track name"
                      />
                      <Input
                        value={track.description}
                        onChange={(e) => handleUpdateTrack(track.id, 'description', e.target.value)}
                        className="h-8 text-xs"
                        placeholder="Description"
                      />
                    </div>
                    {track.id !== 'all' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleRemoveTrack(track.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              <Button variant="outline" size="sm" onClick={handleAddTrack} className="gap-1.5">
                <Plus className="h-4 w-4" />
                Add Track
              </Button>
            </TabsContent>

            <TabsContent value="projects" className="space-y-3 mt-4">
              <p className="text-xs text-muted-foreground">
                Map each project to its business objective and checkpoint.
              </p>
              {projects.map((p) => (
                <div key={p.code} className="rounded-lg border p-3 space-y-2">
                  <p className="text-sm font-medium">{p.name} <span className="text-muted-foreground font-mono text-xs">({p.code})</span></p>
                  <Input
                    value={projectMap[p.code]?.businessObjective || ''}
                    onChange={(e) => handleUpdateProjectMap(p.code, 'businessObjective', e.target.value)}
                    className="h-8 text-xs"
                    placeholder="Business Objective"
                  />
                  <Input
                    value={projectMap[p.code]?.checkpoint || ''}
                    onChange={(e) => handleUpdateProjectMap(p.code, 'checkpoint', e.target.value)}
                    className="h-8 text-xs"
                    placeholder="Checkpoint"
                  />
                </div>
              ))}
            </TabsContent>

            <TabsContent value="goals" className="space-y-3 mt-4">
              <p className="text-xs text-muted-foreground">
                Define goals for each quarter (one goal per line).
              </p>
              {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => (
                <div key={q} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">{q}</Badge>
                  </div>
                  <Textarea
                    value={(quarterGoals[q] || []).join('\n')}
                    onChange={(e) => {
                      const lines = e.target.value.split('\n');
                      setQuarterGoals((prev) => ({ ...prev, [q]: lines }));
                    }}
                    rows={3}
                    className="text-xs resize-none"
                    placeholder={`Enter ${q} goals (one per line)...`}
                  />
                </div>
              ))}
            </TabsContent>
          </Tabs>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={closeModal}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Save className="size-4 mr-1.5" />}
            Save Strategy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
