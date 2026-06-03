/**
 * hooks/useInventoryPage.ts
 * Server-side paginated product fetching with debounced search and stale-request cancellation.
 * Replaces 9 state vars + fetchProducts function + 3 useEffects in Inventory.tsx
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { store } from '../store';
import type { Product } from '../types';

export interface ProductFilters {
  category: string; brand: string; size: string;
  stockStatus: string; grade: string; status: string;
}
export const DEFAULT_FILTERS: ProductFilters = {
  category: 'All', brand: 'All', size: 'All', stockStatus: 'All', grade: 'All', status: 'Active',
};

export function useInventoryPage(initialLimit = 25) {
  const [products, setProducts]   = useState<Product[]>([]);
  const [total, setTotal]         = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore]     = useState(true);
  const [page, setPage]           = useState(1);
  const [searchTerm, setSearchTermRaw] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filters, setFilters]     = useState<ProductFilters>(DEFAULT_FILTERS);
  const [itemsPerPage, setItemsPerPage] = useState(initialLimit);
  const reqIdRef = useRef(0);

  useEffect(() => { const t = setTimeout(() => setDebouncedSearch(searchTerm), 300); return () => clearTimeout(t); }, [searchTerm]);

  const fetchPage = useCallback(async (p: number, search: string, f: ProductFilters, isLoadMore: boolean) => {
    if (isLoading && isLoadMore) return;
    const reqId = ++reqIdRef.current;
    setIsLoading(true);
    try {
      const result = await store.fetchProductsPage(p, itemsPerPage, search, f);
      if (reqId !== reqIdRef.current) return;
      setProducts(prev => isLoadMore ? [...prev, ...result.data] : result.data);
      setTotal(result.total);
      setHasMore(result.data.length === itemsPerPage);
    } catch (e) { console.error('[useInventoryPage]', e); }
    finally { if (reqId === reqIdRef.current) setIsLoading(false); }
  }, [itemsPerPage, isLoading]);

  useEffect(() => { setPage(1); fetchPage(1, debouncedSearch, filters, false); }, [debouncedSearch, filters, itemsPerPage]);

  // Re-fetch when store.products changes (e.g. after add/edit)
  useEffect(() => {
    return store.subscribe(() => fetchPage(1, debouncedSearch, filters, false), s => s.products);
  }, [debouncedSearch, filters]);

  const loadMore  = useCallback(() => { const next = page + 1; setPage(next); fetchPage(next, debouncedSearch, filters, true); }, [page, debouncedSearch, filters, fetchPage]);
  const refresh   = useCallback(() => { setPage(1); fetchPage(1, debouncedSearch, filters, false); }, [debouncedSearch, filters, fetchPage]);
  const setSearchTerm = useCallback((s: string) => setSearchTermRaw(s), []);
  const setFilter = useCallback(<K extends keyof ProductFilters>(key: K, value: ProductFilters[K]) => setFilters(prev => ({ ...prev, [key]: value })), []);
  const resetFilters  = useCallback(() => setFilters(DEFAULT_FILTERS), []);

  return { products, total, isLoading, hasMore, loadMore, refresh, searchTerm, setSearchTerm, filters, setFilter, resetFilters, itemsPerPage, setItemsPerPage };
}
