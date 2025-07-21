import { Context } from 'hono'
import { apiResponse } from '../utils/response.js'
import * as service from './todo.service.js'

export async function listTodosController (c: Context) {
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
}

export async function getTodoController (c: Context) {
  const start = Date.now()
  const id = c.req.param('id')
  const todo = await service.getTodo(id)
  const executionTime = `${Date.now() - start}ms`
  if (!todo) return c.json(apiResponse({ success: false, message: 'Todo not found', data: null, executionTime }), 404)
  return c.json(apiResponse({ data: todo, message: 'Todo retrieved successfully', executionTime }))
}

export async function createTodoController (c: Context) {
  const start = Date.now()
  const { title } = await c.req.json()
  const todo = await service.addTodo({ title })
  const executionTime = `${Date.now() - start}ms`
  return c.json(apiResponse({ data: todo, message: 'Todo created successfully', executionTime }), 201)
}

export async function updateTodoController (c: Context) {
  const start = Date.now()
  const id = c.req.param('id')
  const data = await c.req.json()
  const todo = await service.editTodo(id, data)
  const executionTime = `${Date.now() - start}ms`
  if (!todo) return c.json(apiResponse({ success: false, message: 'Todo not found', data: null, executionTime }), 404)
  return c.json(apiResponse({ data: todo, message: 'Todo updated successfully', executionTime }))
}

export async function deleteTodoController (c: Context) {
  const start = Date.now()
  const id = c.req.param('id')
  const ok = await service.removeTodo(id)
  const executionTime = `${Date.now() - start}ms`
  if (!ok) return c.json(apiResponse({ success: false, message: 'Todo not found', data: null, executionTime }), 404)
  return c.json(apiResponse({ data: null, message: 'Todo deleted successfully', executionTime }))
}
