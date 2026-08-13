import { Context, createContext, PropsWithChildren, useContext } from 'react';
import { trpc } from '~/utils/trpc';
import { JWTUser } from '~/services/types/JWT.type';

export type AuthenticatedUserContext = { loggedIn: true; user: JWTUser };

const UserContext: Context
  | {
    loading: true;
  }
  | {
    loggedIn: false;
    user: null;
  }
  | AuthenticatedUserContext
> = createContext({ loading: true }) as any;

// eslint-disable-next-line @typescript-eslint/ban-types
function UserProvider({ children }: PropsWithChildren<{}>) {
  const { data, isPending, isError } = trpc.user.info.useQuery(undefined,{refetchOnWindowFocus: false, refetchOnReconnect: false, refetchOnMount: false});

  // Only show the loading state while the query is actually in flight for the
  // first time. Previously this also stayed true whenever `data` was falsy,
  // which included the "settled with an error" case (isPending becomes false,
  // but data stays undefined) - so a single failed request (network blip,
  // backend hiccup, etc.) left every page depending on useUser() stuck on a
  // loading/skeleton screen forever, since the context never transitioned out
  // of `{ loading: true }`.
  if (isPending) {
    return (
      <UserContext.Provider value={{ loading: true }}>
        {children}
      </UserContext.Provider>
    );
  }

  // If the request failed (or somehow resolved without data), fall back to a
  // logged-out state instead of hanging indefinitely. Pages already know how
  // to handle `loggedIn: false` (they redirect to /login), so this degrades
  // gracefully instead of freezing the UI.
  if (isError || !data) {
    return (
      <UserContext.Provider value={{ loggedIn: false, user: null }}>
        {children}
      </UserContext.Provider>
    );
  }

  return (
    //@ts-expect-error lol
    <UserContext.Provider value={data}>{children}</UserContext.Provider>
  );
}

const useUser = () => useContext(UserContext);

export { UserProvider, useUser };
