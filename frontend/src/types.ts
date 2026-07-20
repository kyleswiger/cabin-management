export interface Profile {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: "admin" | "member";
}

export interface Reservation {
  id: string;
  startDate: string;
  endDate: string;
  createdBy: string;
  createdByName: string;
  attendees: string;
  notes: string;
  status: "active" | "cancelled";
}

export interface SupplyItem {
  id: string;
  name: string;
  status: "ok" | "low" | "out";
  lastUpdatedBy: string;
  lastUpdatedDate: string;
}

export interface Contribution {
  id: string;
  projectId: string;
  userId: string;
  userName: string;
  amount: number;
  date: string;
  note: string;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  status: "not_started" | "in_progress" | "done";
  priority: "high" | "medium" | "low";
  estimatedCost: number | null;
  contributions: Contribution[];
  contributedTotal: number;
}

export interface ChoreLog {
  id: string;
  type: "mow" | "trim" | "other";
  note: string;
  completedBy: string;
  completedByName: string;
  completedDate: string;
}

export interface Settings {
  priorityWindowDays: number;
  vacancyThresholdDays: number;
  preVisitReminderDays: number;
  priorityUserId: string | null;
  notifyOnProjectUpdates: boolean;
}

export interface Dashboard {
  today: string;
  current: Reservation | null;
  next: Reservation | null;
  lastCheckout: string | null;
  vacancyGapDays: number | null;
  daysSinceLastMow: number | null;
  lastMow: ChoreLog | null;
  lastTrim: ChoreLog | null;
  lowOutSupplies: SupplyItem[];
  openProjects: Project[];
  settings: Settings;
}

export interface NotificationLog {
  id: string;
  userId: string;
  type: string;
  status: string;
  message: string;
  sentDate: string;
}
