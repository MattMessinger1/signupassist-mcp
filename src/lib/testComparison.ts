/**
 * Test Result Comparison System
 * Tracks and compares results from Orchestrator vs MCP Direct modes
 */

export interface TestResult {
  mode: 'orchestrator' | 'mcp-direct';
  step: string;
  input: any;
  output: any;
  timing: number;
  errors: string[];
  timestamp: Date;
}

export interface TestComparison {
  orchestrator?: TestResult;
  mcp?: TestResult;
  differences: string[];
  passed: boolean;
}

export interface CoverageReport {
  orchestratorCoverage: {
    stepsCompleted: number;
    totalSteps: number;
    cardsGenerated: number;
    ctasGenerated: number;
  };
  mcpCoverage: {
    toolsCalled: number;
    totalTools: number;
    auditEntriesCreated: number;
    rawResponsesReceived: number;
  };
  differences: TestComparison[];
  recommendations: string[];
  overallPassed: boolean;
}

export class TestComparisonTracker {
  private results: TestResult[] = [];
  private comparisons: Map<string, TestComparison> = new Map();

  /**
   * Add a test result
   */
  addResult(result: TestResult): void {
    this.results.push(result);
    console.log(`[TestComparison] Added ${result.mode} result for step: ${result.step}`);
  }

  /**
   * Compare orchestrator vs MCP results for a given step
   */
  compareStep(stepName: string): TestComparison | null {
    const orchestratorResult = this.results.find(
      r => r.step === stepName && r.mode === 'orchestrator'
    );
    const mcpResult = this.results.find(
      r => r.step === stepName && r.mode === 'mcp-direct'
    );

    if (!orchestratorResult && !mcpResult) {
      return null;
    }

    const differences: string[] = [];
    let passed = true;

    // Compare outputs
    if (orchestratorResult && mcpResult) {
      // Check if orchestrator has UI components (expected)
      if (!orchestratorResult.output.cards && !orchestratorResult.output.message) {
        differences.push('Orchestrator missing UI components');
        passed = false;
      }

      // Check if MCP has raw tool data (expected)
      if (!mcpResult.output.success && !mcpResult.output.data) {
        differences.push('MCP missing tool response data');
        passed = false;
      }

      // Compare timing
      if (Math.abs(orchestratorResult.timing - mcpResult.timing) > 5000) {
        differences.push(`Large timing difference: ${Math.abs(orchestratorResult.timing - mcpResult.timing)}ms`);
      }

      // Compare errors
      if (orchestratorResult.errors.length !== mcpResult.errors.length) {
        differences.push(`Error count mismatch: Orchestrator ${orchestratorResult.errors.length}, MCP ${mcpResult.errors.length}`);
      }
    }

    const comparison: TestComparison = {
      orchestrator: orchestratorResult,
      mcp: mcpResult,
      differences,
      passed,
    };

    this.comparisons.set(stepName, comparison);
    return comparison;
  }

  /**
   * Generate comprehensive coverage report
   */
  generateReport(): CoverageReport {
    const orchestratorResults = this.results.filter(r => r.mode === 'orchestrator');
    const mcpResults = this.results.filter(r => r.mode === 'mcp-direct');

    // Count orchestrator metrics
    let cardsGenerated = 0;
    let ctasGenerated = 0;
    orchestratorResults.forEach(r => {
      if (r.output.cards) cardsGenerated += r.output.cards.length;
      if (r.output.cta) ctasGenerated += r.output.cta.length;
    });

    // Count MCP metrics
    const toolsCalled = new Set(mcpResults.map(r => r.step)).size;
    const rawResponsesReceived = mcpResults.filter(r => r.output.success).length;

    // Compare all steps
    const allSteps = new Set([
      ...orchestratorResults.map(r => r.step),
      ...mcpResults.map(r => r.step),
    ]);

    const differences: TestComparison[] = [];
    allSteps.forEach(step => {
      const comparison = this.compareStep(step);
      if (comparison) {
        differences.push(comparison);
      }
    });

    // Generate recommendations
    const recommendations: string[] = [];
    
    if (cardsGenerated === 0) {
      recommendations.push('⚠️ No UI cards generated in orchestrator mode - check card generation logic');
    }
    
    if (rawResponsesReceived === 0) {
      recommendations.push('⚠️ No successful MCP tool responses - check tool implementation');
    }

    if (orchestratorResults.some(r => r.errors.length > 0)) {
      recommendations.push('⚠️ Orchestrator mode has errors - review error handling');
    }

    if (mcpResults.some(r => r.errors.length > 0)) {
      recommendations.push('⚠️ MCP Direct mode has errors - review tool responses');
    }

    const overallPassed = differences.every(d => d.passed);

    if (overallPassed) {
      recommendations.push('✅ All tests passed - both modes working correctly');
    }

    return {
      orchestratorCoverage: {
        stepsCompleted: orchestratorResults.length,
        totalSteps: allSteps.size,
        cardsGenerated,
        ctasGenerated,
      },
      mcpCoverage: {
        toolsCalled,
        totalTools: allSteps.size,
        auditEntriesCreated: 0, // Would need to query DB for this
        rawResponsesReceived,
      },
      differences,
      recommendations,
      overallPassed,
    };
  }

  /**
   * Clear all results
   */
  clear(): void {
    this.results = [];
    this.comparisons.clear();
  }

  /**
   * Get all results
   */
  getResults(): TestResult[] {
    return [...this.results];
  }

  /**
   * Get all comparisons
   */
  getComparisons(): TestComparison[] {
    return Array.from(this.comparisons.values());
  }
}
