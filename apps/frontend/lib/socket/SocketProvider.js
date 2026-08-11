import React, { createContext, useEffect, useMemo } from 'react';
import socketClient from './socketClient';

export const SocketContext = createContext(null);

export const SocketProvider = ({ children, client = socketClient, session = null }) => {
  const value = useMemo(() => client, [client]);

  useEffect(() => {
    const handleOnline = () => {
      if (!client.isConnected() && session?.token) {
        client.connect({
          auth: {
            token: session.token,
          },
        }).catch(() => {});
      }
    };

    const handleOffline = () => {
      client.disconnect();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [client, session?.token]);

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};
