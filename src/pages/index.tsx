/* eslint-disable @next/next/no-img-element */
import { useUser } from '~/components/contexts/user';
import { NextPageWithLayout } from './_app';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

const IndexPage: NextPageWithLayout = () => {
  const user = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady || typeof window === 'undefined') {
      return;
    }

    // The user context is hydrated asynchronously. During the Roblox callback it
    // can briefly look logged out before the session cookie / JWT is ready, so
    // redirecting immediately causes the login loop.
    if ('loading' in user) {
      return;
    }

    if (user.loggedIn === true) {
      void router.replace('/dashboard');
      return;
    }

    if (router.pathname !== '/login') {
      void router.replace('/login');
    }
  }, [router, user]);

  return (
    <main className="h-screen flex flex-col justify-center align-middle py-24 px-8 bg-gray-100">
      <div className="flex flex-col justify-center self-center align-middle">
        <img
          src="https://cdn.readmin.app/readmin-public/RA-Black.png"
          alt="ReAdmin Logo"
          className="self-center max-w-lg w-full h-min"
        />
        <p className="text-center text-4xl font-bold mt-12 self-center">
          We are logging you in!
        </p>
        <p className="text-xl mt-2 max-w-lg self-center text-center">
          Please wait as we redirect you
        </p>
      </div>
    </main>
  );
};

export default IndexPage;
