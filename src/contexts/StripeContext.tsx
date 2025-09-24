import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { loadStripe, Stripe } from '@stripe/stripe-js';

interface StripeContextType {
  stripe: Stripe | null;
  loading: boolean;
}

const StripeContext = createContext<StripeContextType>({ stripe: null, loading: true });

export const useStripe = () => useContext(StripeContext);

interface StripeProviderProps {
  children: ReactNode;
}

export const StripeProvider: React.FC<StripeProviderProps> = ({ children }) => {
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initializeStripe = async () => {
      try {
        // Using Stripe publishable key - this is safe to expose in frontend
        const stripeInstance = await loadStripe('pk_test_51QaUhLLyGRQVXFaLxe3Ygv0wfVr8z6FTKFqCJ9Lw6dAI1PTWT1NCGSSHDhtYN8lFyR35gKP5CJH8djqXEp3qfaLp00XFMN5cPE');
        setStripe(stripeInstance);
      } catch (error) {
        console.error('Failed to initialize Stripe:', error);
      } finally {
        setLoading(false);
      }
    };

    initializeStripe();
  }, []);

  return (
    <StripeContext.Provider value={{ stripe, loading }}>
      {children}
    </StripeContext.Provider>
  );
};