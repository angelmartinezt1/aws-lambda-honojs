import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { handle } from 'hono/aws-lambda'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono! Local')
})

if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000
  serve({ fetch: app.fetch, port })
  console.log(`Server running at http://localhost:${port}`)
}

export const handler = handle(app)
