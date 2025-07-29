import { connectToDatabase } from '../config/mongo.js'
import { AbandonedEvent, AbandonedSession } from './abandoned.model.js'
import { DateRange, SortCriteria } from './abandoned.types.js'

const SESSION_COLLECTION = 'abandoned_sessions'
const METRICS_COLLECTION = 'abandoned_metrics'

//
// Insertar nueva sesión abandonada
//
export async function insertSession (session: AbandonedSession) {
  const db = await connectToDatabase()
  await db.collection<AbandonedSession>(SESSION_COLLECTION).insertOne(session)
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
    } as any
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
    } as any
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

// ==========================================
// ADMIN REPOSITORY METHODS
// ==========================================

export interface AdminListParams {
  seller_id: number
  page: number
  size: number
  sort_criteria: SortCriteria[]
  date_range: DateRange
  search_terms?: string[]
  status_filter?: string
}

/**
 * Obtiene lista paginada de sesiones abandonadas para admin
 */
export async function getAbandonedSessionsForAdmin (params: AdminListParams) {
  const db = await connectToDatabase()
  const collection = db.collection(SESSION_COLLECTION)

  // Construir filtros
  const filters: any = {
    seller_id: params.seller_id,
    created_at: {
      $gte: params.date_range.start,
      $lte: params.date_range.end
    }
  }

  // Filtro por status
  if (params.status_filter) {
    if (params.status_filter === 'RECOVERED') {
      filters.$or = [
        { 'status.cart': 'RECOVERED' },
        { 'status.checkout': 'RECOVERED' }
      ]
    } else if (params.status_filter === 'ABANDONED') {
      filters.$or = [
        { 'status.cart': 'ABANDONED' },
        { 'status.checkout': 'ABANDONED' }
      ]
    } else if (params.status_filter === 'ACTIVE') {
      filters.$or = [
        { 'status.cart': 'ACTIVE' },
        { 'status.checkout': 'ACTIVE' }
      ]
    }
  }

  // Filtro de búsqueda
  if (params.search_terms && params.search_terms.length > 0) {
    const search_conditions = params.search_terms.map(term => ({
      $or: [
        { email: { $regex: term, $options: 'i' } },
        { 'customer_info.full_name': { $regex: term, $options: 'i' } },
        { 'customer_info.email': { $regex: term, $options: 'i' } },
        { 'products.name': { $regex: term, $options: 'i' } },
        { 'identifiers.cart_id': { $regex: term, $options: 'i' } },
        { 'identifiers.checkout_ulid': { $regex: term, $options: 'i' } }
      ]
    }))

    filters.$and = search_conditions
  }

  // Construir sort
  const sort_obj: any = {}
  for (const criteria of params.sort_criteria) {
    const direction = criteria.direction === 'desc' ? -1 : 1

    switch (criteria.field) {
      case 'item_count':
        sort_obj.products_count = direction
        break
      case 'total_amount':
        sort_obj.total_amount = direction
        break
      case 'created_at':
        sort_obj.created_at = direction
        break
      case 'status':
        sort_obj['status.cart'] = direction
        sort_obj['status.checkout'] = direction
        break
      default:
        sort_obj.created_at = -1 // Default sort
    }
  }

  if (Object.keys(sort_obj).length === 0) {
    sort_obj.created_at = -1 // Default sort si no hay criterios
  }

  // Ejecutar queries
  const skip = (params.page - 1) * params.size

  const [sessions, total_count] = await Promise.all([
    collection
      .find(filters)
      .sort(sort_obj)
      .skip(skip)
      .limit(params.size)
      .toArray(),
    collection.countDocuments(filters)
  ])

  return {
    sessions,
    total_count,
    total_pages: Math.ceil(total_count / params.size)
  }
}

/**
 * Estadísticas rápidas para el dashboard admin
 */
export async function getAbandonedStatsForAdmin (
  seller_id: number,
  date_range: DateRange
) {
  const db = await connectToDatabase()
  const collection = db.collection(SESSION_COLLECTION)

  const filters = {
    seller_id,
    created_at: {
      $gte: date_range.start,
      $lte: date_range.end
    }
  }

  const stats = await collection.aggregate([
    { $match: filters },
    {
      $group: {
        _id: null,
        total_sessions: { $sum: 1 },
        total_amount: { $sum: '$total_amount' },
        cart_sessions: {
          $sum: {
            $cond: [{ $eq: ['$session_type', 'CART_ORIGINATED'] }, 1, 0]
          }
        },
        checkout_sessions: {
          $sum: {
            $cond: [{ $eq: ['$session_type', 'CHECKOUT_DIRECT'] }, 1, 0]
          }
        },
        recovered_sessions: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ['$status.cart', 'RECOVERED'] },
                  { $eq: ['$status.checkout', 'RECOVERED'] }
                ]
              },
              1,
              0
            ]
          }
        }
      }
    }
  ]).toArray()

  return stats[0] || {
    total_sessions: 0,
    total_amount: 0,
    cart_sessions: 0,
    checkout_sessions: 0,
    recovered_sessions: 0
  }
}
