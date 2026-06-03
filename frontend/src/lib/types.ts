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
}

export interface QueueData {
  tasks: BlockedTask[]
}

export interface DashboardData {
  tasks: BlockedTask[]
  queues: Record<string, QueueData>
  today: string
}

export interface SyncInfo {
  [queue: string]: string
}
