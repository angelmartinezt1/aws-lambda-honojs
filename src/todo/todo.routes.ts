import { Hono } from 'hono'
import { connectToDatabase } from '../config/mongo.js'
import { apiResponse } from '../utils/response.js'
import * as service from './todo.service.js'

const todoRoutes = new Hono()

todoRoutes.get('/', async (c) => {
  const start = Date.now()
  const todos = await service.listTodos()
  const executionTime = `${Date.now() - start}ms`
  return c.json(apiResponse({
    data: todos,
    message: 'Todos retrieved successfully',
    executionTime,
    pagination: {
      page: 1,
      size: todos.length,
      totalElements: todos.length,
      totalPages: 1
    }
  }))
})

todoRoutes.get('/db-ping', async (c) => {
  try {
    const db = await connectToDatabase()
    const result = await db.admin().ping()
    return c.json({ ok: true, result })
  } catch (err) {
    console.error(err)
    return c.json({ ok: false, error: err.message }, 500)
  }
})

todoRoutes.get('/:id', async (c) => {
  const id = c.req.param('id')
  const todo = await service.getTodo(id)
  if (!todo) return c.notFound()
  return c.json(todo)
})

todoRoutes.post('/', async (c) => {
  const { title } = await c.req.json()
  const todo = await service.addTodo({ title })
  return c.json(todo, 201)
})

todoRoutes.put('/:id', async (c) => {
  const id = c.req.param('id')
  const data = await c.req.json()
  const todo = await service.editTodo(id, data)
  if (!todo) return c.notFound()
  return c.json(todo)
})

todoRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const ok = await service.removeTodo(id)
  if (!ok) return c.notFound()
  return c.body(null, 204)
})

export default todoRoutes
