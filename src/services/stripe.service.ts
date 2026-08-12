import Stripe from 'stripe';
import { env } from '~/services/env';
import { User, Workspace } from './NewMongoTypes';
import { readminCollections } from '~/services/mongo.service';

// If Stripe is not configured, export a harmless stub so the rest of the
// codebase can import stripe.service without runtime errors. Billing-related
// flows should check `env.STRIPE_PUBLIC` / `env.STRIPE_SECRET` and behave
// accordingly (disabled when unset).
let stripeService: any = null;
if (env.STRIPE_SECRET && env.STRIPE_SECRET.trim() !== '') {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  stripeService = new Stripe(env.STRIPE_SECRET, {
    //@ts-expect-error ok
    apiVersion: null,
  });
} else {
  // Minimal stub matching the nested shape used by the app. Methods return
  // safe no-op values (empty arrays / null urls / empty objects).
  stripeService = {
    customers: {
      retrieve: async (_: string) => ({}),
      update: async (_: string, __: any) => ({}),
      create: async (_: any) => ({ id: '' }),
    },
    billing: {
      meters: {
        list: async (_: any) => ({ data: [], has_more: false }),
        create: async (_: any) => null,
      },
    },
    prices: {
      list: async (_: any) => ({ data: [], has_more: false }),
      create: async (_: any) => ({}),
      update: async (_: string, __: any) => ({}),
    },
    checkout: {
      sessions: {
        create: async (_: any) => ({ url: null }),
      },
    },
    billingPortal: {
      sessions: {
        create: async (_: any) => ({ url: null }),
      },
    },
    subscriptions: {
      list: async (_: any) => ({ data: [] }),
      update: async (_: string, __: any) => ({}),
    },
  };
}

export const reAdminProductId = env.STRIPE_PUBLIC && env.STRIPE_PUBLIC.startsWith('pk_test') ? 'prod_P1vkRDvQJs3thH' : 'prod_P22XA4AaEGIGs7'
export const reAdminSubcriptionId = env.STRIPE_PUBLIC && env.STRIPE_PUBLIC.startsWith('pk_test') ? 'price_1ODrsgFQlpJ67TzVZXg7ZMUP' : 'price_1ODyS0FQlpJ67TzVpN1Haz1M'
export const reAdminUsageSubcriptionId = env.STRIPE_PUBLIC && env.STRIPE_PUBLIC.startsWith('pk_test') ? 'price_1OLJmhFQlpJ67TzVs1AzzhH8' : 'price_1OLJlfFQlpJ67TzV460ezTYC'

// If Stripe is disabled, updateStripeUser is a no-op so login/session
// creation doesn't fail.
export async function updateStripeUser(
  user: User
): Promise<any> {
  if (!env.STRIPE_PUBLIC || !env.STRIPE_SECRET) {
    return {} as any;
  }

  const isTesting = env.STRIPE_PUBLIC.startsWith('pk_test');
  const userObject = {
    name: user.name,
    ...user?.email ? { email: user.email } : {},
  }
  if (isTesting) {
    if (user.testStripeId) {
      try {
        const existing = await stripeService.customers.retrieve(user.testStripeId);
        await stripeService.customers.update(existing.id, userObject);
        return existing;
      } catch (e) {

      }
    }
    const created = await stripeService.customers.create(userObject);
    if (created.id) {
      await readminCollections.user.updateOne({ robloxId: user.robloxId }, { $set: { testStripeId: created.id } });
    }
    return created;
  }
  if (user.stripeId) {
    try {
      const existing = await stripeService.customers.retrieve(user.stripeId);
      await stripeService.customers.update(existing.id, userObject);
      return existing;
    } catch (e) {

    }
  }
  const created = await stripeService.customers.create(userObject);
  if (created.id) {
    await readminCollections.user.updateOne({ robloxId: user.robloxId }, { $set: { stripeId: created.id } });
  }
  return created;
}

export async function findMeterOrCreate(workspace: Workspace, second = false): Promise<any | null> {
  if (!env.STRIPE_PUBLIC || !env.STRIPE_SECRET) {
    // Stripe disabled — return null so callers know meters are not available.
    return null;
  }
  let meter = null;
  const find = async (last?: string) => {
    const list = await stripeService.billing.meters.list({
      limit: 100,
      ...(last ? { starting_after: last } : {}),
    })
    const found = list.data.find((i: any) => i.event_name === `${workspace.groupId}-member-count`);
    if (found) {
      meter = found;
      return;
    }
    if (list.has_more) {
      return await find(list?.data[list.data.length - 1]?.id);
    }
  }
  await find();
  if (!meter) {
    try {
      return await stripeService.billing.meters.create({
        display_name: `${workspace?.groupName} Member Count`,
        event_name: `${workspace.groupId}-member-count`,
        default_aggregation: {
          formula: 'last'
        }
      })
    } catch (e) {
      if (second) {
        return null;
      }
      return await findMeterOrCreate(workspace, true);
    }
  }
  return meter;
}

export async function findPriceByNameOrCreate(workspace: Workspace, meterId: string): Promise<any | null> {
  if (!env.STRIPE_PUBLIC || !env.STRIPE_SECRET) return null;
  let price = null;
  const find = async (last?: string) => {
    const list = await stripeService.prices.list({
      limit: 100,
      ...(last ? { starting_after: last } : {}),
    })
    const found = list.data.find((i: any) => i.metadata?.groupId?.toString() === workspace.groupId.toString());
    if (found) {
      if (found.active === false) {
        await stripeService.prices.update(found.id, {
          active: true
        });
      }
      price = found;
      return;
    }
    if (list.has_more) {
      return await find(list?.data[list.data.length - 1]?.id);
    }
  }
  await find();
  if (!price) {
    return await stripeService.prices.create({
      product: reAdminProductId,
      currency: 'usd',
      metadata: {
        groupId: workspace.groupId.toString()
      },
      nickname: `${workspace?.groupName} Member Count`,
      billing_scheme: 'per_unit',
      recurring: {
        interval: 'month',
        usage_type: 'metered',
        meter: meterId,
        interval_count: 1
      },
      unit_amount_decimal: '0.08'
    })
  }
  return price;
}

// One-time concierge setup / migration fee. Reused across all workspaces so we
// only ever create a single price and look it up by metadata afterwards.
export const SETUP_ASSIST_AMOUNT_CENTS = 1500;

export async function findSetupAssistPriceOrCreate(): Promise<any | null> {
  if (!env.STRIPE_PUBLIC || !env.STRIPE_SECRET) return null;
  let price: any | null = null;
  const find = async (last?: string) => {
    const list = await stripeService.prices.list({
      limit: 100,
      ...(last ? { starting_after: last } : {}),
    });
    const found = list.data.find(
      (i: any) => i.metadata?.type === 'setup-assist' && i.active !== false,
    );
    if (found) {
      price = found;
      return;
    }
    if (list.has_more) {
      return await find(list?.data[list.data.length - 1]?.id);
    }
  };
  await find();
  if (!price) {
    return await stripeService.prices.create({
      product: reAdminProductId,
      currency: 'usd',
      metadata: {
        type: 'setup-assist',
      },
      nickname: 'Workspace Setup & Migration',
      unit_amount: SETUP_ASSIST_AMOUNT_CENTS,
    });
  }
  return price;
}

export default stripeService;
