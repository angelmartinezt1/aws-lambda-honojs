import { ObjectId } from 'mongodb'

export interface Todo {
  _id?: string | ObjectId
  title: string
  completed: boolean
  createdAt: Date
  updatedAt: Date
}
