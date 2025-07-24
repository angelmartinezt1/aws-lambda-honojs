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
// Actualizar sesión por cart_id
//
export async function updateSessionByCartId (cart_id: string, update: Partial<AbandonedSession>) {
  const db = await connectToDatabase()
  return db.collection(SESSION_COLLECTION).updateOne(
    { 'identifiers.cart_id': cart_id },
    { $set: update }
  )
}

//
// Actualizar sesión por checkout_ulid
//
export async function updateSessionByCheckoutUlid (checkout_ulid: string, update: Partial<AbandonedSession>) {
  const db = await connectToDatabase()
  return db.collection(SESSION_COLLECTION).updateOne(
    { 'identifiers.checkout_ulid': checkout_ulid },
    { $set: update }
  )
}

//
// Agregar evento a sesión por cart_id
//
export async function appendEventByCartId (cart_id: string, event: AbandonedEvent) {
  const db = await connectToDatabase()
  return db.collection(SESSION_COLLECTION).updateOne(
    { 'identifiers.cart_id': cart_id },
    {
      $push: { events: event },
      $set: { updated_at: new Date() }
    }
  )
}

//
// Agregar evento a sesión por checkout_ulid
//
export async function appendEventByCheckoutUlid (
  checkout_ulid: string,
  new_event: AbandonedEvent
) {
  const db = await connectToDatabase()
  const collection = db.collection(SESSION_COLLECTION)

  const session = await collection.findOne({ 'identifiers.checkout_ulid': checkout_ulid })
  if (!session) return

  const already_exists = session.events?.some(
    (e: AbandonedEvent) =>
      e.type === new_event.type &&
      new Date(e.timestamp).getTime() === new Date(new_event.timestamp).getTime()
  )

  if (already_exists) {
    return { matched: true, added: false }
  }

  await collection.updateOne(
    { 'identifiers.checkout_ulid': checkout_ulid },
    {
      $push: { events: new_event },
      $set: { updated_at: new Date() }
    }
  )

  return { matched: true, added: true }
}

//
// Incrementar métricas de abandono (cart o checkout)
//
export async function incrementMetricForAbandonment (
  seller_id: number,
  session: AbandonedSession,
  type: 'cart' | 'checkout'
) {
  const db = await connectToDatabase()

  const inc_fields: Record<string, number> = {
    [`${type}.abandoned`]: 1,
    [`${type}.abandoned_amount`]: session.total_amount,
    'totals.total_abandoned_amount': session.total_amount
  }

  return db.collection(METRICS_COLLECTION).updateOne(
    { seller_id, date: session.date },
    {
      $inc: inc_fields,
      $set: { last_updated_at: new Date() }
    },
    { upsert: true }
  )
}

//
// Incrementar métricas de recuperación (cart o checkout)
//
export async function incrementMetricForRecovery (
  seller_id: number,
  type: 'cart' | 'checkout',
  session_id: string
) {
  const db = await connectToDatabase()
  const query_key = type === 'cart' ? 'identifiers.cart_id' : 'identifiers.checkout_ulid'

  const session = await db.collection<AbandonedSession>(SESSION_COLLECTION).findOne({ [query_key]: session_id })

  if (!session) return

  const amount = session.total_amount

  const inc_fields: Record<string, number> = {
    [`${type}.recovered`]: 1,
    [`${type}.recovered_amount`]: amount,
    [`${type}.abandoned`]: -1,
    [`${type}.abandoned_amount`]: -amount,
    'totals.total_recovered_amount': amount,
    'totals.total_abandoned_amount': -amount
  }

  return db.collection(METRICS_COLLECTION).updateOne(
    { seller_id, date: session.date },
    {
      $inc: inc_fields,
      $set: { last_updated_at: new Date() }
    },
    { upsert: true }
  )
}

export async function findSessionByCartId (cart_id: string) {
  const db = await connectToDatabase()
  return db.collection(SESSION_COLLECTION).findOne({ 'identifiers.cart_id': cart_id })
}

export async function hasEventByCartId (cart_id: string, event_type: string): Promise<boolean> {
  const db = await connectToDatabase()
  const doc = await db.collection(SESSION_COLLECTION).findOne({
    'identifiers.cart_id': cart_id,
    'events.type': event_type
  })
  return !!doc
}

export async function hasEventByCheckoutUlid (checkout_ulid: string, event_type: string): Promise<boolean> {
  const db = await connectToDatabase()
  const doc = await db.collection(SESSION_COLLECTION).findOne({
    'identifiers.checkout_ulid': checkout_ulid,
    'events.type': event_type
  })
  return !!doc
}

export async function findSessionByCheckoutUlid (checkout_ulid: string) {
  const db = await connectToDatabase()
  return db.collection(SESSION_COLLECTION).findOne({ 'identifiers.checkout_ulid': checkout_ulid })
}

interface MetricOperation {
  seller_id: number
  date: string
  type: 'abandonment' | 'recovery'
  category: 'cart' | 'checkout'
  amount: number
  session_id?: string
}

export async function processBatchMetrics (operations: MetricOperation[]): Promise<void> {
  if (operations.length === 0) return

  const db = await connectToDatabase()

  // Agrupar operaciones por seller_id y fecha
  const grouped_ops = operations.reduce((acc, op) => {
    const key = `${op.seller_id}-${op.date}`
    if (!acc[key]) {
      acc[key] = {
        seller_id: op.seller_id,
        date: op.date,
        increments: {}
      }
    }

    const { type, category, amount } = op

    if (type === 'abandonment') {
      acc[key].increments[`${category}.abandoned`] = (acc[key].increments[`${category}.abandoned`] || 0) + 1
      acc[key].increments[`${category}.abandoned_amount`] = (acc[key].increments[`${category}.abandoned_amount`] || 0) + amount
      acc[key].increments['totals.total_abandoned_amount'] = (acc[key].increments['totals.total_abandoned_amount'] || 0) + amount
    } else if (type === 'recovery') {
      acc[key].increments[`${category}.recovered`] = (acc[key].increments[`${category}.recovered`] || 0) + 1
      acc[key].increments[`${category}.recovered_amount`] = (acc[key].increments[`${category}.recovered_amount`] || 0) + amount
      acc[key].increments[`${category}.abandoned`] = (acc[key].increments[`${category}.abandoned`] || 0) - 1
      acc[key].increments[`${category}.abandoned_amount`] = (acc[key].increments[`${category}.abandoned_amount`] || 0) - amount
      acc[key].increments['totals.total_recovered_amount'] = (acc[key].increments['totals.total_recovered_amount'] || 0) + amount
      acc[key].increments['totals.total_abandoned_amount'] = (acc[key].increments['totals.total_abandoned_amount'] || 0) - amount
    }

    return acc
  }, {} as Record<string, { seller_id: number, date: string, increments: Record<string, number> }>)

  // Bulk write
  const bulk_ops = Object.values(grouped_ops).map(({ seller_id, date, increments }) => ({
    updateOne: {
      filter: { seller_id, date },
      update: {
        $inc: increments,
        $set: { last_updated_at: new Date() }
      },
      upsert: true
    }
  }))

  if (bulk_ops.length > 0) {
    await db.collection(METRICS_COLLECTION).bulkWrite(bulk_ops, { ordered: false })
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
  seller_id: number,
  date: string,
  cart_count: number,
  total_amount: number
): Promise<void> {
  const db = await connectToDatabase()

  await db.collection(METRICS_COLLECTION).updateOne(
    { seller_id, date },
    {
      $inc: {
        'cart.abandoned': cart_count,           // ✅ Incrementar por el total
        'cart.abandoned_amount': total_amount,   // ✅ Sumar todos los montos
        'totals.total_abandoned_amount': total_amount
      },
      $set: {
        last_updated_at: new Date()
      }
    },
    { upsert: true }
  )
}
