export interface CreateCartAbandonedPayload {
  platform: string
  session_type: 'CART_ORIGINATED'
  customer_info: {
    user_id: number
    email: string
    full_name: string
  }
  products: any[]
  products_count: number
  total_amount: number
  currency: string
  identifiers: { cart_id: string }
  event: {
    type: 'CART_ABANDONED'
    timestamp: string
    details?: any
  }
}

export interface UpdateCartPayload {
  products: any[]
  products_count: number
  total_amount: number
  event: {
    type: 'CART_UPDATED'
    timestamp: string
    details?: any
  }
}

export interface CheckoutAbandonedPayload {
  platform: string
  session_type: 'CHECKOUT_DIRECT'
  customer_info: {
    type: 'guest'
    email: string
  }
  total_amount: number
  currency: string
  identifiers: {
    cart_id: null
    checkout_ulid: string
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
  batch_id: string
  timestamp: string
  total_carts: number
  total_sellers: number
  carts: {
    seller_id: number
    cart_id: string
    user_id?: number
    email: string
    full_name?: string
    phone?: string
    products: any[]
    total_amount: number
    currency: string
    platform: string
    abandoned_at: string
    last_updated: string
    shipping_address?: {
      country: string
      state: string
      city: string
      zip_code: string
    }
  }[]
}
