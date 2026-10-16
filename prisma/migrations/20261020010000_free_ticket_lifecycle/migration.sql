-- T13: free registrations are fulfilled at checkout, without Stripe.
ALTER TYPE "OrderLifecycleEventType" ADD VALUE 'free_fulfilled';
