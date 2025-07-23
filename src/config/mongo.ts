import { Db, MongoClient } from 'mongodb'

const uri = process.env.MONGODB_URI || ''
if (!uri) throw new Error('MONGODB_URI is not set in environment variables')

let cachedClient: MongoClient | null = null
let cachedDb: Db | null = null

export async function connectToDatabase (): Promise<Db> {
  if (cachedDb) return cachedDb

  const options = {
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 10000,
    waitQueueTimeoutMS: 10000,
    appName: 'hono-todo-app',
  }

  if (!cachedClient) {
    cachedClient = new MongoClient(uri, options)
    await cachedClient.connect()
  } else {
    try {
      await cachedClient.db().command({ ping: 1 })
    } catch (err) {
      console.warn('⚠️ Reestableciendo conexión con MongoDB...')
      cachedClient = new MongoClient(uri, options)
      await cachedClient.connect()
    }
  }

  cachedDb = cachedClient.db()
  return cachedDb
}
