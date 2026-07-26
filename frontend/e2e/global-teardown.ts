import { sweepTestData } from "./api";

// Safety net: after the whole run, remove any marked data a failing/aborted spec may
// have left behind. Specs also clean up their own entities as they go.
export default async function globalTeardown(): Promise<void> {
  try {
    const summary = await sweepTestData();
    console.log(`\n[e2e teardown] ${summary}`);
  } catch (err) {
    console.warn(`\n[e2e teardown] sweep failed (clean up manually if needed): ${(err as Error).message}`);
  }
}
