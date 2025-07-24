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
export async function appendEventByCheckoutUlid (
  checkoutUlid: string,
  newEvent: AbandonedEvent
) {
  const db = await connectToDatabase()
  const collection = db.collection(SESSION_COLLECTION)

  const session = await collection.findOne({ 'identifiers.checkoutUlid': checkoutUlid })
  if (!session) return

  const alreadyExists = session.events?.some(
    (e: AbandonedEvent) =>
      e.type === newEvent.type &&
      new Date(e.timestamp).getTime() === new Date(newEvent.timestamp).getTime()
  )

  if (alreadyExists) {
    return { matched: true, added: false }
  }

  await collection.updateOne(
    { 'identifiers.checkoutUlid': checkoutUlid },
    {
      $push: { events: newEvent },
      $set: { updatedAt: new Date() }
    }
  )

  return { matched: true, added: true }
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

  const amount = session.totalAmount

  const incFields: Record<string, number> = {
    [`${type}.recovered`]: 1,
    [`${type}.recoveredAmount`]: amount,
    [`${type}.abandoned`]: -1,
    [`${type}.abandonedAmount`]: -amount,
    'totals.totalRecoveredAmount': amount,
    'totals.totalAbandonedAmount': -amount
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

export async function hasEventByCartId (cartId: string, eventType: string): Promise<boolean> {
  const db = await connectToDatabase()
  const doc = await db.collection(SESSION_COLLECTION).findOne({
    'identifiers.cartId': cartId,
    'events.type': eventType
  })
  return !!doc
}

export async function hasEventByCheckoutUlid (checkoutUlid: string, eventType: string): Promise<boolean> {
  const db = await connectToDatabase()
  const doc = await db.collection(SESSION_COLLECTION).findOne({
    'identifiers.checkoutUlid': checkoutUlid,
    'events.type': eventType
  })
  return !!doc
}

export async function findSessionByCheckoutUlid (checkoutUlid: string) {
  const db = await connectToDatabase()
  return db.collection(SESSION_COLLECTION).findOne({ 'identifiers.checkoutUlid': checkoutUlid })
}

interface MetricOperation {
  sellerId: number
  date: string
  type: 'abandonment' | 'recovery'
  category: 'cart' | 'checkout'
  amount: number
  sessionId?: string
}

export async function processBatchMetrics (operations: MetricOperation[]): Promise<void> {
  if (operations.length === 0) return

  const db = await connectToDatabase()

  // Agrupar operaciones por sellerId y fecha
  const groupedOps = operations.reduce((acc, op) => {
    const key = `${op.sellerId}-${op.date}`
    if (!acc[key]) {
      acc[key] = {
        sellerId: op.sellerId,
        date: op.date,
        increments: {}
      }
    }

    const { type, category, amount } = op

    if (type === 'abandonment') {
      acc[key].increments[`${category}.abandoned`] = (acc[key].increments[`${category}.abandoned`] || 0) + 1
      acc[key].increments[`${category}.abandonedAmount`] = (acc[key].increments[`${category}.abandonedAmount`] || 0) + amount
      acc[key].increments['totals.totalAbandonedAmount'] = (acc[key].increments['totals.totalAbandonedAmount'] || 0) + amount
    } else if (type === 'recovery') {
      acc[key].increments[`${category}.recovered`] = (acc[key].increments[`${category}.recovered`] || 0) + 1
      acc[key].increments[`${category}.recoveredAmount`] = (acc[key].increments[`${category}.recoveredAmount`] || 0) + amount
      acc[key].increments[`${category}.abandoned`] = (acc[key].increments[`${category}.abandoned`] || 0) - 1
      acc[key].increments[`${category}.abandonedAmount`] = (acc[key].increments[`${category}.abandonedAmount`] || 0) - amount
      acc[key].increments['totals.totalRecoveredAmount'] = (acc[key].increments['totals.totalRecoveredAmount'] || 0) + amount
      acc[key].increments['totals.totalAbandonedAmount'] = (acc[key].increments['totals.totalAbandonedAmount'] || 0) - amount
    }

    return acc
  }, {} as Record<string, { sellerId: number, date: string, increments: Record<string, number> }>)

  // Bulk write
  const bulkOps = Object.values(groupedOps).map(({ sellerId, date, increments }) => ({
    updateOne: {
      filter: { sellerId, date },
      update: {
        $inc: increments,
        $set: { lastUpdatedAt: new Date() }
      },
      upsert: true
    }
  }))

  if (bulkOps.length > 0) {
    await db.collection(METRICS_COLLECTION).bulkWrite(bulkOps, { ordered: false })
  }
}

/**
 * Ejecuta operaciones bulk en MongoDB
 */
export async function executeBulkWrite (operations: any[]) {
  const db = await connectToDatabase()
  return db.collection(SESSION_COLLECTION).bulkWrite(operations, {
    ordered: false,
    writeConcern: { w: 1, j: false } // Más rápido para batch
  })
}

export async function incrementBatchMetrics (
  sellerId: number,
  date: string,
  cartCount: number,
  totalAmount: number
): Promise<void> {
  const db = await connectToDatabase()

  await db.collection(METRICS_COLLECTION).updateOne(
    { sellerId, date },
    {
      $inc: {
        'cart.abandoned': cartCount,           // ✅ Incrementar por el total
        'cart.abandonedAmount': totalAmount,   // ✅ Sumar todos los montos
        'totals.totalAbandonedAmount': totalAmount
      },
      $set: {
        lastUpdatedAt: new Date()
      }
    },
    { upsert: true }
  )
}
