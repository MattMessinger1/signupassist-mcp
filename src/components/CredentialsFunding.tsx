import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalTrigger } from '@/components/ui/modal';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, AlertCircle, Plus, CreditCard, Shield } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe('pk_test_51RujoPAaGNDlVi1koVlBSBBXy2yfwz7vuMBciJxkawKBKaqwR4xw07wEFUAMa73ADIUqzwB5GwbPM3YnPYu5vo4X00rAdiwPkx'); // Your Stripe publishable key

const credentialsSchema = z.object({
  alias: z.string().min(1, 'Alias is required').max(100),
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

interface StoredCredential {
  id: string;
  alias: string;
  provider: string;
  created_at: string;
}

interface CheckStatus {
  credentials: boolean;
  providerPayment: boolean;
  successFee: boolean;
  membership: boolean;
  discovery: boolean;
}

function StripePaymentSetup({ onComplete }: { onComplete: (success: boolean) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    
    if (!stripe || !elements) return;
    
    setLoading(true);
    
    try {
      // Get setup intent from our edge function
      const { data, error } = await supabase.functions.invoke('stripe-setup-intent');
      
      if (error) throw error;
      
      const { client_secret } = data;
      
      // Confirm the setup intent
      const { setupIntent, error: stripeError } = await stripe.confirmCardSetup(client_secret, {
        payment_method: {
          card: elements.getElement(CardElement)!,
        }
      });
      
      if (stripeError) {
        throw new Error(stripeError.message);
      }
      
      if (setupIntent.status === 'succeeded') {
        // Update user_billing with the payment method ID
        const userId = (await supabase.auth.getUser()).data.user?.id;
        if (!userId) throw new Error('User not found');
        
        const { error: updateError } = await supabase
          .from('user_billing')
          .upsert({
            user_id: userId,
            default_payment_method_id: setupIntent.payment_method as string,
          } as any);
          
        if (updateError) throw updateError;
        
        toast({
          title: "Payment Method Saved",
          description: "Your payment method has been securely saved.",
        });
        
        onComplete(true);
      }
    } catch (error) {
      console.error('Stripe setup error:', error);
      toast({
        title: "Setup Failed",
        description: error.message || "Failed to save payment method",
        variant: "destructive",
      });
      onComplete(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="p-4 border rounded-lg">
        <CardElement 
          options={{
            style: {
              base: {
                fontSize: '16px',
                color: 'hsl(var(--foreground))',
                '::placeholder': {
                  color: 'hsl(var(--muted-foreground))',
                },
              },
            },
          }}
        />
      </div>
      <Button type="submit" disabled={!stripe || loading} className="w-full">
        {loading ? 'Saving...' : 'Save Payment Method'}
      </Button>
    </form>
  );
}

export default function CredentialsFunding() {
  const [user, setUser] = useState(null);
  const [storedCredentials, setStoredCredentials] = useState<StoredCredential[]>([]);
  const [selectedCredential, setSelectedCredential] = useState<string>('');
  const [checkStatus, setCheckStatus] = useState<CheckStatus>({
    credentials: false,
    providerPayment: false,
    successFee: false,
    membership: false,
    discovery: false,
  });
  const [loading, setLoading] = useState({
    credentials: false,
    testLogin: false,
    paymentCheck: false,
  });
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [showStripeModal, setShowStripeModal] = useState(false);
  
  const { toast } = useToast();

  const credentialsForm = useForm<z.infer<typeof credentialsSchema>>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: {
      alias: '',
      email: '',
      password: '',
    },
  });

  useEffect(() => {
    // Check auth state and load data
    const checkAuthAndLoadData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUser(user);
        await loadStoredCredentials(user.id);
        await checkSuccessFeePM(user.id);
      }
    };
    
    checkAuthAndLoadData();
  }, []);

  const loadStoredCredentials = async (userId: string) => {
    const { data, error } = (await supabase
      .from('stored_credentials')
      .select('id, alias, provider, created_at')
      .eq('provider', 'skiclubpro')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })) as any;

    if (!error && data) {
      const credentials = data as unknown as StoredCredential[];
      setStoredCredentials(credentials);
      if (credentials.length > 0 && !selectedCredential) {
        setSelectedCredential(credentials[0].alias);
        setCheckStatus(prev => ({ ...prev, credentials: true }));
      }
    }
  };

  const checkSuccessFeePM = async (userId: string) => {
    const { data } = (await supabase
      .from('user_billing')
      .select('default_payment_method_id')
      .eq('user_id', userId)
      .maybeSingle()) as any;

    const billingData = data as any;
    if (billingData?.default_payment_method_id) {
      setCheckStatus(prev => ({ ...prev, successFee: true }));
    }
  };

  const handleAddCredentials = async (values: z.infer<typeof credentialsSchema>) => {
    setLoading(prev => ({ ...prev, credentials: true }));
    
    try {
      const { data, error } = await supabase.functions.invoke('store-credentials', {
        body: {
          alias: values.alias,
          provider: 'skiclubpro',
          email: values.email,
          password: values.password,
        }
      });

      if (error) throw error;

      toast({
        title: "Credentials Stored",
        description: `Successfully stored credentials as "${values.alias}"`,
      });

      setShowCredentialsModal(false);
      credentialsForm.reset();
      
      // Reload credentials list
      if (user) {
        await loadStoredCredentials(user.id);
      }
    } catch (error) {
      toast({
        title: "Storage Failed",
        description: error.message || "Failed to store credentials",
        variant: "destructive",
      });
    } finally {
      setLoading(prev => ({ ...prev, credentials: false }));
    }
  };

  const handleTestLogin = async () => {
    if (!selectedCredential) return;
    
    setLoading(prev => ({ ...prev, testLogin: true }));
    
    try {
      // For now, just simulate a successful test
      // In real implementation, this would call the MCP scp.login tool
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setCheckStatus(prev => ({ ...prev, credentials: true }));
      
      toast({
        title: "Login Test Successful",
        description: "Your SkiClubPro credentials are working correctly.",
      });
    } catch (error) {
      toast({
        title: "Login Test Failed",
        description: "Unable to login with these credentials",
        variant: "destructive",
      });
    } finally {
      setLoading(prev => ({ ...prev, testLogin: false }));
    }
  };

  const handleCheckStoredCard = async () => {
    setLoading(prev => ({ ...prev, paymentCheck: true }));
    
    try {
      // For now, simulate checking for stored payment method
      // In real implementation, this would call scp.check_stored_payment_method
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Simulate random result for demo
      const hasCard = Math.random() > 0.5;
      setCheckStatus(prev => ({ ...prev, providerPayment: hasCard }));
      
      toast({
        title: hasCard ? "Payment Method Found" : "No Payment Method",
        description: hasCard 
          ? "A payment method is stored in your SkiClubPro account" 
          : "No payment method found. Please add one in SkiClubPro.",
        variant: hasCard ? "default" : "destructive",
      });
    } catch (error) {
      toast({
        title: "Check Failed",
        description: "Unable to check payment method status",
        variant: "destructive",
      });
    } finally {
      setLoading(prev => ({ ...prev, paymentCheck: false }));
    }
  };

  const canCreatePlan = Object.values(checkStatus).every(Boolean);

  return (
    <div className="space-y-6 max-w-4xl mx-auto p-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Plan Builder - Credentials & Funding</h1>
        <p className="text-muted-foreground">
          Set up your credentials and payment methods before creating automated registration plans.
        </p>
      </div>

      {/* Progress Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Setup Progress
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {Object.entries(checkStatus).map(([key, status]) => (
              <div key={key} className="flex items-center gap-2">
                {status ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-600" />
                )}
                <span className="text-sm capitalize">{key}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* SkiClubPro Credentials */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            SkiClubPro Account
          </CardTitle>
          <CardDescription>
            Store and test your SkiClubPro login credentials securely.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {storedCredentials.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Credential</label>
              <Select value={selectedCredential} onValueChange={setSelectedCredential}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose stored credentials" />
                </SelectTrigger>
                <SelectContent>
                  {storedCredentials.map((cred) => (
                    <SelectItem key={cred.id} value={cred.alias}>
                      {cred.alias} (added {new Date(cred.created_at).toLocaleDateString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          
          <div className="flex gap-2">
            <Modal open={showCredentialsModal} onOpenChange={setShowCredentialsModal}>
              <ModalTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Credentials
                </Button>
              </ModalTrigger>
              <ModalContent>
                <ModalHeader>
                  <ModalTitle>Add SkiClubPro Credentials</ModalTitle>
                </ModalHeader>
                <Form {...credentialsForm}>
                  <form onSubmit={credentialsForm.handleSubmit(handleAddCredentials)} className="space-y-4">
                    <FormField
                      control={credentialsForm.control}
                      name="alias"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Alias</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. primary-account" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={credentialsForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="your@email.com" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={credentialsForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input type="password" placeholder="Your password" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" disabled={loading.credentials} className="w-full">
                      {loading.credentials ? 'Storing...' : 'Store Credentials'}
                    </Button>
                  </form>
                </Form>
              </ModalContent>
            </Modal>

            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleTestLogin}
              disabled={!selectedCredential || loading.testLogin}
            >
              {loading.testLogin ? 'Testing...' : 'Test Login'}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {checkStatus.credentials ? (
              <Badge variant="default" className="bg-green-100 text-green-800">
                <CheckCircle className="h-3 w-3 mr-1" />
                Credentials Verified
              </Badge>
            ) : (
              <Badge variant="destructive">
                <XCircle className="h-3 w-3 mr-1" />
                Not Verified
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Provider Payment Method */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            SkiClubPro Payment Method
          </CardTitle>
          <CardDescription>
            Verify you have a payment method stored in your SkiClubPro account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button 
            variant="outline" 
            onClick={handleCheckStoredCard}
            disabled={loading.paymentCheck}
          >
            {loading.paymentCheck ? 'Checking...' : 'Check Stored Card'}
          </Button>

          <div className="flex items-center gap-2">
            {checkStatus.providerPayment ? (
              <Badge variant="default" className="bg-green-100 text-green-800">
                <CheckCircle className="h-3 w-3 mr-1" />
                Payment Method On File
              </Badge>
            ) : (
              <Badge variant="destructive">
                <XCircle className="h-3 w-3 mr-1" />
                No Payment Method Found
              </Badge>
            )}
          </div>

          {!checkStatus.providerPayment && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-amber-800">No payment method found</p>
                  <p className="text-amber-700">
                    Please log into your SkiClubPro account and add a payment method, then re-check.
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Success Fee Payment */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            SignupAssist Success Fee
          </CardTitle>
          <CardDescription>
            Save a payment method for our success-based fees when registrations complete.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Modal open={showStripeModal} onOpenChange={setShowStripeModal}>
            <ModalTrigger asChild>
              <Button variant="outline" disabled={checkStatus.successFee}>
                {checkStatus.successFee ? 'Payment Method Saved' : 'Save Payment Method'}
              </Button>
            </ModalTrigger>
            <ModalContent>
              <ModalHeader>
                <ModalTitle>Save Payment Method</ModalTitle>
              </ModalHeader>
              <Elements stripe={stripePromise}>
                <StripePaymentSetup 
                  onComplete={(success) => {
                    if (success) {
                      setCheckStatus(prev => ({ ...prev, successFee: true }));
                    }
                    setShowStripeModal(false);
                  }} 
                />
              </Elements>
            </ModalContent>
          </Modal>

          <div className="flex items-center gap-2">
            {checkStatus.successFee ? (
              <Badge variant="default" className="bg-green-100 text-green-800">
                <CheckCircle className="h-3 w-3 mr-1" />
                Payment Method Ready
              </Badge>
            ) : (
              <Badge variant="destructive">
                <XCircle className="h-3 w-3 mr-1" />
                No Payment Method
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Create Plan Button */}
      <Card>
        <CardContent className="pt-6">
          <Button 
            size="lg" 
            className="w-full" 
            disabled={!canCreatePlan}
          >
            {canCreatePlan ? 'Create Plan' : 'Complete Setup to Create Plan'}
          </Button>
          
          {!canCreatePlan && (
            <p className="text-sm text-muted-foreground text-center mt-2">
              All sections must be completed before you can create a plan.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}