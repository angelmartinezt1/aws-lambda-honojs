import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import corsConfig from './config/cors.js'
import todoRoutes from './todo/index.js'

const app = new Hono()

app.use(logger())
app.use('*', cors(corsConfig))
app.route('/todo', todoRoutes)
app.get('/', (c) => {
  return c.json('Hello Hono! Local')
})

export default app
