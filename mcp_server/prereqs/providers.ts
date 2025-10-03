// mcp_server/prereqs/providers.ts
import { registerProvider } from './registry.js';
import { SkiClubProCheckers } from '../config/providers/skiclubpro/prereqs.js';

export function registerAllProviders() {
  registerProvider('skiclubpro', SkiClubProCheckers);
  // future: registerProvider('campminder', CampMinderCheckers) ...
}
