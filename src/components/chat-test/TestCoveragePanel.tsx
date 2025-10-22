/**
 * Test Coverage Panel
 * Displays real-time test coverage metrics for Orchestrator vs MCP Direct modes
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import type { CoverageReport } from "@/lib/testComparison";

interface TestCoveragePanelProps {
  report: CoverageReport | null;
}

export function TestCoveragePanel({ report }: TestCoveragePanelProps) {
  if (!report) {
    return (
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-sm">📊 Test Coverage</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No test results yet. Run comprehensive tests to see coverage.
          </p>
        </CardContent>
      </Card>
    );
  }

  const orchestratorProgress = (report.orchestratorCoverage.stepsCompleted / report.orchestratorCoverage.totalSteps) * 100;
  const mcpProgress = (report.mcpCoverage.toolsCalled / report.mcpCoverage.totalTools) * 100;

  return (
    <Card className="mb-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">📊 Test Coverage Report</CardTitle>
          {report.overallPassed ? (
            <Badge variant="default" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              All Passed
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <XCircle className="h-3 w-3" />
              Some Failed
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Orchestrator Coverage */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold">Orchestrator Mode (REST)</h4>
            <span className="text-xs text-muted-foreground">
              {report.orchestratorCoverage.stepsCompleted}/{report.orchestratorCoverage.totalSteps} steps
            </span>
          </div>
          <Progress value={orchestratorProgress} className="h-2 mb-2" />
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="text-xs">
                🃏 Cards: {report.orchestratorCoverage.cardsGenerated}
              </Badge>
            </div>
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="text-xs">
                🎯 CTAs: {report.orchestratorCoverage.ctasGenerated}
              </Badge>
            </div>
          </div>
        </div>

        {/* MCP Coverage */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold">MCP Direct Mode (Tools)</h4>
            <span className="text-xs text-muted-foreground">
              {report.mcpCoverage.toolsCalled}/{report.mcpCoverage.totalTools} tools
            </span>
          </div>
          <Progress value={mcpProgress} className="h-2 mb-2" />
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="text-xs">
                ✅ Success: {report.mcpCoverage.rawResponsesReceived}
              </Badge>
            </div>
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="text-xs">
                📝 Audit: {report.mcpCoverage.auditEntriesCreated}
              </Badge>
            </div>
          </div>
        </div>

        {/* Differences */}
        {report.differences.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold mb-2">Comparisons</h4>
            <div className="space-y-1">
              {report.differences.slice(0, 3).map((diff, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs">
                  {diff.passed ? (
                    <CheckCircle2 className="h-3 w-3 text-green-500 mt-0.5" />
                  ) : (
                    <XCircle className="h-3 w-3 text-destructive mt-0.5" />
                  )}
                  <div className="flex-1">
                    <p className="font-medium">
                      {diff.orchestrator?.step || diff.mcp?.step || 'Unknown step'}
                    </p>
                    {diff.differences.length > 0 && (
                      <p className="text-muted-foreground">
                        {diff.differences[0]}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {report.differences.length > 3 && (
                <p className="text-xs text-muted-foreground">
                  +{report.differences.length - 3} more comparisons
                </p>
              )}
            </div>
          </div>
        )}

        {/* Recommendations */}
        {report.recommendations.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold mb-2">Recommendations</h4>
            <div className="space-y-1">
              {report.recommendations.map((rec, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs">
                  {rec.startsWith('✅') ? (
                    <CheckCircle2 className="h-3 w-3 text-green-500 mt-0.5" />
                  ) : (
                    <AlertTriangle className="h-3 w-3 text-amber-500 mt-0.5" />
                  )}
                  <p className="text-muted-foreground">{rec.replace(/^[✅⚠️]\s*/, '')}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
