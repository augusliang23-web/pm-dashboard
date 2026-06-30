// ═══════════════════════════════════════════════════════════════════
//  PM Dashboard Type Definitions — 1:1 mapped from v2.0T Firestore schema
// ═══════════════════════════════════════════════════════════════════

// ── Status & Attention ──
export type ProjectStatus = 'green' | 'yellow' | 'red' | 'to-do' | 'in-progress' | 'done' | 'at-risk';
export type AttentionLevel = 'action' | 'monitor' | 'strategy' | 'watch';
export type Visibility = 'active' | 'hidden' | 'archived';
export type DashboardRole = 'admin' | 'pm' | 'vip';
export type HealthOption = 'green' | 'yellow' | 'red';

// ── Milestone ──
export interface MilestonePlan {
  planId: string;
  name: string;
  status: string;
  date: string;
  plan?: string;
  history?: Array<{ field: string; from: string; to: string; at: string }>;
}

// ── Risk Action Pair ──
export interface RiskActionPair {
  risk: string;
  action: string;
  primary?: boolean;
}

// ── Quarterly Milestone ──
export interface QuarterlyMilestone {
  quarter: string;
  goal: string;
  window: string;
  status: string;
}

// ── Project (exact Firestore shape) ──
export interface Project {
  name: string;
  code: string;
  owner: string;
  deputy: string;
  customer: string;
  location: string;
  visibility: Visibility;
  status: ProjectStatus;
  progress: number;
  attention: AttentionLevel;
  attentionManual?: boolean;
  highlight: string;
  weeklyActions: string;
  risk: string;
  next: string;
  riskActions: RiskActionPair[];
  milestones: MilestonePlan[];
  quarterlyMilestones: QuarterlyMilestone[];
  [key: string]: unknown; // allow extra fields
}

// ── Executive Timeline ──
export interface ExecutiveTimelineRow {
  label: string;
  cells: Record<string, string[]> | string[][];
}

export interface ExecutiveMilestoneTimeline {
  title: string;
  quarters: string[];
  rows: ExecutiveTimelineRow[];
  phases?: string[];
}

// ── Strategic Track ──
export interface StrategicTrack {
  id: string;
  label: string;
  description: string;
}

// ── Strategy Layer (exact Firestore shape) ──
export interface StrategyLayer {
  activeTrack: string;
  tracks: StrategicTrack[];
  quarterGoals: Record<string, string[]>;
  executiveMilestoneTimeline: ExecutiveMilestoneTimeline;
  projectMap: Record<string, { businessObjective: string; checkpoint: string }>;
}

// ── Week Document (exact Firestore shape) ──
export interface Week {
  weekLabel: string;
  weekDate: string;
  summary: string;
  isReleased: boolean;
  lastModifiedBy: string;
  projects: Project[];
  strategyLayer?: StrategyLayer;
  [key: string]: unknown;
}

// ── User Document (exact Firestore shape) ──
export interface UserDoc {
  role: string;
  [key: string]: unknown;
}

// ── Presence ──
export interface PresenceDoc {
  online: boolean;
  lastSeen: number;
  idle: boolean;
  name?: string;
}

export interface PresenceSession {
  userId: string;
  startedAt: number;
  lastEventAt: number;
  state: 'active' | 'idle' | 'closed';
  closed?: boolean;
}

// ── Presence Usage ──
export interface UsageBucket {
  start: number;
  end: number;
  writes: number;
}

// ── Dashboard View ──
export type ViewId = 'overview' | 'projects' | 'timeline' | 'risk' | 'team' | 'roadmap' | 'activity';

// ── Constants ──
export const PROJECT_MEMBER_TBD = 'TBD';

export const ATTENTION_MAP: Record<AttentionLevel, string> = {
  action: 'Executive Action',
  monitor: 'Monitor Closely',
  strategy: 'Strategic Watch',
  watch: 'Keep Watching',
};

export const STATUS_LABELS: Record<string, string> = {
  green: 'On Track',
  yellow: 'At Risk',
  red: 'Critical',
  'to-do': 'To Do',
  'in-progress': 'In Progress',
  done: 'Done',
  'at-risk': 'At Risk',
};

export const HEALTH_OPTIONS: Array<[HealthOption, string]> = [
  ['green', 'On Track'],
  ['yellow', 'At Risk'],
  ['red', 'Blocked'],
];

export const UNIVERSAL_CHECKPOINTS = [
  '1. Specification Definition',
  '2. Concept Validation',
  '3. System Integration',
  '4. Customer Delivery',
];

export const STRATEGIC_TRACKS: StrategicTrack[] = [
  { id: 'all', label: 'All Projects', description: 'All projects' },
];

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBke6_lXZwcS1UCGYpS15hLgfSbC6xGEFI",
  authDomain: "project-manager-dashboar-a067f.firebaseapp.com",
  projectId: "project-manager-dashboar-a067f",
  storageBucket: "project-manager-dashboar-a067f.firebasestorage.app",
  messagingSenderId: "842441149281",
  appId: "1:842441149281:web:ef2a9af8b37593451e1320",
  measurementId: "G-TW9FW819EY",
};

export const PRESENCE_CONSTANTS = {
  IDLE_TIMEOUT: 10 * 60 * 1000,
  HEARTBEAT_MS: 5 * 60 * 1000,
  ACTIVE_WINDOW_MS: 12 * 60 * 1000,
  USAGE_FLUSH_MS: 12 * 60 * 60 * 1000,
  USAGE_LOOKBACK_BUCKETS: 112,
  SESSION_COLLECTION: 'presenceSessions',
  ROLLUP_COLLECTION: 'presenceDailyRollups',
  SESSION_RETENTION_DAYS: 90,
  WRITES_PER_DAY: 20000,
  WRITES_PER_12H: 10000,
  SIX_WEEK_BASELINE: {
    startDate: "2026-05-16",
    endDate: "2026-06-27",
    reads: 69,
    writes: 6882,
    freeWriteQuota: 42 * 20000,
  } as const,
};

// ── Alias Map (same as original) ──
export const ALIAS_MAP: Record<string, string> = {
  "augus.liang": "Augus",
  "josiah.winkler": "Josiah",
  "qianyun.zhu": "Bonnie",
  "huichong.kong": "Huichong",
};