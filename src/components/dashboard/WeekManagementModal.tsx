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
import { useDashboardStore, getRiskActionPairs } from '@/stores/dashboard';
import { Check, Copy, Sparkles, CalendarPlus, ChevronRight } from 'lucide-react';

export default function WeekManagementModal() {
  const showWeekManagement = useDashboardStore((s) => s.showWeekManagement);
  const closeModal = useDashboardStore((s) => s.closeModal);
  const allWeeks = useDashboardStore((s) => s.allWeeks);
  const currentWeekIdx = useDashboardStore((s) => s.currentWeekIdx);
  const currentWeek = useDashboardStore((s) => s.currentWeek);
  const saveWeekSummary = useDashboardStore((s) => s.saveWeekSummary);
  const createNewWeek = useDashboardStore((s) => s.createNewWeek);
  const jumpToWeek = useDashboardStore((s) => s.jumpToWeek);
  const showLoader = useDashboardStore((s) => s.showLoader);
  const hideLoader = useDashboardStore((s) => s.hideLoader);
  const showToast = useDashboardStore((s) => s.showToast);

  const [summaryText, setSummaryText] = useState('');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newWeekLabel, setNewWeekLabel] = useState('');
  const [newWeekDate, setNewWeekDate] = useState('');

  // Sync summary text when current week changes
  const week = currentWeek();
  useMemo(() => {
    if (week) {
      setSummaryText(week.summary || '');
    }
  }, [week?.summary]);

  // Compute next week label
  useMemo(() => {
    if (allWeeks.length > 0) {
      const lastWeek = allWeeks[allWeeks.length - 1];
      const match = lastWeek.weekLabel.match(/W(\d+)\s*(\d{4})/);
      if (match) {
        const nextNum = parseInt(match[1], 10) + 1;
        const year = match[2];
        setNewWeekLabel(`W${nextNum} ${year}`);
      }
    }
  }, [allWeeks]);

  // Build AI copilot prompt
  const generateCopilotPrompt = useCallback(() => {
    const cw = currentWeek();
    if (!cw) return '';

    const projects = cw.projects || [];
    const prevWeekIdx = currentWeekIdx - 1;
    const prevWeek = prevWeekIdx >= 0 ? allWeeks[prevWeekIdx] : null;

    const projectSummaries = projects
      .filter((p) => p.visibility === 'active' || !p.visibility)
      .map((p) => {
        const lines: string[] = [];
        lines.push(`### ${p.name} (${p.code}) — Status: ${p.status}`);
        if (p.highlight) lines.push(`**Highlight:** ${p.highlight}`);
        const riskPairs = getRiskActionPairs(p);
        if (riskPairs.length > 0) {
          lines.push('**Risks & Actions:**');
          riskPairs.forEach((ra, i) => {
            lines.push(`  ${i + 1}. Risk: ${ra.risk}${ra.primary ? ' (Primary)' : ''}`);
            if (ra.action) lines.push(`     Action: ${ra.action}`);
          });
        }
        if (p.weeklyActions) lines.push(`**Weekly Key Actions:** ${p.weeklyActions}`);
        return lines.join('\n');
      })
      .join('\n\n');

    const prevSummary = prevWeek?.summary
      ? `\n---\n### Previous Week Summary (${prevWeek.weekLabel}):\n${prevWeek.summary}`
      : '';

    const prompt = `## PM Dashboard Weekly Summary Prompt — ${cw.weekLabel}\n\n` +
      `${projectSummaries}` +
      `${prevSummary}\n\n` +
      `---\n` +
      `Based on the above project data and previous week context, generate a concise executive-level weekly summary covering:\n` +
      `1. Overall portfolio health\n` +
      `2. Key highlights and achievements\n` +
      `3. Risks and mitigations\n` +
      `4. Upcoming focus areas`;

    return prompt;
  }, [currentWeek, currentWeekIdx, allWeeks]);

  const handleCopyPrompt = useCallback(async () => {
    const prompt = generateCopilotPrompt();
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showToast('Prompt copied to clipboard');
    } catch {
      showToast('Failed to copy');
    }
  }, [generateCopilotPrompt, showToast]);

  const handleSaveSummary = useCallback(async () => {
    setSaving(true);
    try {
      await saveWeekSummary(summaryText);
    } finally {
      setSaving(false);
    }
  }, [summaryText, saveWeekSummary]);

  const handleCreateWeek = useCallback(async () => {
    if (!newWeekLabel.trim()) {
      showToast('Week label is required');
      return;
    }
    if (!newWeekDate.trim()) {
      showToast('Date range is required');
      return;
    }
    setCreating(true);
    try {
      await createNewWeek(newWeekLabel.trim(), newWeekDate.trim());
      setNewWeekLabel('');
      setNewWeekDate('');
    } finally {
      setCreating(false);
    }
  }, [newWeekLabel, newWeekDate, createNewWeek, showToast]);

  const handleWeekClick = useCallback(
    (idx: number) => {
      jumpToWeek(idx);
      closeModal();
    },
    [jumpToWeek, closeModal]
  );

  return (
    <Dialog open={showWeekManagement} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="size-5" />
            Week Management
          </DialogTitle>
          <DialogDescription>
            Manage weekly summaries, create new weeks, and navigate between weeks.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-6 pb-2">
            {/* AI-Assisted Weekly Summary */}
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                <Sparkles className="size-4" />
                AI-Assisted Weekly Summary
              </h3>
              <Textarea
                placeholder="Write your weekly summary here..."
                value={summaryText}
                onChange={(e) => setSummaryText(e.target.value)}
                rows={6}
                className="resize-none"
              />
              <div className="flex flex-wrap gap-2 mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyPrompt}
                >
                  {copied ? <Check className="size-4 mr-1.5" /> : <Copy className="size-4 mr-1.5" />}
                  {copied ? 'Copied' : 'Generate Copilot Prompt'}
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveSummary}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save Summary'}
                </Button>
              </div>
            </section>

            <Separator />

            {/* Create Next Week */}
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                <CalendarPlus className="size-4" />
                Create Next Week
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Week Label
                  </label>
                  <Input
                    placeholder="e.g. W29 2026"
                    value={newWeekLabel}
                    onChange={(e) => setNewWeekLabel(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Date Range
                  </label>
                  <Input
                    placeholder="e.g. Jul 14 - Jul 18"
                    value={newWeekDate}
                    onChange={(e) => setNewWeekDate(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Active projects will be copied from the current week.
              </p>
              <Button
                size="sm"
                onClick={handleCreateWeek}
                disabled={creating || !newWeekLabel.trim() || !newWeekDate.trim()}
                className="mt-3"
              >
                {creating ? 'Creating...' : 'Create'}
              </Button>
            </section>

            <Separator />

            {/* Week List */}
            <section>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">
                All Weeks
              </h3>
              <div className="space-y-1.5">
                {allWeeks.length === 0 && (
                  <p className="text-sm text-muted-foreground py-2">No weeks found.</p>
                )}
                {[...allWeeks].reverse().map((w, reverseIdx) => {
                  const realIdx = allWeeks.length - 1 - reverseIdx;
                  const isCurrent = realIdx === currentWeekIdx;
                  return (
                    <button
                      key={w.weekLabel}
                      onClick={() => handleWeekClick(realIdx)}
                      className={`
                        w-full flex items-center justify-between rounded-md px-3 py-2 text-sm
                        transition-colors hover:bg-accent
                        ${isCurrent ? 'bg-accent font-medium' : ''}
                      `}
                    >
                      <div className="flex items-center gap-2">
                        <ChevronRight className="size-4 text-muted-foreground" />
                        <span>{w.weekLabel}</span>
                        {isCurrent && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            Current
                          </Badge>
                        )}
                      </div>
                      <Badge
                        variant={w.isReleased ? 'default' : 'outline'}
                        className={w.isReleased ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                      >
                        {w.isReleased ? 'Released' : 'Draft'}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={closeModal}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
