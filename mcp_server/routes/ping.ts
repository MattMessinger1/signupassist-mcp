import { Router } from "express";

const router = Router();

// Version info for health check verification
const VERSION = "2.1.1-full-gating";
const BUILD_ID = "2025-06-22T02:30:00Z";

router.get("/", (_, res) => res.json({ 
  ok: true, 
  version: VERSION,
  build: BUILD_ID,
  ts: Date.now() 
}));

export default router;
