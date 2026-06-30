// ═══════════════════════════════════════════════════════════════════
//  Zustand Store — mirrors v2.0T global state + wraps Firebase operations
// ═══════════════════════════════════════════════════════════════════

import { create } from 'zustand';
import type { User } from 'firebase/auth';
import type {
  Week, Project, DashboardRole, ViewId,
  RiskActionPair, MilestonePlan, QuarterlyMilestone,
  AttentionLevel, Visibility, StrategyLayer, PresenceDoc,
} from '@/types/dashboard';
import { PROJECT_MEMBER_TBD, ATTENTION_MAP } from '@/types/dashboard';
import * as fb from '@/services/firebase';

// ── Helper: can edit project (same logic as v2.0T) ──
function canEditProject(proj: Project, role: DashboardRole, currentUser: User | null): boolean {
  if (role === 'admin') return true;
  if (role === 'vip') return false;
  if (!currentUser) return false;
  const userEmail = currentUser.email || '';
  const userPrefix = userEmail.split('@')[0]?.toLowerCase() || '';
  const aliasMap: Record<string, string> = {
    'augus.liang': 'augus',
    'josiah.winkler': 'josiah',
    'qianyun.zhu': 'bonnie',
    'huichong.kong': 'huichong',
  };
  const owner = (proj.owner || '').toLowerCase();
  const deputy = (proj.deputy || '').toLowerCase();
  const assignedOwner = owner === PROJECT_MEMBER_TBD.toLowerCase() ? '' : owner;
  const assignedDeputy = deputy === PROJECT_MEMBER_TBD.toLowerCase() ? '' : deputy;
  const userAlias = aliasMap[userPrefix] || userPrefix;
  return (
    assignedOwner.includes(userPrefix) ||
    assignedOwner.includes(userAlias) ||
    assignedDeputy.includes(userPrefix) ||
    assignedDeputy.includes(userAlias)
  );
}

// ── Helper: get attention ──
function getProjectAttention(proj: Project): AttentionLevel {
  if (proj.attentionManual) return proj.attention;
  if (proj.status === 'red') return 'action';
  if (proj.status === 'yellow' && proj.progress < 50) return 'action';
  if (proj.status === 'yellow') return 'monitor';
  return 'watch';
}

// ── Helper: get risk action pairs ──
function getRiskActionPairs(proj: Project): RiskActionPair[] {
  if (proj.riskActions && proj.riskActions.length > 0) return proj.riskActions;
  const risks = (proj.risk || '').split('\n').filter(Boolean);
  const nexts = (proj.next || '').split('\n').filter(Boolean);
  return risks.map((r, i) => ({ risk: r, action: nexts[i] || '', primary: i === 0 }));
}

// ── Helper: collect milestones with history ──
function collectMilestonesWithHistory(prev: Project | null, current: MilestonePlan[]): MilestonePlan[] {
  if (!prev) return current;
  const prevMap = new Map(prev.milestones.map((m) => [m.planId, m]));
  return current.map((m) => {
    const old = prevMap.get(m.planId);
    if (!old) return m;
    const history: Array<{ field: string; from: string; to: string; at: string }> = [
      ...(old.history || []),
    ];
    if (old.name !== m.name) history.push({ field: 'name', from: old.name, to: m.name, at: new Date().toISOString() });
    if (old.status !== m.status) history.push({ field: 'status', from: old.status, to: m.status, at: new Date().toISOString() });
    if (old.date !== m.date) history.push({ field: 'date', from: old.date, to: m.date, at: new Date().toISOString() });
    return { ...m, history: history.slice(-20) };
  });
}

// ── Helper: normalize milestone plan ──
function normalizeMilestonePlan(raw: Partial<MilestonePlan> & { name?: string; status?: string; date?: string; planId?: string; history?: unknown }, index?: number): MilestonePlan {
  return {
    planId: raw.planId || `ms-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: raw.name || '',
    status: raw.status || 'to-do',
    date: raw.date || '',
    plan: raw.plan || '',
    history: Array.isArray(raw.history) ? raw.history as MilestonePlan['history'] : [],
  };
}

// ── Helper: get quarterly milestones ──
function getQuarterlyMilestones(proj: Project): QuarterlyMilestone[] {
  return proj.quarterlyMilestones || [];
}

// ── Sort weeks by label ──
function sortWeeksByLabel(weeks: Week[]): Week[] {
  return [...weeks].sort((a, b) => {
    const parseLabel = (label: string) => {
      const m = label.match(/W(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    };
    return parseLabel(a.weekLabel) - parseLabel(b.weekLabel);
  });
}

// ── Filter projects ──
function filterProjects(projects: Project[], filters: {
  status?: string; track?: string; owner?: string; pmFilter?: string; search?: string;
}): Project[] {
  let result = projects;
  if (filters.pmFilter && filters.pmFilter !== 'all') {
    result = result.filter(
      (p) => p.visibility !== 'hidden' && p.visibility !== 'archived'
    );
  } else {
    result = result.filter((p) => p.visibility === 'active');
  }
  if (filters.status && filters.status !== 'all') {
    result = result.filter((p) => p.status === filters.status);
  }
  if (filters.owner && filters.owner !== 'all') {
    result = result.filter((p) => p.owner === filters.owner || p.deputy === filters.owner);
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        p.owner.toLowerCase().includes(q) ||
        p.highlight.toLowerCase().includes(q)
    );
  }
  return result;
}

// ── Store Interface ──
interface DashboardStore {
  // Auth
  currentUser: User | null;
  currentRole: DashboardRole;
  isAdminVipPreview: boolean;
  loginError: string | null;
  isLoggingIn: boolean;

  // Data
  allWeeks: Week[];
  currentWeekIdx: number;
  pmList: string[];
  presenceDocs: PresenceDoc[];
  onlineUsers: string[];

  // UI
  activeView: ViewId;
  isOverview: boolean;
  activeStrategicTrack: string;
  activeRoadmapYear: number | null;
  loading: boolean;
  loaderText: string;
  toastMessage: string | null;
  isEditing: boolean;
  editingProjCode: string | null;
  isCreatingNew: boolean;
  showWeekManagement: boolean;
  showStrategyLayer: boolean;
  showPresenceUsage: boolean;
  showChangePassword: boolean;
  showProjDetail: string | null;
  releaseWriteInProgress: boolean;

  // Auth actions
  handleLogin: (email: string, password: string) => Promise<void>;
  handleLogout: () => Promise<void>;

  // Data actions
  setWeeks: (weeks: Week[]) => void;
  jumpToWeek: (idx: number) => void;
  setPmList: (list: string[]) => void;
  setPresence: (docs: PresenceDoc[]) => void;

  // Week operations (preserve exact Firestore writes)
  saveCurrentWeekQuietly: () => Promise<void>;
  saveWeekSummary: (summary: string) => Promise<void>;
  createNewWeek: (label: string, date: string) => Promise<void>;
  toggleReleaseWeek: () => Promise<void>;

  // Project operations (preserve exact Firestore writes)
  saveProjEdit: (formData: Partial<Project>, isNew: boolean) => Promise<void>;
  deleteProject: (code: string) => Promise<void>;
  updateAttention: (code: string, attention: AttentionLevel) => Promise<void>;
  reorderProjects: (codes: string[]) => Promise<void>;

  // Strategy
  saveStrategyLayer: (data: Partial<StrategyLayer>) => Promise<void>;

  // UI actions
  setActiveView: (view: ViewId) => void;
  toggleOverview: () => void;
  setActiveStrategicTrack: (trackId: string) => void;
  setActiveRoadmapYear: (year: number) => void;
  openProjEdit: (code: string | null, isNew?: boolean) => void;
  openProjDetail: (code: string | null) => void;
  openWeekManagement: () => void;
  openStrategyLayer: () => void;
  openPresenceUsage: () => void;
  openChangePassword: () => void;
  closeModal: () => void;
  showLoader: (text?: string) => void;
  hideLoader: () => void;
  showToast: (msg: string) => void;
  toggleVipPreview: () => void;

  // Computed
  currentWeek: () => Week | undefined;
  currentProjects: () => Project[];
  filteredProjects: () => Project[];
  isVipPerspective: () => boolean;
  canEdit: (proj: Project) => boolean;
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  // ── Initial State (same as v2.0T) ──
  currentUser: null,
  currentRole: 'pm',
  isAdminVipPreview: false,
  loginError: null,
  isLoggingIn: false,

  allWeeks: [],
  currentWeekIdx: -1,
  pmList: [],
  presenceDocs: [],
  onlineUsers: [],

  activeView: 'overview',
  isOverview: false,
  activeStrategicTrack: 'all',
  activeRoadmapYear: null,
  loading: true,
  loaderText: 'Connecting to Secure System...',
  toastMessage: null,
  isEditing: false,
  editingProjCode: null,
  isCreatingNew: false,
  showWeekManagement: false,
  showStrategyLayer: false,
  showPresenceUsage: false,
  showChangePassword: false,
  showProjDetail: null,
  releaseWriteInProgress: false,

  // ── Auth ──
  handleLogin: async (email, password) => {
    set({ isLoggingIn: true, loginError: null });
    try {
      const cred = await fb.login(email, password);
      const emailKey = fb.getEmailKey(cred.user);
      const role = (await fb.fetchUserRole(emailKey)) as DashboardRole;
      const pmList = await fb.fetchPMList();
      set({
        currentUser: cred.user,
        currentRole: role,
        pmList,
        isLoggingIn: false,
        loading: false,
      });
    } catch (e) {
      const err = e as Error;
      set({
        isLoggingIn: false,
        loginError:
          err.message === 'missing-dashboard-role'
            ? 'Login succeeded, but this account has not been assigned a dashboard role yet.'
            : err.message.includes('auth/invalid-credential')
            ? 'Invalid email or password.'
            : err.message,
      });
    }
  },

  handleLogout: async () => {
    await fb.logout();
    set({
      currentUser: null,
      currentRole: 'pm',
      isAdminVipPreview: false,
      allWeeks: [],
      currentWeekIdx: -1,
      loading: true,
      loginError: null,
    });
  },

  // ── Data ──
  setWeeks: (weeks) => {
    const sorted = sortWeeksByLabel(weeks);
    const { currentWeekIdx } = get();
    let idx = currentWeekIdx;
    if (idx < 0 || get().allWeeks.length === 0) {
      idx = sorted.length - 1;
    }
    if (idx >= sorted.length) idx = sorted.length - 1;
    set({ allWeeks: sorted, currentWeekIdx: idx, loading: false });
  },

  jumpToWeek: (idx) => set({ currentWeekIdx: idx }),

  setPmList: (list) => set({ pmList: list }),

  setPresence: (docs) => {
    const now = Date.now();
    const window = 12 * 60 * 1000;
    const online = docs
      .filter((d) => d.online && !d.idle && now - d.lastSeen < window)
      .map((d) => d.name || d?.toString()?.split('/')[3] || 'Unknown');
    set({ presenceDocs: docs, onlineUsers: online });
  },

  // ── Week Operations (exact same Firestore writes) ──
  saveCurrentWeekQuietly: async () => {
    const { allWeeks, currentWeekIdx, currentUser } = get();
    const week = allWeeks[currentWeekIdx];
    if (!week || !currentUser) return;
    week.lastModifiedBy = currentUser.email || '';
    await fb.saveWeek(week);
  },

  saveWeekSummary: async (summary) => {
    const { allWeeks, currentWeekIdx, currentUser } = get();
    const week = allWeeks[currentWeekIdx];
    if (!week || !currentUser) return;
    week.summary = summary;
    week.lastModifiedBy = currentUser.email || '';
    set({ allWeeks: [...get().allWeeks] });
    await fb.saveWeek(week);
    get().showToast('Summary updated');
  },

  createNewWeek: async (label, date) => {
    const { allWeeks, currentUser } = get();
    set({ loading: true, loaderText: 'Creating New Week...' });
    try {
      let projects: Project[] = [];
      if (allWeeks.length > 0) {
        const lastWeek = allWeeks[allWeeks.length - 1];
        projects = JSON.parse(JSON.stringify(lastWeek.projects || []));
        projects = projects.filter((p) => !p.visibility || p.visibility === 'active');
      }
      const newWeek: Week = {
        weekLabel: label,
        weekDate: date,
        summary: '',
        lastModifiedBy: currentUser?.email || '',
        projects,
        isReleased: false,
      };
      await fb.saveWeek(newWeek);
      get().showToast('New week created');
    } finally {
      set({ loading: false });
    }
  },

  toggleReleaseWeek: async () => {
    const { allWeeks, currentWeekIdx, currentUser, releaseWriteInProgress } = get();
    const week = allWeeks[currentWeekIdx];
    if (!week || !currentUser || releaseWriteInProgress) return;
    const isCurrentlyReleased = week.isReleased;
    const newStatus = !isCurrentlyReleased;
    set({ releaseWriteInProgress: true, loading: true, loaderText: newStatus ? 'Releasing to VIP...' : 'Reverting to Draft...' });
    try {
      await fb.confirmWeekMutation(
        week,
        { isReleased: newStatus, lastModifiedBy: currentUser.email } as Partial<Week>,
        async (candidate) => {
          await fb.updateWeekField(candidate.weekLabel, {
            isReleased: newStatus,
            lastModifiedBy: currentUser.email,
          });
        }
      );
      const updated = get().allWeeks;
      updated[currentWeekIdx] = { ...week, isReleased: newStatus, lastModifiedBy: currentUser.email || '' };
      set({ allWeeks: [...updated], releaseWriteInProgress: false, loading: false });
      get().showToast(newStatus ? 'Week released to VIP!' : 'Week reverted to Draft');
    } catch (err) {
      set({ releaseWriteInProgress: false, loading: false });
      get().showToast(fb.getWriteErrorMessage(err));
    }
  },

  // ── Project Operations (exact same Firestore writes) ──
  saveProjEdit: async (formData, isNew) => {
    const { allWeeks, currentWeekIdx, currentUser, editingProjCode } = get();
    const week = allWeeks[currentWeekIdx];
    if (!week || !currentUser) return;
    set({ loading: true, loaderText: 'Saving Project...' });
    try {
      const previousProject = isNew ? null : week.projects.find((x) => x.code === editingProjCode) || null;
      const milestones = collectMilestonesWithHistory(previousProject, formData.milestones || []);
      const riskActions = formData.riskActions || [];
      const riskText = riskActions.map((item) => item.risk).filter(Boolean).join('\n');
      const nextText = riskActions.map((item) => item.action).filter(Boolean).join('\n');
      const pData: Project = {
        name: formData.name || '',
        code: formData.code || '',
        owner: formData.owner || '',
        deputy: formData.deputy || '',
        customer: formData.customer || '',
        location: formData.location || '',
        visibility: (formData.visibility as Visibility) || 'active',
        milestones,
        quarterlyMilestones: formData.quarterlyMilestones || [],
        status: formData.status || 'green',
        progress: formData.progress || 0,
        attention: formData.attention || 'watch',
        attentionManual: true,
        highlight: formData.highlight || '',
        weeklyActions: formData.weeklyActions || '',
        riskActions,
        risk: riskText,
        next: nextText,
      };
      if (isNew) {
        week.projects.push(pData);
      } else {
        const idx = week.projects.findIndex((x) => x.code === editingProjCode);
        if (idx >= 0) week.projects[idx] = { ...week.projects[idx], ...pData };
      }
      week.lastModifiedBy = currentUser.email || '';
      await fb.saveWeek(week);
      set({
        allWeeks: [...get().allWeeks],
        isEditing: false,
        editingProjCode: null,
        isCreatingNew: false,
        loading: false,
      });
      get().showToast('Project saved successfully');
    } catch {
      set({ loading: false });
      get().showToast('Save failed. Please try again.');
    }
  },

  deleteProject: async (code) => {
    const { allWeeks, currentWeekIdx } = get();
    const week = allWeeks[currentWeekIdx];
    if (!week) return;
    set({ loading: true, loaderText: 'Deleting Project...' });
    try {
      week.projects = week.projects.filter((x) => x.code !== code);
      week.lastModifiedBy = get().currentUser?.email || '';
      await fb.saveWeek(week);
      set({ allWeeks: [...get().allWeeks], isEditing: false, editingProjCode: null, loading: false });
      get().showToast('Project deleted');
    } catch {
      set({ loading: false });
      get().showToast('Delete failed.');
    }
  },

  updateAttention: async (code, attention) => {
    const { allWeeks, currentWeekIdx } = get();
    const week = allWeeks[currentWeekIdx];
    if (!week) return;
    const p = week.projects.find((x) => x.code === code);
    if (!p) return;
    p.attention = attention;
    p.attentionManual = true;
    set({ allWeeks: [...get().allWeeks] });
    await get().saveCurrentWeekQuietly();
    get().showToast('Attention updated');
  },

  reorderProjects: async (codes) => {
    const { allWeeks, currentWeekIdx } = get();
    const week = allWeeks[currentWeekIdx];
    if (!week) return;
    const projectMap = new Map(week.projects.map((p) => [p.code, p]));
    week.projects = codes.map((code) => projectMap.get(code)!).filter(Boolean);
    set({ allWeeks: [...get().allWeeks] });
    await get().saveCurrentWeekQuietly();
  },

  // ── Strategy ──
  saveStrategyLayer: async (data) => {
    const { allWeeks, currentWeekIdx, currentUser } = get();
    const week = allWeeks[currentWeekIdx];
    if (!week || !currentUser) return;
    set({ loading: true, loaderText: 'Saving Strategy Layer...' });
    try {
      const strategyLayer: StrategyLayer = {
        activeTrack: 'all',
        tracks: data.tracks || [],
        quarterGoals: data.quarterGoals || {},
        executiveMilestoneTimeline: data.executiveMilestoneTimeline || { title: '', quarters: [], rows: [], phases: [] },
        projectMap: data.projectMap || {},
      };
      const savedWeek = await fb.confirmWeekMutation(
        week,
        { strategyLayer, lastModifiedBy: currentUser.email } as Partial<Week>,
        async (candidate) => {
          await fb.saveWeek(candidate as Week);
        }
      );
      const updated = get().allWeeks;
      updated[currentWeekIdx] = savedWeek as Week;
      set({ allWeeks: [...updated], showStrategyLayer: false, loading: false });
      get().showToast('Strategy layer saved');
    } catch (err) {
      set({ loading: false });
      get().showToast(fb.getWriteErrorMessage(err));
    }
  },

  // ── UI Actions ──
  setActiveView: (view) => set({ activeView: view }),
  toggleOverview: () => set((s) => ({ isOverview: !s.isOverview })),
  setActiveStrategicTrack: (trackId) => set({ activeStrategicTrack: trackId }),
  setActiveRoadmapYear: (year) => set({ activeRoadmapYear: year }),
  openProjEdit: (code, isNew = false) => set({ isEditing: true, editingProjCode: code, isCreatingNew: isNew }),
  openProjDetail: (code) => set({ showProjDetail: code }),
  openWeekManagement: () => set({ showWeekManagement: true }),
  openStrategyLayer: () => set({ showStrategyLayer: true }),
  openPresenceUsage: () => set({ showPresenceUsage: true }),
  openChangePassword: () => set({ showChangePassword: true }),
  closeModal: () => set({
    isEditing: false, editingProjCode: null, isCreatingNew: false,
    showWeekManagement: false, showStrategyLayer: false,
    showPresenceUsage: false, showChangePassword: false, showProjDetail: null,
  }),
  showLoader: (text = 'Processing...') => set({ loading: true, loaderText: text }),
  hideLoader: () => set({ loading: false }),
  showToast: (msg) => {
    set({ toastMessage: msg });
    setTimeout(() => set({ toastMessage: null }), 3000);
  },
  toggleVipPreview: () => set((s) => ({ isAdminVipPreview: !s.isAdminVipPreview })),

  // ── Computed ──
  currentWeek: () => get().allWeeks[get().currentWeekIdx],
  currentProjects: () => {
    const week = get().allWeeks[get().currentWeekIdx];
    if (!week) return [];
    if (get().currentRole === 'vip' || get().isVipPerspective()) {
      return week.projects.filter((p) => p.visibility !== 'hidden' && p.visibility !== 'archived');
    }
    return week.projects.filter((p) => p.visibility === 'active');
  },
  filteredProjects: () => {
    const projects = get().currentProjects();
    return filterProjects(projects, { search: '' });
  },
  isVipPerspective: () => get().currentRole === 'vip' || (get().currentRole === 'admin' && get().isAdminVipPreview),
  canEdit: (proj) => canEditProject(proj, get().currentRole, get().currentUser),
}));

// ── Export helpers for components ──
export { getProjectAttention, getRiskActionPairs, getQuarterlyMilestones, normalizeMilestonePlan, sortWeeksByLabel, filterProjects, ATTENTION_MAP };