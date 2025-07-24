import { Context } from 'hono'
import { apiResponse } from '../utils/response.js'
import * as service from './abandoned.service.js'

// Al inicio de tu abandoned.controller.ts, agregar:

/**
 * Wrapper para manejar timing y errores
 */
function withTiming<T extends any[]> (
  operation: string,
  handler: (...args: T) => Promise<Response>
) {
  return async (...args: T): Promise<Response> => {
    const start = Date.now()

    try {
      const response = await handler(...args)
      const execution_time = `${Date.now() - start}ms`

      // Agregar timing a la respuesta si es exitosa
      if (response.status === 200) {
        const body = await response.json()
        return Response.json({
          ...body,
          execution_time
        })
      }

      return response
    } catch (error) {
      const execution_time = `${Date.now() - start}ms`
      console.error(`Error in ${operation}:`, error)

      const message = error instanceof Error ? error.message : 'Unknown error occurred'
      const status_code = message.includes('Validation') ? 400 : 500

      return Response.json(
        apiResponse({
          success: false,
          error: message,
          operation,
          execution_time
        }),
        { status: status_code }
      )
    }
  }
}

export async function createCartAbandoned (c: Context) {
  const start = Date.now()
  const seller_id = Number(c.req.param('seller_id'))
  const body = await c.req.json()
  const result = await service.handleCreateCartAbandoned(seller_id, body)
  const execution_time = `${Date.now() - start}ms`
  return c.json(apiResponse({ success: true, data: result, execution_time }))
}

export async function updateCartAbandoned (c: Context) {
  const seller_id = Number(c.req.param('seller_id'))
  const cart_id = c.req.param('cart_id')
  const body = await c.req.json()
  const result = await service.handleUpdateCartAbandoned(seller_id, cart_id, body)
  return c.json(apiResponse({ success: true, data: result }))
}

export async function createCheckoutAbandoned (c: Context) {
  const seller_id = Number(c.req.param('seller_id'))
  const body = await c.req.json()
  const result = await service.handleCreateCheckoutAbandoned(seller_id, body)
  return c.json(apiResponse({ success: true, data: result }))
}

export async function updateCheckoutAbandoned (c: Context) {
  const seller_id = Number(c.req.param('seller_id'))
  const checkout_ulid = c.req.param('checkout_ulid')
  const body = await c.req.json()
  const result = await service.handleUpdateCheckoutAbandoned(seller_id, checkout_ulid, body)
  return c.json(apiResponse({ success: true, data: result }))
}

export async function markAsRecovered (c: Context) {
  const seller_id = Number(c.req.param('seller_id'))
  const body = await c.req.json()
  const result = await service.handleMarkAsRecovered(seller_id, body)
  return c.json(apiResponse({ success: true, data: result }))
}

export const createFlatBatchAbandonedCarts = withTiming('createFlatBatchAbandonedCarts', async (c: Context) => {
  const body = await c.req.json()

  if (!body || typeof body !== 'object') {
    throw new Error('Invalid request body: must be a valid JSON object')
  }

  if (!Array.isArray(body.carts) || body.carts.length === 0) {
    throw new Error('Carts array is required and cannot be empty')
  }

  // Validar límite de batch size
  if (body.carts.length > 10000) {
    throw new Error('Batch size cannot exceed 10,000 carts')
  }

  // Validar que todos los carts tengan seller_id
  const carts_without_seller_id = body.carts.filter(cart => !cart.seller_id)
  if (carts_without_seller_id.length > 0) {
    throw new Error(`${carts_without_seller_id.length} carts are missing seller_id`)
  }

  const result = await service.handleFlatBatchAbandonedCarts(body)

  return Response.json(apiResponse({
    success: true,
    data: result
  }))
})
