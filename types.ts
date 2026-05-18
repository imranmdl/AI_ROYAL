
export enum UserRole {
  ADMIN = 'Admin',
  MANAGER = 'Manager',
  SALES_EXECUTIVE = 'Sales Executive',
  SUPERVISOR = 'Supervisor'
}

export type UserStatus = 'Active' | 'Suspended';

export interface UserPermissions {
  canViewDashboard: boolean;
  canManageInventory: boolean;
  canManageSales: boolean;
  canViewReports: boolean;
  canManageUsers: boolean;
  canViewCredits: boolean;
  canManageCustomers: boolean;
  canManageReturns: boolean;
  canManageGallery: boolean;
}

export type Category = string;
export type UnitType =
  | 'Box'
  | 'Bag'
  | 'Piece'
  | 'Unit'
  | 'Sft'
  | 'Litre'
  | 'Slab'
  | 'Pouch'     // e.g. tile adhesive sachet
  | 'Kg'
  | 'Gram';

/** Weight variants a unit can be expressed in — e.g. 250g pouch, 500g pouch, 1kg bag */
export interface UnitVariant {
  id: string;
  label: string;        // e.g. '250g', '500g', '1kg'
  weightGrams: number;  // 250 / 500 / 1000
  purchasePrice: number;
  sellingPrice: number;
}

export interface LoadingChargeRule {
  id: string;
  productType: string; // Category name or specific type like '2x4 Tiles'
  unitType: 'sqft' | 'box' | 'piece' | 'unit' | 'other';
  rate: number;
  perUnit: number;
  isActive: boolean;
}
export type TransportCostType = 'Percentage' | 'Fixed';
export type TransportBasis = 'Per Unit' | 'Per Sft';
export type TileGrade = 'Premium' | 'Standard' | 'Commercial' | 'Budget';

export type CustomerType =
  | 'House Owner'      // End customer
  | 'Contractor'       // Handles installation
  | 'Engineer'         // Site engineer
  | 'Architect'        // Architect / Interior designer
  | 'Commission Agent' // Mestri / referral agent
  | 'Dealer'           // B2B dealer
  | 'Retail'           // Walk-in retail
  | 'Landlord'
  | 'Interior Designer';

export type LeadStatus = 'New' | 'Follow-up' | 'In Discussion' | 'Quotation Sent' | 'Converted' | 'Lost';
export type LeadSource = 'WhatsApp' | 'Walk-in' | 'Agent Referral' | 'Phone' | 'Instagram' | 'Gallery' | 'Manual';
export type ProjectStage = 'Planning' | 'Ongoing' | 'Finishing' | 'Completed';
export type TileCategory = 'Floor' | 'Wall' | 'Premium' | 'Budget' | 'Granite' | 'Kadapa' | 'Sanitary';

/** Commission agent entry linked to a customer's sale */
export interface AgentCommission {
  id: string;
  agentId: string;        // Customer id of the agent
  agentName: string;
  customerId: string;     // Customer who bought
  saleId?: string;
  invoiceNo?: string;
  saleAmount: number;
  commissionPct: number;
  commissionValue: number;
  date: string;
  status: 'Pending' | 'Paid';
  paidDate?: string;
  notes?: string;
}

/** Broadcast campaign template */
export interface MessageTemplate {
  id: string;
  name: string;
  category: 'New Arrivals' | 'Offers' | 'Clearance' | 'Stock Update' | 'Custom';
  body: string;           // supports [Name], [Type], [Category] placeholders
  createdAt: string;
}

export interface Godown {
  id: string;
  name: string;
  location: string;
}

export interface StockLocation {
  godownId: string;
  boxes: number;
  loose: number;
}

export interface CustomerInteraction {
  id: string;
  date: string;
  type: 'WhatsApp' | 'Call' | 'Visit' | 'Email';
  notes: string;
  outcome?: string;
}

export interface Customer {
  id: string;
  name: string;
  mobile: string;
  address: string;
  city?: string;
  gst?: string;
  email?: string;
  type: CustomerType;
  status: LeadStatus;
  source?: LeadSource;
  // Agent / referral
  referredBy?: string;           // Agent customer id
  referredByName?: string;
  agentCommissionPct?: number;   // default commission % for this agent
  // Project info
  projectStage?: ProjectStage;
  preferredCategories?: TileCategory[];
  budgetMin?: number;
  budgetMax?: number;
  // Business
  totalBusiness: number;
  lastContactDate?: string;
  nextFollowUpDate?: string;
  assignedTo?: string;           // User id
  assignedToName?: string;
  tags?: string[];               // AI / manual tags for campaigns
  notes?: string;
  // Tracking
  interactions: CustomerInteraction[];
  agentCommissions?: AgentCommission[];
  createdAt: string;
}

export interface DamageRecord {
  id: string;
  date: string;
  godownId: string;
  qty: number; 
  looseQty: number; 
}

export interface PurchaseRecord {
  id: string;
  date: string;
  vendorName: string;
  vehicleNumber: string;
  gstInvoiceNo: string;
  qtyBoxes: number;
  godownId: string;
}

export interface StockAdjustmentEntry {
  id: string;
  date: string;
  userId: string;
  userName: string;
  actionType: 'Purchase' | 'Sale' | 'Damage' | 'Correction' | 'Transfer' | 'Return';
  qtyBoxes: number;
  qtyLoose: number;
  godownId: string;
  godownName: string;
  notes?: string;
  vendorOrderId?: string; // Link to VendorOrder for traceability
}

// Kadapa finish/polish types — extensible, stored in settings.kadapaItemTypes
export type KadapaFinish = string; // e.g. 'Single Polish', 'Double Polish', 'Big Single Polish', 'Big Double Polish'

export interface KadapaItemType {
  id: string;
  name: string;         // e.g. 'Single Polish'
  ratePerSqft: number;  // e.g. 28
}

export interface Slab {
  id: string;
  slabNo: string;
  heightFt: number;
  heightIn: number;
  lengthFt: number;
  lengthIn: number;
  sqft: number;
  isSold: boolean;
  soldToInvoiceNo?: string;
  // Kadapa-specific
  finish?: KadapaFinish;   // which polish type this slab is
  landedCost?: number;     // sqft * ratePerSqft (auto-calculated)
  sellingPrice?: number;   // per-slab selling price (user enters per-sqft, auto-calculated)
  sellingPricePerSqft?: number;
}

export interface Product {
  id: string;
  name: string;
  category: Category;
  brand: string;
  isTile: boolean;
  unitType: UnitType;
  size: string;
  thickness?: string;
  finish?: string;
  slabHeightFt?: number;
  slabHeightIn?: number;
  slabLengthFt?: number;
  slabLengthIn?: number;
  costPerSqft?: number;
  sellingPricePerSqft?: number;
  shadeNo?: string;    // Industry specific
  batchNo?: string;    // Industry specific
  grade?: TileGrade;   // Industry specific
  tilesPerBox: number;
  sqftPerBox: number;
  purchasePrice: number; 
  transportCost: number; 
  transportCostType: TransportCostType;
  transportBasis: TransportBasis;
  otherCharges: number;
  totalCostPerUnit: number; 
  totalStockValue: number; 
  sellingPrice: number;    
  stockBoxes: number; 
  stockLoose: number; 
  damagedPieces: number;
  damageHistory: DamageRecord[]; 
  purchaseHistory: PurchaseRecord[]; 
  adjustmentLog: StockAdjustmentEntry[]; 
  reorderLevel: number;
  images: string[];
  lastPurchaseDate?: string;
  lastPurchaseVendor?: string;
  lastPurchaseVehicle?: string;
  linkedOrderId?: string; // Link to VendorOrder
  locationStock: StockLocation[]; 
  slabs?: Slab[]; // For Granite/Marble
  kadapaType?: KadapaFinish; // For Kadapa — references settings.kadapaItemTypes[].name
  graniteName?: string; // For Granite
  status: 'Active' | 'Suspended';
  showInGallery: boolean;

  // Unit variants (for weight-based products like pouches, bags)
  unitVariants?: UnitVariant[];         // e.g. [{label:'250g'}, {label:'500g'}]
  baseWeightGrams?: number;             // base weight of one unit in grams (if applicable)

  // Dependent / Linked items (for bundled or usage-tracked items)
  dependentItems?: DependentItem[];     // items consumed/dispatched with this product
}

/** A dependent item: consumed or dispatched together with a parent product */
export interface DependentItem {
  id: string;
  productId: string;      // referenced product
  productName: string;
  qtyPerUnit: number;     // how many of this item per 1 unit of parent
  unitLabel: string;      // e.g. 'per Box', 'per Slab'
  isOptional: boolean;    // if true: suggested but not mandatory
  trackStock: boolean;    // if true: deduct stock automatically on sale/dispatch
}

export type OfferStatus = 'Draft' | 'Under Review' | 'Published' | 'Expired' | 'Paused';
export type OfferKind = 'Percentage' | 'Fixed' | 'BOGO' | 'BuyXGetY' | 'FreeProduct' | 'PromoCode' | 'CustomerSpecific' | 'InvoiceValue';
export type OfferRiskLevel = 'Green' | 'Yellow' | 'Red';
export type CustomerSegment = 'All' | 'Retail' | 'Builder' | 'Architect' | 'Contractor' | 'Dealer' | 'VIP';

export interface OfferBOGO {
  buyQty: number;
  getQty: number;
  getFreeProductId?: string;       // if null → same product
  discountOnSecond?: number;       // % off 2nd item instead of free
}

export interface OfferInvoiceSlabs {
  minValue: number;
  benefit: 'Percentage' | 'Fixed' | 'FreeProduct' | 'Gift';
  benefitValue: number;
  giftDescription?: string;
}

export interface Offer {
  id: string;
  title: string;
  description: string;
  kind: OfferKind;
  type: 'Percentage' | 'Fixed';  // kept for compat — maps to kind for simple offers
  value: number;
  targetProductIds: string[];
  targetCategories: Category[];
  targetCustomerSegments?: CustomerSegment[];
  targetCustomerIds?: string[];
  minPurchaseValue?: number;
  minQtyBoxes?: number;
  maxQtyBoxes?: number;
  status: OfferStatus;
  startDate: string;
  expiryDate: string;
  createdBy: string;
  publishedBy?: string;
  promoCode?: string;              // e.g. DIWALI25
  promoCodeUsageLimit?: number;
  promoCodeUsageCount?: number;
  bogo?: OfferBOGO;
  invoiceSlabs?: OfferInvoiceSlabs[];
  // Margin guard
  minMarginPct?: number;           // block if offer drops margin below this
  requiresApproval?: boolean;
  approvalNote?: string;
  // Analytics
  usageCount?: number;
  totalDiscountGiven?: number;
  totalRevenueGenerated?: number;
  campaignBudget?: number;
  campaignSpent?: number;
  priority?: number;               // higher = applied first
  stackable?: boolean;             // can combine with other offers
}

export interface MarginThreshold {
  category: string;
  minMarginPct: number;   // e.g. 10 for 10%
  warningMarginPct: number; // yellow zone start
  approvalRequired: boolean;
}

export interface ContractorIncentive {
  id: string;
  contractorName: string;
  contractorMobile: string;
  type: 'Percentage' | 'Fixed' | 'PerSqft' | 'PerBox' | 'Gift' | 'Target';
  value: number;
  targetCategory?: string;
  linkedInvoiceIds?: string[];
  totalEarned: number;
  totalPaid: number;
  pending: number;
  status: 'Active' | 'Settled' | 'Expired';
  startDate: string;
  expiryDate?: string;
  notes?: string;
  referralCode?: string;
  createdBy: string;
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  type: 'Offer' | 'Discount' | 'CustomPrice';
  requestedBy: string;
  requestedAt: string;
  offerId?: string;
  customerId?: string;
  customerName?: string;
  productId?: string;
  invoiceNo?: string;
  originalPrice: number;
  proposedPrice: number;
  discountValue: number;
  marginPct: number;
  riskLevel: OfferRiskLevel;
  status: 'Pending' | 'Approved' | 'Rejected';
  approvedBy?: string;
  approvedAt?: string;
  comment?: string;
  reason: string;
}

export interface CommissionTier {
  minMargin: number;
  commissionValue: number;
  commissionType: 'Percentage' | 'Fixed';
}

export interface CommissionRule {
  id: string;
  title: string;
  description?: string;
  type: 'Percentage' | 'Fixed' | 'Conditional' | 'SlowStock';
  value: number; 
  tiers?: CommissionTier[];   // for Conditional: margin-based tiers
  targetCategory?: Category;
  targetProductId?: string;   // for item-specific or slow-stock rules
  targetUserId?: string;      // restrict to specific executive
  isActive: boolean;
  startDate?: string;
  expiryDate?: string;
  createdAt: string;
  // Slow-stock specific
  minDaysInStock?: number;    // trigger if item unsold for N days
  maxMarginForTrigger?: number; // only apply if margin ≤ this (slow items sold at low margin)
  // Per-sale incentive breakdown tracking
  totalIncentivePaid?: number;
  usageCount?: number;
  priority?: number;           // higher = evaluated first; 1 = lowest
}

/** Recorded incentive for a single sale item */
export interface IncentiveEntry {
  id: string;
  saleId: string;
  invoiceNo: string;
  saleItemId?: string;
  productName: string;
  productId: string;
  userId: string;
  userName: string;
  ruleId: string;
  ruleTitle: string;
  date: string;
  saleAmount: number;      // net selling amount for this line
  landedCost: number;      // cost of this line
  profit: number;          // saleAmount - landedCost
  marginPct: number;       // profit / landedCost * 100
  incentiveAmount: number; // what the salesperson earns
  basis: string;           // e.g. "3% of ₹500 margin" — human-readable
  status: 'Pending' | 'Accrued' | 'Paid';
}

export interface AdvanceRecord {
  id: string;
  userId: string;
  amount: number;
  date: string;
  notes: string;
}

export type PayrollStatus = 'Pending' | 'Partially Paid' | 'Paid';

export interface PayrollRecord {
  id: string;
  userId: string;
  userName: string;
  month: string; 
  baseSalary: number;
  incentivesAccrued: number;
  bonus: number;
  travelExpenses: number;
  otherExpenses: number;
  advancesDeducted: number;
  netPayable: number;
  paidAmount: number;
  balanceDue: number;
  status: PayrollStatus;
  lastPaymentDate?: string;
  remarks?: string;
}

export interface QuotationItem {
  id: string;
  productId: string;
  productName: string;
  productCategory?: string;
  purpose: string;
  reqSqft: number;
  qtyBoxes: number;
  qtyPieces: number;
  rate: number;
  costRate: number;
  priceBasis: 'Box' | 'Sqft';
  amount: number;
  appliedOfferId?: string;
  discountAmount?: number;
  selectedSlabIds?: string[]; // For Granite/Marble
}

export interface CustomFieldValue {
  label: string;
  value: string;
}

export type TransactionStatus = 'Active' | 'Draft' | 'Hold' | 'Deleted';

export interface Quotation {
  id: string;
  quotationNo: string;
  customerName: string;
  customerMobile: string;
  customerAddress: string;
  customerGst?: string;
  date: string;
  items: QuotationItem[];
  subTotal: number;
  discountValue: number;
  discountType: 'Fixed' | 'Percentage';
  gstPercent: number;
  gstAmount: number;
  loadingCharges: number;
  totalAmount: number;
  isGstIncluded: boolean;
  globalCommission: number;
  globalCommissionType: 'Fixed' | 'Percentage';
  salesPersonId: string;
  convertedToSaleId?: string;
  appliedOfferId?: string;
  remarks?: string;
  customFields?: CustomFieldValue[];
  status: TransactionStatus;
}

export interface Purchase {
  id: string;
  vendorName: string;
  vehicleNumber: string;
  gstInvoiceNo: string;
  date: string;
  godownId: string; 
  items: PurchaseItem[];
  vendorOrderId?: string; // Link to VendorOrder
}

export interface PurchaseItem {
  productId: string;
  productName: string;
  qtyBoxes: number;
  rate: number;
}

export interface SaleItem {
  productId: string;
  productName: string;
  productCategory?: string;
  purpose: string; 
  qtyBoxes: number;
  qtyLoose: number;
  rate: number; 
  costRate: number;
  priceBasis: 'Box' | 'Sqft';
  sqft: number;
  amount: number;
  sourceGodownId: string; 
  appliedOfferId?: string;
  discountAmount?: number;
  selectedSlabIds?: string[]; // For Granite/Marble
}

export interface ReturnItem {
  productId: string;
  productName: string;
  qtyBoxes: number;
  qtyLoose: number;
  refundAmount: number;
}

export interface Return {
  id: string;
  saleId: string;
  invoiceNo: string;
  date: string;
  customerName: string;
  items: ReturnItem[];
  totalRefundAmount: number;
  refundMode: 'Cash' | 'UPI' | 'Bank Transfer' | 'Store Credit';
  remarks?: string;
  processedBy: string;
}

export interface Sale {
  id: string;
  invoiceNo: string;
  customerName: string;
  customerMobile?: string;
  customerAddress?: string;
  customerGst?: string;
  date: string;
  items: SaleItem[];
  returns?: Return[];
  subTotal: number;
  discountValue: number;
  discountType: 'Fixed' | 'Percentage';
  gstPercent: number;
  gstAmount: number;
  loadingCharges: number;
  totalAmount: number;
  isGstIncluded: boolean;
  amountPaid: number;
  balance: number;
  paymentType: 'Cash' | 'UPI' | 'Card' | 'Credit' | 'Mixed';
  salesPersonId: string;
  salesPersonName: string;
  commissionValue: number;
  commissionType: 'Fixed' | 'Percentage';
  commissionStatus: 'Accrued' | 'Paid';
  quotationId?: string;
  appliedOfferId?: string;
  remarks?: string;
  customFields?: CustomFieldValue[];
  status: TransactionStatus;
}

export interface Payment {
  id: string;
  saleId: string;
  invoiceNo: string;
  customerName: string;
  customerMobile?: string;
  amount: number;
  date: string;
  paymentMode: 'Cash' | 'UPI' | 'Bank Transfer' | 'Cheque' | 'NEFT/RTGS';
  remarks?: string;
  referenceNo?: string;
}

/** Custom credit — no invoice needed (labor, transport, advance, old dues etc.) */
export interface CustomCredit {
  id: string;
  customerName: string;
  customerMobile: string;
  type: 'Debit' | 'Credit';    // Debit = amount owed BY customer, Credit = refund/advance
  amount: number;
  date: string;
  category: 'Labor' | 'Transport' | 'Advance' | 'Old Due' | 'Adjustment' | 'Other';
  description: string;
  status: 'Open' | 'Settled' | 'Partial';
  amountSettled: number;
  createdBy?: string;
}

/** Payment reminder */
export interface PaymentReminder {
  id: string;
  customerName: string;
  customerMobile: string;
  amount: number;
  dueDate: string;
  notes?: string;
  status: 'Pending' | 'Sent' | 'Done';
  createdAt: string;
}

export interface Expense {
  id: string;
  title: string;
  category: string;
  amount: number;
  date: string;
  remarks?: string;
  images?: string[];
}

export interface ActivityLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  details: string;
  timestamp: string;
  module: 'Sales' | 'Inventory' | 'Users' | 'Reports' | 'Credits' | 'Customers' | 'Offers' | 'Returns';
}

export interface DashboardVisibilitySettings {
  showStockValuation: boolean;
  showGrossMargin: boolean;
  showNetProfit: boolean;
  showDailyBooking: boolean;
  showOverdueOption: boolean;
  showGalleryStock: boolean;
  enableGalleryCart: boolean;
  enableGalleryOtp: boolean;
}

export interface SystemSettings {
  backupFrequency: '15min' | '1hour' | 'daily' | 'Never';
  lastBackupTimestamp: number;
  showroomName: string;
  showroomAddress: string;
  showroomCity: string;
  showroomPhone: string;
  showroomGst: string;
  systemBranding: string;
  showroomDescription: string;
  galleryTitle: string;
  gallerySubTitle: string;
  galleryNotification?: string;
  decimalPlaceText?: string;
  customInvoiceFieldLabels: string[];
  dashboardVisibility: DashboardVisibilitySettings;
  predefinedSizes: string[];
  categories: string[];
  enableIndividualSlabManagement: boolean;
  printShowCompanyGst: boolean;    // show/hide company GST on printed docs
  printShowCustomerGst: boolean;   // show/hide customer GST on printed docs
  kadapaItemTypes?: KadapaItemType[];
  messageTemplates?: MessageTemplate[]; // Admin-managed finish types with rates
  categoryUnitMap?: Record<string, { defaultUnit: UnitType; allowedUnits: UnitType[]; hasVariants: boolean }>; // per-category unit config
  marginThresholds?: MarginThreshold[]; // per-category minimum margin rules
}

export interface GalleryLeadItem {
  productId: string;
  productName: string;
  category?: string;
  requestedSqft: number;     // for tiles: requested sqft; for slabs: total sqft of selected slabs
  calculatedBoxes: number;   // for tiles only
  unitPrice: number;         // per-sqft for slabs, per-box for tiles
  totalValue: number;
  purpose?: string;
  appliedOfferId?: string;
  discountAmount?: number;
  originalPrice?: number;
  // Slab-specific (Kadapa / Granite / Marble)
  selectedSlabIds?: string[];     // IDs of specific slabs customer selected
  selectedSlabNos?: string[];     // Slab numbers for display
  slabDetails?: {                 // snapshot of each selected slab
    id: string;
    slabNo: string;
    sqft: number;
    finish?: string;
    sellingPrice?: number;
    sellingPricePerSqft?: number;
  }[];
}

export interface GalleryLead {
  id: string;
  timestamp: string;
  customerName: string;
  customerMobile: string;
  customerPlace: string;
  items: GalleryLeadItem[];
  totalAmount: number;
  totalDiscount?: number;
  status: 'New' | 'Responded' | 'Converted' | 'Cancelled';
  source: 'Gallery' | 'Instagram' | 'Facebook' | 'Other';
  remarks?: string;
  followUpDate?: string;
  // Conversion tracking
  convertedQuotationId?: string;
  convertedSaleId?: string;
  convertedAt?: string;
  // Customer portal
  customerEmail?: string;
  otpVerified?: boolean;
}

export type VendorOrderStatus = 'Ordered' | 'Partial' | 'In Transit' | 'Received' | 'Cancelled';
export type VendorPaymentStatus = 'Pending' | 'Partially Paid' | 'Paid' | 'Advance' | 'Credit';
export type VendorPaymentMode = 'RTGS' | 'Cash' | 'PhonePe' | 'GPay' | 'Bank Transfer' | 'Cheque';

export interface VendorPaymentRecord {
  id: string;
  date: string;
  amount: number;
  mode: VendorPaymentMode;
  referenceNo?: string;
  remarks?: string;
  paymentSlip?: string; // base64
}

export interface DamagedItemTracking {
  id: string;
  productId: string;
  productName: string;
  qtyDamaged: number;
  type: 'Box' | 'Piece';
  reason: string;
  actionTaken?: string; 
  date: string;
  photos?: string[];
}

export interface VendorOrderItem {
  productId: string;
  productName: string;
  qtyBoxes: number;
  rate: number;
  receivedQty?: number;
  sellingPrice?: number;    // manual selling price per box set at order time
  transportShare?: number;  // % of transport cost allocated to this item (auto-calc)
  landedCost?: number;      // landed cost per box = (item cost + transport share) / qty
}

export interface VendorOrder {
  id: string;
  orderNo: string;
  vendorName: string;
  vendorPhone?: string;       // vendor contact number
  vendorGst?: string;         // vendor GST number
  orderDate: string;
  expectedDeliveryDate?: string;
  status: VendorOrderStatus;
  paymentStatus: VendorPaymentStatus;
  creditDays?: number;
  cashAmount: number;
  rtgsAmount: number;
  transportPayment: number;   // payment made specifically for transport
  transportationCost: number;
  otherCosts: number;
  invoiceFile?: string;       // base64
  totalAmount: number;        // Item total (excl. transport/other)
  paidAmount: number;
  balanceAmount: number;
  paymentHistory: VendorPaymentRecord[];
  items: VendorOrderItem[];
  vehicleNumber?: string;
  receivedDate?: string;
  receivedGodownId?: string;
  damagedItems: DamagedItemTracking[];
  trackingDetails?: string;
  remarks?: string;
}

export interface User {
  id: string;
  name: string;
  role: UserRole;
  email: string;
  password?: string;
  status: UserStatus;
  permissions: UserPermissions;
  monthlyTarget?: number;
  baseSalary: number; 
}
