import { Context } from 'hono'
import * as service from './todo.service.js'

export async function listTodosController (c: Context) {
  const todos = await service.listTodos()
  return c.json(todos)
}

export async function getTodoController (c: Context) {
  const id = c.req.param('id')
  const todo = await service.getTodo(id)
  if (!todo) return c.notFound()
  return c.json(todo)
}

export async function createTodoController (c: Context) {
  const { title } = await c.req.json()
  const todo = await service.addTodo({ title })
  return c.json(todo, 201)
}

export async function updateTodoController (c: Context) {
  const id = c.req.param('id')
  const data = await c.req.json()
  const todo = await service.editTodo(id, data)
  if (!todo) return c.notFound()
  return c.json(todo)
}

export async function deleteTodoController (c: Context) {
  const id = c.req.param('id')
  const ok = await service.removeTodo(id)
  if (!ok) return c.notFound()
  return c.body(null, 204)
}
