import { useEffect } from 'react';
import { useRouter } from 'next/router';
import LoadingPage from '~/components/layouts/LoadingPage';
import { useUser } from '~/components/contexts/user';

export default function Home() {
  const router = useRouter();
  const info = useUser();

  useEffect(() => {
    if ('loading' in info) return;
    router.replace(info.loggedIn ? '/dashboard' : '/login');
  }, [info, router]);

  return <LoadingPage />;
}
