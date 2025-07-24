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
