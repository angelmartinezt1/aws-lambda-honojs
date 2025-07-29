export interface CreateCartAbandonedPayload {
  platform: string
  session_type: 'CART_ORIGINATED'
  customer_info: {
    user_id: number
    email: string
    full_name: string
    marketing?: {
      email?: { subscribed: boolean }
      sms?: { subscribed: boolean }
    }
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
  products: any[]
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

// ==========================================
// ADMIN TYPES (SNAKE_CASE)
// ==========================================

export interface AdminListAbandonedQuery {
  page?: number
  size?: number
  sort_by?: string  // "field:direction,field2:direction"
  interval?: 'today' | '7days' | '30days'
  search?: string   // "term1,term2"
  status?: 'ABANDONED' | 'RECOVERED' | 'ACTIVE'
}

export interface AdminAbandonedItem {
  seller_id: number
  id: string
  checkout_id: string
  customer: string
  name: string
  phone: string
  email: string
  total_amount: number
  timestamp: number
  recovered_at: number
  status: 'recovered' | 'not_recovered'
  type: 'cart' | 'purchase'
  email_status: 'sent' | 'not_sent' | 'failed'
  item_count: number
  details: {
    products: AdminProductItem[]
  }
}

export interface AdminProductItem {
  item_id: string
  name: string
  quantity: number
  price: number
  shipping: number | null
  total: number | null
  collection: string | null
  attributes: {
    size?: string
    color?: string
    [key: string]: any
  }
  image_url: string
}

export interface AdminListResponse {
  metadata: {
    success: boolean
    message: string
    timestamp: string
    execution_time: string
  }
  data: AdminAbandonedItem[]
  pagination: {
    page: number
    size: number
    total_elements: number
    total_pages: number
  }
}

export interface SortCriteria {
  field: string
  direction: 'asc' | 'desc'
}

export interface DateRange {
  start: Date
  end: Date
}
