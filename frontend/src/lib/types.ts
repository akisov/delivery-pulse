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
}
export interface FeatureCategory { key: string; maxEff: number | null; sle: number }
export interface FeatureRefs {
  ok: boolean
  teams: string[]
  teamLabels: Record<string, string>
  categories: FeatureCategory[]
  items: FeatureRef[]
}
export interface MmfCriterion { name: string; ok: boolean; note: string }
export interface MmfCheck { criteria: MmfCriterion[]; score: number; total: number; recommendations: string[] }
export interface FeatureAnalysis {
  ok: boolean
  error?: string
  category: string | null
  effortDays: number | null
  rationale: string
  similar: string[]
  sle: number | null
  mmf: MmfCheck | null
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
