import { disableProjectNotifications } from "./api";

// Turn project update notifications off before any spec runs, so the suite can't text real
// people or leave unsweepable NOTIF# rows behind. Errors are deliberately not caught: if the
// guard can't be established, the run must not start. `global-teardown.ts` restores the flag.
export default async function globalSetup(): Promise<void> {
  await disableProjectNotifications();
}
