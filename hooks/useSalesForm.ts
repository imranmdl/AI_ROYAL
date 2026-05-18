/**
 * hooks/useSalesForm.ts
 * Replaces 40 useState calls in Sales.tsx with a single useReducer.
 * One re-render per action, not one per field.
 */
import { useReducer, useCallback } from 'react';
import type { SaleItem, Quotation } from '../types';

export interface SalesFormState {
  customer: string; mobile: string; address: string;
  customerGst: string; remarks: string; purpose: string;
  cart: SaleItem[];
  selectedProductId: string; productSearch: string;
  boxQty: number; looseQty: number; sqft: number;
  rate: number; markup: number; sourceGodownId: string;
  priceBasis: 'Box' | 'Sqft'; selectedSlabIds: string[];
  paymentType: 'Cash' | 'UPI' | 'Card' | 'Credit' | 'Mixed';
  amountPaid: number; isFullPayment: boolean; selectedOfferId: string;
  viewMode: 'billing' | 'history' | 'preview';
  selectedSale: any | null; editingSaleId: string | null;
  invoiceDate: string;
  customFields: Array<{ label: string; value: string }>;
}

const defaultState = (labels: string[]): SalesFormState => ({
  customer: '', mobile: '', address: '', customerGst: '', remarks: '', purpose: '',
  cart: [], selectedProductId: '', productSearch: '',
  boxQty: 1, looseQty: 0, sqft: 0, rate: 0, markup: 0,
  sourceGodownId: 'g1', priceBasis: 'Box', selectedSlabIds: [],
  paymentType: 'Cash', amountPaid: 0, isFullPayment: true, selectedOfferId: '',
  viewMode: 'billing', selectedSale: null, editingSaleId: null,
  invoiceDate: new Date().toLocaleDateString(),
  customFields: labels.map(label => ({ label, value: '' })),
});

type Action =
  | { type: 'SET'; field: keyof SalesFormState; value: any }
  | { type: 'SET_MANY'; updates: Partial<SalesFormState> }
  | { type: 'RESET'; labels: string[] }
  | { type: 'ADD_TO_CART'; item: SaleItem }
  | { type: 'REMOVE_FROM_CART'; index: number }
  | { type: 'UPDATE_CART_ITEM'; index: number; updates: Partial<SaleItem> }
  | { type: 'CLEAR_CART' }
  | { type: 'LOAD_QUOTATION'; quotation: Quotation; labels: string[] };

function reducer(state: SalesFormState, action: Action): SalesFormState {
  switch (action.type) {
    case 'SET':        return { ...state, [action.field]: action.value };
    case 'SET_MANY':   return { ...state, ...action.updates };
    case 'RESET':      return defaultState(action.labels);
    case 'ADD_TO_CART':    return { ...state, cart: [...state.cart, action.item] };
    case 'REMOVE_FROM_CART': return { ...state, cart: state.cart.filter((_, i) => i !== action.index) };
    case 'UPDATE_CART_ITEM': return { ...state, cart: state.cart.map((item, i) => i === action.index ? { ...item, ...action.updates } : item) };
    case 'CLEAR_CART': return { ...state, cart: [] };
    case 'LOAD_QUOTATION': return { ...state, customer: action.quotation.customerName, mobile: (action.quotation as any).customerMobile || '', address: (action.quotation as any).customerAddress || '', cart: action.quotation.items.map((item: any) => ({ ...item, sourceGodownId: 'g1' })), customFields: action.labels.map(label => ({ label, value: '' })) };
    default: return state;
  }
}

export function useSalesForm(customFieldLabels: string[]) {
  const [state, dispatch] = useReducer(reducer, defaultState(customFieldLabels));
  const set        = useCallback(<K extends keyof SalesFormState>(field: K, value: SalesFormState[K]) => dispatch({ type: 'SET', field, value }), []);
  const setMany    = useCallback((updates: Partial<SalesFormState>) => dispatch({ type: 'SET_MANY', updates }), []);
  const reset      = useCallback(() => dispatch({ type: 'RESET', labels: customFieldLabels }), [customFieldLabels]);
  const addToCart  = useCallback((item: SaleItem) => dispatch({ type: 'ADD_TO_CART', item }), []);
  const removeFromCart = useCallback((index: number) => dispatch({ type: 'REMOVE_FROM_CART', index }), []);
  const updateCartItem = useCallback((index: number, updates: Partial<SaleItem>) => dispatch({ type: 'UPDATE_CART_ITEM', index, updates }), []);
  const clearCart  = useCallback(() => dispatch({ type: 'CLEAR_CART' }), []);
  const loadQuotation = useCallback((quotation: Quotation) => dispatch({ type: 'LOAD_QUOTATION', quotation, labels: customFieldLabels }), [customFieldLabels]);
  return { state, set, setMany, reset, addToCart, removeFromCart, updateCartItem, clearCart, loadQuotation };
}
