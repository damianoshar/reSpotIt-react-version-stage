import React, { createContext, useContext } from 'react';

const SyncPhotosContext = createContext<boolean>(true);

export const SyncPhotosProvider = SyncPhotosContext.Provider;

export function useSyncPhotos(): boolean {
  return useContext(SyncPhotosContext);
}
