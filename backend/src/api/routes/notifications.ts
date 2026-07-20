import { queryType } from "../../lib/db.js";
import { ApiError, type Caller } from "../../lib/http.js";

interface NotificationLog {
  id: string;
  userId: string;
  type: string;
  status: string;
  message: string;
  sentDate: string;
}

/** Debug/audit view of recent notifications (PRD 7) — admin only. */
export async function listNotifications(caller: Caller): Promise<NotificationLog[]> {
  if (!caller.isAdmin) throw new ApiError(403, "Only an admin can view the notification log");
  const items = await queryType<NotificationLog>("NOTIF");
  return items.sort((a, b) => b.sentDate.localeCompare(a.sentDate)).slice(0, 100);
}
