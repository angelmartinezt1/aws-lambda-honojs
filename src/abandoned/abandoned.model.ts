import { ObjectId } from 'mongodb'

export interface AbandonedSession {
  _id?: string | ObjectId
  sellerId: number
  sessionId?: string
  userId?: number
  email: string
  sessionType: 'CART_ORIGINATED' | 'CHECKOUT_DIRECT'
  platform: string
  identifiers: {
    cartId?: string | null
    checkoutUlid?: string
  }
  customerInfo: {
    type: 'registered' | 'guest'
    email: string
    phone?: string
    fullName?: string
    marketing?: {
      email?: { subscribed: boolean }
      sms?: { subscribed: boolean }
    }
  }
  products?: ProductItem[]
  productsCount?: number
  totalAmount: number
  currency: string
  status: {
    cart?: 'ACTIVE' | 'ABANDONED' | 'RECOVERED' | null
    checkout?: 'STARTED' | 'ABANDONED' | 'PAID' | 'RECOVERED' | null
  }
  events: AbandonedEvent[]
  emailStats?: any
  attempts?: {
    recovery?: number
    checkout?: number
  }
  metadata?: any
  date: string
  createdAt?: Date
  updatedAt?: Date
  cartUpdatedAt?: Date
  checkoutUpdatedAt?: Date
}

export interface AbandonedEvent {
  type: string
  timestamp: string
  details?: Record<string, any>
}

export interface ProductItem {
  productId: string
  sku: string
  name: string
  quantity: number
  unitPrice: number
  totalPrice: number
  imageUrl?: string
  idT1?: string
  uniqueId?: number
  childUniqueId?: number
  collection?: string
  attributes?: Record<string, string>
  addedAt?: string
}
