/**
 * Payment Guardrails - Prevent discovery from crossing payment boundaries
 * 
 * Provides pre-click and post-click safety checks to ensure we never
 * accidentally submit payment forms or navigate to payment pages.
 */

import { Page, Locator } from 'playwright';

/**
 * Check if a button/element appears to be a payment submission button
 */
export async function isPaymentButton(locator: Locator): Promise<boolean> {
  try {
    // Get text content
    const text = await locator.textContent().catch(() => '');
    const lowerText = (text || '').toLowerCase();
    
    // Payment button text patterns
    const paymentTextPatterns = [
      /pay\s*(now)?/i,
      /purchase/i,
      /checkout/i,
      /place\s*order/i,
      /complete\s*payment/i,
      /buy\s*now/i,
      /submit\s*payment/i,
      /confirm\s*purchase/i,
      /finalize/i,
      /add\s*to\s*cart/i
    ];
    
    if (paymentTextPatterns.some(rx => rx.test(lowerText))) {
      console.log('[Guardrails] Payment button detected by text:', lowerText);
      return true;
    }
    
    // Check attributes for payment indicators
    const id = await locator.getAttribute('id').catch(() => '');
    const className = await locator.getAttribute('class').catch(() => '');
    const name = await locator.getAttribute('name').catch(() => '');
    const type = await locator.getAttribute('type').catch(() => '');
    
    const attrs = `${id} ${className} ${name} ${type}`.toLowerCase();
    
    if (attrs.includes('payment') || attrs.includes('checkout') || attrs.includes('purchase')) {
      return true;
    }
    
    // Check for nearby price indicators (within 200px)
    const box = await locator.boundingBox().catch(() => null);
    if (box) {
      const nearbyText = await locator.page()
        .locator('text=/\\$\\d+|€\\d+|£\\d+|\\d+\\.\\d{2}/')
        .all();
      
      for (const priceEl of nearbyText) {
        const priceBox = await priceEl.boundingBox().catch(() => null);
        if (priceBox) {
          const distance = Math.sqrt(
            Math.pow(box.x - priceBox.x, 2) + 
            Math.pow(box.y - priceBox.y, 2)
          );
          if (distance < 200) {
            return true;
          }
        }
      }
    }
    
    return false;
  } catch (err) {
    console.warn('[Guardrails] Error checking payment button:', err);
    return false;
  }
}

/**
 * Check if the current page appears to be a payment page
 */
export async function pageIndicatesPayment(page: Page): Promise<boolean> {
  try {
    const url = page.url().toLowerCase();
    
    // URL-based detection
    const paymentUrlPatterns = [
      /checkout/i,
      /payment/i,
      /billing/i,
      /cart/i,
      /order\/confirm/i,
      /purchase/i
    ];
    
    if (paymentUrlPatterns.some(rx => rx.test(url))) {
      console.log('[Guardrails] Payment URL detected:', url);
      return true;
    }
    
    // Check for Stripe Elements (iframe with stripe in src)
    const stripeFrames = page.frames().filter(f => 
      f.url().includes('stripe.com') || f.url().includes('stripe.js')
    );
    if (stripeFrames.length > 0) {
      console.log('[Guardrails] Stripe Elements detected');
      return true;
    }
    
    // Check body text for payment indicators
    const bodyText = await page.textContent('body').catch(() => '');
    const lowerBody = bodyText.toLowerCase();
    
    const paymentBodyPatterns = [
      /enter\s*(your\s*)?credit\s*card/i,
      /card\s*number/i,
      /cvv/i,
      /expiration\s*date/i,
      /billing\s*information/i,
      /payment\s*method/i,
      /total\s*amount.*\$\d+/i,
      /order\s*total/i,
      /complete\s*(your\s*)?purchase/i
    ];
    
    if (paymentBodyPatterns.some(rx => rx.test(lowerBody))) {
      console.log('[Guardrails] Payment content detected in page body');
      return true;
    }
    
    // Check for common payment form fields
    const hasCardNumberField = await page.locator('input[name*="card"], input[id*="card"], input[placeholder*="card number"]').count() > 0;
    const hasCVVField = await page.locator('input[name*="cvv"], input[id*="cvv"], input[placeholder*="cvv"]').count() > 0;
    
    if (hasCardNumberField || hasCVVField) {
      console.log('[Guardrails] Payment form fields detected');
      return true;
    }
    
    return false;
  } catch (err) {
    console.warn('[Guardrails] Error checking payment page:', err);
    return false;
  }
}

/**
 * Evidence capture for payment stops
 */
export interface PaymentStopEvidence {
  url: string;
  timestamp: string;
  reason: 'payment_button' | 'payment_page';
  buttonText?: string;
  pageTitle?: string;
  screenshot?: string; // base64 if needed
}

export async function capturePaymentEvidence(
  page: Page,
  reason: 'payment_button' | 'payment_page',
  buttonText?: string
): Promise<PaymentStopEvidence> {
  return {
    url: page.url(),
    timestamp: new Date().toISOString(),
    reason,
    buttonText,
    pageTitle: await page.title().catch(() => 'Unknown')
  };
}
