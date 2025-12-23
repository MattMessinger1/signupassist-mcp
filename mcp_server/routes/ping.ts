import { Router } from "express";

const router = Router();

// Version info for health check verification
const VERSION = process.env.APP_VERSION || "2.1.1-full-gating";
const BUILD_ID = process.env.APP_BUILD_ID || "2025-06-22T02:30:00Z";

router.get("/", (_, res) => {
  console.log("[DEPLOY CHECK] Commit:", process.env.RAILWAY_GIT_COMMIT_SHA);
  res.json({ 
    ok: true, 
    version: VERSION,
    build: BUILD_ID,
    commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    ts: Date.now() 
  });
});

export default router;
