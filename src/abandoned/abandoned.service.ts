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

  if (!payload.identifiers?.cartId?.trim()) {
    errors.push({ field: 'cartId', message: 'CartId is required and cannot be empty' })
  }

  if (!payload.customerInfo?.email?.trim()) {
    errors.push({ field: 'email', message: 'Customer email is required' })
  }

  if (!payload.products || payload.products.length === 0) {
    errors.push({ field: 'products', message: 'Products array cannot be empty' })
  }

  if (!payload.totalAmount || payload.totalAmount <= 0) {
    errors.push({ field: 'totalAmount', message: 'Total amount must be greater than 0' })
  }

  return errors
}

function validateCheckoutPayload (payload: CheckoutAbandonedPayload): ValidationError[] {
  const errors: ValidationError[] = []

  if (!payload.identifiers?.checkoutUlid?.trim()) {
    errors.push({ field: 'checkoutUlid', message: 'CheckoutUlid is required' })
  }

  if (!payload.customerInfo?.email?.trim()) {
    errors.push({ field: 'email', message: 'Customer email is required' })
  }

  if (!payload.totalAmount || payload.totalAmount <= 0) {
    errors.push({ field: 'totalAmount', message: 'Total amount must be greater than 0' })
  }

  return errors
}

// Utility para retry con backoff exponencial
async function withRetry<T> (
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 100
): Promise<T> {
  let lastError: Error

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error as Error

      if (attempt === maxRetries) break

      // Exponential backoff con jitter
      const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 100
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError!
}

// ==========================================
// METRICS HELPER - CON FALLBACK
// ==========================================

interface MetricOperation {
  sellerId: number
  date: string
  type: 'abandonment' | 'recovery'
  category: 'cart' | 'checkout'
  amount: number
  sessionId?: string
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
      } catch (fallbackError) {
        console.error('Fallback metrics processing also failed:', fallbackError)
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
            operation.sellerId,
            {
              totalAmount: operation.amount,
              date: operation.date
            } as any,
            operation.category
          )
        } else if (operation.type === 'recovery') {
          // Usar la función original
          await repo.incrementMetricForRecovery(
            operation.sellerId,
            operation.category,
            operation.sessionId || ''
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

const metricsBatch = MetricsBatch.getInstance()

// ==========================================
// SERVICE IMPLEMENTATIONS OPTIMIZADAS
// ==========================================

/**
 * 1. Crear carrito abandonado - OPTIMIZADO
 */
export async function handleCreateCartAbandoned (
  sellerId: number,
  payload: CreateCartAbandonedPayload
): Promise<{
  message: string
  cartId: string
  alreadyExists: boolean
  validationErrors?: ValidationError[]
}> {
  // 1. Validación temprana
  const validationErrors = validateCartPayload(payload)
  if (validationErrors.length > 0) {
    return {
      message: 'Validation failed',
      cartId: payload.identifiers.cartId,
      alreadyExists: false,
      validationErrors
    }
  }

  const cartId = payload.identifiers.cartId
  const event = payload.event
  const now = new Date(event.timestamp)

  try {
    // 2. Operación atómica - buscar y actualizar o crear
    const result = await withRetry(async () => {
      const existing = await repo.findSessionByCartId(cartId)

      if (existing) {
        // Actualizar sesión existente
        await repo.updateSessionByCartId(cartId, {
          products: payload.products,
          productsCount: payload.productsCount,
          totalAmount: payload.totalAmount,
          updatedAt: now,
          cartUpdatedAt: now
        })

        // Solo agregar evento si no existe ya
        const alreadyHasEvent = await repo.hasEventByCartId(cartId, event.type)
        if (!alreadyHasEvent) {
          await repo.appendEventByCartId(cartId, event)
        }

        return { wasNew: false, alreadyHasEvent }
      }

      // Crear nueva sesión
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
      return { wasNew: true, alreadyHasEvent: false }
    })

    // 3. Métricas asíncronas - solo para nuevas sesiones
    if (result.wasNew) {
      metricsBatch.addMetric({
        sellerId,
        date: generateDateKey(event.timestamp),
        type: 'abandonment',
        category: 'cart',
        amount: payload.totalAmount
      })
    }

    return {
      message: result.wasNew
        ? 'New cart session created'
        : result.alreadyHasEvent
          ? 'Session updated (event already existed)'
          : 'Session updated and event added',
      cartId,
      alreadyExists: !result.wasNew
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
  sellerId: number,
  cartId: string,
  payload: UpdateCartPayload
): Promise<{ cartId: string; updated: boolean }> {
  if (!cartId?.trim()) {
    throw new Error('CartId is required')
  }

  if (!payload.products || payload.products.length === 0) {
    throw new Error('Products array cannot be empty')
  }

  const now = new Date(payload.event.timestamp)

  try {
    const result = await withRetry(async () => {
      // Operación atómica - update + append event
      const updateResult = await repo.updateSessionByCartId(cartId, {
        products: payload.products,
        productsCount: payload.productsCount,
        totalAmount: payload.totalAmount,
        updatedAt: now,
        cartUpdatedAt: now
      })

      if (updateResult.matchedCount > 0) {
        await repo.appendEventByCartId(cartId, payload.event)
      }

      return updateResult
    })

    return {
      cartId,
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
  sellerId: number,
  payload: CheckoutAbandonedPayload
): Promise<{
  message: string
  checkoutUlid: string
  alreadyExists: boolean
  validationErrors?: ValidationError[]
}> {
  // 1. Validación temprana
  const validationErrors = validateCheckoutPayload(payload)
  if (validationErrors.length > 0) {
    return {
      message: 'Validation failed',
      checkoutUlid: payload.identifiers.checkoutUlid,
      alreadyExists: false,
      validationErrors
    }
  }

  const { checkoutUlid, cartId } = payload.identifiers
  const now = new Date(payload.event.timestamp)

  try {
    // 2. Operación atómica
    const result = await withRetry(async () => {
      const existing = await repo.findSessionByCheckoutUlid(checkoutUlid)

      if (existing) {
        // Actualizar sesión existente
        const updates: Partial<AbandonedSession> = {
          updatedAt: now
        }

        if (payload.products && payload.products.length > 0) {
          updates.products = payload.products
          updates.productsCount = payload.products.length
          updates.totalAmount = payload.totalAmount
        }

        if (cartId) {
          updates.identifiers = { ...existing.identifiers, cartId }
        }

        await repo.updateSessionByCheckoutUlid(checkoutUlid, updates)
        await repo.appendEventByCheckoutUlid(checkoutUlid, payload.event)

        return { wasNew: false }
      }

      // Crear nueva sesión
      const session: AbandonedSession = {
        sellerId,
        sessionType: payload.sessionType,
        platform: payload.platform,
        email: payload.customerInfo.email,
        customerInfo: {
          type: payload.customerInfo.type,
          email: payload.customerInfo.email,
          fullName: payload.customerInfo.fullName ?? '',
          marketing: payload.customerInfo.marketing ?? {}
        },
        identifiers: {
          cartId: cartId ?? null,
          checkoutUlid
        },
        products: payload.products ?? [],
        productsCount: payload.products?.length ?? 0,
        totalAmount: payload.totalAmount,
        currency: payload.currency,
        status: {
          cart: null,
          checkout: 'ABANDONED'
        },
        events: [payload.event],
        date: generateDateKey(payload.event.timestamp),
        createdAt: now,
        updatedAt: now
      }

      await repo.insertSession(session)
      return { wasNew: true }
    })

    // 3. Métricas asíncronas - solo para nuevas sesiones
    if (result.wasNew) {
      metricsBatch.addMetric({
        sellerId,
        date: generateDateKey(payload.event.timestamp),
        type: 'abandonment',
        category: 'checkout',
        amount: payload.totalAmount
      })
    }

    return {
      message: result.wasNew ? 'New checkout session created' : 'Checkout session updated',
      checkoutUlid,
      alreadyExists: !result.wasNew
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
  sellerId: number,
  checkoutUlid: string,
  payload: Partial<CheckoutAbandonedPayload & { cartId?: string }>
): Promise<{ checkoutUlid: string; updated: boolean }> {
  if (!checkoutUlid?.trim()) {
    throw new Error('CheckoutUlid is required')
  }

  try {
    const result = await withRetry(async () => {
      const updateFields: any = {
        updatedAt: new Date(payload.event?.timestamp || Date.now())
      }

      // Solo actualizar cartId si viene en el payload
      if (payload.cartId) {
        updateFields['identifiers.cartId'] = payload.cartId
      }

      // Actualizar productos si vienen
      if (payload.products && payload.products.length > 0) {
        updateFields.products = payload.products
        updateFields.productsCount = payload.products.length
        updateFields.totalAmount = payload.totalAmount
      }

      const updateResult = await repo.updateSessionByCheckoutUlid(checkoutUlid, updateFields)

      if (updateResult.matchedCount > 0 && payload.event) {
        await repo.appendEventByCheckoutUlid(checkoutUlid, payload.event)
      }

      return updateResult
    })

    return {
      checkoutUlid,
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
  sellerId: number,
  payload: MarkAsRecoveredPayload
): Promise<{
  message: string
  id: string
  recovered: boolean
  alreadyRecovered?: boolean
}> {
  const { type, id, event } = payload

  if (!type || !id?.trim() || !event) {
    throw new Error('Missing required fields: type, id, and event are required')
  }

  if (!['cart', 'checkout'].includes(type)) {
    throw new Error('Type must be either "cart" or "checkout"')
  }

  const now = new Date(event.timestamp)
  const isCart = type === 'cart'

  try {
    // 1. Verificar si ya está recuperado y actualizar atomicamente
    const result = await withRetry(async () => {
      // Verificar si ya existe el evento de recuperación
      const alreadyHasEvent = isCart
        ? await repo.hasEventByCartId(id, event.type)
        : await repo.hasEventByCheckoutUlid(id, event.type)

      if (alreadyHasEvent) {
        return { alreadyRecovered: true, session: null }
      }

      // Obtener la sesión antes de actualizar para las métricas
      const session = isCart
        ? await repo.findSessionByCartId(id)
        : await repo.findSessionByCheckoutUlid(id)

      if (!session) {
        throw new Error(`Session not found for ${type} ID: ${id}`)
      }

      // Actualizar el status a RECOVERED
      const statusField = isCart ? 'status.cart' : 'status.checkout'
      const updatedAtField = isCart ? 'cartUpdatedAt' : 'checkoutUpdatedAt'

      const updateFields: Record<string, any> = {
        [statusField]: 'RECOVERED',
        updatedAt: now,
        [updatedAtField]: now
      }

      if (isCart) {
        await repo.updateSessionByCartId(id, updateFields)
        await repo.appendEventByCartId(id, event)
      } else {
        await repo.updateSessionByCheckoutUlid(id, updateFields)
        await repo.appendEventByCheckoutUlid(id, event)
      }

      return { alreadyRecovered: false, session }
    })

    if (result.alreadyRecovered) {
      return {
        message: 'Session was already recovered',
        id,
        recovered: false,
        alreadyRecovered: true
      }
    }

    // 2. Métricas asíncronas de recuperación
    if (result.session) {
      metricsBatch.addMetric({
        sellerId,
        date: result.session.date,
        type: 'recovery',
        category: isCart ? 'cart' : 'checkout',
        amount: result.session.totalAmount,
        sessionId: id
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
    await metricsBatch.forceFlush()
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
    pendingMetrics: number
  }
}> {
  try {
    // Verificar conexión a DB haciendo una query simple
    await repo.findSessionByCartId('health-check-test')

    return {
      status: 'healthy',
      metrics: {
        pendingMetrics: (metricsBatch as any).queue?.length || 0
      }
    }
  } catch (error) {
    console.error('Health check failed:', error)
    return {
      status: 'degraded',
      metrics: {
        pendingMetrics: (metricsBatch as any).queue?.length || 0
      }
    }
  }
}

export async function handleFlatBatchAbandonedCarts (
  payload: FlatBatchAbandonedCartsPayload
): Promise<{
  message: string
  batchId: string
  totalProcessed: number
  totalCreated: number
  totalUpdated: number
  totalErrors: number
  executionTime: string
  sellerStats: Record<number, {
    processed: number
    created: number
    updated: number
    errors: number
  }>
}> {
  const startTime = Date.now()

  const sellerResults = [] // ✅ Para recopilar resultados con carritos nuevos

  console.log(`Processing flat batch ${payload.batchId}`, {
    totalCarts: payload.totalCarts,
    totalSellers: payload.totalSellers
  })

  const overallStats = {
    totalProcessed: 0,
    totalCreated: 0,
    totalUpdated: 0,
    totalErrors: 0
  }

  const sellerStats: Record<number, any> = {}

  try {
    // ✅ Agrupar carts por sellerId automáticamente
    const cartsBySeller = payload.carts.reduce((acc, cart) => {
      if (!acc[cart.sellerId]) {
        acc[cart.sellerId] = []
      }
      acc[cart.sellerId].push(cart)
      return acc
    }, {} as Record<number, typeof payload.carts>)

    console.log(`Grouped carts for ${Object.keys(cartsBySeller).length} sellers`)

    // ✅ Procesar cada seller en paralelo (con límite de concurrencia)
    const sellerIds = Object.keys(cartsBySeller).map(Number)
    const concurrencyLimit = 5
    const sellerChunks = chunkArray(sellerIds, concurrencyLimit)

    for (const chunk of sellerChunks) {
      const chunkPromises = chunk.map(async (sellerId) => {
        const sellerCarts = cartsBySeller[sellerId]
        return processFlatSellerCarts(sellerId, sellerCarts, payload.timestamp)
      })

      const chunkResults = await Promise.allSettled(chunkPromises)

      // Agregar resultados
      chunkResults.forEach((result, index) => {
        const sellerId = chunk[index]

        if (result.status === 'fulfilled') {
          const stats = result.value
          sellerStats[sellerId] = {
            processed: stats.processed,
            created: stats.created,
            updated: stats.updated,
            errors: stats.errors
          }

          overallStats.totalProcessed += stats.processed
          overallStats.totalCreated += stats.created
          overallStats.totalUpdated += stats.updated
          overallStats.totalErrors += stats.errors

          // ✅ AGREGAR: recopilar para métricas
          sellerResults.push({
            sellerId,
            newCarts: stats.newCarts || [] // ✅ Fallback a array vacío
          })
        } else {
          console.error(`Failed to process seller ${sellerId}:`, result.reason)
          const sellerCartsCount = cartsBySeller[sellerId].length

          sellerStats[sellerId] = {
            processed: 0,
            created: 0,
            updated: 0,
            errors: sellerCartsCount
          }

          overallStats.totalErrors += sellerCartsCount
        }
      })
    }

    // ✅ Procesar métricas para todos los sellers
    await processFlatBatchMetrics(sellerResults, payload.timestamp)

    const executionTime = `${Date.now() - startTime}ms`

    console.log('Flat batch processing completed:', {
      ...overallStats,
      executionTime,
      batchId: payload.batchId
    })

    return {
      message: 'Flat batch processed successfully',
      batchId: payload.batchId,
      ...overallStats,
      executionTime,
      sellerStats
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
  sellerId: number,
  carts: any[],
  timestamp: string
): Promise<{
  processed: number
  created: number
  updated: number
  errors: number
  newCarts: any[] // ✅ AGREGAR: carritos que fueron creados (no actualizados)
}> {
  console.log(`Processing seller ${sellerId} with ${carts.length} carts`)

  const stats = { processed: 0, created: 0, updated: 0, errors: 0 }
  const newCarts: any[] = [] // ✅ NUEVO: tracking de carritos nuevos

  try {
    // Procesar en micro-batches
    const microBatchSize = 500
    const microBatches = chunkArray(carts, microBatchSize)

    for (const microBatch of microBatches) {
      const microStats = await processMicroBatchCarts(sellerId, microBatch, timestamp)

      stats.processed += microStats.processed
      stats.created += microStats.created
      stats.updated += microStats.updated
      stats.errors += microStats.errors

      // ✅ AGREGAR: identificar carritos nuevos basado en el resultado
      if (microStats.createdCarts) {
        newCarts.push(...microStats.createdCarts)
      }
    }

    return { ...stats, newCarts } // ✅ RETORNAR carritos nuevos
  } catch (error) {
    console.error(`Error processing seller ${sellerId}:`, error)
    stats.errors = carts.length
    return { ...stats, newCarts: [] }
  }
}

/**
 * Procesa métricas para la estructura flat
 */
async function processFlatBatchMetrics (
  sellerResults: Array<{
    sellerId: number
    newCarts: any[]
  }>,
  timestamp: string
): Promise<void> {
  const date = generateDateKey(timestamp)

  for (const { sellerId, newCarts } of sellerResults) {
    if (newCarts.length === 0) {
      console.log(`⏭️ No new carts for seller ${sellerId}, skipping metrics`)
      continue
    }

    try {
      // ✅ CAMBIO: Una sola métrica agregada en lugar de 500 individuales
      const totalAmount = newCarts.reduce((sum, cart) => sum + cart.totalAmount, 0)
      const cartCount = newCarts.length

      const finalRoundedAmount = Math.round(totalAmount * 100) / 100

      // ✅ Llamar directamente al repository con datos agregados
      await repo.incrementBatchMetrics(sellerId, date, cartCount, finalRoundedAmount)

      console.log(`✅ Processed ${cartCount} NEW cart metrics for seller ${sellerId} in single operation`)
    } catch (error) {
      console.error(`❌ Error processing metrics for seller ${sellerId}:`, error)
    }
  }
}
async function processFlatBatchMetrics2 (
  sellerResults: Array<{
    sellerId: number
    newCarts: any[] // ✅ Solo los carritos nuevos
  }>,
  timestamp: string
): Promise<void> {
  const date = generateDateKey(timestamp)

  for (const { sellerId, newCarts } of sellerResults) {
    if (newCarts.length === 0) {
      console.log(`⏭️ No new carts for seller ${sellerId}, skipping metrics`)
      continue
    }

    try {
      // ✅ Solo procesar métricas para carritos NUEVOS
      for (const cart of newCarts) {
        await repo.incrementMetricForAbandonment(
          sellerId,
          {
            totalAmount: cart.totalAmount,
            date
          } as any,
          'cart'
        )
      }

      console.log(`✅ Processed ${newCarts.length} NEW cart metrics for seller ${sellerId}`)
    } catch (error) {
      console.error(`❌ Error processing metrics for seller ${sellerId}:`, error)
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
// ✅ CORREGIR processMicroBatchCarts - falta declarar createdCarts
async function processMicroBatchCarts (
  sellerId: number,
  carts: any[],
  timestamp: string
): Promise<{ processed: number; created: number; updated: number; errors: number; createdCarts?: any[] }> {
  const stats = { processed: 0, created: 0, updated: 0, errors: 0 }
  const createdCarts: any[] = [] // ✅ AGREGAR esta línea que falta

  // Preparar operaciones bulk para MongoDB
  const bulkOps = []
  const now = new Date()

  for (const cart of carts) {
    try {
      const session: AbandonedSession = {
        sellerId,
        sessionType: 'CART_ORIGINATED',
        platform: cart.platform,
        email: cart.email,
        customerInfo: {
          type: cart.userId ? 'registered' : 'guest',
          email: cart.email,
          fullName: cart.fullName || '',
          ...(cart.userId && { userId: cart.userId })
        },
        identifiers: {
          cartId: cart.cartId,
          checkoutUlid: null
        },
        products: cart.products,
        productsCount: cart.products.length,
        totalAmount: cart.totalAmount,
        currency: cart.currency,
        status: {
          cart: 'ABANDONED',
          checkout: null
        },
        events: [{
          type: 'CART_ABANDONED_BATCH',
          timestamp: cart.abandonedAt,
          details: {
            batchProcessed: true,
            originalTimestamp: cart.abandonedAt
          }
        }],
        date: generateDateKey(cart.abandonedAt),
        createdAt: now,
        updatedAt: now,
        cartUpdatedAt: new Date(cart.lastUpdated)
      }

      // Usar upsert para evitar duplicados
      /* bulkOps.push({
        replaceOne: {
          filter: { 'identifiers.cartId': cart.cartId },
          replacement: session,
          upsert: true
        }
      }) */

      // ✅ SOLUCIÓN: updateOne con $setOnInsert y $set
      bulkOps.push({
        updateOne: {
          filter: { 'identifiers.cartId': cart.cartId },
          update: {
            $setOnInsert: {
              // ✅ Solo se asignan si es un documento NUEVO
              sellerId: session.sellerId,
              sessionType: session.sessionType,
              platform: session.platform,
              email: session.email,
              customerInfo: session.customerInfo,
              identifiers: session.identifiers,
              currency: session.currency,
              status: session.status,
              date: session.date,
              createdAt: now,  // ✅ Solo se asigna en INSERT
              events: session.events
            },
            $set: {
              // ✅ Siempre se actualizan (tanto INSERT como UPDATE)
              products: session.products,
              productsCount: session.productsCount,
              totalAmount: session.totalAmount,
              updatedAt: now,  // ✅ Se actualiza siempre
              cartUpdatedAt: session.cartUpdatedAt
            }
          },
          upsert: true
        }
      })

      stats.processed++
    } catch (error) {
      console.error(`Error preparing cart ${cart.cartId}:`, error)
      stats.errors++
    }
  }

  // Ejecutar bulk operation
  if (bulkOps.length > 0) {
    try {
      const result = await repo.executeBulkWrite(bulkOps)
      stats.created = result.upsertedCount
      stats.updated = result.modifiedCount

      // ✅ CORREGIR: identificar carritos nuevos
      if (result.upsertedIds) {
        Object.keys(result.upsertedIds).forEach(index => {
          const cartIndex = parseInt(index)
          if (carts[cartIndex]) {
            createdCarts.push(carts[cartIndex])
          }
        })
      }
    } catch (error) {
      console.error('Bulk write error:', error)
      stats.errors += bulkOps.length
    }
  }

  return { ...stats, createdCarts } // ✅ RETORNAR createdCarts
}
