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
        // Use your Stripe account's publishable key
        const publishableKey = "pk_test_51RujoPAaGNDlVi1kJYM8eAGJrqCRyS2o2z1d6r3zU3xJjGn3J7Xo7CvlydXvteLWQ0YqG9WyNHSjA9fGXFoq5cPE";
        
        console.log('Stripe initialization - using platform publishable key');
        
        const stripeInstance = await loadStripe(publishableKey);
        console.log('Stripe loaded successfully:', !!stripeInstance);
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