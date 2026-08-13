import 'module-alias/register';
import 'dotenv/config';

import Fastify from 'fastify'
import cors from '@fastify/cors'
import {
  fastifyTRPCPlugin,
  FastifyTRPCPluginOptions,
} from '@trpc/server/adapters/fastify';
import { AppRouter, appRouter } from '~/server/routers/_app';
import { env } from '~/services/env';
import { defaultRouter } from './routers';
import { GroupOAuthAuthorization, GroupRole, RankingKey, RunningGames, Workspace } from '~/services/NewMongoTypes';
import loaderIdHook from './hooks/loaderIdHook';
import getRunningServerHook from './hooks/getRunningServerHook';
import { WithId } from 'mongodb';
import rankingKeyHook from './hooks/rankingKeyHook';
import { createContext } from '~/server/context';

export const fastify = Fastify({
    logger: true,
    routerOptions: {
        maxParamLength: 5000
    },
    bodyLimit: 25 * 1024 * 1024, // 10 MB
    // http2: true,
})
fastify.register(cors, {
    origin: {
        test: ['https://pewilliam.vercel.app'],
        preview: ['https://pewilliam.vercel.app'],
        development: ['https://pewilliam.vercel.app', 'https://pewilliam.vercel.app', 'https://pewilliam.vercel.app'],
        production: ['https://rewilliam.vercel.app', 'https://rewilliam.vercel.app'],
    }[env.NEXT_PUBLIC_VERCEL_ENV || 'test'],
    credentials: true,
})


declare module 'fastify' {
    interface FastifyRequest {
        // session: UserSession;
        RankingKey: WithId<RankingKey>;
        GroupRoles: WithId<GroupRole>[];
        RobloxBot: WithId<GroupOAuthAuthorization>;
        workspace: WithId<Workspace>;
        runningGame: WithId<RunningGames>;
    }
    interface FastifyContextConfig {
        workspaceFromLoaderId?: true;
        getRunningServer?: true;
        rankingKey?: true;
        // requireAuthentication?: boolean;
        // bypassModeration?: boolean;
        parseAs?: 'string' | 'json';
    }
}

async function main() {
    // tRPC issues GET requests for queries, which browsers may cache heuristically
    // (no CDN involved) — causing the dashboard to show stale data until a hard
    // refresh. Mark API responses as non-cacheable so clients always revalidate.
    // Individual routes can still opt into caching by setting their own header.
    fastify.addHook('onSend', async (request, reply) => {
        if (!reply.hasHeader('cache-control')) {
            reply.header('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
            reply.header('pragma', 'no-cache');
            reply.header('expires', '0');
        }
    });

    await fastify.register(loaderIdHook);
    await fastify.register(getRunningServerHook);
    await fastify.register(rankingKeyHook);
    fastify.register(defaultRouter);
    fastify.register(fastifyTRPCPlugin, {
        prefix: '/trpc',
        trpcOptions: {
            router: appRouter,
            allowBatching: true,
            createContext,
            onError({ path, error }) {
            // report to error monitoring
            console.warn(`Error in tRPC handler on path '${path}':`, error);
            },
        } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions']
    })

    fastify.ready();

    try {
        if (process.env.JEST_WORKER_ID !== undefined) {
            fastify.log.info('Running in Jest test environment, skipping server start');
            return;
        }
        fastify.log.info('Starting ReAdmin API server...');
        await fastify.listen({ host: '0.0.0.0', port: parseInt(process.env?.PORT || '') || 3001 })
        fastify.log.info(`Server listening on ${fastify.server.address()}`)    } catch (err) {
        fastify.log.error(err)
        process.exit(1)
    }
}

main()
