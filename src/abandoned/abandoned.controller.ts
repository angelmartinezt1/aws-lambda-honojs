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
      const executionTime = `${Date.now() - start}ms`

      // Agregar timing a la respuesta si es exitosa
      if (response.status === 200) {
        const body = await response.json()
        return Response.json({
          ...body,
          executionTime
        })
      }

      return response
    } catch (error) {
      const executionTime = `${Date.now() - start}ms`
      console.error(`Error in ${operation}:`, error)

      const message = error instanceof Error ? error.message : 'Unknown error occurred'
      const statusCode = message.includes('Validation') ? 400 : 500

      return Response.json(
        apiResponse({
          success: false,
          error: message,
          operation,
          executionTime
        }),
        { status: statusCode }
      )
    }
  }
}

export async function createCartAbandoned (c: Context) {
  const start = Date.now()
  const sellerId = Number(c.req.param('sellerId'))
  const body = await c.req.json()
  const result = await service.handleCreateCartAbandoned(sellerId, body)
  const executionTime = `${Date.now() - start}ms`
  return c.json(apiResponse({ success: true, data: result, executionTime }))
}

export async function updateCartAbandoned (c: Context) {
  const sellerId = Number(c.req.param('sellerId'))
  const cartId = c.req.param('cartId')
  const body = await c.req.json()
  const result = await service.handleUpdateCartAbandoned(sellerId, cartId, body)
  return c.json(apiResponse({ success: true, data: result }))
}

export async function createCheckoutAbandoned (c: Context) {
  const sellerId = Number(c.req.param('sellerId'))
  const body = await c.req.json()
  const result = await service.handleCreateCheckoutAbandoned(sellerId, body)
  return c.json(apiResponse({ success: true, data: result }))
}

export async function updateCheckoutAbandoned (c: Context) {
  const sellerId = Number(c.req.param('sellerId'))
  const checkoutUlid = c.req.param('checkoutUlid')
  const body = await c.req.json()
  const result = await service.handleUpdateCheckoutAbandoned(sellerId, checkoutUlid, body)
  return c.json(apiResponse({ success: true, data: result }))
}

export async function markAsRecovered (c: Context) {
  const sellerId = Number(c.req.param('sellerId'))
  const body = await c.req.json()
  const result = await service.handleMarkAsRecovered(sellerId, body)
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

  // Validar que todos los carts tengan sellerId
  const cartsWithoutSellerId = body.carts.filter(cart => !cart.sellerId)
  if (cartsWithoutSellerId.length > 0) {
    throw new Error(`${cartsWithoutSellerId.length} carts are missing sellerId`)
  }

  const result = await service.handleFlatBatchAbandonedCarts(body)

  return Response.json(apiResponse({
    success: true,
    data: result
  }))
})
