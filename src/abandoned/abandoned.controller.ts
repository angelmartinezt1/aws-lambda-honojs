import { Context } from 'hono'
import { apiResponse } from '../utils/response.js'
import * as service from './abandoned.service.js'

export async function createCartAbandoned (c: Context) {
  const sellerId = Number(c.req.param('sellerId'))
  const body = await c.req.json()
  const result = await service.handleCreateCartAbandoned(sellerId, body)
  return c.json(apiResponse({ success: true, data: result }))
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
