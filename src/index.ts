import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { handle } from 'hono/aws-lambda'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono! Local')
})

if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000
  const server = serve({ fetch: app.fetch, port })
  console.log(`Server running at http://localhost:${port}`)
  // graceful shutdown
  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully...')
    server.close()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    server.close((err) => {
      if (err) {
        console.error(err)
        process.exit(1)
      }
      process.exit(0)
    })
  })
}

export const handler = handle(app)
