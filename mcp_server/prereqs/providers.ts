// mcp_server/prereqs/providers.ts
import { registerProvider } from './registry';
import { SkiClubProCheckers } from '../config/providers/skiclubpro/prereqs';

export function registerAllProviders() {
  registerProvider('skiclubpro', SkiClubProCheckers);
  // future: registerProvider('campminder', CampMinderCheckers) ...
}
