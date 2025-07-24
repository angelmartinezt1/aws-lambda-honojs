import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import abandonedRoutes from './abandoned/index.js'
import corsConfig from './config/cors.js'
import todoRoutes from './todo/index.js'

const app = new Hono()

app.use(logger())
app.use('*', cors(corsConfig))
app.route('/todo', todoRoutes)
app.route('/abandoned', abandonedRoutes)
app.get('/', (c) => {
  return c.json('Hello Hono! Github Actions CI/CD with AWS Lambda')
})

export default app
