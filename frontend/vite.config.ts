import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Branding comes from a deployment profile, not from this repo. CABIN_CONFIG is
// set by deploy.sh; the example profile keeps `npm run dev` working standalone.
const configPath = resolve(
  process.env.CABIN_CONFIG ?? '../profile.example/cabin.config.json',
)
const branding = JSON.parse(readFileSync(configPath, 'utf8'))

export default defineConfig({
  plugins: [
    react(),
    {
      // index.html is static, so the title and favicon glyph are substituted here.
      name: 'branding-html',
      transformIndexHtml: (html) =>
        html
          .replaceAll('%APP_NAME%', branding.appName)
          .replaceAll('%APP_EMOJI%', branding.emoji),
    },
  ],
  resolve: {
    // `import branding from 'app-config'` resolves to the active profile.
    alias: { 'app-config': configPath },
  },
  define: {
    // amazon-cognito-identity-js references Node's `global`, which browsers lack.
    global: 'globalThis',
  },
})
