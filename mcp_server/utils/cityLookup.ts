/**
 * City Lookup Utility for Location Recognition
 * 
 * Provides comprehensive US city recognition, fuzzy matching, and state disambiguation.
 * Optimized for common cities users might type when searching for programs.
 */

// Common typo mappings for fuzzy matching
const TYPO_CORRECTIONS: Record<string, string> = {
  'madisn': 'madison',
  'madision': 'madison',
  'nashvile': 'nashville',
  'nashvill': 'nashville',
  'milwakee': 'milwaukee',
  'milwuakee': 'milwaukee',
  'chicaco': 'chicago',
  'chicgo': 'chicago',
  'minnepolis': 'minneapolis',
  'mineapolis': 'minneapolis',
  'philidelphia': 'philadelphia',
  'philedelphia': 'philadelphia',
  'pitsburg': 'pittsburgh',
  'pittsburg': 'pittsburgh',
  'cincinatti': 'cincinnati',
  'cincinati': 'cincinnati',
  'indianopolis': 'indianapolis',
  'indanapolis': 'indianapolis',
  'detriot': 'detroit',
  'dertoit': 'detroit',
  'clevland': 'cleveland',
  'clevlend': 'cleveland',
  'seatle': 'seattle',
  'seattel': 'seattle',
  'portand': 'portland',
  'portlend': 'portland',
  'denvr': 'denver',
  'dnever': 'denver',
  'phoneix': 'phoenix',
  'phenix': 'phoenix',
  'dallas': 'dallas',
  'dalas': 'dallas',
  'huston': 'houston',
  'houstan': 'houston',
  'austiin': 'austin',
  'austn': 'austin',
  'san antono': 'san antonio',
  'los angelos': 'los angeles',
  'los angles': 'los angeles',
  'sanfrancisco': 'san francisco',
  'san fransisco': 'san francisco',
  'new yrok': 'new york',
  'newyork': 'new york',
};

// Top US cities with state information
// Format: [cityName, stateAbbr, stateFull, population (approx for sorting)]
export const US_CITIES: Array<[string, string, string, number]> = [
  // Major metros (top 50)
  ['New York', 'NY', 'New York', 8300000],
  ['Los Angeles', 'CA', 'California', 4000000],
  ['Chicago', 'IL', 'Illinois', 2700000],
  ['Houston', 'TX', 'Texas', 2300000],
  ['Phoenix', 'AZ', 'Arizona', 1600000],
  ['Philadelphia', 'PA', 'Pennsylvania', 1600000],
  ['San Antonio', 'TX', 'Texas', 1500000],
  ['San Diego', 'CA', 'California', 1400000],
  ['Dallas', 'TX', 'Texas', 1300000],
  ['San Jose', 'CA', 'California', 1000000],
  ['Austin', 'TX', 'Texas', 970000],
  ['Jacksonville', 'FL', 'Florida', 950000],
  ['Fort Worth', 'TX', 'Texas', 920000],
  ['Columbus', 'OH', 'Ohio', 900000],
  ['Charlotte', 'NC', 'North Carolina', 880000],
  ['San Francisco', 'CA', 'California', 870000],
  ['Indianapolis', 'IN', 'Indiana', 880000],
  ['Seattle', 'WA', 'Washington', 750000],
  ['Denver', 'CO', 'Colorado', 730000],
  ['Washington', 'DC', 'District of Columbia', 710000],
  ['Boston', 'MA', 'Massachusetts', 690000],
  ['Nashville', 'TN', 'Tennessee', 680000],
  ['El Paso', 'TX', 'Texas', 680000],
  ['Detroit', 'MI', 'Michigan', 640000],
  ['Portland', 'OR', 'Oregon', 650000],
  ['Memphis', 'TN', 'Tennessee', 630000],
  ['Oklahoma City', 'OK', 'Oklahoma', 680000],
  ['Las Vegas', 'NV', 'Nevada', 640000],
  ['Louisville', 'KY', 'Kentucky', 620000],
  ['Baltimore', 'MD', 'Maryland', 590000],
  ['Milwaukee', 'WI', 'Wisconsin', 580000],
  ['Albuquerque', 'NM', 'New Mexico', 560000],
  ['Tucson', 'AZ', 'Arizona', 540000],
  ['Fresno', 'CA', 'California', 540000],
  ['Sacramento', 'CA', 'California', 520000],
  ['Kansas City', 'MO', 'Missouri', 510000],
  ['Mesa', 'AZ', 'Arizona', 500000],
  ['Atlanta', 'GA', 'Georgia', 500000],
  ['Omaha', 'NE', 'Nebraska', 490000],
  ['Colorado Springs', 'CO', 'Colorado', 480000],
  ['Raleigh', 'NC', 'North Carolina', 470000],
  ['Miami', 'FL', 'Florida', 460000],
  ['Cleveland', 'OH', 'Ohio', 370000],
  ['Minneapolis', 'MN', 'Minnesota', 430000],
  ['Tulsa', 'OK', 'Oklahoma', 410000],
  ['Oakland', 'CA', 'California', 430000],
  ['Tampa', 'FL', 'Florida', 400000],
  ['Pittsburgh', 'PA', 'Pennsylvania', 300000],
  ['Cincinnati', 'OH', 'Ohio', 310000],
  ['St. Louis', 'MO', 'Missouri', 300000],
  
  // Wisconsin cities (our current coverage area)
  ['Madison', 'WI', 'Wisconsin', 270000],
  ['Middleton', 'WI', 'Wisconsin', 22000],
  ['Verona', 'WI', 'Wisconsin', 14000],
  ['Fitchburg', 'WI', 'Wisconsin', 35000],
  ['Waunakee', 'WI', 'Wisconsin', 16000],
  ['Sun Prairie', 'WI', 'Wisconsin', 36000],
  ['Monona', 'WI', 'Wisconsin', 8500],
  ['Cottage Grove', 'WI', 'Wisconsin', 8000],
  ['DeForest', 'WI', 'Wisconsin', 12000],
  ['Oregon', 'WI', 'Wisconsin', 11000],
  ['Stoughton', 'WI', 'Wisconsin', 14000],
  ['Mount Horeb', 'WI', 'Wisconsin', 8000],
  ['Cross Plains', 'WI', 'Wisconsin', 4500],
  ['Green Bay', 'WI', 'Wisconsin', 105000],
  ['Appleton', 'WI', 'Wisconsin', 75000],
  ['Eau Claire', 'WI', 'Wisconsin', 70000],
  ['Kenosha', 'WI', 'Wisconsin', 100000],
  ['Racine', 'WI', 'Wisconsin', 76000],
  ['Janesville', 'WI', 'Wisconsin', 65000],
  ['La Crosse', 'WI', 'Wisconsin', 52000],
  
  // Common ambiguous city names (exist in multiple states)
  ['Highland Park', 'IL', 'Illinois', 30000],
  ['Highland Park', 'TX', 'Texas', 9000],
  ['Highland Park', 'MI', 'Michigan', 9000],
  ['Highland Park', 'NJ', 'New Jersey', 14000],
  ['Springfield', 'IL', 'Illinois', 115000],
  ['Springfield', 'MA', 'Massachusetts', 155000],
  ['Springfield', 'MO', 'Missouri', 170000],
  ['Springfield', 'OH', 'Ohio', 58000],
  ['Portland', 'ME', 'Maine', 68000],
  ['Portland', 'OR', 'Oregon', 650000],
  ['Columbus', 'GA', 'Georgia', 200000],
  ['Columbus', 'OH', 'Ohio', 900000],
  ['Richmond', 'VA', 'Virginia', 230000],
  ['Richmond', 'CA', 'California', 116000],
  ['Aurora', 'CO', 'Colorado', 390000],
  ['Aurora', 'IL', 'Illinois', 180000],
  ['Arlington', 'TX', 'Texas', 400000],
  ['Arlington', 'VA', 'Virginia', 240000],
  ['Riverside', 'CA', 'California', 330000],
  ['Burlington', 'VT', 'Vermont', 44000],
  ['Burlington', 'NC', 'North Carolina', 55000],
  ['Lancaster', 'PA', 'Pennsylvania', 60000],
  ['Lancaster', 'CA', 'California', 175000],
  ['Lexington', 'KY', 'Kentucky', 320000],
  ['Lexington', 'MA', 'Massachusetts', 34000],
  ['Fairfield', 'CT', 'Connecticut', 61000],
  ['Fairfield', 'CA', 'California', 120000],
  ['Greenville', 'SC', 'South Carolina', 70000],
  ['Greenville', 'NC', 'North Carolina', 92000],
  ['Jackson', 'MS', 'Mississippi', 150000],
  ['Jackson', 'MI', 'Michigan', 31000],
  ['Jackson', 'TN', 'Tennessee', 68000],
  ['Franklin', 'TN', 'Tennessee', 85000],
  ['Franklin', 'MA', 'Massachusetts', 33000],
  ['Franklin', 'WI', 'Wisconsin', 36000],
  ['Georgetown', 'TX', 'Texas', 80000],
  ['Georgetown', 'KY', 'Kentucky', 36000],
  
  // More medium-sized cities
  ['St. Paul', 'MN', 'Minnesota', 310000],
  ['Ann Arbor', 'MI', 'Michigan', 120000],
  ['Boulder', 'CO', 'Colorado', 105000],
  ['Scottsdale', 'AZ', 'Arizona', 260000],
  ['Plano', 'TX', 'Texas', 290000],
  ['Irvine', 'CA', 'California', 310000],
  ['Orlando', 'FL', 'Florida', 290000],
  ['Newark', 'NJ', 'New Jersey', 280000],
  ['Honolulu', 'HI', 'Hawaii', 350000],
  ['Anchorage', 'AK', 'Alaska', 290000],
  ['Salt Lake City', 'UT', 'Utah', 200000],
  ['Boise', 'ID', 'Idaho', 235000],
  ['Birmingham', 'AL', 'Alabama', 200000],
  ['Buffalo', 'NY', 'New York', 255000],
  ['Rochester', 'NY', 'New York', 210000],
  ['New Orleans', 'LA', 'Louisiana', 390000],
  ['Providence', 'RI', 'Rhode Island', 190000],
  ['Hartford', 'CT', 'Connecticut', 120000],
  ['Spokane', 'WA', 'Washington', 220000],
  ['Tacoma', 'WA', 'Washington', 220000],
  ['Knoxville', 'TN', 'Tennessee', 190000],
  ['Chattanooga', 'TN', 'Tennessee', 180000],
];

// State name/abbreviation lookups
export const STATE_ABBR_TO_NAME: Record<string, string> = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
  'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
  'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
  'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
  'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
  'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
  'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
  'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
  'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
  'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
  'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
  'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
  'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'District of Columbia'
};

export const STATE_NAME_TO_ABBR: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_ABBR_TO_NAME).map(([abbr, name]) => [name.toLowerCase(), abbr])
);

export interface CityMatch {
  city: string;
  state: string;
  stateFull: string;
  population: number;
  matchType: 'exact' | 'fuzzy' | 'corrected';
  originalQuery: string;
}

export interface CityLookupResult {
  found: boolean;
  matches: CityMatch[];
  isAmbiguous: boolean;
  suggestedMatch: CityMatch | null;
  needsDisambiguation: boolean;
  disambiguationOptions?: Array<{ city: string; state: string; description: string }>;
}

/**
 * Normalize text for matching (lowercase, trim, remove extra spaces)
 */
function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Apply typo corrections
 */
function correctTypos(query: string): string {
  const normalized = normalize(query);
  return TYPO_CORRECTIONS[normalized] || normalized;
}

/**
 * Extract state from query if present (e.g., "Madison WI" or "Madison, Wisconsin")
 */
function extractStateFromQuery(query: string): { city: string; state: string | null } {
  const normalized = normalize(query);
  
  // Check for state abbreviation at end (e.g., "Madison WI", "Madison, WI")
  const abbrMatch = normalized.match(/^(.+?)[\s,]+([a-z]{2})$/);
  if (abbrMatch) {
    const [, cityPart, stateAbbr] = abbrMatch;
    if (STATE_ABBR_TO_NAME[stateAbbr.toUpperCase()]) {
      return { city: cityPart.trim(), state: stateAbbr.toUpperCase() };
    }
  }
  
  // Check for full state name at end (e.g., "Madison Wisconsin")
  for (const [stateName, abbr] of Object.entries(STATE_NAME_TO_ABBR)) {
    if (normalized.endsWith(stateName)) {
      const cityPart = normalized.slice(0, -stateName.length).trim().replace(/,\s*$/, '');
      return { city: cityPart, state: abbr };
    }
  }
  
  return { city: normalized, state: null };
}

/**
 * Calculate Levenshtein distance for fuzzy matching
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

/**
 * Main city lookup function
 * 
 * @param query - User input (e.g., "Nashville", "Madison WI", "Highland Park")
 * @returns Lookup result with matches and disambiguation info
 */
export function lookupCity(query: string): CityLookupResult {
  if (!query || query.trim().length < 2) {
    return {
      found: false,
      matches: [],
      isAmbiguous: false,
      suggestedMatch: null,
      needsDisambiguation: false
    };
  }
  
  const originalQuery = query;
  const { city: cityQuery, state: stateHint } = extractStateFromQuery(query);
  const correctedQuery = correctTypos(cityQuery);
  
  // Find all matching cities
  const matches: CityMatch[] = [];
  
  for (const [cityName, stateAbbr, stateFull, population] of US_CITIES) {
    const normalizedCityName = normalize(cityName);
    
    // Exact match
    if (normalizedCityName === correctedQuery) {
      // If state hint provided, only include if it matches
      if (stateHint && stateAbbr !== stateHint) continue;
      
      matches.push({
        city: cityName,
        state: stateAbbr,
        stateFull,
        population,
        matchType: correctedQuery !== cityQuery ? 'corrected' : 'exact',
        originalQuery
      });
    }
    // Fuzzy match (within 2 edit distance for longer names)
    else if (correctedQuery.length >= 4) {
      const distance = levenshteinDistance(normalizedCityName, correctedQuery);
      if (distance <= 2 && distance < normalizedCityName.length * 0.3) {
        if (stateHint && stateAbbr !== stateHint) continue;
        
        matches.push({
          city: cityName,
          state: stateAbbr,
          stateFull,
          population,
          matchType: 'fuzzy',
          originalQuery
        });
      }
    }
  }
  
  // Sort by population (larger cities first), then exact matches before fuzzy
  matches.sort((a, b) => {
    if (a.matchType === 'exact' && b.matchType !== 'exact') return -1;
    if (b.matchType === 'exact' && a.matchType !== 'exact') return 1;
    return b.population - a.population;
  });
  
  // Determine if ambiguous (same city name in multiple states)
  const uniqueCities = new Set(matches.map(m => m.city.toLowerCase()));
  const isAmbiguous = uniqueCities.size === 1 && matches.length > 1;
  
  // Build disambiguation options if needed
  let disambiguationOptions: Array<{ city: string; state: string; description: string }> | undefined;
  if (isAmbiguous) {
    disambiguationOptions = matches.slice(0, 4).map(m => ({
      city: m.city,
      state: m.state,
      description: `${m.city}, ${m.state} (${m.stateFull})`
    }));
  }
  
  return {
    found: matches.length > 0,
    matches,
    isAmbiguous,
    suggestedMatch: matches[0] || null,
    needsDisambiguation: isAmbiguous,
    disambiguationOptions
  };
}

/**
 * Check if a city is a common ambiguous name
 */
export function isAmbiguousCity(cityName: string): boolean {
  const normalized = normalize(cityName);
  const matchingCities = US_CITIES.filter(([name]) => normalize(name) === normalized);
  return matchingCities.length > 1;
}

/**
 * Get all known locations for an ambiguous city
 */
export function getAmbiguousCityOptions(cityName: string): Array<{ city: string; state: string; stateFull: string }> {
  const normalized = normalize(cityName);
  return US_CITIES
    .filter(([name]) => normalize(name) === normalized)
    .map(([city, state, stateFull]) => ({ city, state, stateFull }));
}

/**
 * Format city display string
 */
export function formatCityDisplay(city: string, state: string): string {
  return `${city}, ${state}`;
}
