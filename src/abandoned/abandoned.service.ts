import { generateDateKey } from '../utils/date'; // función utilitaria opcional
import { AbandonedSession } from './abandoned.model.js'
import * as repo from './abandoned.repository.js'
import { CheckoutAbandonedPayload, CreateCartAbandonedPayload, MarkAsRecoveredPayload, UpdateCartPayload } from './abandoned.types.js'

//
// 5. Marcar sesión como recuperada
//

//
// 1. Crear carrito abandonado
//
export async function handleCreateCartAbandoned (
  sellerId: number,
  payload: CreateCartAbandonedPayload
) {
  const cartId = payload.identifiers.cartId
  const event = payload.event
  const now = new Date(event.timestamp)

  const existing = await repo.findSessionByCartId(cartId)

  if (existing) {
    // 1. Actualiza campos importantes de la sesión
    await repo.updateSessionByCartId(cartId, {
      products: payload.products,
      productsCount: payload.productsCount,
      totalAmount: payload.totalAmount,
      updatedAt: now,
      cartUpdatedAt: now
    })

    // 2. Solo agregar evento si aún no existe
    const alreadyHasEvent = await repo.hasEventByCartId(cartId, event.type)
    if (!alreadyHasEvent) {
      await repo.appendEventByCartId(cartId, event)
    }

    return {
      message: alreadyHasEvent
        ? 'Session updated (event already existed)'
        : 'Session updated and event added',
      cartId,
      alreadyExists: true
    }
  }

  // No existe: crear nueva sesión
  const session: AbandonedSession = {
    sellerId,
    sessionType: payload.sessionType,
    platform: payload.platform,
    email: payload.customerInfo.email,
    customerInfo: {
      type: 'registered',
      email: payload.customerInfo.email,
      fullName: payload.customerInfo.fullName,
      marketing: payload.customerInfo.marketing ?? {}
    },
    identifiers: {
      cartId,
      checkoutUlid: null
    },
    products: payload.products,
    productsCount: payload.productsCount,
    totalAmount: payload.totalAmount,
    currency: payload.currency,
    status: {
      cart: 'ABANDONED',
      checkout: null
    },
    events: [event],
    date: generateDateKey(event.timestamp),
    createdAt: now,
    updatedAt: now,
    cartUpdatedAt: now
  }

  await repo.insertSession(session)
  await repo.incrementMetricForAbandonment(sellerId, session, 'cart')

  return {
    message: 'New session created',
    cartId,
    alreadyExists: false
  }
}

//
// 2. Actualizar carrito abandonado (productos + evento)
//
export async function handleUpdateCartAbandoned (sellerId: number, cartId: string, payload: UpdateCartPayload) {
  const updatedFields = {
    products: payload.products,
    productsCount: payload.productsCount,
    totalAmount: payload.totalAmount,
    updatedAt: new Date(payload.event.timestamp),
    cartUpdatedAt: new Date(payload.event.timestamp)
  }

  await repo.updateSessionByCartId(cartId, updatedFields)
  await repo.appendEventByCartId(cartId, payload.event)

  return { cartId }
}

//
// 3. Crear checkout abandonado (guest user)
//
export async function handleCreateCheckoutAbandoned (sellerId: number, payload: CheckoutAbandonedPayload) {
  const session: AbandonedSession = {
    sellerId,
    sessionType: payload.sessionType,
    platform: payload.platform,
    email: payload.customerInfo.email,
    customerInfo: payload.customerInfo,
    identifiers: {
      cartId: null,
      checkoutUlid: payload.identifiers.checkoutUlid
    },
    products: [],
    productsCount: 0,
    totalAmount: payload.totalAmount,
    currency: payload.currency,
    status: {
      cart: null,
      checkout: 'ABANDONED'
    },
    events: [payload.event],
    date: generateDateKey(payload.event.timestamp),
    createdAt: new Date(payload.event.timestamp),
    updatedAt: new Date(payload.event.timestamp),
    checkoutUpdatedAt: new Date(payload.event.timestamp)
  }

  await repo.insertSession(session)
  await repo.incrementMetricForAbandonment(sellerId, session, 'checkout')

  return { checkoutUlid: payload.identifiers.checkoutUlid }
}

//
// 4. Actualizar sesión de checkout por checkoutUlid
//
export async function handleUpdateCheckoutAbandoned (sellerId: number, checkoutUlid: string, payload: Partial<CheckoutAbandonedPayload>) {
  if (payload.cartId) {
    await repo.updateSessionByCheckoutUlid(checkoutUlid, {
      'identifiers.cartId': payload.cartId
    })
  }
  await repo.appendEventByCheckoutUlid(checkoutUlid, payload.event)
  return { checkoutUlid }
}

export async function handleMarkAsRecovered (
  sellerId: number,
  payload: MarkAsRecoveredPayload
) {
  const { type, id, event } = payload
  const now = new Date(event.timestamp)

  const isCart = type === 'cart'
  const queryField = isCart ? 'cartId' : 'checkoutUlid'
  const statusField = isCart ? 'status.cart' : 'status.checkout'

  // 1. Verifica si ya existe el evento de recuperación
  const alreadyHasEvent = isCart
    ? await repo.hasEventByCartId(id, event.type)
    : await repo.hasEventByCheckoutUlid(id, event.type)

  // 2. Si ya existe, no hagas nada más
  if (alreadyHasEvent) {
    return {
      message: 'Already recovered — event already exists',
      id,
      alreadyRecovered: true
    }
  }

  // 3. Actualizar el status a RECOVERED
  const updateFields: Record<string, any> = {
    [statusField]: 'RECOVERED',
    updatedAt: now
  }

  if (isCart) {
    updateFields.cartUpdatedAt = now
    await repo.updateSessionByCartId(id, updateFields)
    await repo.appendEventByCartId(id, event)
  } else {
    updateFields.checkoutUpdatedAt = now
    await repo.updateSessionByCheckoutUlid(id, updateFields)
    await repo.appendEventByCheckoutUlid(id, event)
  }

  // 4. Incrementar la métrica solo una vez
  await repo.incrementMetricForRecovery(sellerId, type, id)

  return {
    message: 'Session marked as recovered',
    id,
    recovered: true
  }
}
