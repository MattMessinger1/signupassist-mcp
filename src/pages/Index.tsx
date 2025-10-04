import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar, Shield, DollarSign } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useState } from 'react';
import { prompts } from '@/lib/prompts';

const Index = () => {
  const [debugResult, setDebugResult] = useState<any>(null);

  const testCredDebug = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('cred-debug');
      if (error) {
        setDebugResult({ error: error.message });
      } else {
        setDebugResult(data);
      }
    } catch (err) {
      setDebugResult({ error: 'Failed to call cred-debug function' });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-16 px-4">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4">{prompts.landing.hero.title}</h1>
          <p className="text-xl text-muted-foreground mb-8">
            {prompts.landing.hero.tagline}
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Link to="/plan-builder">
              <Button size="lg" className="text-lg px-8 py-3">
                {prompts.landing.hero.createPlan}
              </Button>
            </Link>
            <Link to="/dashboard">
              <Button size="lg" variant="outline" className="text-lg px-8 py-3">
                {prompts.landing.hero.viewDashboard}
              </Button>
            </Link>
            <Link to="/credentials">
              <Button size="lg" variant="outline" className="text-lg px-8 py-3">
                {prompts.landing.hero.manageCredentials}
              </Button>
            </Link>
            <Link to="/login-test">
              <Button size="lg" variant="secondary" className="text-lg px-8 py-3">
                Test Login
              </Button>
            </Link>
            <Button size="lg" variant="secondary" className="text-lg px-8 py-3" onClick={testCredDebug}>
              Test Debug
            </Button>
          </div>
        </div>

        {debugResult && (
          <div className="mb-8 max-w-2xl mx-auto">
            <Card>
              <CardHeader>
                <CardTitle>Debug Result</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-sm bg-muted p-4 rounded overflow-auto">
                  {JSON.stringify(debugResult, null, 2)}
                </pre>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
          {[
            { icon: Calendar, ...prompts.landing.features[0] },
            { icon: Shield, ...prompts.landing.features[1] },
            { icon: DollarSign, ...prompts.landing.features[2] },
          ].map((feature, index) => (
            <Card key={index}>
              <CardHeader>
                <feature.icon className="h-8 w-8 mb-2" />
                <CardTitle>{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>{feature.description}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Index;
