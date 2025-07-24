import { ObjectId } from 'mongodb'

export interface AbandonedSession {
  _id?: string | ObjectId
  seller_id: number
  session_id?: string
  user_id?: number
  email: string
  session_type: 'CART_ORIGINATED' | 'CHECKOUT_DIRECT'
  platform: string
  identifiers: {
    cart_id?: string | null
    checkout_ulid?: string
  }
  customer_info: {
    type: 'registered' | 'guest'
    email: string
    phone?: string
    full_name?: string
    marketing?: {
      email?: { subscribed: boolean }
      sms?: { subscribed: boolean }
    }
  }
  products?: ProductItem[]
  products_count?: number
  total_amount: number
  currency: string
  status: {
    cart?: 'ACTIVE' | 'ABANDONED' | 'RECOVERED' | null
    checkout?: 'STARTED' | 'ABANDONED' | 'PAID' | 'RECOVERED' | null
  }
  events: AbandonedEvent[]
  email_stats?: any
  attempts?: {
    recovery?: number
    checkout?: number
  }
  metadata?: any
  date: string
  created_at?: Date
  updated_at?: Date
  cart_updated_at?: Date
  checkout_updated_at?: Date
}

export interface AbandonedEvent {
  type: string
  timestamp: string
  details?: Record<string, any>
}

export interface ProductItem {
  product_id: string
  sku: string
  name: string
  quantity: number
  unit_price: number
  total_price: number
  image_url?: string
  id_t1?: string
  unique_id?: number
  child_unique_id?: number
  collection?: string
  attributes?: Record<string, string>
  added_at?: string
}
