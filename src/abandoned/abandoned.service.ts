import { generateDateKey } from '../utils/date'
import { AbandonedSession } from './abandoned.model.js'
import * as repo from './abandoned.repository.js'
import {
  CheckoutAbandonedPayload,
  CreateCartAbandonedPayload,
  FlatBatchAbandonedCartsPayload,
  MarkAsRecoveredPayload,
  UpdateCartPayload
} from './abandoned.types.js'

// ==========================================
// UTILITIES & VALIDATION
// ==========================================

interface ValidationError {
  field: string
  message: string
}

function validateCartPayload (payload: CreateCartAbandonedPayload): ValidationError[] {
  const errors: ValidationError[] = []

  if (!payload.identifiers?.cart_id?.trim()) {
    errors.push({ field: 'cart_id', message: 'cart_id is required and cannot be empty' })
  }

  if (!payload.customer_info?.email?.trim()) {
    errors.push({ field: 'email', message: 'Customer email is required' })
  }

  if (!payload.products || payload.products.length === 0) {
    errors.push({ field: 'products', message: 'Products array cannot be empty' })
  }

  if (!payload.total_amount || payload.total_amount <= 0) {
    errors.push({ field: 'total_amount', message: 'total_amount must be greater than 0' })
  }

  return errors
}

function validateCheckoutPayload (payload: CheckoutAbandonedPayload): ValidationError[] {
  const errors: ValidationError[] = []

  if (!payload.identifiers?.checkout_ulid?.trim()) {
    errors.push({ field: 'checkout_ulid', message: 'checkout_ulid is required' })
  }

  if (!payload.customer_info?.email?.trim()) {
    errors.push({ field: 'email', message: 'Customer email is required' })
  }

  if (!payload.total_amount || payload.total_amount <= 0) {
    errors.push({ field: 'total_amount', message: 'total_amount must be greater than 0' })
  }

  return errors
}

// Utility para retry con backoff exponencial
async function withRetry<T> (
  operation: () => Promise<T>,
  max_retries = 3,
  base_delay = 100
): Promise<T> {
  let last_error: Error

  for (let attempt = 1; attempt <= max_retries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      last_error = error as Error

      if (attempt === max_retries) break

      // Exponential backoff con jitter
      const delay = base_delay * Math.pow(2, attempt - 1) + Math.random() * 100
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw last_error!
}

// ==========================================
// METRICS HELPER - CON FALLBACK
// ==========================================

interface MetricOperation {
  seller_id: number
  date: string
  type: 'abandonment' | 'recovery'
  category: 'cart' | 'checkout'
  amount: number
  session_id?: string
}

class MetricsBatch {
  private static instance: MetricsBatch
  private queue: MetricOperation[] = []
  private processing = false
  private timer: NodeJS.Timeout | null = null

  static getInstance (): MetricsBatch {
    if (!MetricsBatch.instance) {
      MetricsBatch.instance = new MetricsBatch()
    }
    return MetricsBatch.instance
  }

  addMetric (operation: MetricOperation): void {
    this.queue.push(operation)
    this.scheduleFlush()
  }

  private scheduleFlush (): void {
    if (this.timer || this.processing) return

    this.timer = setTimeout(() => {
      this.flush().catch(error =>
        console.error('Metrics batch flush error:', error)
      )
    }, 1000)
  }

  private async flush (): Promise<void> {
    if (this.queue.length === 0 || this.processing) return

    this.processing = true
    this.timer = null

    const batch = [...this.queue]
    this.queue = []

    try {
      // Verificar si la función batch existe
      if (typeof repo.processBatchMetrics === 'function') {
        await repo.processBatchMetrics(batch)
      } else {
        // Fallback: procesar individualmente
        console.warn('processBatchMetrics not available, using individual processing')
        await this.processBatchIndividually(batch)
      }
    } catch (error) {
      console.error('Failed to process metrics batch:', error)
      // Fallback en caso de error
      try {
        await this.processBatchIndividually(batch)
      } catch (fallback_error) {
        console.error('Fallback metrics processing also failed:', fallback_error)
        // Re-queue failed operations (con límite)
        if (batch.length < 1000) {
          this.queue.unshift(...batch)
        }
      }
    } finally {
      this.processing = false

      if (this.queue.length > 0) {
        this.scheduleFlush()
      }
    }
  }

  private async processBatchIndividually (batch: MetricOperation[]): Promise<void> {
    for (const operation of batch) {
      try {
        if (operation.type === 'abandonment') {
          // Usar la función original
          await repo.incrementMetricForAbandonment(
            operation.seller_id,
            {
              total_amount: operation.amount,
              date: operation.date
            } as any,
            operation.category
          )
        } else if (operation.type === 'recovery') {
          // Usar la función original
          await repo.incrementMetricForRecovery(
            operation.seller_id,
            operation.category,
            operation.session_id || ''
          )
        }
      } catch (error) {
        console.error('Failed to process individual metric:', error)
        // Continuar con la siguiente métrica
      }
    }
  }

  async forceFlush (): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.flush()
  }
}

const metrics_batch = MetricsBatch.getInstance()

// ==========================================
// SERVICE IMPLEMENTATIONS OPTIMIZADAS
// ==========================================

/**
 * 1. Crear carrito abandonado - OPTIMIZADO
 */
export async function handleCreateCartAbandoned (
  seller_id: number,
  payload: CreateCartAbandonedPayload
): Promise<{
  message: string
  cart_id: string
  already_exists: boolean
  validation_errors?: ValidationError[]
}> {
  // 1. Validación temprana
  const validation_errors = validateCartPayload(payload)
  if (validation_errors.length > 0) {
    return {
      message: 'Validation failed',
      cart_id: payload.identifiers.cart_id,
      already_exists: false,
      validation_errors
    }
  }

  const cart_id = payload.identifiers.cart_id
  const event = payload.event
  const now = new Date(event.timestamp)

  try {
    // 2. Operación atómica - buscar y actualizar o crear
    const result = await withRetry(async () => {
      const existing = await repo.findSessionByCartId(cart_id)

      if (existing) {
        // Actualizar sesión existente
        await repo.updateSessionByCartId(cart_id, {
          products: payload.products,
          products_count: payload.products_count,
          total_amount: payload.total_amount,
          updated_at: now,
          cart_updated_at: now
        })

        // Solo agregar evento si no existe ya
        const already_has_event = await repo.hasEventByCartId(cart_id, event.type)
        if (!already_has_event) {
          await repo.appendEventByCartId(cart_id, event)
        }

        return { was_new: false, already_has_event }
      }

      // Crear nueva sesión
      const session: AbandonedSession = {
        seller_id,
        session_type: payload.session_type,
        platform: payload.platform,
        email: payload.customer_info.email,
        customer_info: {
          type: 'registered',
          email: payload.customer_info.email,
          full_name: payload.customer_info.full_name,
          marketing: payload.customer_info.marketing ?? {}
        },
        identifiers: {
          cart_id,
          checkout_ulid: null
        },
        products: payload.products,
        products_count: payload.products_count,
        total_amount: payload.total_amount,
        currency: payload.currency,
        status: {
          cart: 'ABANDONED',
          checkout: null
        },
        events: [event],
        date: generateDateKey(event.timestamp),
        created_at: now,
        updated_at: now,
        cart_updated_at: now
      }

      await repo.insertSession(session)
      return { was_new: true, already_has_event: false }
    })

    // 3. Métricas asíncronas - solo para nuevas sesiones
    if (result.was_new) {
      metrics_batch.addMetric({
        seller_id,
        date: generateDateKey(event.timestamp),
        type: 'abandonment',
        category: 'cart',
        amount: payload.total_amount
      })
    }

    return {
      message: result.was_new
        ? 'New cart session created'
        : result.already_has_event
          ? 'Session updated (event already existed)'
          : 'Session updated and event added',
      cart_id,
      already_exists: !result.was_new
    }
  } catch (error) {
    console.error('Error in handleCreateCartAbandoned:', error)
    throw new Error(`Failed to process cart abandonment: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * 2. Actualizar carrito abandonado - OPTIMIZADO
 */
export async function handleUpdateCartAbandoned (
  seller_id: number,
  cart_id: string,
  payload: UpdateCartPayload
): Promise<{ cart_id: string; updated: boolean }> {
  if (!cart_id?.trim()) {
    throw new Error('cart_id is required')
  }

  if (!payload.products || payload.products.length === 0) {
    throw new Error('Products array cannot be empty')
  }

  const now = new Date(payload.event.timestamp)

  try {
    const result = await withRetry(async () => {
      // Operación atómica - update + append event
      const update_result = await repo.updateSessionByCartId(cart_id, {
        products: payload.products,
        products_count: payload.products_count,
        total_amount: payload.total_amount,
        updated_at: now,
        cart_updated_at: now
      })

      if (update_result.matchedCount > 0) {
        await repo.appendEventByCartId(cart_id, payload.event)
      }

      return update_result
    })

    return {
      cart_id,
      updated: result.matchedCount > 0
    }
  } catch (error) {
    console.error('Error in handleUpdateCartAbandoned:', error)
    throw new Error(`Failed to update cart: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * 3. Crear checkout abandonado - OPTIMIZADO
 */
export async function handleCreateCheckoutAbandoned (
  seller_id: number,
  payload: CheckoutAbandonedPayload
): Promise<{
  message: string
  checkout_ulid: string
  already_exists: boolean
  validation_errors?: ValidationError[]
}> {
  // 1. Validación temprana
  const validation_errors = validateCheckoutPayload(payload)
  if (validation_errors.length > 0) {
    return {
      message: 'Validation failed',
      checkout_ulid: payload.identifiers.checkout_ulid,
      already_exists: false,
      validation_errors
    }
  }

  const { checkout_ulid, cart_id } = payload.identifiers
  const now = new Date(payload.event.timestamp)

  try {
    // 2. Operación atómica
    const result = await withRetry(async () => {
      const existing = await repo.findSessionByCheckoutUlid(checkout_ulid)

      if (existing) {
        // Actualizar sesión existente
        const updates: Partial<AbandonedSession> = {
          updated_at: now
        }

        if (payload.products && payload.products.length > 0) {
          updates.products = payload.products
          updates.products_count = payload.products.length
          updates.total_amount = payload.total_amount
        }

        if (cart_id) {
          updates.identifiers = { ...existing.identifiers, cart_id }
        }

        await repo.updateSessionByCheckoutUlid(checkout_ulid, updates)
        await repo.appendEventByCheckoutUlid(checkout_ulid, payload.event)

        return { was_new: false }
      }

      // Crear nueva sesión
      const session: AbandonedSession = {
        seller_id,
        session_type: payload.session_type,
        platform: payload.platform,
        email: payload.customer_info.email,
        customer_info: {
          type: payload.customer_info.type,
          email: payload.customer_info.email,
          full_name: payload.customer_info.full_name ?? '',
          marketing: payload.customer_info.marketing ?? {}
        },
        identifiers: {
          cart_id: cart_id ?? null,
          checkout_ulid
        },
        products: payload.products ?? [],
        products_count: payload.products?.length ?? 0,
        total_amount: payload.total_amount,
        currency: payload.currency,
        status: {
          cart: null,
          checkout: 'ABANDONED'
        },
        events: [payload.event],
        date: generateDateKey(payload.event.timestamp),
        created_at: now,
        updated_at: now
      }

      await repo.insertSession(session)
      return { was_new: true }
    })

    // 3. Métricas asíncronas - solo para nuevas sesiones
    if (result.was_new) {
      metrics_batch.addMetric({
        seller_id,
        date: generateDateKey(payload.event.timestamp),
        type: 'abandonment',
        category: 'checkout',
        amount: payload.total_amount
      })
    }

    return {
      message: result.was_new ? 'New checkout session created' : 'Checkout session updated',
      checkout_ulid,
      already_exists: !result.was_new
    }
  } catch (error) {
    console.error('Error in handleCreateCheckoutAbandoned:', error)
    throw new Error(`Failed to process checkout abandonment: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * 4. Actualizar sesión de checkout - OPTIMIZADO
 */
export async function handleUpdateCheckoutAbandoned (
  seller_id: number,
  checkout_ulid: string,
  payload: Partial<CheckoutAbandonedPayload & { cart_id?: string }>
): Promise<{ checkout_ulid: string; updated: boolean }> {
  if (!checkout_ulid?.trim()) {
    throw new Error('checkout_ulid is required')
  }

  try {
    const result = await withRetry(async () => {
      const update_fields: any = {
        updated_at: new Date(payload.event?.timestamp || Date.now())
      }

      // Solo actualizar cart_id si viene en el payload
      if (payload.cart_id) {
        update_fields['identifiers.cart_id'] = payload.cart_id
      }

      // Actualizar productos si vienen
      if (payload.products && payload.products.length > 0) {
        update_fields.products = payload.products
        update_fields.products_count = payload.products.length
        update_fields.total_amount = payload.total_amount
      }

      const update_result = await repo.updateSessionByCheckoutUlid(checkout_ulid, update_fields)

      if (update_result.matchedCount > 0 && payload.event) {
        await repo.appendEventByCheckoutUlid(checkout_ulid, payload.event)
      }

      return update_result
    })

    return {
      checkout_ulid,
      updated: result.matchedCount > 0
    }
  } catch (error) {
    console.error('Error in handleUpdateCheckoutAbandoned:', error)
    throw new Error(`Failed to update checkout: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * 5. Marcar sesión como recuperada - OPTIMIZADO
 */
export async function handleMarkAsRecovered (
  seller_id: number,
  payload: MarkAsRecoveredPayload
): Promise<{
  message: string
  id: string
  recovered: boolean
  already_recovered?: boolean
}> {
  const { type, id, event } = payload

  if (!type || !id?.trim() || !event) {
    throw new Error('Missing required fields: type, id, and event are required')
  }

  if (!['cart', 'checkout'].includes(type)) {
    throw new Error('Type must be either "cart" or "checkout"')
  }

  const now = new Date(event.timestamp)
  const is_cart = type === 'cart'

  try {
    // 1. Verificar si ya está recuperado y actualizar atomicamente
    const result = await withRetry(async () => {
      // Verificar si ya existe el evento de recuperación
      const already_has_event = is_cart
        ? await repo.hasEventByCartId(id, event.type)
        : await repo.hasEventByCheckoutUlid(id, event.type)

      if (already_has_event) {
        return { already_recovered: true, session: null }
      }

      // Obtener la sesión antes de actualizar para las métricas
      const session = is_cart
        ? await repo.findSessionByCartId(id)
        : await repo.findSessionByCheckoutUlid(id)

      if (!session) {
        throw new Error(`Session not found for ${type} ID: ${id}`)
      }

      // Actualizar el status a RECOVERED
      const status_field = is_cart ? 'status.cart' : 'status.checkout'
      const updated_at_field = is_cart ? 'cart_updated_at' : 'checkout_updated_at'

      const update_fields: Record<string, any> = {
        [status_field]: 'RECOVERED',
        updated_at: now,
        [updated_at_field]: now
      }

      if (is_cart) {
        await repo.updateSessionByCartId(id, update_fields)
        await repo.appendEventByCartId(id, event)
      } else {
        await repo.updateSessionByCheckoutUlid(id, update_fields)
        await repo.appendEventByCheckoutUlid(id, event)
      }

      return { already_recovered: false, session }
    })

    if (result.already_recovered) {
      return {
        message: 'Session was already recovered',
        id,
        recovered: false,
        already_recovered: true
      }
    }

    // 2. Métricas asíncronas de recuperación
    if (result.session) {
      metrics_batch.addMetric({
        seller_id,
        date: result.session.date,
        type: 'recovery',
        category: is_cart ? 'cart' : 'checkout',
        amount: result.session.total_amount,
        session_id: id
      })
    }

    return {
      message: 'Session marked as recovered successfully',
      id,
      recovered: true
    }
  } catch (error) {
    console.error('Error in handleMarkAsRecovered:', error)
    throw new Error(`Failed to mark session as recovered: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

// ==========================================
// CLEANUP & HEALTH CHECK
// ==========================================

/**
 * Función para llamar en el shutdown de Lambda
 */
export async function shutdown (): Promise<void> {
  try {
    await metrics_batch.forceFlush()
    console.log('Service shutdown completed successfully')
  } catch (error) {
    console.error('Error during service shutdown:', error)
  }
}

/**
 * Health check del servicio
 */
export async function healthCheck (): Promise<{
  status: 'healthy' | 'degraded'
  metrics: {
    pending_metrics: number
  }
}> {
  try {
    // Verificar conexión a DB haciendo una query simple
    await repo.findSessionByCartId('health-check-test')

    return {
      status: 'healthy',
      metrics: {
        pending_metrics: (metrics_batch as any).queue?.length || 0
      }
    }
  } catch (error) {
    console.error('Health check failed:', error)
    return {
      status: 'degraded',
      metrics: {
        pending_metrics: (metrics_batch as any).queue?.length || 0
      }
    }
  }
}

export async function handleFlatBatchAbandonedCarts (
  payload: FlatBatchAbandonedCartsPayload
): Promise<{
  message: string
  batch_id: string
  total_processed: number
  total_created: number
  total_updated: number
  total_errors: number
  execution_time: string
  seller_stats: Record<number, {
    processed: number
    created: number
    updated: number
    errors: number
  }>
}> {
  const start_time = Date.now()

  const seller_results = [] // ✅ Para recopilar resultados con carritos nuevos

  console.log(`Processing flat batch ${payload.batch_id}`, {
    total_carts: payload.total_carts,
    total_sellers: payload.total_sellers
  })

  const overall_stats = {
    total_processed: 0,
    total_created: 0,
    total_updated: 0,
    total_errors: 0
  }

  const seller_stats: Record<number, any> = {}

  try {
    // ✅ Agrupar carts por seller_id automáticamente
    const carts_by_seller = payload.carts.reduce((acc, cart) => {
      if (!acc[cart.seller_id]) {
        acc[cart.seller_id] = []
      }
      acc[cart.seller_id].push(cart)
      return acc
    }, {} as Record<number, typeof payload.carts>)

    console.log(`Grouped carts for ${Object.keys(carts_by_seller).length} sellers`)

    // ✅ Procesar cada seller en paralelo (con límite de concurrencia)
    const seller_ids = Object.keys(carts_by_seller).map(Number)
    const concurrency_limit = 5
    const seller_chunks = chunkArray(seller_ids, concurrency_limit)

    for (const chunk of seller_chunks) {
      const chunk_promises = chunk.map(async (seller_id) => {
        const seller_carts = carts_by_seller[seller_id]
        return processFlatSellerCarts(seller_id, seller_carts, payload.timestamp)
      })

      const chunk_results = await Promise.allSettled(chunk_promises)

      // Agregar resultados
      chunk_results.forEach((result, index) => {
        const seller_id = chunk[index]

        if (result.status === 'fulfilled') {
          const stats = result.value
          seller_stats[seller_id] = {
            processed: stats.processed,
            created: stats.created,
            updated: stats.updated,
            errors: stats.errors
          }

          overall_stats.total_processed += stats.processed
          overall_stats.total_created += stats.created
          overall_stats.total_updated += stats.updated
          overall_stats.total_errors += stats.errors

          // ✅ AGREGAR: recopilar para métricas
          seller_results.push({
            seller_id,
            new_carts: stats.new_carts || [] // ✅ Fallback a array vacío
          })
        } else {
          console.error(`Failed to process seller ${seller_id}:`, result.reason)
          const seller_carts_count = carts_by_seller[seller_id].length

          seller_stats[seller_id] = {
            processed: 0,
            created: 0,
            updated: 0,
            errors: seller_carts_count
          }

          overall_stats.total_errors += seller_carts_count
        }
      })
    }

    // ✅ Procesar métricas para todos los sellers
    await processFlatBatchMetrics(seller_results, payload.timestamp)

    const execution_time = `${Date.now() - start_time}ms`

    console.log('Flat batch processing completed:', {
      ...overall_stats,
      execution_time,
      batch_id: payload.batch_id
    })

    return {
      message: 'Flat batch processed successfully',
      batch_id: payload.batch_id,
      ...overall_stats,
      execution_time,
      seller_stats
    }
  } catch (error) {
    console.error('Flat batch processing failed:', error)
    throw new Error(`Failed to process flat batch: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Procesa carts de un seller específico
 */
// ✅ MODIFICAR en abandoned.service.ts
async function processFlatSellerCarts (
  seller_id: number,
  carts: any[],
  timestamp: string
): Promise<{
  processed: number
  created: number
  updated: number
  errors: number
  new_carts: any[] // ✅ AGREGAR: carritos que fueron creados (no actualizados)
}> {
  console.log(`Processing seller ${seller_id} with ${carts.length} carts`)

  const stats = { processed: 0, created: 0, updated: 0, errors: 0 }
  const new_carts: any[] = [] // ✅ NUEVO: tracking de carritos nuevos

  try {
    // Procesar en micro-batches
    const micro_batch_size = 500
    const micro_batches = chunkArray(carts, micro_batch_size)

    for (const micro_batch of micro_batches) {
      const micro_stats = await processMicroBatchCarts(seller_id, micro_batch, timestamp)

      stats.processed += micro_stats.processed
      stats.created += micro_stats.created
      stats.updated += micro_stats.updated
      stats.errors += micro_stats.errors

      // ✅ AGREGAR: identificar carritos nuevos basado en el resultado
      if (micro_stats.created_carts) {
        new_carts.push(...micro_stats.created_carts)
      }
    }

    return { ...stats, new_carts } // ✅ RETORNAR carritos nuevos
  } catch (error) {
    console.error(`Error processing seller ${seller_id}:`, error)
    stats.errors = carts.length
    return { ...stats, new_carts: [] }
  }
}

/**
 * Procesa métricas para la estructura flat
 */
async function processFlatBatchMetrics (
  seller_results: Array<{
    seller_id: number
    new_carts: any[]
  }>,
  timestamp: string
): Promise<void> {
  const date = generateDateKey(timestamp)

  for (const { seller_id, new_carts } of seller_results) {
    if (new_carts.length === 0) {
      console.log(`⏭️ No new carts for seller ${seller_id}, skipping metrics`)
      continue
    }

    try {
      // ✅ CAMBIO: Una sola métrica agregada en lugar de 500 individuales
      const total_amount = new_carts.reduce((sum, cart) => sum + cart.total_amount, 0)
      const cart_count = new_carts.length

      const final_rounded_amount = Math.round(total_amount * 100) / 100

      // ✅ Llamar directamente al repository con datos agregados
      await repo.incrementBatchMetrics(seller_id, date, cart_count, final_rounded_amount)

      console.log(`✅ Processed ${cart_count} NEW cart metrics for seller ${seller_id} in single operation`)
    } catch (error) {
      console.error(`❌ Error processing metrics for seller ${seller_id}:`, error)
    }
  }
}

async function processFlatBatchMetrics2 (
  seller_results: Array<{
    seller_id: number
    new_carts: any[] // ✅ Solo los carritos nuevos
  }>,
  timestamp: string
): Promise<void> {
  const date = generateDateKey(timestamp)

  for (const { seller_id, new_carts } of seller_results) {
    if (new_carts.length === 0) {
      console.log(`⏭️ No new carts for seller ${seller_id}, skipping metrics`)
      continue
    }

    try {
      // ✅ Solo procesar métricas para carritos NUEVOS
      for (const cart of new_carts) {
        await repo.incrementMetricForAbandonment(
          seller_id,
          {
            total_amount: cart.total_amount,
            date
          } as any,
          'cart'
        )
      }

      console.log(`✅ Processed ${new_carts.length} NEW cart metrics for seller ${seller_id}`)
    } catch (error) {
      console.error(`❌ Error processing metrics for seller ${seller_id}:`, error)
    }
  }
}

/**
 * Divide array en chunks
 */
function chunkArray<T> (array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

/**
 * Procesa un micro-batch de carritos (operación atómica)
 */
// ✅ CORREGIR processMicroBatchCarts - falta declarar created_carts
async function processMicroBatchCarts (
  seller_id: number,
  carts: any[],
  timestamp: string
): Promise<{ processed: number; created: number; updated: number; errors: number; created_carts?: any[] }> {
  const stats = { processed: 0, created: 0, updated: 0, errors: 0 }
  const created_carts: any[] = [] // ✅ AGREGAR esta línea que falta

  // Preparar operaciones bulk para MongoDB
  const bulk_ops = []
  const now = new Date()

  for (const cart of carts) {
    try {
      const session: AbandonedSession = {
        seller_id,
        session_type: 'CART_ORIGINATED',
        platform: cart.platform,
        email: cart.email,
        customer_info: {
          type: cart.user_id ? 'registered' : 'guest',
          email: cart.email,
          full_name: cart.full_name || '',
          ...(cart.user_id && { user_id: cart.user_id })
        },
        identifiers: {
          cart_id: cart.cart_id,
          checkout_ulid: null
        },
        products: cart.products,
        products_count: cart.products.length,
        total_amount: cart.total_amount,
        currency: cart.currency,
        status: {
          cart: 'ABANDONED',
          checkout: null
        },
        events: [{
          type: 'CART_ABANDONED_BATCH',
          timestamp: cart.abandoned_at,
          details: {
            batch_processed: true,
            original_timestamp: cart.abandoned_at
          }
        }],
        date: generateDateKey(cart.abandoned_at),
        created_at: now,
        updated_at: now,
        cart_updated_at: new Date(cart.last_updated)
      }

      // ✅ SOLUCIÓN: updateOne con $setOnInsert y $set
      bulk_ops.push({
        updateOne: {
          filter: { 'identifiers.cart_id': cart.cart_id },
          update: {
            $setOnInsert: {
              // ✅ Solo se asignan si es un documento NUEVO
              seller_id: session.seller_id,
              session_type: session.session_type,
              platform: session.platform,
              email: session.email,
              customer_info: session.customer_info,
              identifiers: session.identifiers,
              currency: session.currency,
              status: session.status,
              date: session.date,
              created_at: now,  // ✅ Solo se asigna en INSERT
              events: session.events
            },
            $set: {
              // ✅ Siempre se actualizan (tanto INSERT como UPDATE)
              products: session.products,
              products_count: session.products_count,
              total_amount: session.total_amount,
              updated_at: now,  // ✅ Se actualiza siempre
              cart_updated_at: session.cart_updated_at
            }
          },
          upsert: true
        }
      })

      stats.processed++
    } catch (error) {
      console.error(`Error preparing cart ${cart.cart_id}:`, error)
      stats.errors++
    }
  }

  // Ejecutar bulk operation
  if (bulk_ops.length > 0) {
    try {
      const result = await repo.executeBulkWrite(bulk_ops)
      stats.created = result.upsertedCount
      stats.updated = result.modifiedCount

      // ✅ CORREGIR: identificar carritos nuevos
      if (result.upsertedIds) {
        Object.keys(result.upsertedIds).forEach(index => {
          const cart_index = parseInt(index)
          if (carts[cart_index]) {
            created_carts.push(carts[cart_index])
          }
        })
      }
    } catch (error) {
      console.error('Bulk write error:', error)
      stats.errors += bulk_ops.length
    }
  }

  return { ...stats, created_carts } // ✅ RETORNAR created_carts
}
