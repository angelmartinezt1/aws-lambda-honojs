export interface CreateCartAbandonedPayload {
  platform: string
  sessionType: 'CART_ORIGINATED'
  customerInfo: {
    userId: number
    email: string
    fullName: string
  }
  products: any[]
  productsCount: number
  totalAmount: number
  currency: string
  identifiers: { cartId: string }
  event: {
    type: 'CART_ABANDONED'
    timestamp: string
    details?: any
  }
}

export interface UpdateCartPayload {
  products: any[]
  productsCount: number
  totalAmount: number
  event: {
    type: 'CART_UPDATED'
    timestamp: string
    details?: any
  }
}

export interface CheckoutAbandonedPayload {
  platform: string
  sessionType: 'CHECKOUT_DIRECT'
  customerInfo: {
    type: 'guest'
    email: string
  }
  totalAmount: number
  currency: string
  identifiers: {
    cartId: null
    checkoutUlid: string
  }
  event: {
    type: 'CHECKOUT_ABANDONED'
    timestamp: string
    details?: any
  }
}

export interface MarkAsRecoveredPayload {
  type: 'cart' | 'checkout'
  id: string
  event: {
    type: 'CART_RECOVERED' | 'CHECKOUT_RECOVERED'
    timestamp: string
    details?: any
  }
}

export interface FlatBatchAbandonedCartsPayload {
  batchId: string
  timestamp: string
  totalCarts: number
  totalSellers: number
  carts: {
    sellerId: number              // ✅ Cada cart tiene su sellerId
    cartId: string
    userId?: number
    email: string
    fullName?: string
    phone?: string
    products: any[]
    totalAmount: number
    currency: string
    platform: string
    abandonedAt: string
    lastUpdated: string
    shippingAddress?: {
      country: string
      state: string
      city: string
      zipCode: string
    }
  }[]
}
