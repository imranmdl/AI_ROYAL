/**
 * hooks/useStore.ts
 * Typed selector hooks — components subscribe only to the slice they need.
 * Inventory re-renders ONLY when products change. Sales ONLY when sales change.
 */
import { useState, useEffect } from 'react';
import { store } from '../store';

export function useStoreSlice<T>(selector: (s: typeof store) => T): T {
  const [value, setValue] = useState<T>(() => selector(store));
  useEffect(() => {
    setValue(selector(store));
    return store.subscribe(
      () => setValue(selector(store)),
      selector as (s: any) => unknown
    );
  }, []);
  return value;
}

export const useProducts     = () => useStoreSlice(s => s.products);
export const useSales        = () => useStoreSlice(s => s.sales);
export const useQuotations   = () => useStoreSlice(s => s.quotations);
export const useCustomers    = () => useStoreSlice(s => s.customers);
export const usePayments     = () => useStoreSlice(s => s.payments);
export const useExpenses     = () => useStoreSlice(s => s.expenses);
export const useReturns      = () => useStoreSlice(s => s.returns);
export const useVendorOrders = () => useStoreSlice(s => s.vendorOrders);
export const useGalleryLeads = () => useStoreSlice(s => s.galleryLeads);
export const useOffers       = () => useStoreSlice(s => s.offers);
export const useSettings     = () => useStoreSlice(s => s.settings);
export const useGodowns      = () => useStoreSlice(s => s.godowns);
export const useUsers        = () => useStoreSlice(s => s.users);
export const useActivityLogs = () => useStoreSlice(s => s.activityLogs);
export const useCurrentUser  = () => useStoreSlice(s => s.currentUser);
export const useSyncStatus   = () => useStoreSlice(s => ({
  isSyncing: s.isSyncing, isOnline: s.isOnline,
  dbConnected: s.dbConnected, syncError: s.syncError, lastUpdated: s.lastUpdated,
}));
