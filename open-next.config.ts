// OpenNext Cloudflare adapter config for QuizForge.
// Minimal setup: no R2 incremental cache (our quizzes are generated on demand,
// not statically cached), so we use the default in-memory behavior. If we later
// add heavy ISR, swap in r2IncrementalCache here.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
