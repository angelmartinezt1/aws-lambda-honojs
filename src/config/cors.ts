const envOrigins = process.env.CORS_ORIGINS || ''
const allowedOrigins = envOrigins.split(',').map(o => o.trim()).filter(Boolean)

export default {
  origin: (origin: string) => {
    if (!origin) return null
    if (allowedOrigins.includes('*')) return '*'
    return allowedOrigins.includes(origin) ? origin : null
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}
