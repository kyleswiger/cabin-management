// Resolved by the `app-config` alias in vite.config.ts to the active profile's
// cabin.config.json. Typed as unknown here; branding.ts narrows it.
declare module "app-config" {
  const config: unknown;
  export default config;
}
