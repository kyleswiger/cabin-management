import { sweepTestData, restoreSettings } from "./api";

// Safety net: after the whole run, remove any marked data a failing/aborted spec may
// have left behind. Specs also clean up their own entities as they go.
export default async function globalTeardown(): Promise<void> {
  // Runs before the sweep: deleting a project sends no notification, so the order is safe,
  // and doing it first means a sweep failure can't leave project SMS switched off.
  try {
    await restoreSettings();
  } catch (err) {
    console.warn(
      `\n[e2e teardown] settings restore failed — project update SMS is still DISABLED. ` +
        `The next run restores it, or re-enable it in Settings: ${(err as Error).message}`
    );
  }
  try {
    const summary = await sweepTestData();
    console.log(`\n[e2e teardown] ${summary}`);
  } catch (err) {
    console.warn(`\n[e2e teardown] sweep failed (clean up manually if needed): ${(err as Error).message}`);
  }
}
