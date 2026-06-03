import { Product, User, UserRole } from './types';

export const MOCK_PRODUCTS: Product[] = [
  {
    id: '1',
    name: 'Statutario White Glossy',
    category: 'Floor Tile',
    brand: 'Kajaria',
    isTile: true,
    unitType: 'Box',
    size: '600x1200 mm',
    thickness: '9mm',
    finish: 'Glossy',
    tilesPerBox: 2,
    sqftPerBox: 15.5,
    purchasePrice: 450,
    transportCost: 5,
    transportCostType: 'Percentage',
    transportBasis: 'Per Unit',
    otherCharges: 10,
    totalCostPerUnit: 482.5,
    totalStockValue: 58141.25,
    sellingPrice: 750,
    stockBoxes: 120,
    stockLoose: 1,
    damagedPieces: 0,
    damageHistory: [],
    purchaseHistory: [],
    adjustmentLog: [],
    reorderLevel: 20,
    images: ['https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&q=80&w=1000'],
    locationStock: [
      { godownId: 'g1', boxes: 120, loose: 1 }
    ],
    // Fix: Added required 'status' property to mock product
    status: 'Active',
    showInGallery: true
  },
  {
    id: '2',
    name: 'Black Galaxy Granite',
    category: 'Granite',
    brand: 'Premium',
    isTile: false,
    unitType: 'Sft',
    size: 'Custom',
    thickness: '18mm',
    finish: 'Polished',
    tilesPerBox: 1,
    sqftPerBox: 1,
    purchasePrice: 120,
    transportCost: 10,
    transportCostType: 'Fixed',
    transportBasis: 'Per Unit',
    otherCharges: 0,
    totalCostPerUnit: 130,
    totalStockValue: 65000,
    sellingPrice: 180,
    stockBoxes: 500,
    stockLoose: 0,
    damagedPieces: 2,
    damageHistory: [],
    purchaseHistory: [],
    adjustmentLog: [],
    reorderLevel: 50,
    images: ['https://images.unsplash.com/photo-1558611848-73f7eb4001a1?auto=format&fit=crop&q=80&w=1000'],
    locationStock: [
      { godownId: 'g1', boxes: 500, loose: 0 }
    ],
    // Fix: Added required 'status' property to mock product
    status: 'Active',
    showInGallery: true
  }
];

export const MOCK_USERS: User[] = [
  { 
    id: '1', 
    name: 'Rajesh Kumar', 
    role: UserRole.ADMIN, 
    email: 'admin@royal.com', 
    password: 'admin', 
    status: 'Active',
    permissions: {
      canViewDashboard: true,
      canManageInventory: true,
      canManageSales: true,
      canViewReports: true,
      canManageUsers: true,
      canViewCredits: true,
      canManageCustomers: true,
      canManageReturns: true,
      canManageGallery: true
    },
    monthlyTarget: 1000000,
    // Fix: Added missing required baseSalary property
    baseSalary: 50000
  },
  { 
    id: '2', 
    name: 'Amit Sales', 
    role: UserRole.SALES_EXECUTIVE, 
    email: 'sales@royal.com', 
    password: 'sales', 
    status: 'Active',
    permissions: {
      canViewDashboard: true,
      canManageInventory: false,
      canManageSales: true,
      canViewReports: false,
      canManageUsers: false,
      canViewCredits: true,
      canManageCustomers: true,
      canManageReturns: false,
      canManageGallery: false
    },
    monthlyTarget: 500000,
    // Fix: Added missing required baseSalary property
    baseSalary: 25000
  }
];