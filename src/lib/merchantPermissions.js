// What each store role is allowed to do.
//
// Routes name a permission, never a role, so adding a fourth role later is a
// change to the table below and nothing else. Roles live in
// models/merchantMember.model.js.

export const PERMISSIONS = {
  PRODUCTS_READ:  'products:read',
  PRODUCTS_WRITE: 'products:write',
  ORDERS_READ:    'orders:read',
  ORDERS_WRITE:   'orders:write',
  COUPONS_READ:   'coupons:read',
  COUPONS_WRITE:  'coupons:write',
  ANALYTICS_READ: 'analytics:read',
  MARKETING_SEND: 'marketing:send',
  // Storefront identity: name, description, logo, banner, categories.
  PROFILE_WRITE:  'profile:write',
  // Payout and compliance fields: IBAN, national id, CR number.
  PAYOUTS_WRITE:  'payouts:write',
  // Invite, change the role of, and revoke members.
  TEAM_WRITE:     'team:write',
};

const ALL = Object.values(PERMISSIONS);

// Staff run the day-to-day storefront but cannot change what the store *is*,
// where its money goes, or who else can get in.
const STAFF = [
  PERMISSIONS.PRODUCTS_READ,
  PERMISSIONS.ORDERS_READ,
  PERMISSIONS.ORDERS_WRITE,
  PERMISSIONS.COUPONS_READ,
];

// Managers additionally own the catalogue and its commercial levers.
const MANAGER = [
  ...STAFF,
  PERMISSIONS.PRODUCTS_WRITE,
  PERMISSIONS.COUPONS_WRITE,
  PERMISSIONS.ANALYTICS_READ,
  PERMISSIONS.MARKETING_SEND,
];

export const ROLE_PERMISSIONS = Object.freeze({
  owner:   Object.freeze([...ALL]),
  manager: Object.freeze([...MANAGER]),
  staff:   Object.freeze([...STAFF]),
});

/**
 * @param {string} role - a MERCHANT_ROLES value
 * @param {string} permission - a PERMISSIONS value
 */
export const hasPermission = (role, permission) =>
  Boolean(role) && (ROLE_PERMISSIONS[role] || []).includes(permission);

export const permissionsForRole = (role) => ROLE_PERMISSIONS[role] || [];
