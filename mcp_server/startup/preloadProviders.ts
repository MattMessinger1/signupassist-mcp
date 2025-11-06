/**
 * Preload popular provider searches to warm the cache on server startup
 * Improves response time for common queries
 */

import { googlePlacesSearch } from '../utils/providerSearch.js';
import Logger from '../utils/logger.js';

const POPULAR_SEARCHES = [
  { name: 'YMCA', location: 'Madison WI' },
  { name: 'Boys and Girls Club', location: 'Madison WI' },
  { name: 'Blackhawk Ski Club', location: 'Middleton WI' },
  { name: 'Madison Nordic Ski Club', location: 'Madison WI' },
  { name: 'Community Center', location: 'Madison WI' },
];

export async function preloadProviderCache() {
  Logger.info('[Preload] 🔥 Warming provider search cache...');
  
  const results = await Promise.allSettled(
    POPULAR_SEARCHES.map(async (s) => {
      try {
        await googlePlacesSearch(s.name, s.location);
        return `✅ ${s.name}`;
      } catch (error) {
        Logger.warn(`[Preload] Failed to cache ${s.name}:`, error);
        return `❌ ${s.name}`;
      }
    })
  );
  
  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  Logger.info(`[Preload] ✅ Cache warmed: ${succeeded}/${POPULAR_SEARCHES.length} providers preloaded`);
}
