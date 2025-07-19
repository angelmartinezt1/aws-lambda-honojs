import { ObjectId, WithId } from 'mongodb'
import { connectToDatabase } from '../config/mongo.js'
import { Todo } from './todo.model.js'

const COLLECTION = 'todos'

export async function getAllTodos (): Promise<Todo[]> {
  const db = await connectToDatabase()
  const docs = await db.collection<WithId<Todo>>(COLLECTION).find().toArray()
  return docs.map(doc => ({ ...doc, _id: doc._id?.toString() }))
}

export async function getTodoById (id: string): Promise<Todo | null> {
  const db = await connectToDatabase()
  const doc = await db.collection<WithId<Todo>>(COLLECTION).findOne({ _id: new ObjectId(id) })
  return doc ? { ...doc, _id: doc._id?.toString() } : null
}

export async function createTodo (todo: Omit<Todo, '_id' | 'createdAt' | 'updatedAt'>): Promise<Todo> {
  const db = await connectToDatabase()
  const now = new Date()
  const doc = { ...todo, completed: false, createdAt: now, updatedAt: now }
  const result = await db.collection<Todo>(COLLECTION).insertOne(doc)
  return { ...doc, _id: result.insertedId.toString() }
}

export async function updateTodo (id: string, update: Partial<Todo>): Promise<Todo | null> {
  const db = await connectToDatabase()
  const result = await db.collection<WithId<Todo>>(COLLECTION).findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: { ...update, updatedAt: new Date() } },
    { returnDocument: 'after' }
  ) as any
  const value = result?.value
  if (!value) return null
  return { ...value, _id: value._id?.toString() }
}

export async function deleteTodo (id: string): Promise<boolean> {
  const db = await connectToDatabase()
  const result = await db.collection<WithId<Todo>>(COLLECTION).deleteOne({ _id: new ObjectId(id) })
  return result.deletedCount === 1
}
