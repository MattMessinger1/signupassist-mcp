# Program Mappings Builder

## Overview

The `buildProgramMappings.ts` script analyzes successful registrations from the `mandate_audit` table to build high-confidence program mappings for fast-path intent targeting.

## Purpose

This script enables Phase 4 of the intent-driven fast-path optimization:
- Reduces scrape time from 30s to 2-3s for high-intent users
- Automatically learns from successful registration patterns
- Calculates confidence scores based on historical frequency
- Extracts keywords for better intent matching

## Usage

### Basic Usage
```bash
tsx scripts/buildProgramMappings.ts
```

### Custom Output Path
```bash
tsx scripts/buildProgramMappings.ts --output=/path/to/custom_mappings.json
```

### Minimum Sample Threshold
```bash
tsx scripts/buildProgramMappings.ts --min-samples=5
```

### Combined Options
```bash
tsx scripts/buildProgramMappings.ts --output=./mappings.json --min-samples=3
```

## Output Format

The script generates a JSON file with the following structure:

```json
{
  "generated_at": "2025-01-06T12:00:00.000Z",
  "total_samples": 150,
  "mappings_count": 12,
  "min_samples": 3,
  "mappings": [
    {
      "program_ref": "309",
      "ageMin": 6,
      "ageMax": 12,
      "category": "lessons",
      "provider": "blackhawk-ski-club",
      "keywords": ["nordic", "wednesday", "kids"],
      "confidence": 0.92,
      "season": "winter",
      "samples": 45
    }
  ]
}
```

## Confidence Score Calculation

Confidence is calculated using multiple factors:
- **Frequency (60% weight)**: Higher registration count = higher confidence
- **Age data bonus (+10%)**: Programs with age data are more reliable
- **Category data bonus (+10%)**: Programs with category tags are more reliable
- **Recency bonus (+10%)**: Activity within last 6 months increases confidence

Maximum confidence: 1.0

## Data Sources

The script queries the `mandate_audit` table for records where:
- `action = 'registration_completed'`
- `program_ref IS NOT NULL`

It extracts:
- Provider/organization reference
- Program reference
- Child age from metadata
- Category from metadata
- Program name/title

## Integration

The generated mappings are automatically loaded by `intentParser.ts`:
1. On startup, checks for `mcp_server/config/program_mappings.json`
2. If found, loads mappings from file
3. Falls back to hardcoded mappings if file missing

### Manual Reload

To reload mappings without restarting:
```typescript
import { reloadProgramMappings } from '../lib/intentParser.js';
await reloadProgramMappings();
```

## Recommended Schedule

- **Initial setup**: Run once to bootstrap from existing audit logs
- **Weekly**: Update mappings to catch new programs
- **Quarterly**: Full rebuild to adjust confidence scores
- **On-demand**: After significant changes to program offerings

## Example Workflow

```bash
# 1. Check current audit log count
psql $DATABASE_URL -c "SELECT COUNT(*) FROM mandate_audit WHERE action='registration_completed';"

# 2. Build mappings with default settings
tsx scripts/buildProgramMappings.ts

# 3. Review output
cat mcp_server/config/program_mappings.json

# 4. Deploy to production
git add mcp_server/config/program_mappings.json
git commit -m "Update program mappings from audit logs"
git push
```

## Troubleshooting

### No registrations found
```
⚠️  No successful registrations found in audit logs
```
**Solution**: Run test registrations or use mock data first.

### Insufficient samples
```
⏭️  Skipping program_ref (only 2 samples)
```
**Solution**: Lower `--min-samples` threshold or wait for more registrations.

### Permission denied
```
❌ Failed to query audit logs: permission denied
```
**Solution**: Ensure `SUPABASE_SERVICE_ROLE_KEY` is set and has proper permissions.

## Monitoring

Track these metrics after deployment:
- Fast-path hit rate (% of high-intent users)
- Fast-path success rate (% proceeding with suggested program)
- Time savings (fast-path vs full scrape)
- Mapping accuracy (confidence vs actual conversion)

## Future Enhancements

- [ ] ML-based confidence scoring
- [ ] Seasonal adjustment (auto-detect registration windows)
- [ ] Multi-provider aggregation
- [ ] A/B testing different confidence thresholds
- [ ] Real-time mapping updates via webhook
