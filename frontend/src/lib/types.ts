export interface Blocking {
  key: string
  title: string
  reason: string
  startDate: string
  endDate: string
  status: string
  days: number
  isActive: boolean
}

export interface BlockedTask {
  key: string
  title: string
  url: string
  queue: string
  blockings: Blocking[]
  totalDays: number
  isOutlier?: boolean
}

export interface QueueData {
  tasks: BlockedTask[]
}

export interface DashboardData {
  tasks: BlockedTask[]
  queues: Record<string, QueueData>
  today: string
  p70: number
  p85: number
  p90: number
}

export interface SyncInfo {
  [queue: string]: string
}

// ── Арх. комитет (возвраты) ────────────────────────────────────────────────────
export interface ArchReturnTask {
  key: string
  title: string
  url: string
  queue: string
  issueType: string        // story | analytics | technicaldebt | improvement | elaboration
  issueTypeDisplay: string
  entryDate: string | null // дата входа в комитет в периоде (null — вошла раньше)
  entered: boolean         // был ли вход (→180) в периоде
  entryDates: string[]
  v1Dates: string[]        // даты возвратов АрхКома в периоде
  v2Dates: string[]        // даты возвратов ТА в периоде
  v1n: number
  v2n: number
  total: number
  cycleDays?: number | null // дней от входа до выхода из комитета (null — ещё внутри)
}

export interface ArchDashboardData {
  tasks: ArchReturnTask[]
  queues: Record<string, { tasks: ArchReturnTask[] }>
  dateFrom: string
  dateTo: string
}

// ── Оценка (план-факт спринта) ─────────────────────────────────────────────────
export interface Sprint {
  id: number
  team: string
  name: string
  date_from: string
  date_to: string
  finalized: boolean
}

export interface SprintTask {
  key: string
  title: string
  plan: Record<string, number>   // role → SP
  fact: Record<string, number>   // role → SP
  planTotal: number
  factTotal: number
  pct: number
}

export interface SprintPlanFact {
  ok: boolean
  finalized: boolean
  sprint: { id: number; name: string; team: string; dateFrom: string; dateTo: string; finalized: boolean }
  tasks: SprintTask[]
  byRole: Record<string, { plan: number; fact: number; capacity: number; remaining: number; load: number }>
  roles: string[]
  roleLabels: Record<string, string>
  totals: { tasks: number; plan: number; fact: number; pct: number; delta: number }
}

// ── Оценка новых возможностей ──────────────────────────────────────────────────
export interface FeatureRef {
  key: string; title: string; url: string
  team: string; category: string; assignee: string
  effort: number; days: number
  effCat?: string; promoted?: boolean   // category поднята по SLE (effCat — исходная по effort)
}
export interface FeatureCategory { key: string; maxEff: number | null; sle: number }
export interface FeatureRefs {
  ok: boolean
  teams: string[]
  teamLabels: Record<string, string>
  categories: FeatureCategory[]
  items: FeatureRef[]
}
export type StackBreakdown = Record<string, number>
export interface WorklogStacks {
  ok: boolean
  byStack: StackBreakdown
  perTask: { key: string; title: string; url: string; byStack: StackBreakdown; total: number }[]
  other: { name: string; hours: number }[]
  tasks: number
}
export interface MmfCriterion { name: string; ok: boolean; note: string }
export interface MmfCheck { criteria: MmfCriterion[]; score: number; total: number; recommendations: string[] }
export interface FeatureIssue {
  key: string; url: string; summary: string; status: string | null
  effort: number | null; effortFact: number | null; jobCategory: string | null
}
export interface EffortBasis {
  source: "similar" | "category"
  n: number; median: number; min: number; max: number; values: number[]
}
export interface FeatureAnalysis {
  ok: boolean
  error?: string
  category: string | null
  effortDays: number | null       // оценка = медиана эталонов (effortBasis)
  aiEffortDays?: number | null     // свободная прикидка ИИ по сложности (справочно)
  effortBasis?: EffortBasis | null
  rationale: string
  similar: string[]
  sle: number | null
  mmf: MmfCheck | null
  issue?: FeatureIssue | null
}
export interface FeatureRefInfo {
  key: string; url: string; title: string
  team: string | null; category: string | null
  effort: number | null; days: number | null
  byStack: StackBreakdown; inRefs: boolean
}

// Задача, которая сейчас находится в одном из статусов Арх. комитета
export interface ArchTask {
  key: string
  title: string
  url: string
  queue: string
  issueType: string
  issueTypeDisplay: string
  status: string
  statusKey: string
  assignee: string
  since: string
  daysInStatus: number
  v1n: number  // возвратов от АрхКома (на ревью аналитики)
  v2n: number  // возвратов от ТА (на доработку)
}

// ── Поток по командам (CFD + WIP Age) ───────────────────────────────────────────
export interface FlowLimit { count: number; limit: number | null }
export interface FlowWipTask {
  key: string; url: string; title: string; assignee: string
  status: string; days: number; bucket: "regular" | "onec" | "crit"
}
export interface FlowTeamData {
  ok: boolean
  team: string; label: string; queue: string
  teams: string[]; teamLabels: Record<string, string>
  statuses: string[]
  cfd: Array<Record<string, number | string>>   // { day, [status]: count }
  wipAge: { day: string; p90: number; count: number }[]
  limits: { regular: FlowLimit; crit: FlowLimit; onec?: FlowLimit }
  wipTasks: FlowWipTask[]
  topOld: FlowWipTask[]
  tasks: number; updatedAt: string | null
}
export interface FlowSyncStatus { running: boolean; pct: number; msg: string; error: string }
