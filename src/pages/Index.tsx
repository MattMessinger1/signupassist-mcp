import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar, Shield, DollarSign } from 'lucide-react';

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-16 px-4">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4">SignupAssist</h1>
          <p className="text-xl text-muted-foreground mb-8">
            Automated registration for your children's programs
          </p>
          <Link to="/plan-builder">
            <Button size="lg" className="text-lg px-8 py-3">
              Create Signup Plan
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
          <Card>
            <CardHeader>
              <Calendar className="h-8 w-8 mb-2" />
              <CardTitle>Never Miss Registration</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Set up automated registration that runs exactly when registration opens, 
                even if you're sleeping or busy.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Shield className="h-8 w-8 mb-2" />
              <CardTitle>Secure & Trusted</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Your credentials are encrypted and stored securely. We only access your 
                account to complete the specific registration you authorized.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <DollarSign className="h-8 w-8 mb-2" />
              <CardTitle>Pay Only on Success</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                $20 service fee charged only when we successfully register your child. 
                No hidden fees or subscriptions.
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Index;
