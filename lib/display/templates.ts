import type { ReasonCode } from '../contracts/assess';

type Template = { title: string; nextStep: string };

/** Fixed explanation text per reason. Model output never supplies wording, only evidence. */
export const REASON_TEMPLATES = {
  payment_before_viewing: {
    title: 'Payment requested before viewing',
    nextStep: 'Do not pay a deposit or transfer money before you have seen the car and its documents in person.',
  },
  shipping_only: {
    title: 'Delivery-only sale',
    nextStep: 'Ask to view the car in person before paying anything. Be wary of shipping-only offers.',
  },
  mileage_mismatch: {
    title: 'Mileage does not match',
    nextStep: 'Ask the seller which mileage is right, and for NCT or service records that show it.',
  },
  year_mismatch: {
    title: 'Year does not match',
    nextStep: 'Ask to see the registration certificate to confirm the year.',
  },
  fuel_mismatch: {
    title: 'Fuel type does not match',
    nextStep: 'Ask the seller to confirm the engine and fuel type.',
  },
  transmission_mismatch: {
    title: 'Gearbox does not match',
    nextStep: 'Ask whether the car is manual or automatic.',
  },
  private_seller_business_wording: {
    title: 'Private ad with trade wording',
    nextStep: 'Ask whether you are buying from a private individual or a business. Your consumer rights differ.',
  },
  service_history_conflict: {
    title: 'Service history statements conflict',
    nextStep: 'Ask to see the service book or receipts.',
  },
} as const satisfies Record<ReasonCode, Template>;
