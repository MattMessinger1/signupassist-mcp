import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex items-center justify-center min-h-[400px] p-4">
          <Alert variant="destructive" className="max-w-2xl">
            <AlertTriangle className="h-5 w-5" />
            <AlertTitle className="text-lg font-semibold">Something went wrong</AlertTitle>
            <AlertDescription className="space-y-4">
              <p className="text-sm">
                The application encountered an error. Please try refreshing the page.
              </p>
              {this.state.error && (
                <details className="text-xs bg-muted p-2 rounded">
                  <summary className="cursor-pointer font-medium hover:underline">
                    Error details
                  </summary>
                  <pre className="mt-2 overflow-auto">
                    {this.state.error.message}
                  </pre>
                </details>
              )}
              <Button onClick={this.handleReset} className="mt-2">
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh Page
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    return this.props.children;
  }
}
