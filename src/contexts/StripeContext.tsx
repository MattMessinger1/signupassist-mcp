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
        // Get publishable key from localStorage (set by the modal)
        const publishableKey = localStorage.getItem('stripe_publishable_key');
        
        console.log('Stripe initialization - key from localStorage:', publishableKey ? `${publishableKey.substring(0, 10)}...` : 'null');
        
        if (!publishableKey) {
          console.warn('No Stripe publishable key found. Please set one using the modal.');
          setLoading(false);
          return;
        }

        if (!publishableKey.startsWith('pk_')) {
          console.error('Invalid publishable key format. Must start with pk_');
          setLoading(false);
          return;
        }

        console.log('Loading Stripe with key...');
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