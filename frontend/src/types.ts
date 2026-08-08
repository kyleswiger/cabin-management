export interface Profile {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: "admin" | "member";
  /** Explicit SMS opt-in. No text is sent without it — see backend/src/lib/sms.ts. */
  smsConsent?: boolean;
  smsConsentAt?: string | null;
  emailOptIn?: boolean;
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

/** Area guide entry (PRD 5.11). */
export interface Trek {
  id: string;
  name: string;
  category: "hike" | "food" | "attraction" | "essentials";
  description: string;
  driveMinutes?: number;
  link?: string;
  addedBy: string;
  addedByName: string;
  createdAt: string;
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
  /** Post-checkout SMS nudge to add a guestbook entry (PRD 5.10). Off by default. */
  guestbookNudgeEnabled: boolean;
}

/** One journal entry per visit — the digital cabin logbook (PRD 5.10). */
export interface GuestbookEntry {
  id: string;
  author: string;
  authorName: string;
  title: string;
  body: string;
  /** Inclusive YYYY-MM-DD visit dates. */
  visitStart: string;
  visitEnd: string;
  /** Gallery photo links (PRD 5.8/5.10) — stored now, linking UI ships with the gallery. */
  mediaIds: string[];
  createdAt: string;
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
  latestGuestbookEntry: Pick<GuestbookEntry, "id" | "title" | "authorName" | "visitStart"> | null;
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
