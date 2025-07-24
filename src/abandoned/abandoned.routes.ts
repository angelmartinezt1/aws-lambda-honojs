import { Hono } from 'hono'
import * as controller from './abandoned.controller'

const abandonedRoutes = new Hono()

// 🛒 Crear sesión de carrito abandonado
abandonedRoutes.post('/:sellerId/abandoned/cart', controller.createCartAbandoned)

// 🔁 Actualizar sesión por cartId (productos/evento)
abandonedRoutes.put('/:sellerId/abandoned/cart/:cartId', controller.updateCartAbandoned)

// 📦 Checkout abandonado (anónimo, sin cartId)
abandonedRoutes.post('/:sellerId/abandoned/checkout', controller.createCheckoutAbandoned)

// 📦 Checkout abandonado con cartId
abandonedRoutes.put('/:sellerId/abandoned/checkout/:checkoutUlid', controller.updateCheckoutAbandoned)

// 🔁 Marcar sesión como recuperada
abandonedRoutes.patch('/:sellerId/abandoned/recover', controller.markAsRecovered)

export default abandonedRoutes
