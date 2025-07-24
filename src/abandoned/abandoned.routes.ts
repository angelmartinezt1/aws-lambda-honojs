import { Hono } from 'hono'
import * as controller from './abandoned.controller'

const abandonedRoutes = new Hono()

// 🛒 Crear sesión de carrito abandonado
abandonedRoutes.post('/:seller_id/abandoned/cart', controller.createCartAbandoned)

// 🔁 Actualizar sesión por cart_id (productos/evento)
abandonedRoutes.put('/:seller_id/abandoned/cart/:cart_id', controller.updateCartAbandoned)

// 📦 Checkout abandonado (anónimo, sin cart_id)
abandonedRoutes.post('/:seller_id/abandoned/checkout', controller.createCheckoutAbandoned)

// 📦 Checkout abandonado con cart_id
abandonedRoutes.put('/:seller_id/abandoned/checkout/:checkout_ulid', controller.updateCheckoutAbandoned)

// 🔁 Marcar sesión como recuperada
abandonedRoutes.patch('/:seller_id/abandoned/recover', controller.markAsRecovered)

abandonedRoutes.post('/abandoned/flat-batch', controller.createFlatBatchAbandonedCarts)

export default abandonedRoutes
