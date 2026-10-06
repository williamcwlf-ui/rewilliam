/* eslint-disable @next/next/no-img-element */
import { useUser } from '~/components/contexts/user';
import { NextPageWithLayout } from './_app';
import { useRouter } from 'next/router';
import { useEffect, useRef } from 'react';

const IndexPage: NextPageWithLayout = () => {
  const user = useUser();
  const router = useRouter();
  const hasRedirected = useRef(false);

  useEffect(() => {
    // Only redirect once, ever. The auth context is hydrated asynchronously
    // and can flicker between states during the Roblox callback, so we must
    // ensure the redirect only fires a single time when the auth is definite.
    if (hasRedirected.current) {
      return;
    }

    if (!router.isReady || typeof window === 'undefined') {
      return;
    }

    // Wait for auth to be fully resolved (not loading)
    if ('loading' in user) {
      return;
    }

    hasRedirected.current = true;

    if (user.loggedIn === true) {
      void router.replace('/dashboard');
    } else {
      void router.replace('/login');
    }
  }, [router.isReady, user]);

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
