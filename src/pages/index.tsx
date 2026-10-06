/* eslint-disable @next/next/no-img-element */
import { useUser } from '~/components/contexts/user';
import { NextPageWithLayout } from './_app';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

const IndexPage: NextPageWithLayout = () => {
  const user = useUser();
  const router = useRouter();
  const [isReadyToRedirect, setIsReadyToRedirect] = useState(false);

  useEffect(() => {
    if (!router.isReady || typeof window === 'undefined') {
      return;
    }

    // Wait a tick to ensure user context is fully initialized
    const timer = setTimeout(() => {
      if ('loggedIn' in user) {
        if (user.loggedIn === true) {
          router.push(`/dashboard`);
        } else {
          router.push(`/login`);
        }
      } else {
        // User context not ready yet, allow another check
        setIsReadyToRedirect(true);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [router.isReady, user, router]);

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
