// @ts-check

/**
 * @decision DEC-INFRA-001
 * @title Server output mode with Cloudflare adapter (Astro v5 hybrid equivalent)
 * @status accepted
 * @rationale Astro v5 removed the "hybrid" output mode. The equivalent is output: "server"
 *   (SSR default) with export const prerender = true on static pages. This achieves
 *   the same split: public pages prerendered at build time, authenticated/dynamic routes
 *   rendered on-demand by the Cloudflare Worker. The Cloudflare adapter compiles the
 *   Worker bundle to dist/_worker.js/. Clerk integration is registered here so the
 *   middleware hook point is wired — actual auth logic comes in Phase 2.
 */

import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import clerk from "@clerk/astro";

export default defineConfig({
  output: "server",
  adapter: cloudflare(),
  integrations: [clerk()],
});
