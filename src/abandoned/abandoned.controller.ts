import { Context } from 'hono'
import { apiResponse } from '../utils/response.js'
import * as service from './abandoned.service.js'

// ==========================================
// ERROR HANDLER TYPES
// ==========================================

interface ValidationErrorDetail {
  field: string
  message: string
  count?: number
  examples?: string[]
}

interface ErrorResponse {
  success: false
  error: string
  error_type: 'validation' | 'business' | 'system'
  details?: ValidationErrorDetail[]
  operation?: string
  execution_time?: string
  request_id?: string
}

// ==========================================
// IMPROVED ERROR HANDLER
// ==========================================

/**
 * Wrapper mejorado para manejar timing y errores con detalles específicos
 */
function withImprovedTiming<T extends any[]> (
  operation: string,
  handler: (...args: T) => Promise<Response>
) {
  return async (...args: T): Promise<Response> => {
    const start = Date.now()
    const request_id = `${operation}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    try {
      const response = await handler(...args)
      const execution_time = `${Date.now() - start}ms`

      // Agregar timing a la respuesta si es exitosa
      if (response.status === 200) {
        const body = await response.json()
        return Response.json({
          ...body,
          execution_time,
          request_id
        })
      }

      return response
    } catch (error) {
      const execution_time = `${Date.now() - start}ms`

      // Log detallado del error
      console.error(`❌ Error in ${operation} [${request_id}]:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        execution_time,
        timestamp: new Date().toISOString()
      })

      const errorResponse = buildErrorResponse(error, operation, execution_time, request_id)

      return Response.json(errorResponse, {
        status: errorResponse.error_type === 'validation' ? 400 : 500
      })
    }
  }
}

/**
 * Construye una respuesta de error estructurada y útil
 */
function buildErrorResponse (
  error: unknown,
  operation: string,
  execution_time: string,
  request_id: string
): ErrorResponse {
  const message = error instanceof Error ? error.message : 'Unknown error occurred'

  // Detectar tipo de error y extraer detalles
  if (message.includes('missing seller_id')) {
    const match = message.match(/(\d+) carts are missing seller_id/)
    const count = match ? parseInt(match[1]) : 0

    return {
      success: false,
      error: 'Validation failed: Missing required seller_id',
      error_type: 'validation',
      details: [{
        field: 'carts[].seller_id',
        message: `${count} carts are missing the required seller_id field`,
        count
      }],
      operation,
      execution_time,
      request_id
    }
  }

  if (message.includes('Batch size cannot exceed')) {
    const match = message.match(/exceed ([\d,]+)/)
    const limit = match ? match[1] : '10,000'

    return {
      success: false,
      error: 'Validation failed: Batch size exceeded',
      error_type: 'validation',
      details: [{
        field: 'carts',
        message: `Batch size cannot exceed ${limit} carts`
      }],
      operation,
      execution_time,
      request_id
    }
  }

  if (message.includes('Carts array is required')) {
    return {
      success: false,
      error: 'Validation failed: Invalid carts data',
      error_type: 'validation',
      details: [{
        field: 'carts',
        message: 'Carts array is required and cannot be empty'
      }],
      operation,
      execution_time,
      request_id
    }
  }

  if (message.includes('Invalid request body')) {
    return {
      success: false,
      error: 'Validation failed: Invalid request format',
      error_type: 'validation',
      details: [{
        field: 'body',
        message: 'Request body must be a valid JSON object'
      }],
      operation,
      execution_time,
      request_id
    }
  }

  if (message.includes('missing cart_id')) {
    const match = message.match(/(\d+) carts are missing cart_id/)
    const count = match ? parseInt(match[1]) : 0

    return {
      success: false,
      error: 'Validation failed: Missing required cart_id',
      error_type: 'validation',
      details: [{
        field: 'carts[].cart_id',
        message: `${count} carts are missing the required cart_id field`,
        count
      }],
      operation,
      execution_time,
      request_id
    }
  }

  if (message.includes('missing email')) {
    const match = message.match(/(\d+) carts are missing email/)
    const count = match ? parseInt(match[1]) : 0

    return {
      success: false,
      error: 'Validation failed: Missing required email',
      error_type: 'validation',
      details: [{
        field: 'carts[].email',
        message: `${count} carts are missing the required email field`,
        count
      }],
      operation,
      execution_time,
      request_id
    }
  }

  if (message.includes('invalid total_amount')) {
    const match = message.match(/(\d+) carts have invalid total_amount/)
    const count = match ? parseInt(match[1]) : 0

    return {
      success: false,
      error: 'Validation failed: Invalid total_amount',
      error_type: 'validation',
      details: [{
        field: 'carts[].total_amount',
        message: `${count} carts have invalid total_amount (must be > 0)`,
        count
      }],
      operation,
      execution_time,
      request_id
    }
  }

  // Error de conexión a base de datos
  if (message.includes('connection') || message.includes('timeout') || message.includes('ECONNREFUSED')) {
    return {
      success: false,
      error: 'Database connection error',
      error_type: 'system',
      operation,
      execution_time,
      request_id
    }
  }

  // Error de negocio genérico
  if (message.includes('Failed to process') || message.includes('business rule')) {
    return {
      success: false,
      error: message,
      error_type: 'business',
      operation,
      execution_time,
      request_id
    }
  }

  // Error del sistema no categorizado
  return {
    success: false,
    error: `System error: ${message}`,
    error_type: 'system',
    operation,
    execution_time,
    request_id
  }
}

// ==========================================
// CONTROLLERS
// ==========================================

export const createCartAbandoned = withImprovedTiming('createCartAbandoned', async (c: Context) => {
  const seller_id = Number(c.req.param('seller_id'))

  if (!seller_id || seller_id <= 0) {
    throw new Error('Invalid seller_id: must be a positive number')
  }

  let body: any
  try {
    body = await c.req.json()
  } catch (parseError) {
    throw new Error('Invalid request body: Unable to parse JSON')
  }

  const result = await service.handleCreateCartAbandoned(seller_id, body)

  return Response.json(apiResponse({ success: true, data: result }))
})

export const updateCartAbandoned = withImprovedTiming('updateCartAbandoned', async (c: Context) => {
  const seller_id = Number(c.req.param('seller_id'))
  const cart_id = c.req.param('cart_id')

  if (!seller_id || seller_id <= 0) {
    throw new Error('Invalid seller_id: must be a positive number')
  }

  if (!cart_id?.trim()) {
    throw new Error('Invalid cart_id: cannot be empty')
  }

  const body = await c.req.json()
  const result = await service.handleUpdateCartAbandoned(seller_id, cart_id, body)

  return Response.json(apiResponse({ success: true, data: result }))
})

export const createCheckoutAbandoned = withImprovedTiming('createCheckoutAbandoned', async (c: Context) => {
  const seller_id = Number(c.req.param('seller_id'))

  if (!seller_id || seller_id <= 0) {
    throw new Error('Invalid seller_id: must be a positive number')
  }

  const body = await c.req.json()
  const result = await service.handleCreateCheckoutAbandoned(seller_id, body)

  return Response.json(apiResponse({ success: true, data: result }))
})

export const updateCheckoutAbandoned = withImprovedTiming('updateCheckoutAbandoned', async (c: Context) => {
  const seller_id = Number(c.req.param('seller_id'))
  const checkout_ulid = c.req.param('checkout_ulid')

  if (!seller_id || seller_id <= 0) {
    throw new Error('Invalid seller_id: must be a positive number')
  }

  if (!checkout_ulid?.trim()) {
    throw new Error('Invalid checkout_ulid: cannot be empty')
  }

  const body = await c.req.json()
  const result = await service.handleUpdateCheckoutAbandoned(seller_id, checkout_ulid, body)

  return Response.json(apiResponse({ success: true, data: result }))
})

export const markAsRecovered = withImprovedTiming('markAsRecovered', async (c: Context) => {
  const seller_id = Number(c.req.param('seller_id'))

  if (!seller_id || seller_id <= 0) {
    throw new Error('Invalid seller_id: must be a positive number')
  }

  const body = await c.req.json()
  const result = await service.handleMarkAsRecovered(seller_id, body)

  return Response.json(apiResponse({ success: true, data: result }))
})

export const createFlatBatchAbandonedCarts = withImprovedTiming('createFlatBatchAbandonedCarts', async (c: Context) => {
  // Validación temprana del body
  let body: any
  try {
    body = await c.req.json()
  } catch (parseError) {
    throw new Error('Invalid request body: Unable to parse JSON. Please check your request format.')
  }

  if (!body || typeof body !== 'object') {
    throw new Error('Invalid request body: must be a valid JSON object')
  }

  if (!Array.isArray(body.carts)) {
    throw new Error('Carts array is required and must be an array')
  }

  if (body.carts.length === 0) {
    throw new Error('Carts array is required and cannot be empty')
  }

  // Validar límite de batch size
  if (body.carts.length > 10000) {
    throw new Error('Batch size cannot exceed 10,000 carts')
  }

  // ✅ VALIDACIÓN MEJORADA: encontrar carts sin seller_id y dar ejemplos
  const carts_without_seller_id = body.carts
    .map((cart: any, index: number) => ({ cart, index }))
    .filter(({ cart }) => !cart.seller_id || typeof cart.seller_id !== 'number')

  if (carts_without_seller_id.length > 0) {
    // Dar algunos ejemplos de índices problemáticos
    const examples = carts_without_seller_id
      .slice(0, 5)
      .map(({ index, cart }) => `Index ${index}: ${cart.cart_id || 'unknown'} (seller_id: ${cart.seller_id})`)

    const errorMessage = `${carts_without_seller_id.length} carts are missing seller_id. Examples: ${examples.join(', ')}`

    throw new Error(errorMessage)
  }

  // Validaciones adicionales útiles
  const carts_without_cart_id = body.carts.filter((cart: any) => !cart.cart_id?.trim())
  if (carts_without_cart_id.length > 0) {
    throw new Error(`${carts_without_cart_id.length} carts are missing cart_id`)
  }

  const carts_without_email = body.carts.filter((cart: any) => !cart.email?.trim())
  if (carts_without_email.length > 0) {
    throw new Error(`${carts_without_email.length} carts are missing email`)
  }

  const carts_invalid_amount = body.carts.filter((cart: any) => !cart.total_amount || cart.total_amount <= 0)
  if (carts_invalid_amount.length > 0) {
    throw new Error(`${carts_invalid_amount.length} carts have invalid total_amount (must be > 0)`)
  }

  // Procesar el batch
  const result = await service.handleFlatBatchAbandonedCarts(body)

  return Response.json(apiResponse({
    success: true,
    data: result
  }))
})

// ==========================================
// ADMIN ENDPOINTS
// ==========================================

export const listAbandonedSessions = withImprovedTiming('listAbandonedSessions', async (c: Context) => {
  const seller_id = Number(c.req.param('seller_id'))

  if (!seller_id || seller_id <= 0) {
    throw new Error('Invalid seller_id: must be a positive number')
  }

  // Extraer query parameters
  const query = {
    page: parseInt(c.req.query('page') || '1'),
    size: parseInt(c.req.query('size') || '20'),
    sort_by: c.req.query('sort_by') || '',
    interval: c.req.query('interval') as 'today' | '7days' | '30days' || '30days',
    search: c.req.query('search') || '',
    status: c.req.query('status') as 'ABANDONED' | 'RECOVERED' | 'ACTIVE' || undefined
  }

  // Validaciones
  if (query.page < 1) {
    throw new Error('Invalid page: must be >= 1')
  }

  if (query.size < 1 || query.size > 100) {
    throw new Error('Invalid size: must be between 1 and 100')
  }

  if (query.interval && !['today', '7days', '30days'].includes(query.interval)) {
    throw new Error('Invalid interval: must be today, 7days, or 30days')
  }

  if (query.status && !['ABANDONED', 'RECOVERED', 'ACTIVE'].includes(query.status)) {
    throw new Error('Invalid status: must be ABANDONED, RECOVERED, or ACTIVE')
  }

  const result = await service.handleListAbandonedSessions(seller_id, query)

  return Response.json(result)
})

export const getAbandonedStats = withImprovedTiming('getAbandonedStats', async (c: Context) => {
  const seller_id = Number(c.req.param('seller_id'))

  if (!seller_id || seller_id <= 0) {
    throw new Error('Invalid seller_id: must be a positive number')
  }

  // Extraer query parameters
  const interval = c.req.query('interval') as 'today' | '7days' | '30days' || 'today'

  // Validaciones
  if (!['today', '7days', '30days'].includes(interval)) {
    throw new Error('Invalid interval: must be today, 7days, or 30days')
  }

  const result = await service.handleGetAbandonedStats(seller_id, { interval })

  return Response.json(result)
})
