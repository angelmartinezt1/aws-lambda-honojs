import { Db, MongoClient } from 'mongodb'

const uri = process.env.MONGODB_URI || ''
if (!uri) throw new Error('MONGODB_URI is not set in environment variables')

let cachedClient: MongoClient | null = null
let cachedDb: Db | null = null

export async function connectToDatabase (): Promise<Db> {
  if (cachedDb) return cachedDb

  // MongoClient is designed to be reused across invocations in Lambda
  if (!cachedClient) {
    cachedClient = new MongoClient(uri, {
      maxPoolSize: 10, // recommended for Lambda
      minPoolSize: 0,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 10000,
      waitQueueTimeoutMS: 10000,
      appName: 'hono-todo-app',
    })
    await cachedClient.connect()
  }
  cachedDb = cachedClient.db()
  return cachedDb
}
