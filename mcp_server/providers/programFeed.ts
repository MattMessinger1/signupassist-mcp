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
        // Try cached_programs table first (new enhanced cache)
        const { data: enhancedCache, error: enhancedError } = await supabase
          .from("cached_programs")
          .select("programs_by_theme, prerequisites_schema, questions_schema, deep_links, cached_at, metadata")
          .eq("org_ref", org_ref)
          .eq("category", category)
          .gt('expires_at', new Date().toISOString())
          .order('cached_at', { ascending: false })
          .limit(1)
          .single();

        if (!enhancedError && enhancedCache) {
          // Enhanced cache hit - flatten programs from themes
          const allPrograms: any[] = [];
          const programsByTheme = enhancedCache.programs_by_theme as Record<string, any[]>;
          
          for (const [theme, programs] of Object.entries(programsByTheme)) {
            for (const prog of programs) {
              allPrograms.push({
                id: prog.program_ref,
                program_ref: prog.program_ref,
                title: prog.title ?? "Program",
                schedule: prog.schedule_text ?? prog.schedule ?? "Schedule TBD",
                price: prog.price ?? "Price TBD",
                age_range: prog.age_range ?? "",
                description: prog.description ?? "",
                status: prog.status ?? "available",
                category: theme,
                url: prog.url ?? "",
                cta_label: "Enroll",
                cta_href: prog.url ?? "",
                theme: theme,
                metadata: prog.metadata ?? {}
              });
            }
          }

          // Age filtering
          let filtered = allPrograms;
          if (age_hint) {
            filtered = allPrograms.filter((p) => {
              const m = p.age_range.match(/(\d+).*?(\d+)/);
              if (m) {
                const [min, max] = [parseInt(m[1]), parseInt(m[2])];
                return age_hint >= min && age_hint <= max;
              }
              return true;
            });
          }

          const cacheAgeMs = Date.now() - Date.parse(enhancedCache.cached_at);
          Logger.info(
            `[program_feed.get] cache_hit=true (enhanced), feed_age_ms=${cacheAgeMs}, items=${filtered.length}, themes=${Object.keys(programsByTheme).length}`
          );

          return { success: true, programs: filtered, cache_metadata: enhancedCache.metadata };
        }

        // Fallback to old cached_provider_feed table
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
          Logger.info(`[program_feed.get] cache_hit=false, items=0`);
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
          `[program_feed.get] cache_hit=true (legacy), feed_age_ms=${feedAgeMs}, items=${filtered.length}`
        );

        return { success: true, programs: filtered };

      } catch (err) {
        Logger.error("[program_feed.get] exception:", err);
        return { success: true, programs: [] };
      }
    }
  }
};
