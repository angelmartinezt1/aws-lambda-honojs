import { connectToDatabase } from '../config/mongo.js'
import { AbandonedEvent, AbandonedSession } from './abandoned.model.js'

const SESSION_COLLECTION = 'abandoned_sessions'
const METRICS_COLLECTION = 'abandoned_metrics'

//
// Insertar nueva sesión abandonada
//
export async function insertSession (session: AbandonedSession) {
  const db = await connectToDatabase()
  await db.collection(SESSION_COLLECTION).insertOne(session)
}

//
// Actualizar sesión por cartId
//
export async function updateSessionByCartId (cartId: string, update: Partial<AbandonedSession>) {
  const db = await connectToDatabase()
  return db.collection(SESSION_COLLECTION).updateOne(
    { 'identifiers.cartId': cartId },
    { $set: update }
  )
}

//
// Actualizar sesión por checkoutUlid
//
export async function updateSessionByCheckoutUlid (checkoutUlid: string, update: Partial<AbandonedSession>) {
  const db = await connectToDatabase()
  return db.collection(SESSION_COLLECTION).updateOne(
    { 'identifiers.checkoutUlid': checkoutUlid },
    { $set: update }
  )
}

//
// Agregar evento a sesión por cartId
//
export async function appendEventByCartId (cartId: string, event: AbandonedEvent) {
  const db = await connectToDatabase()
  return db.collection(SESSION_COLLECTION).updateOne(
    { 'identifiers.cartId': cartId },
    {
      $push: { events: event },
      $set: { updatedAt: new Date() }
    }
  )
}

//
// Agregar evento a sesión por checkoutUlid
//
export async function appendEventByCheckoutUlid (checkoutUlid: string, event: AbandonedEvent) {
  const db = await connectToDatabase()
  return db.collection(SESSION_COLLECTION).updateOne(
    { 'identifiers.checkoutUlid': checkoutUlid },
    {
      $push: { events: event },
      $set: { updatedAt: new Date() }
    }
  )
}

//
// Incrementar métricas de abandono (cart o checkout)
//
export async function incrementMetricForAbandonment (
  sellerId: number,
  session: AbandonedSession,
  type: 'cart' | 'checkout'
) {
  const db = await connectToDatabase()

  const incFields: Record<string, number> = {
    [`${type}.abandoned`]: 1,
    [`${type}.abandonedAmount`]: session.totalAmount,
    'totals.totalAbandonedAmount': session.totalAmount
  }

  return db.collection(METRICS_COLLECTION).updateOne(
    { sellerId, date: session.date },
    {
      $inc: incFields,
      $set: { lastUpdatedAt: new Date() }
    },
    { upsert: true }
  )
}

//
// Incrementar métricas de recuperación (cart o checkout)
//
export async function incrementMetricForRecovery (
  sellerId: number,
  type: 'cart' | 'checkout',
  sessionId: string
) {
  const db = await connectToDatabase()
  const queryKey = type === 'cart' ? 'identifiers.cartId' : 'identifiers.checkoutUlid'

  const session = await db.collection<AbandonedSession>(SESSION_COLLECTION).findOne({ [queryKey]: sessionId })

  if (!session) return

  const incFields: Record<string, number> = {
    [`${type}.recovered`]: 1,
    [`${type}.recoveredAmount`]: session.totalAmount,
    'totals.totalRecoveredAmount': session.totalAmount
  }

  return db.collection(METRICS_COLLECTION).updateOne(
    { sellerId, date: session.date },
    {
      $inc: incFields,
      $set: { lastUpdatedAt: new Date() }
    },
    { upsert: true }
  )
}

export async function findSessionByCartId (cartId: string) {
  const db = await connectToDatabase()
  return db.collection(SESSION_COLLECTION).findOne({ 'identifiers.cartId': cartId })
}
