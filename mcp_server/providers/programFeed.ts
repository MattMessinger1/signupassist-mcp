import { createClient } from '@supabase/supabase-js';
import Logger from '../utils/logger.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const programFeedTools = {
  "program_feed.get": {
    name: "program_feed.get",
    description: "Fetch cached programs for a provider/category.",
    inputSchema: {
      type: "object",
      properties: {
        org_ref: { type: "string" },
        category: { type: "string" },
        age_hint: { type: "number" }
      },
      required: ["org_ref"]
    },

    handler: async ({ org_ref, category = "all", age_hint }) => {
      if (!org_ref) {
        return { success: false, error: "missing_org_ref" };
      }

      try {
        const { data, error } = await supabase
          .from("cached_provider_feed")
          .select("*")
          .eq("org_ref", org_ref)
          .eq("category", category);

        if (error) {
          Logger.error("[program_feed.get] Supabase error:", error);
          return { success: true, programs: [] };
        }

        if (!data || data.length === 0) {
          Logger.info(`[program_feed.get] feed_hit=false, items=0`);
          return { success: true, programs: [] };
        }

        const programs = data.map(({ program, program_ref, cached_at }) => ({
          id: program_ref,
          program_ref,
          title: program.title ?? "Program",
          schedule: program.schedule ?? "Schedule TBD",
          price: program.price ?? "Price TBD",
          age_range: program.age_range ?? "",
          description: program.description ?? "",
          status: program.status ?? "available",
          category: program.category ?? category,
          url: program.url ?? "",
          cta_label: "Enroll",
          cta_href: program.url ?? "",
          metadata: program.metadata ?? {}
        }));

        // Age filtering
        let filtered = programs;
        if (age_hint) {
          filtered = programs.filter((p) => {
            const m = p.age_range.match(/(\d+).*?(\d+)/);
            if (m) {
              const [min, max] = [parseInt(m[1]), parseInt(m[2])];
              return age_hint >= min && age_hint <= max;
            }
            return true;
          });
        }

        // Telemetry
        const newest = Math.max(...data.map(d => Date.parse(d.cached_at ?? 0)));
        const feedAgeMs = newest ? Date.now() - newest : -1;
        Logger.info(
          `[program_feed.get] feed_hit=true, feed_age_ms=${feedAgeMs}, items=${filtered.length}`
        );

        return { success: true, programs: filtered };

      } catch (err) {
        Logger.error("[program_feed.get] exception:", err);
        return { success: true, programs: [] };
      }
    }
  }
};
