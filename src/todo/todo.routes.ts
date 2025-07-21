import { Hono } from 'hono'
import * as service from './todo.service.js'
import { apiResponse } from '../utils/response.js'

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
