import { Hono } from 'hono'
import {
  createTodoController,
  deleteTodoController,
  getTodoController,
  listTodosController,
  updateTodoController,
} from './todo.controller.js'

const todoRoutes = new Hono()

todoRoutes.get('/', listTodosController)
todoRoutes.get('/:id', getTodoController)
todoRoutes.post('/', createTodoController)
todoRoutes.put('/:id', updateTodoController)
todoRoutes.delete('/:id', deleteTodoController)

export default todoRoutes
