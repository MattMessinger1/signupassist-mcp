import { Refunds, DENIAL_MESSAGES } from '@mattmessinger/refund-guard';

export const refundGuard = new Refunds({
  skus: {
    success_fee: { refund_window_days: 90 },
  },
});

export { DENIAL_MESSAGES };
