import Stripe from 'stripe';
import { env } from '~/services/env';
import { User, Workspace } from './NewMongoTypes';
import { readminCollections } from '~/services/mongo.service';

/**
 * Billing is optional.
 *
 * Premium bills through ReAdmin's own Stripe account, so a self-hosted instance
 * has nothing to sell and no reason to hold Stripe credentials. It used to need
 * them anyway: the client was constructed at import, and `updateStripeUser` runs
 * on every login — so placeholder keys turned each sign-in into a 401 from
 * Stripe, and a blank one crashed the module before the app started.
 *
 * With STRIPE_SECRET unset the client is never built, `updateStripeUser` does
 * nothing, and everything outside billing carries on. Billing endpoints
 * themselves report that billing is not configured rather than failing obscurely.
 */
export const stripeConfigured = Boolean(env.STRIPE_SECRET && env.STRIPE_PUBLIC);

let client: Stripe | undefined;

/**
 * The Stripe client, built on first use. Throws when billing is unconfigured —
 * callers on a billing path should check `stripeConfigured` first and say so
 * plainly; callers on any other path should not be reaching Stripe at all.
 */
function stripe(): Stripe {
  if (!client) {
    if (!stripeConfigured) {
      throw new Error(
        'Billing is not configured: set STRIPE_SECRET and STRIPE_PUBLIC to enable it.',
      );
    }
    client = new Stripe(env.STRIPE_SECRET as string, {
      //@ts-expect-error ok
      apiVersion: null
    });
  }
  return client;
}

/** Whether the configured keys are Stripe's test keys rather than live ones. */
export const stripeIsTestMode = (env.STRIPE_PUBLIC || '').startsWith('pk_test');

export const reAdminProductId = stripeIsTestMode ? 'prod_P1vkRDvQJs3thH' : 'prod_P22XA4AaEGIGs7'
export const reAdminSubcriptionId = stripeIsTestMode ? 'price_1ODrsgFQlpJ67TzVZXg7ZMUP' : 'price_1ODyS0FQlpJ67TzVpN1Haz1M'
export const reAdminUsageSubcriptionId = stripeIsTestMode ? 'price_1OLJmhFQlpJ67TzVs1AzzhH8' : 'price_1OLJlfFQlpJ67TzV460ezTYC'

// https://discord.com/api/oauth2/authorize?client_id=1077397229792399532&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth&response_type=code&scope=identify%20email

export async function updateStripeUser(
  user: User
): Promise<Stripe.Customer | Stripe.DeletedCustomer | null> {
  // Called on every login. Without billing there is no customer to sync, and
  // this must not be what stops someone signing in.
  if (!stripeConfigured) {
    return null;
  }
  const isTesting = stripeIsTestMode;
  const userObject = {
    name: user.name,
    ...user?.email ? { email: user.email } : {},
  }
  if (isTesting) {
    if (user.testStripeId) {
      try {
        const existing = await stripe().customers.retrieve(user.testStripeId);
        await stripe().customers.update(existing.id, userObject);
        return existing;
      } catch (e) {

      }
    }
    const created = await stripe().customers.create(userObject);
    if (created.id) {
      await readminCollections.user.updateOne({ robloxId: user.robloxId }, { $set: { testStripeId: created.id } });
    }
    return created;
  }
  if (user.stripeId) {
    try {
      const existing = await stripe().customers.retrieve(user.stripeId);
      await stripe().customers.update(existing.id, userObject);
      return existing;
    } catch (e) {

    }
  }
  const created = await stripe().customers.create(userObject);
  if (created.id) {
    await readminCollections.user.updateOne({ robloxId: user.robloxId }, { $set: { stripeId: created.id } });
  }
  return created;
}

export async function findMeterOrCreate(workspace: Workspace, second = false): Promise<Stripe.Billing.Meter | null> {
  let meter = null;
  const find = async (last?: string) => {
    const list = await stripe().billing.meters.list({
      limit: 100,
      ...(last ? { starting_after: last } : {}),
    })
    const found = list.data.find((i) => i.event_name === `${workspace.groupId}-member-count`);
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
      return await stripe().billing.meters.create({
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

export async function findPriceByNameOrCreate(workspace: Workspace, meterId: string): Promise<Stripe.Price> {
  let price = null;
  const find = async (last?: string) => {
    const list = await stripe().prices.list({
      limit: 100,
      ...(last ? { starting_after: last } : {}),
    })
    const found = list.data.find((i) => i.metadata?.groupId?.toString() === workspace.groupId.toString());
    if (found) {
      if (found.active === false) {
        await stripe().prices.update(found.id, {
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
    return await stripe().prices.create({
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

export async function findSetupAssistPriceOrCreate(): Promise<Stripe.Price> {
  let price: Stripe.Price | null = null;
  const find = async (last?: string) => {
    const list = await stripe().prices.list({
      limit: 100,
      ...(last ? { starting_after: last } : {}),
    });
    const found = list.data.find(
      (i) => i.metadata?.type === 'setup-assist' && i.active !== false,
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
    return await stripe().prices.create({
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

/**
 * Default export kept as a Proxy so the many `stripeService.x.y()` call sites
 * read unchanged, while construction still happens on first use rather than at
 * import. Touching any property when billing is unconfigured throws the message
 * above — which is the right outcome, since only billing code gets here.
 */
const stripeService = new Proxy({} as Stripe, {
  get: (_target, property) => (stripe() as any)[property],
});

export default stripeService;
