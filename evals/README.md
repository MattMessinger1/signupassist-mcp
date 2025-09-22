# Evaluation Framework

This directory contains comprehensive evaluation scripts for SignupAssist-MCP. Each script measures key metrics that directly map to our value propositions and revenue model.

## Evaluation Scripts

### 1. Coverage Evaluation (`coverage_eval.py`)
**Purpose**: Tests each provider's MCP tools to ensure they work correctly.

**Metrics**:
- Coverage Score = # working providers ÷ # targeted providers
- Tool-level success rates (login, register, check_availability)
- Provider-specific reliability

**Maps to Value Prop**: Validates that our "Set & Forget" promise works across all supported platforms.

**How to Run**:
```bash
python evals/coverage_eval.py
```

**CI Integration**: Fails if coverage drops below 80%

---

### 2. Performance Evaluation (`performance_eval.py`)
**Purpose**: Measures signup latency from scheduled trigger to confirmation.

**Metrics**:
- Win Rate = successful signups ÷ total attempts
- Median completion time
- 95th percentile latency
- Scheduling precision (delay from target time)

**Maps to Value Prop**: Validates "Fast Competitive Signup" by measuring how quickly we can complete signups when they open.

**How to Run**:
```bash
python evals/performance_eval.py
```

**CI Integration**: Fails if win rate drops below 85%

---

### 3. Convenience Evaluation (`convenience_eval.py`)
**Purpose**: Tracks reuse of stored credentials across signups.

**Metrics**:
- Reuse Rate = # signups using stored credentials ÷ total signups
- User segments (power users vs new users)
- Credential efficiency rates

**Maps to Value Prop**: Validates "Credential Reuse" convenience feature that saves parents time.

**How to Run**:
```bash
python evals/convenience_eval.py
```

**CI Integration**: Fails if reuse rate drops below 60%

---

### 4. Reliability Evaluation (`reliability_eval.py`)
**Purpose**: Logs failures, retries, and manual interventions.

**Metrics**:
- Failure Rate = failed attempts ÷ total attempts
- MTBF (Mean Time Between Failures)
- Manual intervention rate
- Recovery time analysis

**Maps to Value Prop**: Ensures our automation is reliable enough for parents to trust with their children's signups.

**How to Run**:
```bash
python evals/reliability_eval.py
```

**CI Integration**: Fails if success rate drops below 85%

---

### 5. Billing Evaluation (`billing_eval.py`)
**Purpose**: Ensures every successful signup triggers exactly one Stripe charge.

**Metrics**:
- Billing Alignment Rate = correctly billed signups ÷ successful signups
- Revenue accuracy (expected vs actual)
- Billing timing analysis

**Maps to Revenue Model**: Critical for our "only pay for success" model. We must never charge for failures and always charge for successes.

**How to Run**:
```bash
python evals/billing_eval.py
```

**CI Integration**: Fails if billing alignment drops below 95%

## Running All Evaluations

To run all evaluations and generate a comprehensive report:

```bash
# Run all evaluations
python evals/coverage_eval.py
python evals/performance_eval.py  
python evals/convenience_eval.py
python evals/reliability_eval.py
python evals/billing_eval.py

# Results are saved as timestamped JSON files
ls -la *_results_*.json
```

## CI/CD Integration

Each evaluation script returns appropriate exit codes for CI systems:
- **Exit 0**: All metrics meet thresholds ✅
- **Exit 1**: One or more metrics below threshold ❌

### GitHub Actions Example

```yaml
name: SignupAssist Evaluations
on: [push, pull_request]

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.9'
      
      - name: Run Coverage Eval
        run: python evals/coverage_eval.py
      
      - name: Run Performance Eval  
        run: python evals/performance_eval.py
        
      - name: Run Convenience Eval
        run: python evals/convenience_eval.py
        
      - name: Run Reliability Eval
        run: python evals/reliability_eval.py
        
      - name: Run Billing Eval
        run: python evals/billing_eval.py
```

## Metrics Thresholds

| Metric | Threshold | Business Impact |
|--------|-----------|------------------|
| Coverage Score | ≥80% | Can't promise "Set & Forget" if tools don't work |
| Win Rate | ≥85% | Parents won't pay if we can't get their kids signed up |
| Reuse Rate | ≥60% | Low reuse means poor user experience |
| Success Rate | ≥85% | High failure rate damages trust and reputation |
| Billing Alignment | ≥95% | Revenue accuracy is critical for business viability |

## Monitoring & Alerts

In production, these evaluations should run:
- **Hourly**: During peak signup seasons (summer camp registration, etc.)
- **Daily**: During normal periods
- **On-demand**: Before major releases or after provider updates

Set up alerts when metrics drop below thresholds to enable rapid response.

## Continuous Improvement

Use evaluation results to:

1. **Identify Problem Providers**: Focus engineering efforts on providers with low coverage/performance
2. **Optimize Billing**: Ensure revenue model sustainability
3. **Improve UX**: Track convenience metrics to guide product development  
4. **Build Trust**: Maintain high reliability to justify "Set & Forget" positioning

## Data Retention

Evaluation results are stored as timestamped JSON files for trend analysis. Consider:
- Archiving results older than 90 days
- Maintaining monthly aggregated summaries for long-term trend tracking
- Exporting key metrics to business intelligence dashboards