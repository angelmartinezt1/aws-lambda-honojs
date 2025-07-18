import { serve } from '@hono/node-server'
import app from './app.js'
import serverConfig from './config/server.js'

const server = serve({ fetch: app.fetch, port: serverConfig.port })
console.log(`Server running at http://localhost:${serverConfig.port}`)

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
