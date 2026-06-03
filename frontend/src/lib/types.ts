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
